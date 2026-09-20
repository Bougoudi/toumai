import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { asyncHandler, parseBody, parseQuery } from '../../middleware/validate.js';
import { forbidden, notFound } from '../lib/errors.js';
import { pageParams, paginated } from '../lib/pagination.js';
import { authenticate, currentUser, requireAdmin } from '../middleware/toumaAuth.js';
import { redactForPublic, trustService } from './trust.service.js';
import { activeBadges, BADGE_RULES } from './badges.js';
import { appealService, standingService, STANDING_EFFECTS } from './standing.service.js';
import { BUYER_FACTORS, LEVEL_THRESHOLDS, PRODUCT_FACTORS, SELLER_FACTORS, SUPPLIER_FACTORS, THRESHOLDS, MIN_SAMPLE, DECAY } from './weights.js';
import { assess, LEVELS, SIGNALS } from './verification-levels.js';
import { configuredProviderSignals } from './verification-provider.js';

/**
 * TOUMA TRUST — API.
 *
 * **Rien de ce qui suit ne permet d'écrire un score, un badge ou un statut de
 * vérification.** Les seules écritures exposées sont un recours (par
 * l'intéressé) et une décision (par l'administration, auditée). Tout le reste
 * est calculé côté serveur à partir de faits. C'est le §36, et c'est la
 * garantie qui rend le reste crédible.
 *
 * **Ce qui est public l'est parce qu'un acheteur en a besoin pour décider** :
 * score, badges, indicateurs de performance. Ce qui ne l'est pas ne l'est
 * jamais : pièces de vérification, signaux de fraude, motifs internes de
 * sanction, adresses.
 */
export const trustRouter = Router();

const indisponible = (res: import('express').Response) =>
  res.status(503).json({
    error: 'Module de confiance désactivé',
    detail: 'TOUMA_TRUST_ENABLED=false — aucun score n’est calculé ni publié.',
  });

trustRouter.use((req, res, next) => {
  if (!env.touma.trust.enabled) return indisponible(res);
  next();
});

/**
 * Les règles du jeu, en clair et sans compte.
 *
 * Publier les pondérations est un choix : un vendeur qui ne peut pas
 * reconstituer son score ne peut pas le contester, et un score incontestable
 * n'est pas une mesure, c'est une sentence.
 */
trustRouter.get(
  '/weights',
  asyncHandler(async (_req, res) => {
    res.json({
      factors: {
        seller: SELLER_FACTORS,
        buyer: BUYER_FACTORS,
        product: PRODUCT_FACTORS,
        supplier: SUPPLIER_FACTORS,
      },
      levels: LEVEL_THRESHOLDS,
      thresholds: THRESHOLDS,
      minimumSample: MIN_SAMPLE,
      decay: DECAY,
      badges: BADGE_RULES.map((r) => ({ code: r.code, entityTypes: r.entityTypes })),
      verification: {
        levels: LEVELS,
        signals: Object.values(SIGNALS),
        /** Signaux qu'aucun prestataire engagé ne peut établir aujourd'hui. */
        unavailableSignals: Object.values(SIGNALS)
          .filter((s) => s.providerRequired && !configuredProviderSignals().has(s.code))
          .map((s) => s.code),
      },
      standingEffects: STANDING_EFFECTS,
    });
  }),
);

/** Confiance d'une boutique — public : c'est ce qui aide à décider avant achat. */
trustRouter.get(
  '/sellers/:idOrSlug',
  asyncHandler(async (req, res) => {
    const store = await prisma.toumaStore.findFirst({
      where: { OR: [{ id: req.params.idOrSlug }, { slug: req.params.idOrSlug }] },
      select: { id: true, status: true, name: true, slug: true, verificationStatus: true, verificationLevel: true },
    });
    if (!store || store.status !== 'ACTIVE') throw notFound('Boutique introuvable.');

    const [trust, badges] = await Promise.all([
      trustService.get('SELLER', store.id),
      activeBadges('SELLER', store.id),
    ]);
    res.json({
      store: { id: store.id, name: store.name, slug: store.slug },
      verification: { status: store.verificationStatus, level: store.verificationLevel },
      ...trust,
      components: redactForPublic(trust.components),
      badges,
    });
  }),
);

/** Confiance d'un produit. */
trustRouter.get(
  '/products/:idOrSlug',
  asyncHandler(async (req, res) => {
    const product = await prisma.toumaProduct.findFirst({
      where: { OR: [{ id: req.params.idOrSlug }, { slug: req.params.idOrSlug }] },
      select: { id: true, status: true, title: true },
    });
    if (!product || product.status !== 'ACTIVE') throw notFound('Produit introuvable.');
    const [trust, badges] = await Promise.all([
      trustService.get('PRODUCT', product.id),
      activeBadges('PRODUCT', product.id),
    ]);
    res.json({
      product: { id: product.id, title: product.title },
      ...trust,
      components: redactForPublic(trust.components),
      badges,
    });
  }),
);

/** Confiance d'un fournisseur B2B. */
trustRouter.get(
  '/suppliers/:userId',
  asyncHandler(async (req, res) => {
    const supplier = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: { id: true, name: true, countryCode: true },
    });
    if (!supplier) throw notFound('Fournisseur introuvable.');
    const [trust, badges] = await Promise.all([
      trustService.get('SUPPLIER', supplier.id),
      activeBadges('SUPPLIER', supplier.id),
    ]);
    res.json({
      supplier: { id: supplier.id, name: supplier.name, countryCode: supplier.countryCode },
      ...trust,
      components: redactForPublic(trust.components),
      badges,
    });
  }),
);

/**
 * Ma confiance. Vue de l'intéressé : son score, ses badges, son état de
 * compte, ses recours — et **pas** les signaux de fraude qui le concernent.
 *
 * Ce n'est pas de l'opacité de confort : publier à l'intéressé le détail des
 * règles anti-fraude qui l'ont signalé lui apprendrait exactement comment les
 * contourner. Ce qui lui est dû — ce qui est reproché, comment contester — lui
 * est donné.
 */
trustRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const [acheteur, standing, recours, boutiques] = await Promise.all([
      trustService.get('BUYER', user.id),
      standingService.get(user.id),
      appealService.mine(user),
      prisma.toumaStore.findMany({
        where: { ownerId: user.id },
        select: { id: true, name: true, slug: true, verificationStatus: true, verificationLevel: true },
      }),
    ]);

    const vendeur = await Promise.all(
      boutiques.map(async (s) => ({
        store: { id: s.id, name: s.name, slug: s.slug },
        verification: { status: s.verificationStatus, level: s.verificationLevel },
        // Même opacité pour l'intéressé : il voit que des contrôles internes
        // lui coûtent des points, pas lesquels. Lui donner le détail
        // reviendrait à publier le mode d'emploi du contournement.
        trust: await trustService.get('SELLER', s.id).then((t) => ({ ...t, components: redactForPublic(t.components) })),
        badges: await activeBadges('SELLER', s.id),
      })),
    );

    res.json({
      buyer: {
        ...acheteur,
        components: redactForPublic(acheteur.components),
        badges: await activeBadges('BUYER', user.id),
      },
      seller: vendeur,
      standing,
      appeals: recours.items,
    });
  }),
);

/** Historique daté d'une entité — accessible à l'intéressé et à l'administration. */
trustRouter.get(
  '/history/:entityType/:entityId',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const type = z.enum(['SELLER', 'BUYER', 'SUPPLIER', 'PRODUCT']).parse(req.params.entityType);

    if (user.role !== 'ADMIN') {
      const autorise =
        (type === 'BUYER' || type === 'SUPPLIER') && req.params.entityId === user.id
          ? true
          : type === 'SELLER'
            ? Boolean(
                await prisma.toumaStore.findFirst({
                  where: { id: req.params.entityId, ownerId: user.id },
                  select: { id: true },
                }),
              )
            : type === 'PRODUCT'
              ? Boolean(
                  await prisma.toumaProduct.findFirst({
                    where: { id: req.params.entityId, store: { ownerId: user.id } },
                    select: { id: true },
                  }),
                )
              : false;
      if (!autorise) throw forbidden('Cet historique ne vous concerne pas.');
    }

    res.json(await trustService.history(type, req.params.entityId));
  }),
);

/** Ce qui manque pour atteindre un niveau de vérification. */
trustRouter.get(
  '/verification/requirements',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { level, storeId } = parseQuery(
      z.object({
        level: z.enum(['BASIC', 'BUSINESS', 'PRO', 'ENTERPRISE']).default('BASIC'),
        storeId: z.string().cuid().optional(),
      }),
      req,
    );

    const store = storeId
      ? await prisma.toumaStore.findFirst({
          where: { id: storeId, ownerId: user.id },
          select: { id: true, verifications: { orderBy: { submittedAt: 'desc' }, take: 1 }, reputation: true },
        })
      : null;
    if (storeId && !store) throw notFound('Boutique introuvable.');

    // Signaux réellement établis. Volontairement avare : rien n'est supposé.
    const etablis = new Set<string>();
    if (user.email) etablis.add('EMAIL_ON_FILE');
    const dossier = store?.verifications[0];
    if (dossier?.status === 'APPROVED') {
      etablis.add('IDENTITY_DOCUMENT');
      if (dossier.registrationNo && dossier.taxId) etablis.add('COMPANY_DOCUMENTS');
    }
    const adresses = await prisma.toumaAddress.count({ where: { userId: user.id } });
    if (adresses > 0) etablis.add('ADDRESS_DECLARED');
    const livrees = store?.reputation?.ordersDelivered ?? 0;
    if (livrees > 0) etablis.add('TRANSACTION_HISTORY');

    res.json(assess(level, etablis, livrees, configuredProviderSignals()));
  }),
);

// ── Recours ────────────────────────────────────────────────────────────────

const appealSchema = z.object({
  subjectType: z.enum(['VERIFICATION', 'STANDING', 'REVIEW', 'TRUST_SCORE']),
  subjectId: z.string().max(64).optional(),
  message: z.string().trim().min(20).max(4000),
  evidence: z.array(z.object({ kind: z.string().max(40), url: z.string().url() })).max(10).optional(),
});

trustRouter.post(
  '/appeals',
  authenticate,
  asyncHandler(async (req, res) => {
    res.status(201).json(await appealService.submit(currentUser(req), parseBody(appealSchema, req)));
  }),
);

trustRouter.get(
  '/appeals',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await appealService.mine(currentUser(req)));
  }),
);

// ── Administration ─────────────────────────────────────────────────────────

export const adminTrustRouter = Router();
adminTrustRouter.use(authenticate, requireAdmin);

/**
 * Tableau de bord. Des décomptes réels, et `null` là où le décompte n'a pas de
 * sens — jamais un zéro qui ferait croire à une mesure.
 */
adminTrustRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const [verifiees, enAttente, risqueEleve, avisSignales, sanctions, recours, scores] = await Promise.all([
      prisma.toumaStore.count({ where: { verificationStatus: 'APPROVED' } }),
      prisma.toumaSellerVerification.count({ where: { status: { in: ['PENDING', 'UNDER_REVIEW'] } } }),
      prisma.toumaRiskScore.count({ where: { level: 'HIGH' } }),
      prisma.toumaReview.count({ where: { status: 'FLAGGED' } }),
      prisma.toumaAccountStanding.count({ where: { status: { not: 'ACTIVE' } } }),
      prisma.toumaTrustAppeal.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
      prisma.toumaTrustScore.groupBy({ by: ['level'], _count: true, where: { entityType: 'SELLER' } }),
    ]);

    res.json({
      verifiedSellers: verifiees,
      pendingVerifications: enAttente,
      highRiskUsers: risqueEleve,
      flaggedReviews: avisSignales,
      activeSanctions: sanctions,
      openAppeals: recours,
      sellerScoreDistribution: scores.map((s) => ({ level: s.level, count: s._count })),
    });
  }),
);

adminTrustRouter.get(
  '/reviews',
  asyncHandler(async (req, res) => {
    const { status } = parseQuery(
      z.object({ status: z.enum(['PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED', 'FLAGGED']).default('FLAGGED') }),
      req,
    );
    const page = pageParams(req.query as Record<string, unknown>);
    const [items, total] = await Promise.all([
      prisma.toumaReview.findMany({
        where: { status },
        include: {
          riskScore: true,
          author: { select: { id: true, name: true } },
          product: { select: { id: true, title: true, storeId: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaReview.count({ where: { status } }),
    ]);
    res.json(paginated(items, total, page));
  }),
);

const moderationSchema = z.object({
  status: z.enum(['PUBLISHED', 'HIDDEN', 'REJECTED']),
  reason: z.string().trim().min(5).max(500),
});

/** Décision de modération. Motif obligatoire, décision auditée. */
adminTrustRouter.post(
  '/reviews/:id/moderate',
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const input = parseBody(moderationSchema, req);
    const review = await prisma.toumaReview.findUnique({ where: { id: req.params.id } });
    if (!review) throw notFound('Avis introuvable.');

    const updated = await prisma.toumaReview.update({
      where: { id: review.id },
      data: {
        status: input.status,
        moderationReason: input.reason,
        moderatedById: admin.id,
        moderatedAt: new Date(),
      },
    });
    const { audit } = await import('../lib/audit.js');
    await audit({
      actorId: admin.id,
      action: `trust.review.${input.status.toLowerCase()}`,
      entity: 'ToumaReview',
      entityId: review.id,
      metadata: { reason: input.reason },
    });
    res.json({ id: updated.id, status: updated.status, moderatedAt: updated.moderatedAt });
  }),
);

adminTrustRouter.get(
  '/risk',
  asyncHandler(async (req, res) => {
    const { level } = parseQuery(
      z.object({ level: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional() }),
      req,
    );
    const page = pageParams(req.query as Record<string, unknown>);
    const where = level ? { level } : {};
    const [items, total] = await Promise.all([
      prisma.toumaTransactionRisk.findMany({
        where,
        include: { order: { select: { id: true, orderNumber: true, total: true, currency: true, status: true } } },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaTransactionRisk.count({ where }),
    ]);
    res.json(paginated(items, total, page));
  }),
);

adminTrustRouter.get(
  '/appeals',
  asyncHandler(async (req, res) => {
    const { status } = parseQuery(
      z.object({ status: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']).optional() }),
      req,
    );
    const page = pageParams(req.query as Record<string, unknown>);
    const { items, total } = await appealService.queue(status, { skip: page.skip, take: page.limit });
    res.json(paginated(items, total, page));
  }),
);

adminTrustRouter.post(
  '/appeals/:id/decide',
  asyncHandler(async (req, res) => {
    const input = parseBody(
      z.object({
        decision: z.enum(['APPROVED', 'REJECTED']),
        resolution: z.string().trim().min(10).max(2000),
      }),
      req,
    );
    res.json(await appealService.decide(currentUser(req), req.params.id, input.decision, input.resolution));
  }),
);

const standingSchema = z.object({
  status: z.enum(['ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED']),
  reason: z.string().trim().max(200).optional(),
  publicReason: z.string().trim().max(500).optional(),
  evidence: z.record(z.unknown()).optional(),
  expiresAt: z.coerce.date().optional(),
});

adminTrustRouter.post(
  '/users/:id/standing',
  asyncHandler(async (req, res) => {
    const input = parseBody(standingSchema, req);
    res.json(
      await standingService.decide(currentUser(req), req.params.id, {
        status: input.status,
        reason: input.reason,
        publicReason: input.publicReason,
        evidence: input.evidence,
        expiresAt: input.expiresAt ?? null,
      }),
    );
  }),
);

/** Recalcul manuel — utile après une correction de données. Audité. */
adminTrustRouter.post(
  '/recompute/:entityType/:entityId',
  asyncHandler(async (req, res) => {
    const type = z.enum(['SELLER', 'BUYER', 'SUPPLIER', 'PRODUCT']).parse(req.params.entityType);
    res.json(await trustService.compute(type, req.params.entityId, 'ADMIN_RECOMPUTE'));
  }),
);

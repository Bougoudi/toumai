import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { asyncHandler, parseBody, parseQuery } from '../../middleware/validate.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { pageParams, paginated } from '../lib/pagination.js';
import { authenticate, currentUser, requireAdmin, requireRole } from '../middleware/toumaAuth.js';
import { promotionService } from './promotion.service.js';
import { referralService } from './referral.service.js';
import { segmentationService } from './segmentation.service.js';

/**
 * TOUMA GROWTH — API.
 *
 * **Deux garde-fous portent tout le fichier.**
 *
 * 1. Un vendeur ne crée que des promotions de **ses** boutiques, et elles sont
 *    forcément financées par lui. Sans ce lien, un vendeur écrirait des
 *    promotions payées par TOUMA — et rien dans l'écran ne le lui interdirait.
 * 2. Le financement `PARTNER` est refusé tant qu'aucun partenariat n'est signé.
 *    Une remise dont le financeur est imaginaire fausse le règlement du
 *    vendeur, et le fausse silencieusement.
 */
export const growthRouter = Router();

growthRouter.use((req, res, next) => {
  if (!env.touma.growth.promotionsEnabled) {
    return res.status(503).json({
      error: 'Promotions désactivées',
      detail: 'TOUMA_GROWTH_PROMOTIONS_ENABLED=false — aucune promotion n’est évaluée.',
    });
  }
  next();
});

/** Promotions publiques en cours. Lisible sans compte : c'est le but. */
growthRouter.get(
  '/promotions',
  asyncHandler(async (req, res) => {
    const page = pageParams(req.query as Record<string, unknown>);
    const maintenant = new Date();
    const where = {
      status: 'ACTIVE' as const,
      startsAt: { lte: maintenant },
      OR: [{ endsAt: null }, { endsAt: { gte: maintenant } }],
    };
    const [items, total] = await Promise.all([
      prisma.toumaPromotion.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          type: true,
          value: true,
          currency: true,
          maxDiscountAmount: true,
          startsAt: true,
          endsAt: true,
          store: { select: { id: true, name: true, slug: true } },
          rules: { select: { kind: true, threshold: true, values: true, negated: true } },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaPromotion.count({ where }),
    ]);
    res.json(paginated(items, total, page));
  }),
);

growthRouter.get(
  '/promotions/:id',
  asyncHandler(async (req, res) => {
    const promo = await prisma.toumaPromotion.findUnique({
      where: { id: req.params.id },
      include: { rules: true, store: { select: { id: true, name: true, slug: true } } },
    });
    // Une promotion qui n'est pas en cours n'a pas de fiche publique : elle
    // laisserait croire à une offre qu'on ne peut pas obtenir.
    if (!promo || promo.status !== 'ACTIVE') throw notFound('Promotion introuvable.');
    // Le budget ne sort jamais : c'est une donnée d'exploitation du vendeur.
    const { createdById: _auteur, ...publique } = promo;
    res.json(publique);
  }),
);

// ── Vendeur ────────────────────────────────────────────────────────────────

export const sellerGrowthRouter = Router();
sellerGrowthRouter.use(authenticate, requireRole('SELLER', 'ADMIN'));

const ruleSchema = z.object({
  kind: z.enum([
    'MIN_ORDER_AMOUNT',
    'MIN_QUANTITY',
    'PRODUCT',
    'CATEGORY',
    'SELLER',
    'COUNTRY',
    'PROVINCE',
    'FIRST_ORDER',
    'NEW_CUSTOMER',
    'CUSTOMER_SEGMENT',
    'MIN_STOCK',
    'MAX_STOCK',
  ]),
  threshold: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  values: z.array(z.string().max(64)).max(200).default([]),
  negated: z.boolean().default(false),
});

const promotionSchema = z.object({
  storeId: z.string().cuid(),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1000).default(''),
  type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING', 'TIERED_DISCOUNT', 'BUNDLE_DISCOUNT', 'FIRST_ORDER']),
  value: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0'),
  currency: z.string().length(3).optional(),
  maxDiscountAmount: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  stacking: z.enum(['STACKABLE', 'NON_STACKABLE', 'EXCLUSIVE']).default('NON_STACKABLE'),
  priority: z.number().int().min(0).max(1000).default(0),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  rules: z.array(ruleSchema).max(20).default([]),
  budget: z.object({ total: z.string().regex(/^\d+(\.\d{1,4})?$/), currency: z.string().length(3) }).optional(),
});

/** Vérifie que la boutique appartient bien à l'appelant. */
async function boutiqueDe(user: ReturnType<typeof currentUser>, storeId: string) {
  const store = await prisma.toumaStore.findUnique({ where: { id: storeId }, select: { id: true, ownerId: true } });
  if (!store) throw notFound('Boutique introuvable.');
  if (store.ownerId !== user.id && user.role !== 'ADMIN') {
    // Un identifiant de boutique valide ne doit pas permettre de deviner
    // l'existence d'une boutique qu'on ne possède pas.
    throw notFound('Boutique introuvable.');
  }
  return store;
}

/** Cohérence d'une promotion. Refuser ici évite une remise absurde en production. */
function verifier(input: z.infer<typeof promotionSchema>) {
  const valeur = new Prisma.Decimal(input.value);
  if (input.type === 'PERCENTAGE' || input.type === 'TIERED_DISCOUNT' || input.type === 'FIRST_ORDER') {
    if (valeur.lessThanOrEqualTo(0) || valeur.greaterThan(100)) {
      throw badRequest('Un pourcentage se situe entre 0 et 100.');
    }
  }
  if ((input.type === 'FIXED_AMOUNT' || input.type === 'BUNDLE_DISCOUNT')) {
    if (valeur.lessThanOrEqualTo(0)) throw badRequest('Un montant de remise doit être positif.');
    if (!input.currency) {
      // Sans devise, une remise fixe s'appliquerait à n'importe quel panier,
      // quelle que soit sa monnaie. Il n'existe pas de taux officiel ici.
      throw badRequest('Une remise en montant fixe exige sa devise.');
    }
  }
  if (input.endsAt && input.startsAt && input.endsAt <= input.startsAt) {
    throw badRequest('La fin d’une promotion doit suivre son début.');
  }
}

sellerGrowthRouter.post(
  '/promotions',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = parseBody(promotionSchema, req);
    await boutiqueDe(user, input.storeId);
    verifier(input);

    const promo = await prisma.toumaPromotion.create({
      data: {
        name: input.name,
        description: input.description,
        type: input.type,
        // Un vendeur crée en brouillon : publier se fait par un second geste,
        // délibéré, après avoir relu ce qu'on vient d'écrire.
        status: 'DRAFT',
        storeId: input.storeId,
        // Lié à la boutique, donc financé par elle. Le vendeur ne choisit pas.
        funding: 'SELLER',
        stacking: input.stacking,
        priority: input.priority,
        value: new Prisma.Decimal(input.value),
        currency: input.currency ?? null,
        maxDiscountAmount: input.maxDiscountAmount ? new Prisma.Decimal(input.maxDiscountAmount) : null,
        startsAt: input.startsAt ?? new Date(),
        endsAt: input.endsAt ?? null,
        createdById: user.id,
        rules: {
          create: input.rules.map((r) => ({
            kind: r.kind,
            threshold: r.threshold ? new Prisma.Decimal(r.threshold) : null,
            values: r.values,
            negated: r.negated,
          })),
        },
        ...(input.budget
          ? { budget: { create: { total: new Prisma.Decimal(input.budget.total), currency: input.budget.currency } } }
          : {}),
      },
      include: { rules: true, budget: true },
    });

    await audit({
      actorId: user.id,
      action: 'promotion.create',
      entity: 'ToumaPromotion',
      entityId: promo.id,
      metadata: { storeId: input.storeId, type: input.type },
    });
    res.status(201).json(promo);
  }),
);

const patchSchema = z.object({
  status: z.enum(['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
  name: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  endsAt: z.coerce.date().nullable().optional(),
});

sellerGrowthRouter.patch(
  '/promotions/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = parseBody(patchSchema, req);
    const promo = await prisma.toumaPromotion.findUnique({ where: { id: req.params.id } });
    if (!promo) throw notFound('Promotion introuvable.');
    if (!promo.storeId) throw forbidden('Une promotion de la place de marché ne se modifie pas depuis l’espace vendeur.');
    await boutiqueDe(user, promo.storeId);

    // Une promotion archivée ne revient pas : des commandes s'y réfèrent, et
    // les rouvrir changerait rétroactivement ce qui a été facturé.
    if (promo.status === 'ARCHIVED' && input.status && input.status !== 'ARCHIVED') {
      throw badRequest('Une promotion archivée ne peut pas être réactivée. Créez-en une nouvelle.');
    }

    const updated = await prisma.toumaPromotion.update({
      where: { id: promo.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
      },
      include: { rules: true, budget: true },
    });
    await audit({
      actorId: user.id,
      action: 'promotion.update',
      entity: 'ToumaPromotion',
      entityId: promo.id,
      metadata: { status: input.status ?? null },
    });
    res.json(updated);
  }),
);

/** Promotions du vendeur, avec ce qu'elles ont réellement coûté. */
sellerGrowthRouter.get(
  '/promotions',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { storeId } = parseQuery(z.object({ storeId: z.string().cuid().optional() }), req);
    const boutiques = await prisma.toumaStore.findMany({
      where: { ownerId: user.id, ...(storeId ? { id: storeId } : {}) },
      select: { id: true },
    });
    const page = pageParams(req.query as Record<string, unknown>);
    const where = { storeId: { in: boutiques.map((b) => b.id) } };
    const [items, total] = await Promise.all([
      prisma.toumaPromotion.findMany({
        where,
        include: { rules: true, budget: true, _count: { select: { usages: true } } },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaPromotion.count({ where }),
    ]);
    res.json(paginated(items, total, page));
  }),
);

/**
 * Ce qu'une promotion a coûté et rapporté.
 *
 * Volontairement sans « ROI » ni taux de conversion : les deux exigeraient
 * d'attribuer une commande à une promotion, ce qui suppose de savoir ce qui se
 * serait passé sans elle. Personne ne le sait. Ce qui est rendu ici est ce qui
 * est **observé** : combien de fois elle s'est appliquée, à combien
 * d'acheteurs distincts, et ce qu'elle a coûté.
 */
sellerGrowthRouter.get(
  '/promotions/:id/performance',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const promo = await prisma.toumaPromotion.findUnique({ where: { id: req.params.id }, include: { budget: true } });
    if (!promo || !promo.storeId) throw notFound('Promotion introuvable.');
    await boutiqueDe(user, promo.storeId);

    const usages = await prisma.toumaPromotionUsage.findMany({
      where: { promotionId: promo.id },
      select: { userId: true, amount: true, currency: true, orderId: true, createdAt: true },
    });

    const parDevise = new Map<string, Prisma.Decimal>();
    for (const u of usages) {
      parDevise.set(u.currency, (parDevise.get(u.currency) ?? new Prisma.Decimal(0)).plus(u.amount));
    }

    res.json({
      promotionId: promo.id,
      name: promo.name,
      status: promo.status,
      timesApplied: usages.length,
      distinctBuyers: new Set(usages.map((u) => u.userId)).size,
      ordersWithPromotion: new Set(usages.map((u) => u.orderId).filter(Boolean)).size,
      // Par devise, jamais additionnées : il n'existe pas de taux officiel ici.
      discountByCurrency: [...parDevise].map(([currency, amount]) => ({ currency, amount: amount.toString() })),
      budget: promo.budget
        ? {
            total: promo.budget.total.toString(),
            spent: promo.budget.spent.toString(),
            currency: promo.budget.currency,
          }
        : null,
      firstApplied: usages.length ? usages.reduce((a, b) => (a.createdAt < b.createdAt ? a : b)).createdAt : null,
      /**
       * Ni taux de conversion, ni retour sur investissement : les deux
       * supposent de savoir ce qui serait arrivé sans la promotion. Personne ne
       * le sait, et un chiffre inventé ici orienterait de vraies décisions
       * commerciales.
       */
      notMeasured: ['conversionRate', 'roi', 'incrementalRevenue'],
    });
  }),
);

// ── Administration ─────────────────────────────────────────────────────────

export const adminGrowthRouter = Router();
adminGrowthRouter.use(authenticate, requireAdmin);

const campaignSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1000).default(''),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  countryCodes: z.array(z.string().length(2)).max(20).default([]),
  provinceIds: z.array(z.string().max(64)).max(50).default([]),
});

adminGrowthRouter.post(
  '/campaigns',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = parseBody(campaignSchema, req);
    if (input.endsAt <= input.startsAt) throw badRequest('La fin d’une campagne doit suivre son début.');

    // Les provinces citées doivent exister. Une campagne visant une province
    // imaginaire ne s'appliquerait nulle part, sans que personne ne le voie.
    if (input.provinceIds.length > 0) {
      const connues = await prisma.toumaProvince.count({ where: { id: { in: input.provinceIds } } });
      if (connues !== input.provinceIds.length) {
        throw badRequest('Une des provinces visées n’existe pas dans le référentiel.');
      }
    }

    const campaign = await prisma.toumaCampaign.create({
      data: { ...input, status: 'DRAFT', createdById: user.id },
    });
    await audit({ actorId: user.id, action: 'campaign.create', entity: 'ToumaCampaign', entityId: campaign.id, metadata: { name: input.name } });
    res.status(201).json(campaign);
  }),
);

adminGrowthRouter.get(
  '/campaigns',
  asyncHandler(async (req, res) => {
    const page = pageParams(req.query as Record<string, unknown>);
    const [items, total] = await Promise.all([
      prisma.toumaCampaign.findMany({
        include: { _count: { select: { promotions: true } } },
        orderBy: { startsAt: 'desc' },
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaCampaign.count(),
    ]);
    res.json(paginated(items, total, page));
  }),
);

/** Tableau de bord marketing : des décomptes observés, rien d'estimé. */
adminGrowthRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const [promotions, actives, campagnes, coupons, usages] = await Promise.all([
      prisma.toumaPromotion.count(),
      prisma.toumaPromotion.count({ where: { status: 'ACTIVE' } }),
      prisma.toumaCampaign.count({ where: { status: 'ACTIVE' } }),
      prisma.toumaCoupon.count({ where: { status: 'ACTIVE' } }),
      prisma.toumaPromotionUsage.groupBy({ by: ['currency'], _sum: { amount: true }, _count: true }),
    ]);
    res.json({
      promotions,
      activePromotions: actives,
      activeCampaigns: campagnes,
      activeCoupons: coupons,
      // Par devise. Additionner XAF et une autre monnaie sans taux officiel
      // produirait un total qui ne veut rien dire.
      discountByCurrency: usages.map((u) => ({
        currency: u.currency,
        amount: (u._sum.amount ?? new Prisma.Decimal(0)).toString(),
        applications: u._count,
      })),
      notMeasured: ['gmvAttribution', 'roi', 'incrementalRevenue'],
    });
  }),
);

/** Évaluation d'un panier — utile au vendeur pour relire sa règle. */
sellerGrowthRouter.post(
  '/promotions/preview',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = parseBody(
      z.object({
        storeId: z.string().cuid(),
        subtotal: z.string().regex(/^\d+(\.\d{1,4})?$/),
        shipping: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0'),
        currency: z.string().length(3),
        productIds: z.array(z.string().cuid()).max(100).default([]),
        categoryIds: z.array(z.string().cuid()).max(50).default([]),
        quantity: z.number().int().min(1).default(1),
        destinationCountry: z.string().length(2).default('TD'),
        destinationProvinceId: z.string().max(64).nullable().default(null),
      }),
      req,
    );
    await boutiqueDe(user, input.storeId);

    const outcome = await promotionService.evaluateCart({
      userId: user.id,
      lines: [
        {
          storeId: input.storeId,
          subtotal: new Prisma.Decimal(input.subtotal),
          shipping: new Prisma.Decimal(input.shipping),
          productIds: input.productIds,
          categoryIds: input.categoryIds,
          quantity: input.quantity,
        },
      ],
      currency: input.currency,
      destinationCountry: input.destinationCountry,
      destinationProvinceId: input.destinationProvinceId,
      previousOrders: 0,
      segments: [],
    });

    res.json({
      applied: outcome.applied.map((a) => ({
        promotionId: a.promotionId,
        name: a.name,
        type: a.type,
        funding: a.funding,
        amount: a.amount.toString(),
        onShipping: a.onShipping,
      })),
      rejected: outcome.rejected,
      merchandiseDiscount: outcome.merchandiseDiscount.toString(),
      shippingDiscount: outcome.shippingDiscount.toString(),
      blocksCoupon: outcome.blocksCoupon,
      /** Un aperçu porte sur ce panier-ci. Il ne promet aucune vente. */
      disclaimer: 'growth.previewDisclaimer',
    });
  }),
);


// ── Parrainage et segments ─────────────────────────────────────────────────

/**
 * Mon parrainage.
 *
 * Hors du routeur `growthRouter`, qui est fermé quand les promotions le sont :
 * couper les promotions n'a aucune raison de couper aussi le parrainage.
 */
export const referralRouter = Router();
referralRouter.use(authenticate);

referralRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await referralService.mine(currentUser(req).id));
  }),
);

referralRouter.post(
  '/code',
  asyncHandler(async (req, res) => {
    const code = await referralService.myCode(currentUser(req).id);
    res.status(201).json({ code: code.code, createdAt: code.createdAt });
  }),
);

adminGrowthRouter.get(
  '/referrals',
  asyncHandler(async (req, res) => {
    const page = pageParams(req.query as Record<string, unknown>);
    const { items, total } = await referralService.pendingRewards({ skip: page.skip, take: page.limit });
    res.json(paginated(items, total, page));
  }),
);

adminGrowthRouter.post(
  '/referrals/:id/reward',
  asyncHandler(async (req, res) => {
    const input = parseBody(z.object({ note: z.string().trim().min(3).max(500) }), req);
    res.json(await referralService.markRewarded(currentUser(req).id, req.params.id, input.note));
  }),
);

adminGrowthRouter.get(
  '/segments',
  asyncHandler(async (_req, res) => {
    res.json({ items: await segmentationService.counts() });
  }),
);

const segmentSchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(40).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).default(''),
  minOrders: z.number().int().min(0).optional(),
  maxOrders: z.number().int().min(0).optional(),
  minSpend: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  spendCurrency: z.string().length(3).optional(),
  minDaysSinceLastOrder: z.number().int().min(0).optional(),
  maxDaysSinceLastOrder: z.number().int().min(0).optional(),
});

adminGrowthRouter.post(
  '/segments',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = parseBody(segmentSchema, req);
    // Un seuil de montant sans devise ne veut rien dire : il ne serait jamais
    // rempli, et personne ne comprendrait pourquoi le segment reste vide.
    if (input.minSpend && !input.spendCurrency) {
      throw badRequest('Un seuil de dépense exige sa devise : il n’existe pas de taux officiel ici.');
    }
    const segment = await prisma.toumaCustomerSegment.create({
      data: {
        ...input,
        minSpend: input.minSpend ? new Prisma.Decimal(input.minSpend) : null,
      },
    });
    await audit({
      actorId: user.id,
      action: 'segment.create',
      entity: 'ToumaCustomerSegment',
      entityId: segment.id,
      metadata: { code: segment.code },
    });
    res.status(201).json(segment);
  }),
);

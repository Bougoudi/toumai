import { Router } from 'express';
import { urlWeb } from '../lib/url.js';
import { requirePermission } from '../admin/permissions.js';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { asyncHandler, parseBody, parseQuery } from '../../middleware/validate.js';
import { notFound, serviceUnavailable } from '../lib/errors.js';
import { authenticate, currentUser, optionalAuth, requireAdmin, requireRole } from '../middleware/toumaAuth.js';
import { corridorService } from './corridor.service.js';
import { costService } from './cost.service.js';
import { tradeDocumentService } from './document.service.js';
import { eligibilityService } from './eligibility.service.js';
import { fxService } from './fx.service.js';
import { timelineService } from './timeline.service.js';
import { tradeAnalytics } from './analytics.service.js';

/**
 * API TOUMA TRADE (§71).
 *
 * La lecture des corridors est **publique** : un acheteur doit pouvoir savoir
 * si Touma dessert son pays avant de créer un compte. Tout ce qui touche une
 * commande, un document ou une configuration est fermé.
 */

const joursTrade = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

function assertActif() {
  if (!env.touma.trade.enabled) throw serviceUnavailable('Le commerce transfrontalier n’est pas activé sur cette instance.');
}

// ── Public : /api/v1/trade ───────────────────────────────────────────────────
export const tradeRouter = Router();

tradeRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const corridors = await corridorService.list();
    res.json({
      enabled: env.touma.trade.enabled,
      fx: fxService.status(),
      corridors: corridors.length,
      /** Nombre de corridors **réellement** opérationnels, pas déclarés. */
      operational: corridors.filter((c) => c.capability.operational).length,
      features: {
        documents: env.touma.trade.documentsEnabled,
        fx: env.touma.trade.fxEnabled,
        compliance: env.touma.trade.complianceEnabled,
        b2b: env.touma.trade.b2bEnabled,
        multivendor: env.touma.trade.multivendorEnabled,
      },
    });
  }),
);

tradeRouter.get(
  '/countries',
  asyncHandler(async (_req, res) => {
    const configs = await corridorService.listCountryConfigs();
    res.json({
      items: configs.map((c) => ({
        countryCode: c.countryCode,
        name: c.country.name,
        currency: c.country.currency,
        dialCode: c.country.dialCode,
        tradeEnabled: c.tradeEnabled,
        languages: c.languages,
        currencies: c.currencies,
        paymentMethods: c.paymentMethods,
        shippingProviders: c.shippingProviders,
        documentKinds: c.documentKinds,
      })),
    });
  }),
);

tradeRouter.get(
  '/corridors',
  asyncHandler(async (_req, res) => {
    const corridors = await corridorService.list();
    res.json({
      items: corridors.map((c) => ({
        id: c.id,
        code: c.code,
        /** Adresse lisible des pages publiques : `tchad-cameroun` (§61). */
        slug: c.slug,
        originCountry: c.originCountry,
        originCountryName: c.originCountryName,
        destinationCountry: c.destinationCountry,
        destinationCountryName: c.destinationCountryName,
        /** Statut déclaré par l'exploitant. */
        declaredStatus: c.status,
        /** Ce qui fonctionne réellement. Les deux sont rendus, jamais fondus. */
        operational: c.capability.operational,
        /** Motifs sous forme de codes : traduisibles, et sûrs à interpréter. */
        blockers: c.capability.blockers,
        missing: c.capability.missing,
        supportedCurrencies: c.supportedCurrencies,
        paymentMethods: c.capability.paymentMethods,
        shippingProviders: c.capability.shippingProviders,
        requiredDocuments: c.requiredDocuments,
        estimatedTransitMinDays: c.estimatedTransitMinDays,
        estimatedTransitMaxDays: c.estimatedTransitMaxDays,
      })),
      note: 'Un corridor n’est opérationnel que si un moyen de paiement et un transporteur le couvrent réellement. Le statut déclaré ne suffit pas.',
    });
  }),
);

/**
 * Un corridor, par son code (`TD_CM`) **ou** par son adresse lisible
 * (`tchad-cameroun`). Les pages publiques n'ont que la seconde, et leur
 * imposer de deviner la première reviendrait à recopier la règle de
 * fabrication du slug hors du serveur.
 */
tradeRouter.get(
  '/corridors/:code',
  asyncHandler(async (req, res) => {
    const { capability, ...corridor } = await corridorService.byReference(req.params.code);
    const routes = await prisma.toumaTradeRoute.findMany({ where: { corridorId: corridor.id, active: true } });
    res.json({
      ...corridor,
      capability,
      routes: routes.map((r) => ({
        id: r.id,
        name: r.name,
        legs: r.legs,
        // Un itinéraire sans source n'est affirmé par personne, et l'écran
        // doit pouvoir le dire (§32).
        sourceName: r.sourceName,
        sourceUrl: r.sourceUrl,
        attributed: Boolean(r.sourceName),
      })),
    });
  }),
);

const eligibiliteSchema = z.object({
  buyerCountry: z.string().length(2),
  sellerCountry: z.string().length(2),
  productId: z.string().cuid().optional(),
  currency: z.string().length(3).optional(),
  paymentMethod: z.string().trim().max(60).optional(),
});

tradeRouter.post(
  '/eligibility/check',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const input = parseBody(eligibiliteSchema, req);
    res.json(await eligibilityService.check({ ...input, userId: req.toumaUser?.id ?? null }));
  }),
);

const coutSchema = z.object({
  currency: z.string().length(3),
  productAmount: z.string().regex(/^\d+(\.\d{1,4})?$/),
  shippingAmount: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  sellerCountry: z.string().length(2),
  buyerCountry: z.string().length(2),
  displayCurrency: z.string().length(3).optional(),
});

tradeRouter.post(
  '/cost-estimate',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const input = parseBody(coutSchema, req);
    res.json(await costService.estimate(input));
  }),
);

tradeRouter.get('/fx', asyncHandler(async (_req, res) => res.json(fxService.status())));

const fxSchema = z.object({ base: z.string().length(3), quote: z.string().length(3) });

tradeRouter.get(
  '/fx/rate',
  asyncHandler(async (req, res) => {
    const { base, quote } = parseQuery(fxSchema, req);
    const taux = await fxService.getRate(base, quote);
    res.json(
      taux
        ? { available: true, rate: taux }
        : { available: false, rate: null, message: `Aucun taux ${base.toUpperCase()} → ${quote.toUpperCase()} provenant d’une source connue.` },
    );
  }),
);

// ── Commandes transfrontalières de l'utilisateur ─────────────────────────────
tradeRouter.get(
  '/orders',
  authenticate,
  asyncHandler(async (req, res) => {
    assertActif();
    const user = currentUser(req);
    const items = await prisma.toumaTradeOrder.findMany({
      where: { OR: [{ order: { buyerId: user.id } }, { order: { store: { ownerId: user.id } } }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        corridor: { select: { code: true, status: true } },
        order: { select: { id: true, orderNumber: true, status: true, total: true, currency: true, createdAt: true, store: { select: { name: true, countryCode: true } } } },
      },
    });
    res.json({
      items: items.map((t) => ({
        id: t.id,
        corridor: t.corridor,
        settlementCurrency: t.settlementCurrency,
        order: { ...t.order, total: t.order.total.toString() },
      })),
    });
  }),
);

tradeRouter.get(
  '/orders/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    assertActif();
    const user = currentUser(req);
    await tradeDocumentService.assertAccess(user, req.params.id);
    const t = await prisma.toumaTradeOrder.findUnique({
      where: { id: req.params.id },
      include: {
        corridor: true,
        route: true,
        exceptions: { orderBy: { raisedAt: 'desc' } },
        costs: { orderBy: { createdAt: 'desc' }, take: 1 },
        order: {
          select: {
            id: true, orderNumber: true, status: true, total: true, currency: true, crossBorder: true,
            buyerCountry: true, sellerCountry: true, createdAt: true,
            store: { select: { name: true, countryCode: true, verificationStatus: true } },
          },
        },
      },
    });
    if (!t) throw notFound('Commande transfrontalière introuvable.');
    res.json({ ...t, order: { ...t.order, total: t.order.total.toString() } });
  }),
);

tradeRouter.get(
  '/orders/:id/timeline',
  authenticate,
  asyncHandler(async (req, res) => res.json(await timelineService.forTradeOrder(currentUser(req), req.params.id))),
);

tradeRouter.get(
  '/orders/:id/checklist',
  authenticate,
  asyncHandler(async (req, res) => res.json(await timelineService.checklist(currentUser(req), req.params.id))),
);

tradeRouter.get(
  '/orders/:id/documents',
  authenticate,
  asyncHandler(async (req, res) => res.json({ items: await tradeDocumentService.listForTradeOrder(currentUser(req), req.params.id) })),
);

// ── Documents ────────────────────────────────────────────────────────────────
const emissionSchema = z.object({
  kind: z.enum(['COMMERCIAL_INVOICE', 'PACKING_LIST']),
  orderId: z.string().cuid(),
});

tradeRouter.post(
  '/documents/issue',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = parseBody(emissionSchema, req);
    const user = currentUser(req);
    const document =
      input.kind === 'COMMERCIAL_INVOICE'
        ? await tradeDocumentService.issueCommercialInvoice(user, input.orderId)
        : await tradeDocumentService.issuePackingList(user, input.orderId);
    const { storageKey, ...visible } = document;
    res.status(201).json(visible);
  }),
);

tradeRouter.post(
  '/documents/proforma',
  authenticate,
  asyncHandler(async (req, res) => {
    const { quoteId } = parseBody(z.object({ quoteId: z.string().cuid() }), req);
    const document = await tradeDocumentService.issueProforma(currentUser(req), quoteId);
    const { storageKey, ...visible } = document;
    res.status(201).json(visible);
  }),
);

tradeRouter.get(
  '/documents/:id',
  authenticate,
  asyncHandler(async (req, res) => res.json(await tradeDocumentService.get(currentUser(req), req.params.id))),
);

// ── Espace vendeur : /api/v1/seller/trade ────────────────────────────────────
export const sellerTradeRouter = Router();
sellerTradeRouter.use(authenticate, requireRole('SELLER', 'ADMIN'));

sellerTradeRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const [commandes, documents] = await Promise.all([
      prisma.toumaTradeOrder.count({ where: { order: { store: { ownerId: user.id } } } }),
      prisma.toumaTradeDocument.count({ where: { tradeOrder: { order: { store: { ownerId: user.id } } } } }),
    ]);
    const parPays = await prisma.toumaOrder.groupBy({
      by: ['buyerCountry'],
      where: { store: { ownerId: user.id }, crossBorder: true },
      _count: { _all: true },
    });
    res.json({
      internationalOrders: commandes,
      documents,
      byDestination: parPays.filter((p) => p.buyerCountry).map((p) => ({ countryCode: p.buyerCountry, orders: p._count._all })),
      tradeEnabled: env.touma.trade.enabled,
    });
  }),
);

sellerTradeRouter.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const { days } = parseQuery(joursTrade, req);
    res.json(await tradeAnalytics.seller(currentUser(req).id, days));
  }),
);

sellerTradeRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const items = await prisma.toumaTradeOrder.findMany({
      where: { order: { store: { ownerId: user.id } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        corridor: { select: { code: true } },
        order: { select: { id: true, orderNumber: true, status: true, total: true, currency: true, buyerCountry: true, createdAt: true } },
      },
    });
    res.json({ items: items.map((t) => ({ id: t.id, corridor: t.corridor, order: { ...t.order, total: t.order.total.toString() } })) });
  }),
);

// ── Espace professionnel : /api/v1/business/trade ────────────────────────────
export const businessTradeRouter = Router();
businessTradeRouter.use(authenticate);

businessTradeRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const [rfqs, devis, commandes] = await Promise.all([
      prisma.toumaRfq.count({ where: { buyerId: user.id } }),
      prisma.toumaQuote.count({ where: { rfq: { buyerId: user.id } } }),
      prisma.toumaTradeOrder.count({ where: { order: { buyerId: user.id } } }),
    ]);
    res.json({ rfqs, quotes: devis, tradeOrders: commandes, tradeEnabled: env.touma.trade.enabled });
  }),
);

businessTradeRouter.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const { days } = parseQuery(joursTrade, req);
    res.json(await tradeAnalytics.business(currentUser(req).id, days));
  }),
);

businessTradeRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const items = await prisma.toumaTradeOrder.findMany({
      where: { order: { buyerId: user.id } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        corridor: { select: { code: true } },
        order: { select: { id: true, orderNumber: true, status: true, total: true, currency: true, sellerCountry: true, createdAt: true, store: { select: { name: true } } } },
      },
    });
    res.json({ items: items.map((t) => ({ id: t.id, corridor: t.corridor, order: { ...t.order, total: t.order.total.toString() } })) });
  }),
);

// ── Administration : /api/v1/admin/trade ─────────────────────────────────────
export const adminTradeRouter = Router();
adminTradeRouter.use(authenticate, requireAdmin, requirePermission('ADMIN_TRADE'));

adminTradeRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const corridors = await corridorService.list();
    const [commandes, documents, incidents, verifications] = await Promise.all([
      prisma.toumaTradeOrder.count(),
      prisma.toumaTradeDocument.count(),
      prisma.toumaTradeShipmentException.count({ where: { resolvedAt: null } }),
      prisma.toumaTradeEligibilityCheck.groupBy({ by: ['verdict'], _count: { _all: true } }),
    ]);
    res.json({
      corridors: corridors.map((c) => ({
        code: c.code,
        declaredStatus: c.status,
        operational: c.capability.operational,
        blockers: c.capability.blockers,
        missing: c.capability.missing,
      })),
      tradeOrders: commandes,
      documents,
      openExceptions: incidents,
      eligibilityByVerdict: Object.fromEntries(verifications.map((v) => [v.verdict, v._count._all])),
      fx: fxService.status(),
    });
  }),
);

adminTradeRouter.get('/corridors', asyncHandler(async (_req, res) => res.json({ items: await corridorService.list() })));

adminTradeRouter.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const { days } = parseQuery(joursTrade, req);
    res.json(await tradeAnalytics.platform(days));
  }),
);

const creationCorridor = z.object({
  originCountry: z.string().length(2),
  destinationCountry: z.string().length(2),
  supportedCurrencies: z.array(z.string().length(3)).optional(),
  supportedPaymentMethods: z.array(z.string().trim().max(60)).optional(),
  supportedShippingMethods: z.array(z.string().trim().max(60)).optional(),
  requiredDocuments: z.array(z.enum(['COMMERCIAL_INVOICE', 'PACKING_LIST', 'PROFORMA_INVOICE', 'PURCHASE_ORDER', 'CERTIFICATE_OF_ORIGIN', 'SHIPPING_DOCUMENT', 'OTHER'])).optional(),
  estimatedTransitMinDays: z.number().int().min(0).max(365).nullish(),
  estimatedTransitMaxDays: z.number().int().min(0).max(365).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

adminTradeRouter.post(
  '/corridors',
  asyncHandler(async (req, res) => {
    const input = parseBody(creationCorridor, req);
    res.status(201).json(await corridorService.createCorridor(input));
  }),
);

adminTradeRouter.patch(
  '/corridors/:id',
  asyncHandler(async (req, res) => {
    const input = parseBody(
      creationCorridor.partial().extend({ status: z.enum(['ACTIVE', 'LIMITED', 'SUSPENDED', 'COMING_SOON']).optional() }),
      req,
    );
    res.json(await corridorService.updateCorridor(req.params.id, input));
  }),
);

const configPays = z.object({
  tradeEnabled: z.boolean().optional(),
  languages: z.array(z.string().min(2).max(5)).optional(),
  currencies: z.array(z.string().length(3)).optional(),
  paymentMethods: z.array(z.string().trim().max(60)).optional(),
  shippingProviders: z.array(z.string().trim().max(60)).optional(),
  documentKinds: z.array(z.enum(['COMMERCIAL_INVOICE', 'PACKING_LIST', 'PROFORMA_INVOICE', 'PURCHASE_ORDER', 'CERTIFICATE_OF_ORIGIN', 'SHIPPING_DOCUMENT', 'OTHER'])).optional(),
  notes: z.string().trim().max(1000).nullish(),
});

adminTradeRouter.put(
  '/countries/:code',
  asyncHandler(async (req, res) => res.json(await corridorService.upsertCountryConfig(req.params.code, parseBody(configPays, req)))),
);

adminTradeRouter.get(
  '/rules',
  asyncHandler(async (_req, res) => {
    const items = await prisma.toumaTradeRuleVersion.findMany({ orderBy: [{ ruleType: 'asc' }, { version: 'desc' }], take: 100 });
    res.json({ items });
  }),
);

const regleSchema = z.object({
  corridorId: z.string().cuid().nullish(),
  countryCode: z.string().length(2).nullish(),
  ruleType: z.string().trim().min(2).max(60),
  body: z.record(z.unknown()).default({}),
  sourceName: z.string().trim().min(2).max(200),
  sourceUrl: urlWeb(2000).nullish(),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().nullish(),
});

adminTradeRouter.post(
  '/rules',
  asyncHandler(async (req, res) => {
    const input = parseBody(regleSchema, req);
    const dernier = await prisma.toumaTradeRuleVersion.findFirst({
      where: { corridorId: input.corridorId ?? null, countryCode: input.countryCode ?? null, ruleType: input.ruleType },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = await prisma.toumaTradeRuleVersion.create({
      data: {
        corridorId: input.corridorId ?? null,
        countryCode: input.countryCode ?? null,
        ruleType: input.ruleType,
        version: (dernier?.version ?? 0) + 1,
        // Créée inactive : une règle qui s'appliquerait dès la saisie
        // changerait le comportement avant toute relecture.
        status: 'DRAFT',
        body: input.body as object,
        sourceName: input.sourceName,
        sourceUrl: input.sourceUrl ?? null,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        createdById: currentUser(req).id,
      },
    });
    res.status(201).json({ ...version, note: 'Version créée en brouillon. Activez-la explicitement pour qu’elle s’applique.' });
  }),
);

adminTradeRouter.post(
  '/rules/:id/activate',
  asyncHandler(async (req, res) => {
    const version = await prisma.toumaTradeRuleVersion.findUnique({ where: { id: req.params.id } });
    if (!version) throw notFound('Version de règle introuvable.');
    // L'ancienne version passe à `SUPERSEDED`, elle n'est jamais modifiée :
    // une commande passée sous une règle garde la règle de ce jour-là (§19).
    await prisma.$transaction([
      prisma.toumaTradeRuleVersion.updateMany({
        where: { corridorId: version.corridorId, countryCode: version.countryCode, ruleType: version.ruleType, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED' },
      }),
      prisma.toumaTradeRuleVersion.update({ where: { id: version.id }, data: { status: 'ACTIVE', reviewedAt: new Date(), reviewedById: currentUser(req).id } }),
    ]);
    res.json({ id: version.id, ruleType: version.ruleType, version: version.version, status: 'ACTIVE' });
  }),
);

adminTradeRouter.get(
  '/exceptions',
  asyncHandler(async (_req, res) => {
    const items = await prisma.toumaTradeShipmentException.findMany({
      where: { resolvedAt: null },
      orderBy: { raisedAt: 'desc' },
      take: 100,
      include: { tradeOrder: { select: { id: true, order: { select: { orderNumber: true } } } } },
    });
    res.json({ items, note: 'La cause n’est renseignée que si une source fiable la donne. « UNKNOWN » est un état légitime.' });
  }),
);

const fxEnregistrement = z.object({
  baseCurrency: z.string().length(3),
  quoteCurrency: z.string().length(3),
  rate: z.string().regex(/^\d+(\.\d{1,10})?$/),
  source: z.enum(['EXTERNAL_PROVIDER', 'CENTRAL_BANK', 'MANUAL_ADMIN']),
  sourceName: z.string().trim().min(2).max(200),
  sourceUrl: urlWeb(2000).nullish(),
  rateAt: z.coerce.date().optional(),
});

adminTradeRouter.post(
  '/fx/rates',
  asyncHandler(async (req, res) => {
    const input = parseBody(fxEnregistrement, req);
    res.status(201).json(await fxService.record({ ...input, createdById: currentUser(req).id }));
  }),
);

adminTradeRouter.post(
  '/documents/:id/verify',
  asyncHandler(async (req, res) => {
    const { method, note } = parseBody(z.object({ method: z.string().trim().min(2).max(200), note: z.string().trim().max(1000).nullish() }), req);
    res.json(await tradeDocumentService.verify(currentUser(req), req.params.id, { method, note }));
  }),
);

adminTradeRouter.post(
  '/documents/:id/reject',
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(z.object({ reason: z.string().trim().min(2).max(1000) }), req);
    res.json(await tradeDocumentService.reject(currentUser(req), req.params.id, reason));
  }),
);

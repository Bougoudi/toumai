import { Router } from 'express';
import { estPermission, LIBELLES_PERMISSION, PERMISSIONS_ADMIN, requirePermission } from './permissions.js';
import { integrityService } from './integrity.service.js';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { auditRequest } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { pageParams, paginated } from '../lib/pagination.js';
import { authenticate, currentUser, requireAdmin } from '../middleware/toumaAuth.js';
import { riskService } from '../risk/risk.service.js';
import { verificationService } from '../verification/verification.service.js';
import { commissionService } from '../payments/commission.service.js';
import { analyticsService } from './analytics.service.js';
import { intelligenceService } from './intelligence.service.js';

/** Toutes les routes d'administration sont protégées (authentification + rôle ADMIN). */
export const adminRouter = Router();

/**
 * Console d'administration historique.
 *
 * `requireAdmin` reste la première barrière. La permission, elle, est posée
 * **route par route** : cette console mêle les comptes, les paiements, les
 * commissions, les litiges et le journal d'audit. Une permission unique pour
 * l'ensemble reviendrait à rendre le découpage décoratif — qui peut lire le
 * tableau de bord pourrait changer un rôle et une règle de commission.
 */
adminRouter.use(authenticate, requireAdmin);

// ── Tableau de bord ──────────────────────────────────────────────────────────
adminRouter.get('/dashboard', requirePermission('ADMIN_SYSTEM'), asyncHandler(async (_req, res) => res.json(await analyticsService.dashboard())));

adminRouter.get(
  '/analytics',
  requirePermission('ADMIN_SYSTEM'),
  asyncHandler(async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30)));
    res.json(await analyticsService.timeseries(days));
  }),
);

// ── Utilisateurs ─────────────────────────────────────────────────────────────
const userStatusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']), reason: z.string().trim().max(500).optional() });
const userRoleSchema = z.object({ role: z.enum(['BUYER', 'SELLER', 'ADMIN']) });

adminRouter.get(
  '/users',
  requirePermission('ADMIN_USERS'),
  asyncHandler(async (req, res) => {
    const page = pageParams(req.query);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const where = q
      ? { OR: [{ email: { contains: q, mode: 'insensitive' as const } }, { name: { contains: q, mode: 'insensitive' as const } }] }
      : {};
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true, name: true, email: true, toumaRole: true, status: true, countryCode: true, createdAt: true, riskScore: { select: { score: true, level: true } } },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.limit,
      }),
      prisma.user.count({ where }),
    ]);
    res.json(paginated(items, total, page));
  }),
);

adminRouter.patch(
  '/users/:id/status',
  requirePermission('ADMIN_USERS'),
  asyncHandler(async (req, res) => {
    const input = parseBody(userStatusSchema, req);
    const admin = currentUser(req);
    if (req.params.id === admin.id) throw badRequest('Vous ne pouvez pas modifier votre propre statut.');
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { status: input.status } });
    await auditRequest(req, 'admin.user.status', 'User', user.id, { status: input.status, reason: input.reason ?? null });
    res.json({ id: user.id, status: user.status });
  }),
);

adminRouter.patch(
  '/users/:id/role',
  requirePermission('ADMIN_USERS'),
  asyncHandler(async (req, res) => {
    const input = parseBody(userRoleSchema, req);
    /**
     * Nommer quelqu'un administrateur ne lui donne **aucune** permission.
     *
     * C'est le point de §25 : « ne pas donner automatiquement toutes les
     * permissions à tous les administrateurs ». Le compte est cadré d'emblée,
     * avec une liste vide ; ses droits sont accordés ensuite, un par un, par
     * quelqu'un qui détient ADMIN_SYSTEM.
     *
     * L'accès complet hérité ne subsiste que pour les comptes qui
     * existaient avant ce découpage — il n'est jamais créé à neuf.
     */
    const devientAdmin = input.role === 'ADMIN';
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { toumaRole: input.role, ...(devientAdmin ? { adminScoped: true, adminPermissions: [] } : {}) },
    });
    await auditRequest(req, 'admin.user.role', 'User', user.id, { role: input.role, scopedOnPromotion: devientAdmin });
    res.json({
      id: user.id,
      role: user.toumaRole,
      ...(devientAdmin
        ? {
            permissions: [],
            note: 'Ce compte est administrateur mais n’a encore aucune permission. Accordez-les depuis /admin/permissions.',
          }
        : {}),
    });
  }),
);

// ── Boutiques & produits ─────────────────────────────────────────────────────
adminRouter.get(
  '/stores',
  requirePermission('ADMIN_USERS'),
  asyncHandler(async (req, res) => {
    const page = pageParams(req.query);
    const [items, total] = await Promise.all([
      prisma.toumaStore.findMany({
        include: { owner: { select: { id: true, name: true, email: true } }, _count: { select: { products: true, orders: true } } },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaStore.count(),
    ]);
    res.json(paginated(items, total, page));
  }),
);

adminRouter.patch(
  '/stores/:id/status',
  requirePermission('ADMIN_USERS'),
  asyncHandler(async (req, res) => {
    const input = parseBody(z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED']), reason: z.string().trim().max(500).optional() }), req);
    const store = await prisma.toumaStore.update({ where: { id: req.params.id }, data: { status: input.status } });
    await auditRequest(req, 'admin.store.status', 'ToumaStore', store.id, { status: input.status, reason: input.reason ?? null });
    res.json({ id: store.id, status: store.status });
  }),
);

adminRouter.patch(
  '/products/:id/status',
  requirePermission('ADMIN_USERS'),
  asyncHandler(async (req, res) => {
    const input = parseBody(z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED', 'SUSPENDED']), reason: z.string().trim().max(500).optional() }), req);
    const product = await prisma.toumaProduct.update({ where: { id: req.params.id }, data: { status: input.status } });
    await auditRequest(req, 'admin.product.status', 'ToumaProduct', product.id, { status: input.status, reason: input.reason ?? null });
    res.json({ id: product.id, status: product.status });
  }),
);

// ── Commandes, paiements, expéditions ────────────────────────────────────────
adminRouter.get(
  '/orders',
  requirePermission('ADMIN_LOGISTICS'),
  asyncHandler(async (req, res) => {
    const page = pageParams(req.query);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const where = status ? { status: status as 'PAID' } : {};
    const [rows, total] = await Promise.all([
      prisma.toumaOrder.findMany({
        where,
        include: { store: { select: { id: true, name: true } }, buyer: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaOrder.count({ where }),
    ]);
    res.json(paginated(rows.map((o) => ({ ...o, subtotal: o.subtotal.toString(), shippingTotal: o.shippingTotal.toString(), commissionTotal: o.commissionTotal.toString(), total: o.total.toString() })), total, page));
  }),
);

adminRouter.get(
  '/payments',
  requirePermission('ADMIN_PAYMENTS'),
  asyncHandler(async (req, res) => {
    const page = pageParams(req.query);
    const [rows, total] = await Promise.all([
      prisma.toumaPayment.findMany({
        include: { order: { select: { id: true, orderNumber: true, storeId: true } } },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaPayment.count(),
    ]);
    res.json(paginated(rows.map((p) => ({ ...p, amount: p.amount.toString(), refundedAmount: p.refundedAmount.toString() })), total, page));
  }),
);

// ── Commission ───────────────────────────────────────────────────────────────

const commissionRuleSchema = z.object({
  countryCode: z.string().trim().length(2).optional(),
  categoryId: z.string().cuid().optional(),
  storeId: z.string().cuid().optional(),
  rate: z.string().regex(/^\d(\.\d{1,6})?$/, 'Taux décimal attendu (0.05 = 5 %).'),
  minFee: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  maxFee: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  feeCurrency: z.string().trim().length(3).optional(),
  effectiveFrom: z.string().datetime().optional(),
  effectiveUntil: z.string().datetime().optional(),
  note: z.string().trim().max(300).optional(),
});

const simulateSchema = z.object({
  base: z.string().regex(/^\d+(\.\d{1,4})?$/),
  currency: z.string().trim().length(3),
  countryCode: z.string().trim().length(2).optional(),
  categoryIds: z.array(z.string().cuid()).max(20).optional(),
  storeId: z.string().cuid().optional(),
});

adminRouter.get(
  '/commission-rules',
  requirePermission('ADMIN_PAYOUTS'),
  asyncHandler(async (req, res) => res.json(await commissionService.list(req.query.all === 'true'))),
);

adminRouter.post(
  '/commission-rules',
  requirePermission('ADMIN_PAYOUTS'),
  asyncHandler(async (req, res) => {
    const input = parseBody(commissionRuleSchema, req);
    res.status(201).json(await commissionService.create(currentUser(req), input));
  }),
);

/**
 * Clôture. Il n'existe **aucune** route de modification ni de suppression :
 * changer un taux, c'est clore la règle et en ouvrir une autre. Une commande
 * passée doit rester explicable par la règle qui l'a produite.
 */
adminRouter.post(
  '/commission-rules/:id/close',
  requirePermission('ADMIN_PAYOUTS'),
  asyncHandler(async (req, res) => {
    const input = parseBody(z.object({ reason: z.string().trim().min(3).max(300) }), req);
    res.json(await commissionService.close(currentUser(req), req.params.id, input.reason));
  }),
);

/** Quel taux s'appliquerait, et pourquoi — avant de le poser sur de vraies commandes. */
adminRouter.post(
  '/commission-rules/simulate',
  requirePermission('ADMIN_PAYOUTS'),
  asyncHandler(async (req, res) => res.json(await commissionService.simulate(parseBody(simulateSchema, req)))),
);

/**
 * Tentatives de webhook — acceptées **et refusées**.
 *
 * C'est la vue qui manquait : un webhook rejeté pour signature invalide était
 * journalisé puis perdu. Le filtre par issue sert d'abord à isoler les rejets,
 * et le compte par issue dit d'un coup d'œil si une série de tentatives est en
 * cours.
 */
adminRouter.get(
  '/webhooks',
  requirePermission('ADMIN_PAYMENTS'),
  asyncHandler(async (req, res) => {
    const page = pageParams(req.query);
    const outcome = typeof req.query.outcome === 'string' && req.query.outcome.length > 0 ? req.query.outcome : undefined;
    const provider = typeof req.query.provider === 'string' && req.query.provider.length > 0 ? req.query.provider : undefined;
    const where = { ...(outcome ? { outcome: outcome as never } : {}), ...(provider ? { provider } : {}) };

    const [rows, total, parIssue] = await Promise.all([
      prisma.toumaWebhookDelivery.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }),
      prisma.toumaWebhookDelivery.count({ where }),
      prisma.toumaWebhookDelivery.groupBy({ by: ['outcome'], _count: { _all: true } }),
    ]);

    res.json({
      ...paginated(rows, total, page),
      byOutcome: parIssue.map((r) => ({ outcome: r.outcome, count: r._count._all })),
    });
  }),
);

adminRouter.get(
  '/shipments',
  requirePermission('ADMIN_LOGISTICS'),
  asyncHandler(async (req, res) => {
    const page = pageParams(req.query);
    const [rows, total] = await Promise.all([
      prisma.toumaShipment.findMany({
        include: { order: { select: { id: true, orderNumber: true } } },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaShipment.count(),
    ]);
    res.json(paginated(rows.map((s) => ({ ...s, amount: s.amount.toString() })), total, page));
  }),
);

// ── Touma Verified ───────────────────────────────────────────────────────────
adminRouter.get(
  '/verifications',
  requirePermission('ADMIN_TRUST'),
  asyncHandler(async (req, res) => {
    const page = pageParams(req.query);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const { items, total } = await verificationService.queue(status, { skip: page.skip, take: page.limit });
    res.json(paginated(items, total, page));
  }),
);

adminRouter.post(
  '/verifications/:id/approve',
  requirePermission('ADMIN_TRUST'),
  asyncHandler(async (req, res) => {
    const comment = typeof req.body?.comment === 'string' ? req.body.comment : undefined;
    res.json(await verificationService.decide(currentUser(req), req.params.id, 'APPROVED', comment));
  }),
);

adminRouter.post(
  '/verifications/:id/reject',
  requirePermission('ADMIN_TRUST'),
  asyncHandler(async (req, res) => {
    const input = parseBody(z.object({ comment: z.string().trim().min(3).max(1000) }), req);
    res.json(await verificationService.decide(currentUser(req), req.params.id, 'REJECTED', input.comment));
  }),
);

// ── Litiges & risque ─────────────────────────────────────────────────────────
adminRouter.get(
  '/disputes',
  requirePermission('ADMIN_TRUST'),
  asyncHandler(async (req, res) => {
    const page = pageParams(req.query);
    const [rows, total] = await Promise.all([
      prisma.toumaDispute.findMany({
        include: { order: { select: { id: true, orderNumber: true, storeId: true, buyerId: true } }, _count: { select: { messages: true, evidence: true } } },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaDispute.count(),
    ]);
    res.json(paginated(rows.map((d) => ({ ...d, refundAmount: d.refundAmount?.toString() ?? null })), total, page));
  }),
);

adminRouter.get('/risk', requirePermission('ADMIN_TRUST'), asyncHandler(async (_req, res) => res.json({ items: await riskService.top(50) })));

adminRouter.post(
  '/risk/:userId/recompute',
  requirePermission('ADMIN_TRUST'),
  asyncHandler(async (req, res) => {
    const score = await riskService.compute(req.params.userId);
    if (!score) throw notFound('Utilisateur introuvable.');
    await auditRequest(req, 'admin.risk.recompute', 'User', req.params.userId, { score: score.score });
    res.json(score);
  }),
);

// ── Journal d'audit ──────────────────────────────────────────────────────────
/**
 * Permissions d'administration (V25 §25-26).
 *
 * Accorder un droit est l'action qui permet toutes les autres : elle demande
 * `ADMIN_SYSTEM` et laisse une trace nominative — qui, à qui, quoi avant,
 * quoi après.
 */
adminRouter.get(
  '/permissions',
  requirePermission('ADMIN_SYSTEM'),
  asyncHandler(async (_req, res) => {
    const admins = await prisma.user.findMany({
      where: { toumaRole: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, adminPermissions: true, adminScoped: true, status: true },
    });
    res.json({
      catalogue: PERMISSIONS_ADMIN.map((code) => ({ code, label: LIBELLES_PERMISSION[code] })),
      admins: admins.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        status: a.status,
        scoped: a.adminScoped,
        permissions: a.adminPermissions,
        /**
         * Un compte non cadré a **tous** les droits. C'est dit ici plutôt que
         * laissé à deviner d'un tableau de permissions vide, qui se lirait
         * comme « aucun droit » et donnerait exactement l'inverse de la
         * réalité.
         */
        effective: a.adminScoped ? a.adminPermissions : [...PERMISSIONS_ADMIN],
      })),
      note: 'Un compte « non cadré » conserve l’accès complet, hérité d’avant le découpage. Lui accorder une permission le cadre définitivement.',
    });
  }),
);

const permissionsSchema = z.object({
  permissions: z.array(z.string().trim().max(40)).max(PERMISSIONS_ADMIN.length),
});

adminRouter.put(
  '/permissions/:id',
  requirePermission('ADMIN_SYSTEM'),
  asyncHandler(async (req, res) => {
    const input = parseBody(permissionsSchema, req);
    const inconnues = input.permissions.filter((p) => !estPermission(p));
    if (inconnues.length > 0) throw badRequest(`Permissions inconnues : ${inconnues.join(', ')}.`);

    const cible = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, toumaRole: true, adminPermissions: true, adminScoped: true },
    });
    if (!cible || cible.toumaRole !== 'ADMIN') throw notFound('Administrateur introuvable.');

    const acteur = currentUser(req);
    /**
     * Personne ne se retire `ADMIN_SYSTEM` à soi-même.
     *
     * Ce n'est pas une politesse : c'est la seule permission qui permet de
     * réattribuer les permissions. Se la retirer en dernier administrateur
     * cadré ferme la porte de l'intérieur, sans clé et sans recours par
     * l'interface.
     */
    const demandees = [...new Set(input.permissions)].filter(estPermission);
    if (cible.id === acteur.id && !demandees.includes('ADMIN_SYSTEM')) {
      throw badRequest('Vous ne pouvez pas retirer votre propre permission ADMIN_SYSTEM : plus personne ne pourrait la rendre.');
    }

    const avant = { permissions: cible.adminPermissions, scoped: cible.adminScoped };
    const apres = await prisma.user.update({
      where: { id: cible.id },
      data: { adminPermissions: demandees, adminScoped: true },
      select: { id: true, adminPermissions: true, adminScoped: true },
    });

    await auditRequest(req, 'admin.permissions.set', 'User', cible.id, {
      before: avant,
      after: { permissions: apres.adminPermissions, scoped: apres.adminScoped },
    });
    res.json({ id: apres.id, permissions: apres.adminPermissions, scoped: apres.adminScoped });
  }),
);

/**
 * Intégrité des données (V25 §83).
 *
 * Aucun contrôle ne répare : constater et réparer sont deux gestes, et le
 * second demande une décision humaine. L'écran dit aussi **ce qu'il a
 * vérifié** — « rien à signaler » ne vaut que rapporté à la liste des
 * invariants contrôlés.
 */
adminRouter.get(
  '/data-integrity',
  requirePermission('ADMIN_SYSTEM'),
  asyncHandler(async (_req, res) => res.json(await integrityService.run())),
);

adminRouter.get(
  '/data-integrity/catalogue',
  requirePermission('ADMIN_SYSTEM'),
  asyncHandler(async (_req, res) => res.json({ items: integrityService.catalogue() })),
);

adminRouter.get(
  '/audit',
  requirePermission('ADMIN_SYSTEM'),
  asyncHandler(async (req, res) => {
    const page = pageParams(req.query);
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const where = action ? { action: { contains: action } } : {};
    const [items, total] = await Promise.all([
      prisma.toumaAuditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaAuditLog.count({ where }),
    ]);
    res.json(paginated(items, total, page));
  }),
);

// ── TOUMA Intelligence ───────────────────────────────────────────────────────
/**
 * Ce que les transactions réelles apprennent : corridors actifs, demande non
 * servie, fiabilité des paiements, catégories en mouvement, tensions de stock.
 */
adminRouter.get(
  '/intelligence',
  requirePermission('ADMIN_SYSTEM'),
  asyncHandler(async (req, res) => {
    const days = Math.min(365, Math.max(7, Number(req.query.days ?? 30) || 30));
    res.json(await intelligenceService.overview(days));
  }),
);

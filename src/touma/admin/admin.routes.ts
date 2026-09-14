import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { auditRequest } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { pageParams, paginated } from '../lib/pagination.js';
import { authenticate, currentUser, requireAdmin } from '../middleware/toumaAuth.js';
import { riskService } from '../risk/risk.service.js';
import { verificationService } from '../verification/verification.service.js';
import { analyticsService } from './analytics.service.js';
import { intelligenceService } from './intelligence.service.js';

/** Toutes les routes d'administration sont protégées (authentification + rôle ADMIN). */
export const adminRouter = Router();

adminRouter.use(authenticate, requireAdmin);

// ── Tableau de bord ──────────────────────────────────────────────────────────
adminRouter.get('/dashboard', asyncHandler(async (_req, res) => res.json(await analyticsService.dashboard())));

adminRouter.get(
  '/analytics',
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
  asyncHandler(async (req, res) => {
    const input = parseBody(userRoleSchema, req);
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { toumaRole: input.role } });
    await auditRequest(req, 'admin.user.role', 'User', user.id, { role: input.role });
    res.json({ id: user.id, role: user.toumaRole });
  }),
);

// ── Boutiques & produits ─────────────────────────────────────────────────────
adminRouter.get(
  '/stores',
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
  asyncHandler(async (req, res) => {
    const input = parseBody(z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED']), reason: z.string().trim().max(500).optional() }), req);
    const store = await prisma.toumaStore.update({ where: { id: req.params.id }, data: { status: input.status } });
    await auditRequest(req, 'admin.store.status', 'ToumaStore', store.id, { status: input.status, reason: input.reason ?? null });
    res.json({ id: store.id, status: store.status });
  }),
);

adminRouter.patch(
  '/products/:id/status',
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
  asyncHandler(async (req, res) => {
    const page = pageParams(req.query);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const { items, total } = await verificationService.queue(status, { skip: page.skip, take: page.limit });
    res.json(paginated(items, total, page));
  }),
);

adminRouter.post(
  '/verifications/:id/approve',
  asyncHandler(async (req, res) => {
    const comment = typeof req.body?.comment === 'string' ? req.body.comment : undefined;
    res.json(await verificationService.decide(currentUser(req), req.params.id, 'APPROVED', comment));
  }),
);

adminRouter.post(
  '/verifications/:id/reject',
  asyncHandler(async (req, res) => {
    const input = parseBody(z.object({ comment: z.string().trim().min(3).max(1000) }), req);
    res.json(await verificationService.decide(currentUser(req), req.params.id, 'REJECTED', input.comment));
  }),
);

// ── Litiges & risque ─────────────────────────────────────────────────────────
adminRouter.get(
  '/disputes',
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

adminRouter.get('/risk', asyncHandler(async (_req, res) => res.json({ items: await riskService.top(50) })));

adminRouter.post(
  '/risk/:userId/recompute',
  asyncHandler(async (req, res) => {
    const score = await riskService.compute(req.params.userId);
    if (!score) throw notFound('Utilisateur introuvable.');
    await auditRequest(req, 'admin.risk.recompute', 'User', req.params.userId, { score: score.score });
    res.json(score);
  }),
);

// ── Journal d'audit ──────────────────────────────────────────────────────────
adminRouter.get(
  '/audit',
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
  asyncHandler(async (req, res) => {
    const days = Math.min(365, Math.max(7, Number(req.query.days ?? 30) || 30));
    res.json(await intelligenceService.overview(days));
  }),
);

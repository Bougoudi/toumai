import { Router } from 'express';
import { requirePermission } from '../admin/permissions.js';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { forbidden, notFound } from '../lib/errors.js';
import { idempotent } from '../lib/idempotency.js';
import { authenticate, currentUser, requireAdmin } from '../middleware/toumaAuth.js';
import { entriesFor, storeBalance } from './ledger.js';
import { settlementService, sweepSettlements } from './settlement.service.js';

/**
 * Centre financier vendeur et administration.
 *
 * Deux règles de lecture tenues partout ici :
 *
 * **Un vendeur ne voit que ses boutiques.** Un identifiant de boutique
 * étrangère répond « introuvable », jamais « interdit » — c'est la convention
 * anti-IDOR du dépôt, et elle vaut d'autant plus sur des montants.
 *
 * **Les devises ne sont jamais additionnées.** Un solde est rendu par devise :
 * sans taux officiel, une somme XAF + EUR serait un chiffre inventé.
 */
export const financeRouter = Router();
export const adminFinanceRouter = Router();

financeRouter.use(authenticate);

// Les délais de protection sont constatés côté serveur, sur le chemin de la
// consultation : une éligibilité qui dépendrait d'un onglet ouvert n'arriverait
// jamais pour celui qui a fermé le sien.
financeRouter.use(
  asyncHandler(async (_req, _res, next) => {
    await sweepSettlements();
    next();
  }),
);

/** Boutique du demandeur — ou 404 si elle n'est pas à lui. */
async function ownStore(userId: string, role: string, storeId?: string) {
  const store = storeId
    ? await prisma.toumaStore.findUnique({ where: { id: storeId }, select: { id: true, ownerId: true, name: true } })
    : await prisma.toumaStore.findFirst({ where: { ownerId: userId }, select: { id: true, ownerId: true, name: true } });
  if (!store) throw notFound('Boutique introuvable.');
  if (store.ownerId !== userId && role !== 'ADMIN') throw notFound('Boutique introuvable.');
  return store;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

// ── Vendeur ─────────────────────────────────────────────────────────────────

financeRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const store = await ownStore(user.id, user.role, str(req.query.store));
    const [finance, balances] = await Promise.all([settlementService.storeFinance(store.id), storeBalance(store.id)]);
    res.json({ store: { id: store.id, name: store.name }, ...finance, ledgerBalances: balances });
  }),
);

financeRouter.get(
  '/payouts',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const store = await ownStore(user.id, user.role, str(req.query.store));
    res.json(await settlementService.payouts(store.id));
  }),
);

financeRouter.get(
  '/payouts/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const payout = await prisma.toumaSellerPayout.findUnique({
      where: { id: req.params.id },
      include: {
        store: { select: { id: true, name: true, ownerId: true } },
        allocations: { select: { orderId: true, currency: true, grossAmount: true, commissionAmount: true, shippingAmount: true, refundedAmount: true } },
      },
    });
    if (!payout) throw notFound('Versement introuvable.');
    if (payout.store.ownerId !== user.id && user.role !== 'ADMIN') throw notFound('Versement introuvable.');

    res.json({
      ...payout,
      amount: payout.amount.toString(),
      allocations: payout.allocations.map((a) => ({
        ...a,
        grossAmount: a.grossAmount.toString(),
        commissionAmount: a.commissionAmount.toString(),
        shippingAmount: a.shippingAmount.toString(),
        refundedAmount: a.refundedAmount.toString(),
        netAmount: settlementService.netOf(a).toString(),
      })),
    });
  }),
);

/** Mouvements comptables d'une commande, pour le vendeur qui l'a honorée. */
financeRouter.get(
  '/orders/:orderId/ledger',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const order = await prisma.toumaOrder.findUnique({
      where: { id: req.params.orderId },
      select: { id: true, store: { select: { ownerId: true } } },
    });
    if (!order) throw notFound('Commande introuvable.');
    if (order.store.ownerId !== user.id && user.role !== 'ADMIN') throw notFound('Commande introuvable.');
    res.json({ items: await entriesFor('ToumaOrder', order.id) });
  }),
);

// ── Administration ──────────────────────────────────────────────────────────

adminFinanceRouter.use(authenticate, requireAdmin, requirePermission('ADMIN_PAYOUTS'));

const payoutCreateSchema = z.object({ storeId: z.string().cuid(), currency: z.string().trim().length(3) });
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });

adminFinanceRouter.get(
  '/payouts',
  asyncHandler(async (req, res) => {
    const status = str(req.query.status);
    const items = await prisma.toumaSellerPayout.findMany({
      where: { ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { store: { select: { id: true, name: true, countryCode: true } }, _count: { select: { allocations: true } } },
    });
    res.json({
      items: items.map((p) => ({ ...p, amount: p.amount.toString(), orderCount: p._count.allocations, _count: undefined })),
    });
  }),
);

adminFinanceRouter.post(
  '/payouts',
  idempotent('finance.payout.create'),
  asyncHandler(async (req, res) => {
    const input = parseBody(payoutCreateSchema, req);
    const payout = await settlementService.createPayout(currentUser(req), input.storeId, input.currency.toUpperCase());
    res.status(201).json(payout);
  }),
);

adminFinanceRouter.post(
  '/payouts/:id/process',
  idempotent('finance.payout.process'),
  asyncHandler(async (req, res) => {
    const providerRef = typeof req.body?.providerRef === 'string' ? req.body.providerRef : undefined;
    res.json(await settlementService.processPayout(currentUser(req), req.params.id, providerRef));
  }),
);

adminFinanceRouter.post(
  '/payouts/:id/hold',
  asyncHandler(async (req, res) => {
    const input = parseBody(reasonSchema, req);
    res.json(await settlementService.holdPayout(currentUser(req), req.params.id, input.reason));
  }),
);

adminFinanceRouter.post(
  '/payouts/:id/release',
  asyncHandler(async (req, res) => res.json(await settlementService.releasePayout(currentUser(req), req.params.id))),
);

adminFinanceRouter.post(
  '/payouts/:id/cancel',
  asyncHandler(async (req, res) => {
    const input = parseBody(reasonSchema, req);
    res.json(await settlementService.cancelPayout(currentUser(req), req.params.id, input.reason));
  }),
);

/**
 * Vue d'ensemble. Tout est **calculé sur des faits**, jamais estimé : si une
 * ligne manque, elle manque — le §80 interdit d'afficher une statistique
 * fabriquée pour remplir un tableau de bord.
 */
adminFinanceRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const [parStatutPaiement, parStatutPart, parStatutVersement, remboursements] = await Promise.all([
      prisma.toumaPayment.groupBy({ by: ['status', 'currency'], _count: { _all: true }, _sum: { amount: true } }),
      prisma.toumaSettlementAllocation.groupBy({ by: ['status', 'currency'], _count: { _all: true } }),
      prisma.toumaSellerPayout.groupBy({ by: ['status', 'currency'], _count: { _all: true }, _sum: { amount: true } }),
      prisma.toumaRefund.groupBy({ by: ['status', 'currency'], _count: { _all: true }, _sum: { amount: true } }),
    ]);

    res.json({
      payments: parStatutPaiement.map((r) => ({ status: r.status, currency: r.currency, count: r._count._all, total: r._sum.amount?.toString() ?? '0' })),
      settlements: parStatutPart.map((r) => ({ status: r.status, currency: r.currency, count: r._count._all })),
      payouts: parStatutVersement.map((r) => ({ status: r.status, currency: r.currency, count: r._count._all, total: r._sum.amount?.toString() ?? '0' })),
      refunds: remboursements.map((r) => ({ status: r.status, currency: r.currency, count: r._count._all, total: r._sum.amount?.toString() ?? '0' })),
      note: 'Montants par devise, jamais additionnés entre devises : aucun taux officiel n’est configuré.',
    });
  }),
);

/** Registre comptable d'une boutique, pour l'administration. */
adminFinanceRouter.get(
  '/ledger',
  asyncHandler(async (req, res) => {
    const storeId = str(req.query.store);
    if (!storeId) throw forbidden('Indiquez la boutique dont vous voulez le registre.');
    res.json({ balances: await storeBalance(storeId) });
  }),
);

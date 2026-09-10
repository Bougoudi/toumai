import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { asyncHandler } from '../../middleware/validate.js';
import { forbidden, notFound } from '../lib/errors.js';
import { authenticate, currentUser, requireRole } from '../middleware/toumaAuth.js';
import { analyticsService } from '../admin/analytics.service.js';

/** Espace vendeur (Seller Center) : agrégats prêts à afficher. */
export const sellerRouter = Router();

sellerRouter.use(authenticate, requireRole('SELLER', 'ADMIN'));

/** Vue d'ensemble : boutiques, ventes, commandes à préparer, stock faible. */
sellerRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const stores = await prisma.toumaStore.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: 'asc' } });
    const stats = await Promise.all(stores.map((s) => analyticsService.storeStats(s.id)));
    const recentOrders = await prisma.toumaOrder.findMany({
      where: { store: { ownerId: user.id } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { items: true, buyer: { select: { name: true } } },
    });
    res.json({
      stores: stores.map((s, i) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        status: s.status,
        verificationStatus: s.verificationStatus,
        countryCode: s.countryCode,
        stats: stats[i],
      })),
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total.toString(),
        currency: o.currency,
        buyer: o.buyer.name,
        itemCount: o.items.reduce((acc, it) => acc + it.quantity, 0),
        createdAt: o.createdAt,
      })),
    });
  }),
);

/** Statistiques détaillées d'une boutique du vendeur. */
sellerRouter.get(
  '/stores/:id/stats',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const store = await prisma.toumaStore.findUnique({ where: { id: req.params.id } });
    if (!store) throw notFound('Boutique introuvable.');
    if (store.ownerId !== user.id && user.role !== 'ADMIN') throw forbidden('Boutique d’un autre vendeur.');
    res.json(await analyticsService.storeStats(store.id));
  }),
);

/** Courbe des ventes d'une boutique (graphique du tableau de bord vendeur). */
sellerRouter.get(
  '/stores/:id/analytics',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const store = await prisma.toumaStore.findUnique({ where: { id: req.params.id } });
    if (!store) throw notFound('Boutique introuvable.');
    if (store.ownerId !== user.id && user.role !== 'ADMIN') throw forbidden('Boutique d’un autre vendeur.');
    const days = Math.min(180, Math.max(7, Number(req.query.days ?? 30)));
    res.json(await analyticsService.storeTimeseries(store.id, days));
  }),
);

/** Articles dont le stock est bas (réapprovisionnement). */
sellerRouter.get(
  '/inventory/low-stock',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const items = await prisma.toumaInventory.findMany({
      where: { product: { store: { ownerId: user.id } }, quantity: { lte: 5 } },
      include: { product: { select: { id: true, title: true, slug: true, storeId: true } }, variant: { select: { id: true, name: true } } },
      orderBy: { quantity: 'asc' },
      take: 100,
    });
    res.json({ items });
  }),
);

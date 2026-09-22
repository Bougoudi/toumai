import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, parseQuery } from '../../middleware/validate.js';
import { forbidden, notFound } from '../lib/errors.js';
import { authenticate, currentUser, requireRole } from '../middleware/toumaAuth.js';
import { analyticsService } from '../admin/analytics.service.js';
import { importService } from '../catalog/import.service.js';
import { listOrdersSchema } from '../orders/order.schema.js';
import { orderService } from '../orders/order.service.js';

/** Pagination du journal de stock : par curseur, l'historique pouvant être long. */
const mouvementsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().cuid().optional(),
});

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
/**
 * Commandes du vendeur (§17).
 *
 * Alias explicite de `GET /orders`, qui filtre déjà sur les boutiques du
 * demandeur. Deux chemins, un seul service : un vendeur cherche ses commandes
 * dans son espace, pas dans la liste générale — mais dupliquer la logique de
 * filtrage serait le meilleur moyen de laisser fuiter la commande d'autrui le
 * jour où l'une des deux copies évolue.
 */
sellerRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    res.json(await orderService.list(currentUser(req), parseQuery(listOrdersSchema, req)));
  }),
);

sellerRouter.get(
  '/orders/:id',
  asyncHandler(async (req, res) => res.json(await orderService.get(currentUser(req), req.params.id))),
);

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

// ── Import et export de catalogue ────────────────────────────────────────────

/**
 * Simulation puis application d'un import. Le corps est le **texte CSV brut** :
 * le vendeur colle le contenu de son tableur ou envoie son fichier, sans avoir
 * à le convertir en JSON.
 */
sellerRouter.post(
  '/stores/:storeId/catalogue/import',
  // Le CSV arrive en texte : la taille est bornée par le middleware global.
  asyncHandler(async (req, res) => {
    const csv = typeof req.body === 'string' ? req.body : String((req.body as { csv?: unknown })?.csv ?? '');
    const dryRun = String(req.query.dryRun ?? 'true') !== 'false';
    res.json(await importService.importCatalogue(currentUser(req), req.params.storeId, csv, { dryRun }));
  }),
);

/** Export au même format que l'import : exporter, corriger, réimporter. */
sellerRouter.get(
  '/stores/:storeId/catalogue/export',
  asyncHandler(async (req, res) => {
    const csv = await importService.exportCatalogue(currentUser(req), req.params.storeId);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="catalogue-touma.csv"`);
    res.send(csv);
  }),
);

/** Modèle vierge, pour partir du bon format plutôt que de le deviner. */
sellerRouter.get(
  '/catalogue/modele',
  asyncHandler(async (_req, res) => {
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="modele-catalogue-touma.csv"');
    res.send(importService.templateCsv());
  }),
);

/**
 * Historique des mouvements de stock d'un produit (V27 §3).
 *
 * C'est la contrepartie utile du journal : le tracer ne sert à rien si le
 * commerçant ne peut pas le lire. La question qu'il pose est toujours la même
 * — « pourquoi ce produit est-il passé de 12 à 9 ? » — et jusqu'ici elle
 * n'avait aucune réponse.
 *
 * Réservé au propriétaire de la boutique. Un mouvement de stock dit combien un
 * concurrent vend et quand : c'est une donnée commerciale, pas un journal
 * public.
 */
sellerRouter.get(
  '/products/:productId/stock-movements',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const produit = await prisma.toumaProduct.findUnique({
      where: { id: req.params.productId },
      select: { id: true, title: true, store: { select: { ownerId: true } } },
    });
    // Introuvable plutôt qu'interdit : répondre 403 confirmerait l'existence
    // du produit d'un autre vendeur.
    if (!produit || (produit.store.ownerId !== user.id && user.role !== 'ADMIN')) {
      throw notFound('Produit introuvable.');
    }

    const { limit, cursor } = parseQuery(mouvementsSchema, req);
    const lignes = await prisma.toumaStockMovement.findMany({
      where: { productId: produit.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        quantityDelta: true,
        reservedDelta: true,
        quantityAfter: true,
        reservedAfter: true,
        reason: true,
        referenceType: true,
        referenceId: true,
        createdAt: true,
      },
    });

    const page = lignes.slice(0, limit);
    res.json({
      product: { id: produit.id, title: produit.title },
      items: page,
      nextCursor: lignes.length > limit ? page[page.length - 1]?.id : null,
      note:
        'Chaque ligne porte l’état après application. Un article dont l’inventaire ne correspond pas au dernier ' +
        'mouvement a été modifié hors journal — le contrôle d’intégrité le signale.',
    });
  }),
);

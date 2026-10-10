import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, parseBody, parseQuery } from '../../middleware/validate.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { authenticate, currentUser, requireRole } from '../middleware/toumaAuth.js';
import { analyticsService } from '../admin/analytics.service.js';
import { importService } from '../catalog/import.service.js';
import { listOrdersSchema } from '../orders/order.schema.js';
import { orderService } from '../orders/order.service.js';
import { ruptures } from '../market/stockout.js';
import { TYPES_SIGNAL } from '../market/signals.service.js';

/** Fenêtre d'analyse des ruptures. */
const rupturesSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  storeId: z.string().cuid().optional(),
});

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

/**
 * Ruptures de stock du vendeur, avec leur durée et la demande observée (V29 §8).
 *
 * Restreint à ses propres boutiques. Les ruptures d'un concurrent disent ce
 * qu'il n'arrive pas à fournir : c'est une donnée commerciale.
 */
sellerRouter.get(
  '/stockouts',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { days, storeId } = parseQuery(rupturesSchema, req);

    const boutiques = await prisma.toumaStore.findMany({ where: { ownerId: user.id }, select: { id: true } });

    // Le contrôle sur la boutique demandée passe **avant** le cas « aucune
    // boutique ». Dans l'autre ordre, un vendeur sans boutique recevait 200 et
    // une liste vide pour n'importe quel identifiant, là où un vendeur qui en a
    // recevait 404 : deux réponses différentes à la même tentative, et la
    // seconde disait au premier que le contrôle existe.
    if (storeId && !boutiques.some((b) => b.id === storeId)) throw notFound('Boutique introuvable.');

    if (boutiques.length === 0) {
      return res.json({ items: [], windowDays: days, note: 'Aucune boutique : rien à analyser.' });
    }

    const resultats = await Promise.all(
      (storeId ? [storeId] : boutiques.map((b) => b.id)).map((id) => ruptures({ days, storeId: id })),
    );
    res.json({
      items: resultats.flatMap((r) => r.items),
      windowDays: days,
      note: resultats[0]?.note ?? '',
    });
  }),
);

// ── Signaux de marché persistés et surveillance (V29 §28 à §30, §36) ─────────
//
// Un vendeur ne lit et ne surveille que ses propres boutiques. Les signaux d'un
// concurrent disent ce qu'il n'arrive pas à fournir : §47 et §48 l'interdisent.
//
// Le contrôle de propriété passe **avant** tout le reste dans chaque route,
// y compris avant le cas « ce vendeur n'a aucune boutique ». Dans l'autre
// ordre, un vendeur sans boutique reçoit 200 pour n'importe quel identifiant
// là où un vendeur qui en a reçoit 404 — et l'écart entre les deux réponses
// apprend au premier que le contrôle existe.

/** Lecture des signaux : ouverts par défaut, les clos sur demande. */
const signauxSchema = z.object({
  storeId: z.string().cuid().optional(),
  kind: z.enum(TYPES_SIGNAL).optional(),
  /** `true` pour voir aussi ce qui est résolu — l'histoire, pas seulement l'état. */
  includeResolved: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Création d'une surveillance. */
const surveillanceSchema = z.object({
  storeId: z.string().cuid(),
  scope: z.enum(['PRODUCT', 'STORE']),
  /** Obligatoire pour une portée produit ; ignoré pour une portée boutique. */
  productId: z.string().cuid().optional(),
  /** Liste vide = tous les types de signaux. */
  kinds: z.array(z.enum(TYPES_SIGNAL)).default([]),
});

/** Mise en sourdine : une échéance, jamais un silence définitif. */
const sourdineSchema = z.object({
  mutedUntil: z.coerce.date().nullable(),
});

/** Les identifiants des boutiques du vendeur, et le contrôle de celle demandée. */
async function boutiquesDuVendeur(userId: string, storeId?: string): Promise<string[]> {
  const boutiques = await prisma.toumaStore.findMany({ where: { ownerId: userId }, select: { id: true } });
  if (storeId && !boutiques.some((b) => b.id === storeId)) throw notFound('Boutique introuvable.');
  return storeId ? [storeId] : boutiques.map((b) => b.id);
}

sellerRouter.get(
  '/market/signals',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { storeId, kind, includeResolved, limit } = parseQuery(signauxSchema, req);
    const ids = await boutiquesDuVendeur(user.id, storeId);

    if (ids.length === 0) {
      return res.json({ items: [], note: 'Aucune boutique : aucun signal à suivre.' });
    }

    const signaux = await prisma.toumaMarketSignal.findMany({
      where: { storeId: { in: ids }, ...(kind ? { kind } : {}), ...(includeResolved ? {} : { resolvedAt: null }) },
      orderBy: [{ resolvedAt: 'asc' }, { firstSeenAt: 'asc' }],
      take: limit,
    });

    const maintenant = Date.now();
    res.json({
      items: signaux.map((s) => ({
        id: s.id,
        kind: s.kind,
        subjectType: s.subjectType,
        subjectId: s.subjectId,
        storeId: s.storeId,
        measured: s.measured,
        observedAt: s.observedAt.toISOString(),
        firstSeenAt: s.firstSeenAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        resolvedAt: s.resolvedAt?.toISOString() ?? null,
        /**
         * L'âge **observé**, et non déduit.
         *
         * Pour un signal clos, il s'arrête à la résolution : compter jusqu'à
         * aujourd'hui ferait vieillir indéfiniment une rupture réglée le mois
         * dernier.
         */
        ageDays: Math.max(
          0,
          Math.floor(((s.resolvedAt?.getTime() ?? maintenant) - s.firstSeenAt.getTime()) / 86_400_000),
        ),
      })),
      note:
        'Un signal est conservé après sa résolution : sa disparition est une information. ' +
        '`ageDays` est observé depuis la première fois que le signal a été vu, et non déduit d’un calcul.',
    });
  }),
);

sellerRouter.get(
  '/market/watches',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const surveillances = await prisma.toumaMarketWatch.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      items: surveillances.map((w) => ({
        id: w.id,
        storeId: w.storeId,
        scope: w.scope,
        subjectId: w.subjectId,
        kinds: w.kinds,
        mutedUntil: w.mutedUntil?.toISOString() ?? null,
        createdAt: w.createdAt.toISOString(),
      })),
      note: 'Une liste `kinds` vide signifie « tous les types de signaux ». Une surveillance muette reste enregistrée.',
    });
  }),
);

sellerRouter.post(
  '/market/watches',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = parseBody(surveillanceSchema, req);
    await boutiquesDuVendeur(user.id, input.storeId);

    // Pour une portée boutique, le sujet **est** la boutique. Laisser la
    // colonne nulle ferait échouer la contrainte d'unicité à son office : deux
    // NULL ne se heurtent pas, et le même vendeur enregistrerait deux fois la
    // même surveillance.
    let subjectId = input.storeId;
    if (input.scope === 'PRODUCT') {
      if (!input.productId) throw badRequest('Une surveillance de produit demande `productId`.');
      // Le produit doit appartenir à la boutique surveillée : autrement un
      // vendeur s'abonnerait aux signaux du produit d'un concurrent en le
      // rattachant à sa propre boutique.
      const produit = await prisma.toumaProduct.findFirst({
        where: { id: input.productId, storeId: input.storeId },
        select: { id: true },
      });
      if (!produit) throw notFound('Produit introuvable dans cette boutique.');
      subjectId = produit.id;
    }

    const surveillance = await prisma.toumaMarketWatch.upsert({
      where: {
        userId_storeId_scope_subjectId: { userId: user.id, storeId: input.storeId, scope: input.scope, subjectId },
      },
      create: { userId: user.id, storeId: input.storeId, scope: input.scope, subjectId, kinds: input.kinds },
      update: { kinds: input.kinds },
    });

    res.status(201).json({
      id: surveillance.id,
      storeId: surveillance.storeId,
      scope: surveillance.scope,
      subjectId: surveillance.subjectId,
      kinds: surveillance.kinds,
      mutedUntil: surveillance.mutedUntil?.toISOString() ?? null,
      note: 'Une surveillance ne crée aucun signal : elle décide seulement lesquels vous sont signalés.',
    });
  }),
);

sellerRouter.patch(
  '/market/watches/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { mutedUntil } = parseBody(sourdineSchema, req);
    // Le filtre sur `userId` **est** le contrôle d'accès : une surveillance
    // d'autrui n'est pas trouvée, et répond donc comme une surveillance qui
    // n'existe pas.
    const existante = await prisma.toumaMarketWatch.findFirst({
      where: { id: req.params.id, userId: user.id },
      select: { id: true },
    });
    if (!existante) throw notFound('Surveillance introuvable.');

    const surveillance = await prisma.toumaMarketWatch.update({
      where: { id: existante.id },
      data: { mutedUntil },
    });
    res.json({ id: surveillance.id, mutedUntil: surveillance.mutedUntil?.toISOString() ?? null });
  }),
);

sellerRouter.delete(
  '/market/watches/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const existante = await prisma.toumaMarketWatch.findFirst({
      where: { id: req.params.id, userId: user.id },
      select: { id: true },
    });
    if (!existante) throw notFound('Surveillance introuvable.');
    await prisma.toumaMarketWatch.delete({ where: { id: existante.id } });
    res.status(204).end();
  }),
);

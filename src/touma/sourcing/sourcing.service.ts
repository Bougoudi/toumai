import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { notFound } from '../lib/errors.js';
import { paginated, type PageParams } from '../lib/pagination.js';
import { reputationService } from '../reputation/reputation.service.js';
import { AVERTISSEMENT, raisons, scorePertinence } from './matching.js';

/**
 * SOURCING FOURNISSEURS.
 *
 * Un acheteur en gros ne cherche pas un article, il cherche **quelqu'un qui
 * peut le fournir** : au bon volume, depuis le bon pays, dans un délai tenable,
 * avec un historique qui inspire confiance.
 *
 * Tout ce qui est affiché ici est **observé**, jamais déclaré :
 *   • la capacité vient du stock réellement saisi ;
 *   • les pays desservis viennent des expéditions réellement effectuées ;
 *   • les délais viennent des offres et des livraisons passées ;
 *   • la réputation vient du module dédié, avec sa règle de volume minimal.
 *
 * Aucun classement « sponsorisé », aucune capacité déclarative : un fournisseur
 * ne peut pas se prétendre capable de 10 tonnes sans l'avoir en stock.
 */

export interface SourcingQuery {
  q?: string;
  category?: string;
  /** Pays du fournisseur. */
  country?: string;
  /** Pays de livraison visé : on vérifie qu'il a déjà été desservi. */
  destination?: string;
  /** Volume recherché : filtre les fournisseurs incapables de le servir. */
  minQuantity?: number;
  verifiedOnly?: boolean;
  sort: 'relevance' | 'capacity' | 'reputation' | 'price' | 'trust';
  page: number;
  limit: number;
}

/** Fournisseurs correspondant à un besoin, avec ce qu'on sait réellement d'eux. */
export async function searchSuppliers(query: SourcingQuery) {
  const page: PageParams = { page: query.page, limit: query.limit, skip: (query.page - 1) * query.limit };

  const productWhere: Prisma.ToumaProductWhereInput = {
    status: 'ACTIVE',
    ...(query.category ? { category: { OR: [{ slug: query.category }, { id: query.category }] } } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: 'insensitive' } },
            { keywords: { contains: query.q, mode: 'insensitive' } },
            { brand: { contains: query.q, mode: 'insensitive' } },
            { description: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const storeWhere: Prisma.ToumaStoreWhereInput = {
    status: 'ACTIVE',
    ...(query.country ? { countryCode: query.country } : {}),
    ...(query.verifiedOnly ? { verificationStatus: 'APPROVED' } : {}),
    // Un fournisseur sans produit correspondant n'est pas un fournisseur pour ce besoin.
    products: { some: productWhere },
  };

  const [stores, total] = await Promise.all([
    prisma.toumaStore.findMany({
      where: storeWhere,
      select: {
        id: true,
        // Interne : sert à rattacher le score fournisseur au compte, et n'est
        // jamais rendu dans la réponse.
        ownerId: true,
        name: true,
        slug: true,
        countryCode: true,
        city: true,
        verificationStatus: true,
        ratingAverage: true,
        ratingCount: true,
        createdAt: true,
        reputation: true,
        products: {
          where: productWhere,
          select: {
            id: true,
            title: true,
            slug: true,
            price: true,
            currency: true,
            minOrderQty: true,
            inventory: { select: { quantity: true } },
            category: { select: { name: true, slug: true } },
          },
          take: 50,
        },
        // Pays réellement desservis : les commandes qui ont réellement quitté la
        // boutique. Un remboursement ultérieur n'efface pas le fait qu'elle a
        // su livrer ce corridor.
        orders: {
          where: { OR: [{ shippedAt: { not: null } }, { deliveredAt: { not: null } }] },
          select: { buyerCountry: true },
          take: 200,
        },
        quotes: {
          where: { status: { in: ['SUBMITTED', 'COUNTERED', 'ACCEPTED'] } },
          select: { leadTimeDays: true },
          take: 100,
        },
      },
      // Le tri fin se fait ensuite sur des agrégats calculés ; la base ordonne
      // d'abord sur ce qu'elle sait faire, pour une pagination stable.
      orderBy: [{ verificationStatus: 'desc' }, { ratingAverage: 'desc' }, { createdAt: 'asc' }],
      skip: page.skip,
      take: page.limit,
    }),
    prisma.toumaStore.count({ where: storeWhere }),
  ]);

  // Le score fournisseur est porté par le **compte** propriétaire, pas par la
  // boutique. La correspondance reste interne : `ownerId` n'a aucune raison de
  // figurer dans une réponse publique.
  const proprietaireParBoutique = new Map(stores.map((s) => [s.id, s.ownerId]));

  const items = stores.map((store) => {
    const products = store.products.map((p) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      price: p.price,
      currency: p.currency,
      minOrderQty: p.minOrderQty,
      available: p.inventory.reduce((acc, i) => acc + i.quantity, 0),
      category: p.category,
    }));

    // Capacité réelle : ce que le fournisseur a effectivement en stock sur les
    // références correspondant à la recherche.
    const capacity = products.reduce((acc, p) => acc + p.available, 0);
    const servingRequest = query.minQuantity ? products.filter((p) => p.available >= query.minQuantity!) : products;
    const cheapest = servingRequest.reduce<(typeof products)[number] | null>(
      (best, p) => (best === null || p.price.lessThan(best.price) ? p : best),
      null,
    );

    const leadTimes = store.quotes.map((q) => q.leadTimeDays).filter((d): d is number => typeof d === 'number' && d > 0);
    const destinations = [...new Set(store.orders.map((o) => o.buyerCountry).filter((c): c is string => Boolean(c)))];

    return {
      store: {
        id: store.id,
        name: store.name,
        slug: store.slug,
        countryCode: store.countryCode,
        city: store.city,
        verified: store.verificationStatus === 'APPROVED',
        rating: { average: Number(store.ratingAverage), count: store.ratingCount },
        memberSince: store.createdAt,
      },
      /** Score de réputation publié, ou null tant que le volume est insuffisant. */
      reputationScore: store.reputation?.score ?? null,
      reputationLevel: store.reputation?.level ?? 'NOUVEAU',
      onTimeRate: store.reputation?.onTimeRate === null || store.reputation?.onTimeRate === undefined ? null : Number(store.reputation.onTimeRate),
      matchingProducts: products.length,
      capacity,
      /** Le fournisseur peut-il servir le volume demandé sur au moins une référence ? */
      servesRequestedQuantity: query.minQuantity ? servingRequest.length > 0 : null,
      bestPrice: cheapest ? { amount: cheapest.price.toString(), currency: cheapest.currency, productId: cheapest.id, title: cheapest.title } : null,
      minOrderQty: products.length ? Math.min(...products.map((p) => p.minOrderQty)) : null,
      /** Délai médian annoncé dans ses offres B2B passées. */
      medianLeadTimeDays: leadTimes.length ? leadTimes.sort((a, b) => a - b)[Math.floor(leadTimes.length / 2)] : null,
      /** Pays où il a déjà réellement expédié. */
      servedCountries: destinations,
      servesDestination: query.destination ? destinations.includes(query.destination) : null,
      samples: products.slice(0, 3).map((p) => ({ id: p.id, title: p.title, slug: p.slug, price: p.price.toString(), currency: p.currency, available: p.available })),
    };
  });

  // Confiance des fournisseurs, en une passe.
  //
  // **Ce classement est organique, et rien ne peut l'acheter.** Aucun terme
  // ci-dessous ne regarde une promotion, une mise en avant ni un paiement —
  // c'est le §31, et l'absence est le point. Une mise en avant payante, le jour
  // où elle existera, devra être une liste **séparée et étiquetée comme telle**,
  // jamais un pouce sur cette balance.
  const trustScores = new Map<string, number | null>();
  if (items.length > 0) {
    const rows = await prisma.toumaTrustScore.findMany({
      where: {
        entityType: 'SUPPLIER',
        entityId: { in: [...proprietaireParBoutique.values()].filter(Boolean) },
      },
      select: { entityId: true, score: true },
    });
    for (const r of rows) trustScores.set(r.entityId, r.score);
  }
  const withTrust = items.map((i) => {
    const trustScore = trustScores.get(proprietaireParBoutique.get(i.store.id) ?? '') ?? null;
    const observe = {
      countryCode: i.store.countryCode,
      verified: i.store.verified,
      matchingProducts: i.matchingProducts,
      capacity: i.capacity,
      servesDestination: i.servesDestination,
      servesRequestedQuantity: i.servesRequestedQuantity,
      servedCountries: i.servedCountries,
      reputationScore: i.reputationScore,
      trustScore,
      minOrderQty: i.minOrderQty,
    };
    return {
      ...i,
      trustScore,
      /**
       * Pourquoi ce fournisseur est là, et ce qui a pesé (§4).
       *
       * Sans cela, l'acheteur recevait une liste ordonnée sans savoir ce qui
       * décidait de l'ordre — une garantie implicite que rien ne permettait de
       * contester.
       */
      matchReasons: raisons({
        demande: {
          q: query.q,
          category: query.category,
          country: query.country,
          destination: query.destination,
          minQuantity: query.minQuantity,
          verifiedOnly: query.verifiedOnly,
        },
        observe,
      }),
      relevanceScore: Number(scorePertinence(observe).toFixed(3)),
    };
  });

  // Tri final sur les agrégats calculés ci-dessus.
  const sorted = [...withTrust].sort((a, b) => {
    if (query.sort === 'capacity') return b.capacity - a.capacity;
    if (query.sort === 'reputation') return (b.reputationScore ?? -1) - (a.reputationScore ?? -1);
    // Un score absent (fournisseur nouveau) passe derrière un score mesuré,
    // mais **devant** un mauvais score : il ne vaut pas zéro.
    if (query.sort === 'trust') return (b.trustScore ?? -1) - (a.trustScore ?? -1);
    if (query.sort === 'price') {
      const pa = a.bestPrice ? Number(a.bestPrice.amount) : Number.POSITIVE_INFINITY;
      const pb = b.bestPrice ? Number(b.bestPrice.amount) : Number.POSITIVE_INFINITY;
      return pa - pb;
    }
    // Pertinence : desservir la destination et le volume demandés passe devant.
    //
    // La confiance y entre pour un point au plus. Volontairement peu : un
    // fournisseur qui livre réellement là où l'acheteur veut être livré lui est
    // plus utile qu'un fournisseur mieux noté qui ne dessert pas sa province.
    //
    // Le score est **celui qui a été publié avec chaque résultat**. Recalculer
    // ici avec des poids écrits à la main les ferait diverger, et les raisons
    // affichées finiraient par expliquer un classement qu'on n'applique plus.
    return b.relevanceScore - a.relevanceScore;
  });

  return { ...paginated(sorted, total, page), disclaimer: AVERTISSEMENT };
}

/** Fiche fournisseur : ce qu'il vend, ce qu'il a livré, comment il se comporte. */
export async function supplierProfile(idOrSlug: string) {
  const store = await prisma.toumaStore.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      countryCode: true,
      city: true,
      status: true,
      verificationStatus: true,
      createdAt: true,
      products: {
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          title: true,
          slug: true,
          price: true,
          currency: true,
          minOrderQty: true,
          inventory: { select: { quantity: true } },
          category: { select: { id: true, name: true, slug: true } },
        },
      },
      // Même règle que la recherche : ce qui est parti est parti, quel que soit
      // le statut final de la commande.
      orders: {
        where: { OR: [{ shippedAt: { not: null } }, { deliveredAt: { not: null } }] },
        select: { buyerCountry: true, currency: true },
        take: 500,
      },
      quotes: { where: { status: { in: ['SUBMITTED', 'COUNTERED', 'ACCEPTED'] } }, select: { leadTimeDays: true, status: true } },
    },
  });
  if (!store || store.status !== 'ACTIVE') throw notFound('Fournisseur introuvable.');

  const reputation = await reputationService.get(store.id);

  // Catalogue regroupé par catégorie : c'est ainsi qu'un acheteur en gros lit
  // une offre fournisseur (« que savez-vous faire ? »), pas produit par produit.
  const byCategory = new Map<string, { name: string; slug: string | null; products: number; capacity: number; minPrice: Prisma.Decimal | null; currency: string }>();
  for (const product of store.products) {
    const key = product.category?.id ?? 'autres';
    const entry = byCategory.get(key) ?? {
      name: product.category?.name ?? 'Autres',
      slug: product.category?.slug ?? null,
      products: 0,
      capacity: 0,
      minPrice: null,
      currency: product.currency,
    };
    entry.products += 1;
    entry.capacity += product.inventory.reduce((acc, i) => acc + i.quantity, 0);
    entry.minPrice = entry.minPrice === null || product.price.lessThan(entry.minPrice) ? product.price : entry.minPrice;
    byCategory.set(key, entry);
  }

  const leadTimes = store.quotes.map((q) => q.leadTimeDays).filter((d): d is number => typeof d === 'number' && d > 0);
  const destinations = [...new Set(store.orders.map((o) => o.buyerCountry).filter((c): c is string => Boolean(c)))];

  return {
    store: {
      id: store.id,
      name: store.name,
      slug: store.slug,
      description: store.description,
      countryCode: store.countryCode,
      city: store.city,
      verified: store.verificationStatus === 'APPROVED',
      memberSince: store.createdAt,
    },
    reputation,
    catalogue: [...byCategory.values()].map((c) => ({
      ...c,
      minPrice: c.minPrice?.toString() ?? null,
    })),
    totalProducts: store.products.length,
    totalCapacity: store.products.reduce((acc, p) => acc + p.inventory.reduce((a, i) => a + i.quantity, 0), 0),
    /** Commandes réellement expédiées, et pays réellement desservis. */
    shippedOrders: store.orders.length,
    servedCountries: destinations,
    quotesSent: store.quotes.length,
    quotesAccepted: store.quotes.filter((q) => q.status === 'ACCEPTED').length,
    medianLeadTimeDays: leadTimes.length ? leadTimes.sort((a, b) => a - b)[Math.floor(leadTimes.length / 2)] : null,
  };
}

export const sourcingService = { searchSuppliers, supplierProfile };

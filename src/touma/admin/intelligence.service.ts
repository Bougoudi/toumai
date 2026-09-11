import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';

/**
 * TOUMA INTELLIGENCE — ce que les transactions réelles apprennent.
 *
 * Un tableau de bord d'« insights » est le genre d'écran où l'on invente
 * facilement des chiffres. Trois règles l'en empêchent ici :
 *
 * 1. **Tout indicateur vient d'un agrégat sur des données réelles.** Aucune
 *    projection, aucune estimation, aucune donnée de démonstration.
 * 2. **Aucun taux ni aucune tendance sans son volume.** « +300 % » sur deux
 *    commandes ne veut rien dire : le volume brut est toujours affiché à côté,
 *    et en dessous d'un seuil la variation n'est simplement pas calculée.
 * 3. **Un indicateur qu'on ne sait pas mesurer est annoncé comme tel**, plutôt
 *    que rempli par un zéro qui se lirait comme une information.
 */

/** En dessous de ce volume, une variation n'est pas publiée. */
const MIN_VOLUME_FOR_TREND = 5;

const PAID_STATUSES: Prisma.EnumToumaOrderStatusFilter['in'] = [
  'PAID',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
];

/** Normalise un terme de recherche pour pouvoir le regrouper. */
function normalizeTerm(term: string): string {
  return term
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Enregistre une recherche, de façon anonyme. Une panne d'enregistrement ne
 * doit jamais casser une recherche : c'est de la mesure, pas du métier.
 */
export async function recordSearch(input: { term: string; resultCount: number; userId?: string | null }) {
  const term = normalizeTerm(input.term);
  if (term.length < 2 || term.length > 120) return;
  try {
    // Le pays de l'acheteur est utile (« que cherche-t-on au Tchad qu'on n'a
    // pas ? ») ; son identité ne l'est pas. On résout donc le pays et on
    // n'enregistre que lui — jamais l'identifiant du compte.
    let countryCode: string | null = null;
    if (input.userId) {
      const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { countryCode: true } });
      countryCode = user?.countryCode ?? null;
    }
    await prisma.toumaSearchQuery.create({
      data: { term, rawTerm: input.term.slice(0, 120), resultCount: input.resultCount, countryCode },
    });
  } catch (err) {
    logger.error('Recherche non journalisée', { err: err instanceof Error ? err.message : String(err) });
  }
}

function since(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (days - 1));
  return date;
}

export const intelligenceService = {
  recordSearch,

  /**
   * Flux réels entre pays : c'est la raison d'être de TOUMA, et donc le premier
   * chiffre que l'exploitant doit voir.
   */
  async corridors(days: number) {
    const from = since(days);
    const orders = await prisma.toumaOrder.findMany({
      where: { createdAt: { gte: from }, status: { in: PAID_STATUSES }, sellerCountry: { not: null }, buyerCountry: { not: null } },
      select: {
        sellerCountry: true,
        buyerCountry: true,
        total: true,
        currency: true,
        paidAt: true,
        shippedAt: true,
        deliveredAt: true,
        _count: { select: { disputes: true } },
      },
    });

    const byCorridor = new Map<
      string,
      {
        from: string;
        to: string;
        orders: number;
        gmv: Record<string, Prisma.Decimal>;
        delays: number[];
        disputes: number;
        crossBorder: boolean;
      }
    >();

    for (const order of orders) {
      const key = `${order.sellerCountry}→${order.buyerCountry}`;
      const row = byCorridor.get(key) ?? {
        from: order.sellerCountry!,
        to: order.buyerCountry!,
        orders: 0,
        gmv: {},
        delays: [],
        disputes: 0,
        crossBorder: order.sellerCountry !== order.buyerCountry,
      };
      row.orders += 1;
      row.gmv[order.currency] = (row.gmv[order.currency] ?? new Prisma.Decimal(0)).plus(order.total);
      row.disputes += order._count.disputes;
      // Délai vécu par l'acheteur : du paiement à la livraison, pas de l'expédition.
      if (order.paidAt && order.deliveredAt) {
        row.delays.push((order.deliveredAt.getTime() - order.paidAt.getTime()) / 86_400_000);
      }
      byCorridor.set(key, row);
    }

    return [...byCorridor.values()]
      .map((c) => ({
        from: c.from,
        to: c.to,
        crossBorder: c.crossBorder,
        orders: c.orders,
        gmv: Object.fromEntries(Object.entries(c.gmv).map(([currency, value]) => [currency, value.toString()])),
        /** Nul tant qu'aucune commande de ce corridor n'a été livrée. */
        averageDeliveryDays: c.delays.length ? Number((c.delays.reduce((a, b) => a + b, 0) / c.delays.length).toFixed(1)) : null,
        deliveredOrders: c.delays.length,
        disputes: c.disputes,
        /** Nul si le volume ne permet pas d'en tirer quoi que ce soit. */
        disputeRate: c.orders >= MIN_VOLUME_FOR_TREND ? Number((c.disputes / c.orders).toFixed(4)) : null,
      }))
      .sort((a, b) => b.orders - a.orders);
  },

  /**
   * Demande non servie : ce que les acheteurs cherchent sans rien trouver, et
   * les appels d'offres restés sans réponse. C'est ce qui dit quel vendeur
   * recruter, et c'est invisible dans un tableau de bord de ventes.
   */
  async unmetDemand(days: number) {
    const from = since(days);

    const [searches, emptySearches, emptyByCountry, rfqs] = await Promise.all([
      prisma.toumaSearchQuery.groupBy({
        by: ['term'],
        where: { createdAt: { gte: from } },
        _count: { _all: true },
        _avg: { resultCount: true },
        orderBy: { _count: { term: 'desc' } },
        take: 20,
      }),
      prisma.toumaSearchQuery.groupBy({
        by: ['term'],
        where: { createdAt: { gte: from }, resultCount: 0 },
        _count: { _all: true },
        orderBy: { _count: { term: 'desc' } },
        take: 20,
      }),
      prisma.toumaSearchQuery.groupBy({
        by: ['countryCode'],
        where: { createdAt: { gte: from }, resultCount: 0 },
        _count: { _all: true },
      }),
      // Un appel d'offres sans offre est une demande explicite, chiffrée, que
      // personne n'a servie : le signal le plus fort du marché.
      prisma.toumaRfq.findMany({
        where: { createdAt: { gte: from }, status: { in: ['OPEN', 'EXPIRED', 'CLOSED'] }, quotes: { none: {} } },
        select: {
          id: true,
          reference: true,
          title: true,
          countryCode: true,
          sourceCountry: true,
          createdAt: true,
          items: { select: { name: true, quantity: true, unit: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      /** Termes les plus recherchés, avec le nombre moyen de résultats obtenus. */
      topSearches: searches.map((s) => ({
        term: s.term,
        searches: s._count._all,
        averageResults: s._avg.resultCount === null ? null : Number(s._avg.resultCount.toFixed(1)),
      })),
      /** Recherches sans aucun résultat : le catalogue manque de ces produits. */
      emptySearches: emptySearches.map((s) => ({ term: s.term, searches: s._count._all })),
      /** Où la demande non servie s'exprime, quand le pays est connu. */
      emptySearchesByCountry: emptyByCountry
        .filter((row) => row.countryCode)
        .map((row) => ({ countryCode: row.countryCode!, searches: row._count._all }))
        .sort((a, b) => b.searches - a.searches),
      unansweredRfqs: rfqs.map((r) => ({
        id: r.id,
        reference: r.reference,
        title: r.title,
        countryCode: r.countryCode,
        sourceCountry: r.sourceCountry,
        createdAt: r.createdAt,
        items: r.items,
      })),
    };
  },

  /**
   * Fiabilité des paiements par méthode. Un mobile money qui échoue une fois
   * sur trois est un problème de premier ordre, invisible dans le GMV.
   */
  async paymentReliability(days: number) {
    const from = since(days);
    const rows = await prisma.toumaPayment.groupBy({
      by: ['method', 'status'],
      where: { createdAt: { gte: from } },
      _count: { _all: true },
    });

    const byMethod = new Map<string, { method: string; total: number; succeeded: number; failed: number; pending: number }>();
    for (const row of rows) {
      const entry = byMethod.get(row.method) ?? { method: row.method, total: 0, succeeded: 0, failed: 0, pending: 0 };
      entry.total += row._count._all;
      if (row.status === 'SUCCEEDED' || row.status === 'REFUNDED' || row.status === 'PARTIALLY_REFUNDED') entry.succeeded += row._count._all;
      else if (row.status === 'FAILED' || row.status === 'CANCELLED') entry.failed += row._count._all;
      else entry.pending += row._count._all;
      byMethod.set(row.method, entry);
    }

    return [...byMethod.values()]
      .map((m) => ({
        ...m,
        // Le taux n'a de sens que sur les paiements tranchés, et avec du volume.
        successRate:
          m.succeeded + m.failed >= MIN_VOLUME_FOR_TREND
            ? Number((m.succeeded / (m.succeeded + m.failed)).toFixed(4))
            : null,
      }))
      .sort((a, b) => b.total - a.total);
  },

  /**
   * Catégories en croissance : comparaison de deux périodes de même durée. Le
   * volume brut est toujours donné, et la variation n'est calculée qu'au-delà
   * d'un seuil — sans quoi « +300 % » signifierait « 1 commande de plus ».
   */
  async categoryTrends(days: number) {
    const current = since(days);
    const previous = new Date(current.getTime() - days * 86_400_000);

    const [now, before] = await Promise.all([
      prisma.toumaOrderItem.groupBy({
        by: ['productId'],
        where: { createdAt: { gte: current } },
        _sum: { quantity: true },
      }),
      prisma.toumaOrderItem.groupBy({
        by: ['productId'],
        where: { createdAt: { gte: previous, lt: current } },
        _sum: { quantity: true },
      }),
    ]);

    const productIds = [...new Set([...now, ...before].map((r) => r.productId).filter((id): id is string => Boolean(id)))];
    const products = await prisma.toumaProduct.findMany({
      where: { id: { in: productIds } },
      select: { id: true, categoryId: true, category: { select: { name: true, slug: true } } },
    });
    const categoryOf = new Map(products.map((p) => [p.id, p]));

    const tally = (rows: typeof now) => {
      const map = new Map<string, number>();
      for (const row of rows) {
        if (!row.productId) continue;
        const key = categoryOf.get(row.productId)?.categoryId ?? 'autres';
        map.set(key, (map.get(key) ?? 0) + (row._sum.quantity ?? 0));
      }
      return map;
    };
    const nowByCategory = tally(now);
    const beforeByCategory = tally(before);

    const names = new Map<string, string>();
    for (const product of products) if (product.categoryId) names.set(product.categoryId, product.category?.name ?? 'Autres');

    return [...new Set([...nowByCategory.keys(), ...beforeByCategory.keys()])]
      .map((key) => {
        const sold = nowByCategory.get(key) ?? 0;
        const previousSold = beforeByCategory.get(key) ?? 0;
        return {
          category: names.get(key) ?? 'Autres',
          sold,
          previousSold,
          /** Nulle tant que le volume ne permet pas d'en tirer une tendance. */
          change:
            previousSold >= MIN_VOLUME_FOR_TREND && sold + previousSold >= MIN_VOLUME_FOR_TREND
              ? Number(((sold - previousSold) / previousSold).toFixed(4))
              : null,
        };
      })
      .sort((a, b) => b.sold - a.sold);
  },

  /**
   * Produits en tension : vendus récemment et presque en rupture. C'est le seul
   * indicateur de cet écran sur lequel un vendeur peut agir le jour même.
   */
  async stockTension(days: number) {
    const from = since(days);
    const sold = await prisma.toumaOrderItem.groupBy({
      by: ['productId'],
      where: { createdAt: { gte: from }, productId: { not: null } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 100,
    });
    const ids = sold.map((s) => s.productId).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return [];

    const products = await prisma.toumaProduct.findMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      select: {
        id: true,
        title: true,
        slug: true,
        store: { select: { id: true, name: true, slug: true } },
        inventory: { select: { quantity: true, lowStockThreshold: true } },
      },
    });
    const soldById = new Map(sold.map((s) => [s.productId!, s._sum.quantity ?? 0]));

    return products
      .map((p) => {
        const stock = p.inventory.reduce((acc, i) => acc + i.quantity, 0);
        const threshold = Math.max(...p.inventory.map((i) => i.lowStockThreshold), 0);
        const soldQuantity = soldById.get(p.id) ?? 0;
        return {
          product: { id: p.id, title: p.title, slug: p.slug },
          store: p.store,
          sold: soldQuantity,
          stock,
          threshold,
          /** Jours de stock au rythme observé — nul si rien n'a été vendu. */
          daysOfStock: soldQuantity > 0 ? Number(((stock / soldQuantity) * days).toFixed(1)) : null,
        };
      })
      .filter((p) => p.stock <= Math.max(p.threshold, 0) || (p.daysOfStock !== null && p.daysOfStock < days))
      .sort((a, b) => (a.daysOfStock ?? Infinity) - (b.daysOfStock ?? Infinity))
      .slice(0, 20);
  },

  /** Vue complète, telle qu'affichée dans la console d'administration. */
  async overview(days: number) {
    const [corridors, demand, payments, categories, tension] = await Promise.all([
      this.corridors(days),
      this.unmetDemand(days),
      this.paymentReliability(days),
      this.categoryTrends(days),
      this.stockTension(days),
    ]);
    return {
      days,
      minVolumeForTrend: MIN_VOLUME_FOR_TREND,
      corridors,
      demand,
      payments,
      categories,
      stockTension: tension,
    };
  },
};

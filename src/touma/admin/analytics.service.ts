import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

/**
 * Analytique Touma.
 *
 * Sépare volontairement les **indicateurs** (GMV, conversion, délais) de la
 * **logique financière** : rien ici ne calcule ce qui est dû à un vendeur. Les
 * montants réellement dus vivent dans `ToumaCommission` / `ToumaSellerPayout`.
 */

/** Statuts considérés comme « transaction réussie » (base du GMV). */
const PAID_STATUSES: Prisma.EnumToumaOrderStatusFilter['in'] = [
  'PAID',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
];

export const analyticsService = {
  /** Vue d'ensemble de la place de marché. */
  async dashboard() {
    // Les agrégats sont calculés par la base : aucune commande n'est chargée en
    // mémoire, le tableau de bord reste constant quel que soit le volume.
    const [users, sellers, stores, products, orders, gmv, paidCount, crossBorderOrders, cancelled, pendingVerifications, openDisputes, failedPayments, shipments] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { toumaRole: 'SELLER' } }),
        prisma.toumaStore.count({ where: { status: 'ACTIVE' } }),
        prisma.toumaProduct.count({ where: { status: 'ACTIVE' } }),
        prisma.toumaOrder.count(),
        // GMV par devise : aucune conversion approximative entre devises.
        prisma.toumaOrder.groupBy({
          by: ['currency'],
          where: { status: { in: PAID_STATUSES } },
          _sum: { total: true },
          _count: { _all: true },
        }),
        prisma.toumaOrder.count({ where: { status: { in: PAID_STATUSES } } }),
        prisma.toumaOrder.count({ where: { status: { in: PAID_STATUSES }, crossBorder: true } }),
        prisma.toumaOrder.count({ where: { status: 'CANCELLED' } }),
        prisma.toumaSellerVerification.count({ where: { status: 'PENDING' } }),
        prisma.toumaDispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
        prisma.toumaPayment.count({ where: { status: 'FAILED' } }),
        prisma.toumaShipment.count(),
      ]);

    const gmvByCurrency: Record<string, string> = {};
    const averageBasket: Record<string, string> = {};
    for (const row of gmv) {
      const total = row._sum.total ?? new Prisma.Decimal(0);
      gmvByCurrency[row.currency] = total.toString();
      averageBasket[row.currency] = total.dividedBy(row._count._all || 1).toFixed(2);
    }

    return {
      users,
      sellers,
      stores,
      products,
      orders,
      paidOrders: paidCount,
      /** Métrique de validation Touma : les transactions transfrontalières. */
      crossBorderOrders,
      gmvByCurrency,
      averageBasket,
      cancellationRate: orders ? Number((cancelled / orders).toFixed(4)) : 0,
      pendingVerifications,
      openDisputes,
      failedPayments,
      shipments,
    };
  },

  /** Série temporelle (commandes et GMV par jour) sur `days` jours, jusqu'à aujourd'hui. */
  async timeseries(days: number) {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    const orders = await prisma.toumaOrder.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, total: true, currency: true, status: true },
      orderBy: { createdAt: 'asc' },
    });

    const byDay = new Map<string, { date: string; orders: number; paid: number; gmv: Record<string, Prisma.Decimal> }>();
    // Un point par jour, même sans commande : une courbe trouée est illisible.
    for (let i = 0; i < days; i += 1) {
      const date = new Date(since.getTime() + i * 24 * 3600 * 1000).toISOString().slice(0, 10);
      byDay.set(date, { date, orders: 0, paid: 0, gmv: {} });
    }
    for (const o of orders) {
      const date = o.createdAt.toISOString().slice(0, 10);
      const row = byDay.get(date) ?? { date, orders: 0, paid: 0, gmv: {} };
      row.orders += 1;
      if (PAID_STATUSES?.includes(o.status)) {
        row.paid += 1;
        row.gmv[o.currency] = (row.gmv[o.currency] ?? new Prisma.Decimal(0)).plus(o.total);
      }
      byDay.set(date, row);
    }

    // Produits les plus vendus (sur la période).
    const topProducts = await prisma.toumaOrderItem.groupBy({
      by: ['productId', 'titleSnapshot'],
      where: { createdAt: { gte: since } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 10,
    });

    return {
      days,
      series: [...byDay.values()].map((r) => ({
        date: r.date,
        orders: r.orders,
        paid: r.paid,
        gmv: Object.fromEntries(Object.entries(r.gmv).map(([c, v]) => [c, v.toString()])),
      })),
      topProducts: topProducts.map((p) => ({ productId: p.productId, title: p.titleSnapshot, quantity: p._sum.quantity ?? 0 })),
    };
  },

  /**
   * Série temporelle des ventes d'une boutique (graphique du Seller Center).
   * Renvoie un point par jour, y compris les jours sans vente, pour que la
   * courbe reste lisible.
   */
  async storeTimeseries(storeId: string, days: number) {
    // Fenêtre de `days` jours se terminant aujourd'hui (bornes incluses).
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    const orders = await prisma.toumaOrder.findMany({
      where: { storeId, createdAt: { gte: since }, status: { in: PAID_STATUSES } },
      select: { createdAt: true, total: true, currency: true },
      orderBy: { createdAt: 'asc' },
    });

    const byDay = new Map<string, { orders: number; revenue: Prisma.Decimal; currency: string | null }>();
    for (let i = 0; i < days; i += 1) {
      const day = new Date(since.getTime() + i * 24 * 3600 * 1000).toISOString().slice(0, 10);
      byDay.set(day, { orders: 0, revenue: new Prisma.Decimal(0), currency: null });
    }
    for (const o of orders) {
      const day = o.createdAt.toISOString().slice(0, 10);
      const row = byDay.get(day);
      if (!row) continue;
      row.orders += 1;
      row.revenue = row.revenue.plus(o.total);
      row.currency = row.currency ?? o.currency;
    }

    const series = [...byDay.entries()].map(([date, r]) => ({
      date,
      orders: r.orders,
      revenue: r.revenue.toString(),
      currency: r.currency,
    }));

    const topProducts = await prisma.toumaOrderItem.groupBy({
      by: ['productId', 'titleSnapshot'],
      where: { order: { storeId, status: { in: PAID_STATUSES } }, createdAt: { gte: since } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    });

    return {
      days,
      series,
      topProducts: topProducts.map((p) => ({ productId: p.productId, title: p.titleSnapshot, quantity: p._sum.quantity ?? 0 })),
    };
  },

  /** Indicateurs d'une boutique (Seller Center), agrégés côté base. */
  async storeStats(storeId: string) {
    const [orders, paidOrders, revenueRows, products, lowStock, pendingShipments] = await Promise.all([
      prisma.toumaOrder.count({ where: { storeId } }),
      prisma.toumaOrder.count({ where: { storeId, status: { in: PAID_STATUSES } } }),
      prisma.toumaOrder.groupBy({
        by: ['currency'],
        where: { storeId, status: { in: PAID_STATUSES } },
        _sum: { total: true },
      }),
      prisma.toumaProduct.count({ where: { storeId, status: 'ACTIVE' } }),
      prisma.toumaInventory.count({ where: { product: { storeId }, quantity: { lte: 5 } } }),
      prisma.toumaOrder.count({ where: { storeId, status: { in: ['PAID', 'CONFIRMED', 'PROCESSING'] } } }),
    ]);

    const revenue: Record<string, string> = {};
    for (const row of revenueRows) revenue[row.currency] = (row._sum.total ?? new Prisma.Decimal(0)).toString();

    return {
      orders,
      paidOrders,
      revenue,
      activeProducts: products,
      lowStockItems: lowStock,
      toShip: pendingShipments,
    };
  },
};

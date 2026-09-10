import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { sum } from '../lib/money.js';

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
    const [users, sellers, stores, products, orders, paidOrders, pendingVerifications, openDisputes, failedPayments, shipments] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { toumaRole: 'SELLER' } }),
      prisma.toumaStore.count({ where: { status: 'ACTIVE' } }),
      prisma.toumaProduct.count({ where: { status: 'ACTIVE' } }),
      prisma.toumaOrder.count(),
      prisma.toumaOrder.findMany({ where: { status: { in: PAID_STATUSES } }, select: { total: true, currency: true, crossBorder: true, createdAt: true } }),
      prisma.toumaSellerVerification.count({ where: { status: 'PENDING' } }),
      prisma.toumaDispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      prisma.toumaPayment.count({ where: { status: 'FAILED' } }),
      prisma.toumaShipment.count(),
    ]);

    // GMV par devise : aucune conversion approximative entre devises.
    const gmvByCurrency: Record<string, string> = {};
    const grouped = new Map<string, Prisma.Decimal[]>();
    for (const o of paidOrders) {
      const list = grouped.get(o.currency) ?? [];
      list.push(o.total);
      grouped.set(o.currency, list);
    }
    for (const [currency, totals] of grouped) gmvByCurrency[currency] = sum(totals).toString();

    const cancelled = await prisma.toumaOrder.count({ where: { status: 'CANCELLED' } });
    const crossBorderOrders = paidOrders.filter((o) => o.crossBorder).length;

    return {
      users,
      sellers,
      stores,
      products,
      orders,
      paidOrders: paidOrders.length,
      /** Métrique de validation Touma : les transactions transfrontalières. */
      crossBorderOrders,
      gmvByCurrency,
      averageBasket: Object.fromEntries(
        [...grouped.entries()].map(([currency, totals]) => [currency, sum(totals).dividedBy(totals.length || 1).toFixed(2)]),
      ),
      cancellationRate: orders ? Number((cancelled / orders).toFixed(4)) : 0,
      pendingVerifications,
      openDisputes,
      failedPayments,
      shipments,
    };
  },

  /** Série temporelle (commandes et GMV par jour) sur `days` jours. */
  async timeseries(days: number) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const orders = await prisma.toumaOrder.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, total: true, currency: true, status: true },
      orderBy: { createdAt: 'asc' },
    });

    const byDay = new Map<string, { date: string; orders: number; paid: number; gmv: Record<string, Prisma.Decimal> }>();
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

  /** Indicateurs d'une boutique (Seller Center). */
  async storeStats(storeId: string) {
    const [orders, products, lowStock, pendingShipments] = await Promise.all([
      prisma.toumaOrder.findMany({ where: { storeId }, select: { total: true, currency: true, status: true, createdAt: true } }),
      prisma.toumaProduct.count({ where: { storeId, status: 'ACTIVE' } }),
      prisma.toumaInventory.count({ where: { product: { storeId }, quantity: { lte: 5 } } }),
      prisma.toumaOrder.count({ where: { storeId, status: { in: ['PAID', 'CONFIRMED', 'PROCESSING'] } } }),
    ]);

    const paid = orders.filter((o) => PAID_STATUSES?.includes(o.status));
    const revenue: Record<string, string> = {};
    const grouped = new Map<string, Prisma.Decimal[]>();
    for (const o of paid) {
      const list = grouped.get(o.currency) ?? [];
      list.push(o.total);
      grouped.set(o.currency, list);
    }
    for (const [currency, totals] of grouped) revenue[currency] = sum(totals).toString();

    return {
      orders: orders.length,
      paidOrders: paid.length,
      revenue,
      activeProducts: products,
      lowStockItems: lowStock,
      toShip: pendingShipments,
    };
  },
};

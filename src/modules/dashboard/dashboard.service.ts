import { prisma } from '../../db/prisma.js';

function toStatusMap(rows: Array<{ status: string; _count: { _all: number } }>) {
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

export const dashboardService = {
  /** Vue d'ensemble de l'activité du pilote automatique. */
  async overview() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [
      oppTotal,
      oppByStatus,
      oppAgg,
      productTotal,
      productActive,
      productGeneratedToday,
      supplierTotal,
      orderTotal,
      orderByStatus,
      recentOrders,
      recentRuns,
      soldOrders,
      purchaseAgg,
    ] = await Promise.all([
      prisma.marketOpportunity.count(),
      prisma.marketOpportunity.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.marketOpportunity.aggregate({ _avg: { opportunityScore: true } }),
      prisma.product.count(),
      prisma.product.count({ where: { status: 'ACTIVE' } }),
      prisma.product.count({ where: { source: 'generated', generatedAt: { gte: startOfDay } } }),
      prisma.supplier.count(),
      prisma.order.count(),
      prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.order.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { customer: true, _count: { select: { items: true } } },
      }),
      prisma.generationRun.findMany({ take: 3, orderBy: { startedAt: 'desc' } }),
      prisma.order.aggregate({
        _sum: { total: true },
        where: { status: { in: ['PAID', 'FULFILLING', 'SHIPPED', 'DELIVERED'] } },
      }),
      prisma.purchaseOrder.aggregate({
        _sum: { cost: true },
        where: { status: { not: 'FAILED' } },
      }),
    ]);

    const revenue = soldOrders._sum.total ?? 0;
    const purchaseCost = purchaseAgg._sum.cost ?? 0;

    return {
      market: {
        opportunities: oppTotal,
        byStatus: toStatusMap(oppByStatus),
        avgOpportunityScore: Math.round(oppAgg._avg.opportunityScore ?? 0),
      },
      catalog: {
        products: productTotal,
        active: productActive,
        generatedToday: productGeneratedToday,
      },
      suppliers: { total: supplierTotal },
      orders: {
        total: orderTotal,
        byStatus: toStatusMap(orderByStatus),
      },
      finance: {
        currency: 'EUR',
        revenue: Number(revenue.toFixed(2)),
        purchaseCost: Number(purchaseCost.toFixed(2)),
        estimatedProfit: Number((revenue - purchaseCost).toFixed(2)),
      },
      recent: {
        orders: recentOrders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          customer: o.customer.name,
          status: o.status,
          total: o.total,
          items: o._count.items,
          createdAt: o.createdAt,
        })),
        generationRuns: recentRuns.map((r) => ({
          id: r.id,
          generated: r.generated,
          skipped: r.skipped,
          failed: r.failed,
          status: r.status,
          startedAt: r.startedAt,
        })),
      },
    };
  },
};

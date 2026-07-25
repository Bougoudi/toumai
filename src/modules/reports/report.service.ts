import { prisma } from '../../db/prisma.js';

const REVENUE_STATUSES = ['PAID', 'FULFILLING', 'SHIPPED', 'DELIVERED'];
const day = (d: Date) => d.toISOString().slice(0, 10);

export interface PnlRow {
  date: string;
  orders: number;
  revenue: number;
  cost: number;
  profit: number;
}

export const reportService = {
  /** Compte de résultat (revenus / coûts / bénéfices), global + par jour. */
  async pnl(): Promise<{ totals: Omit<PnlRow, 'date'> & { margin: number }; rows: PnlRow[] }> {
    const [orders, purchaseOrders] = await Promise.all([
      prisma.order.findMany({
        where: { status: { in: REVENUE_STATUSES } },
        select: { total: true, createdAt: true },
      }),
      prisma.purchaseOrder.findMany({
        where: { status: { not: 'FAILED' } },
        select: { cost: true, createdAt: true },
      }),
    ]);

    const map = new Map<string, PnlRow>();
    const row = (d: string) => {
      let r = map.get(d);
      if (!r) {
        r = { date: d, orders: 0, revenue: 0, cost: 0, profit: 0 };
        map.set(d, r);
      }
      return r;
    };

    for (const o of orders) {
      const r = row(day(o.createdAt));
      r.orders += 1;
      r.revenue += o.total;
    }
    for (const p of purchaseOrders) {
      row(day(p.createdAt)).cost += p.cost;
    }

    const rows = [...map.values()]
      .map((r) => ({
        ...r,
        revenue: +r.revenue.toFixed(2),
        cost: +r.cost.toFixed(2),
        profit: +(r.revenue - r.cost).toFixed(2),
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    const revenue = +orders.reduce((s, o) => s + o.total, 0).toFixed(2);
    const cost = +purchaseOrders.reduce((s, p) => s + p.cost, 0).toFixed(2);
    const profit = +(revenue - cost).toFixed(2);
    const margin = revenue > 0 ? +((profit / revenue) * 100).toFixed(1) : 0;

    return { totals: { orders: orders.length, revenue, cost, profit, margin }, rows };
  },

  /** Export CSV du compte de résultat par jour. */
  async csv(): Promise<string> {
    const { rows, totals } = await this.pnl();
    const header = 'Date;Commandes;Revenus;Couts;Benefice';
    const lines = rows.map((r) => `${r.date};${r.orders};${r.revenue};${r.cost};${r.profit}`);
    const total = `TOTAL;${totals.orders};${totals.revenue};${totals.cost};${totals.profit}`;
    return [header, ...lines, total].join('\n');
  },
};

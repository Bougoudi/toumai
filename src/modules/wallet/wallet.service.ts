import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { getSettings } from '../settings/settings.service.js';
import { reportService } from '../reports/report.service.js';

/** Statuts qui « réservent » de l'argent (non encore rejetés). */
const RESERVING = ['PENDING', 'APPROVED', 'PAID'];

/** Masque une destination (IBAN / email) pour l'affichage et le stockage. */
function maskDestination(method: string, dest: string): string {
  const d = dest.trim();
  if (method === 'paypal') {
    const [user, domain] = d.split('@');
    if (!domain) return '•••';
    return `${user.slice(0, 2)}•••@${domain}`;
  }
  // IBAN : garde les 4 derniers.
  const clean = d.replace(/\s+/g, '');
  return clean.length > 4 ? `•••• ${clean.slice(-4)}` : '••••';
}

export const walletService = {
  /** Solde disponible = bénéfices − retraits déjà engagés. */
  async balance() {
    const { totals } = await reportService.pnl();
    const agg = await prisma.withdrawal.aggregate({
      _sum: { amount: true },
      where: { status: { in: RESERVING } },
    });
    const reserved = agg._sum.amount ?? 0;
    const available = Number((totals.profit - reserved).toFixed(2));
    return {
      currency: getSettings().currency,
      profit: totals.profit,
      revenue: totals.revenue,
      reserved: Number(reserved.toFixed(2)),
      available: Math.max(0, available),
    };
  },

  list() {
    return prisma.withdrawal.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  },

  /**
   * Crée une demande de retrait. Vérifie le montant contre le solde disponible.
   * (La route exige une ré-authentification « step-up ».)
   */
  async request(input: { amount: number; method: 'bank' | 'paypal'; destination: string }) {
    if (input.amount <= 0) throw new HttpError(400, 'Montant invalide.');
    const { available, currency } = await this.balance();
    if (input.amount > available) {
      throw new HttpError(400, `Montant supérieur au solde disponible (${available} ${currency}).`);
    }
    return prisma.withdrawal.create({
      data: {
        amount: Number(input.amount.toFixed(2)),
        currency,
        method: input.method,
        destination: maskDestination(input.method, input.destination),
        status: 'PENDING',
      },
    });
  },

  /** Annule une demande encore en attente (libère les fonds réservés). */
  async cancel(id: string) {
    const w = await prisma.withdrawal.findUnique({ where: { id } });
    if (!w) throw new HttpError(404, 'Retrait introuvable');
    if (w.status !== 'PENDING') throw new HttpError(409, 'Seules les demandes en attente peuvent être annulées.');
    return prisma.withdrawal.update({
      where: { id },
      data: { status: 'REJECTED', note: 'Annulé par l’utilisateur', processedAt: new Date() },
    });
  },
};

import { prisma } from '../../db/prisma.js';

/**
 * TOUMA RISK — score de risque explicite.
 *
 * Principe : le score **n'exclut jamais** un utilisateur tout seul. Il agrège
 * des signaux pondérés, explicables, et sert d'aide à la décision humaine.
 * Toute sanction reste une action d'administration, tracée dans l'audit.
 */

/** Poids par signal (documenté et ajustable — aucune magie). */
const WEIGHTS: Record<string, number> = {
  LOGIN_FAILED: 2,
  PAYMENT_FAILED: 6,
  ORDER_CANCELLED: 4,
  MULTIPLE_ACCOUNTS_SAME_PHONE: 15,
  COUNTRY_ADDRESS_MISMATCH: 8,
  UNUSUAL_VOLUME: 10,
  ADDRESS_CHANGED_BEFORE_SHIPPING: 5,
  DISPUTE_OPENED: 7,
};

/** Fenêtre d'observation des signaux (30 jours). */
const WINDOW_DAYS = 30;

export interface RiskSignal {
  code: string;
  weight: number;
  detail: Record<string, unknown>;
}

function level(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (score >= 60) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

export const riskService = {
  /** Enregistre un signal de fraude (asynchrone, jamais bloquant). */
  async recordSignal(userId: string | null, code: string, detail: Record<string, unknown> = {}) {
    await prisma.toumaFraudEvent.create({
      data: { userId, code, weight: WEIGHTS[code] ?? 1, detail: detail as object },
    });
  },

  /**
   * Recalcule le score d'un utilisateur à partir des signaux récents et de
   * quelques contrôles de cohérence (pays du compte vs pays des adresses,
   * comptes partageant un téléphone, volume de commandes inhabituel).
   */
  async compute(userId: string) {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        addresses: true,
        toumaOrders: { where: { createdAt: { gte: since } }, select: { id: true, status: true, createdAt: true } },
      },
    });
    if (!user) return null;

    const events = await prisma.toumaFraudEvent.findMany({ where: { userId, createdAt: { gte: since } } });
    const signals: RiskSignal[] = events.map((e) => ({ code: e.code, weight: e.weight, detail: e.detail as Record<string, unknown> }));

    // Incohérence pays du compte / pays de livraison.
    if (user.countryCode && user.addresses.some((a) => a.countryCode !== user.countryCode)) {
      signals.push({
        code: 'COUNTRY_ADDRESS_MISMATCH',
        weight: WEIGHTS.COUNTRY_ADDRESS_MISMATCH,
        detail: { accountCountry: user.countryCode },
      });
    }

    // Plusieurs comptes partageant le même téléphone.
    if (user.phone) {
      const sharedPhone = await prisma.user.count({ where: { phone: user.phone, id: { not: user.id } } });
      if (sharedPhone > 0) {
        signals.push({ code: 'MULTIPLE_ACCOUNTS_SAME_PHONE', weight: WEIGHTS.MULTIPLE_ACCOUNTS_SAME_PHONE, detail: { sharedPhone } });
      }
    }

    // Volume inhabituel : plus de 20 commandes sur la fenêtre.
    if (user.toumaOrders.length > 20) {
      signals.push({ code: 'UNUSUAL_VOLUME', weight: WEIGHTS.UNUSUAL_VOLUME, detail: { orders: user.toumaOrders.length } });
    }

    // Taux d'annulation élevé.
    const cancelled = user.toumaOrders.filter((o) => o.status === 'CANCELLED').length;
    if (user.toumaOrders.length >= 5 && cancelled / user.toumaOrders.length > 0.5) {
      signals.push({ code: 'ORDER_CANCELLED', weight: WEIGHTS.ORDER_CANCELLED, detail: { cancelled, total: user.toumaOrders.length } });
    }

    const score = Math.min(100, signals.reduce((acc, s) => acc + s.weight, 0));
    const payload = { score, level: level(score), signals: signals as object, computedAt: new Date() };

    return prisma.toumaRiskScore.upsert({
      where: { userId },
      update: payload,
      create: { userId, ...payload },
    });
  },

  /** Lecture du score (administration). */
  async get(userId: string) {
    return prisma.toumaRiskScore.findUnique({ where: { userId }, include: { user: { select: { id: true, name: true, email: true, status: true } } } });
  },

  /** Utilisateurs les plus risqués (revue humaine). */
  async top(limit = 50) {
    return prisma.toumaRiskScore.findMany({
      orderBy: { score: 'desc' },
      take: limit,
      include: { user: { select: { id: true, name: true, email: true, status: true, countryCode: true } } },
    });
  },
};

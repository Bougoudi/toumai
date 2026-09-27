import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { badRequest, notFound } from '../lib/errors.js';
import { roundTo, ZERO } from '../lib/money.js';
import { notify } from '../lib/notifications.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * FIDÉLITÉ TOUMA.
 *
 * Trois choix de conception, tous assumés :
 *
 * 1. **Les points ne traversent pas les devises.** Faute de taux de change
 *    officiel, seules les commandes libellées dans la devise de fidélité
 *    rapportent des points — plutôt qu'une conversion inventée.
 * 2. **Les points se gagnent à la livraison, pas au paiement.** Créditer au
 *    paiement offrirait des points sur des commandes annulées ou remboursées.
 * 3. **Le solde est la somme des événements.** Aucun écrit direct : chaque
 *    mouvement laisse une ligne, et un remboursement reprend les points gagnés.
 */

/** Paliers lus depuis la configuration : « NOM:pointsCumulés », du plus bas au plus haut. */
function tiers(): Array<{ name: string; threshold: number }> {
  return env.touma.loyaltyTiers
    .split(',')
    .map((entry) => {
      const [name, threshold] = entry.split(':');
      return { name: (name ?? '').trim().toUpperCase(), threshold: Number(threshold ?? 0) };
    })
    .filter((t) => t.name)
    .sort((a, b) => a.threshold - b.threshold);
}

/** Palier atteint pour un cumul de points donné. */
export function tierFor(lifetimePoints: number): string {
  const list = tiers();
  let current = list[0]?.name ?? 'BRONZE';
  for (const tier of list) if (lifetimePoints >= tier.threshold) current = tier.name;
  return current;
}

/** Palier suivant et points restants pour l'atteindre (null au sommet). */
function nextTier(lifetimePoints: number): { name: string; remaining: number } | null {
  const upcoming = tiers().find((t) => t.threshold > lifetimePoints);
  return upcoming ? { name: upcoming.name, remaining: upcoming.threshold - lifetimePoints } : null;
}

/** Points gagnés pour un montant de marchandise. */
export function pointsFor(amount: Prisma.Decimal): number {
  return Math.floor(Number(amount.toString()) * env.touma.loyaltyEarnRate);
}

/** Valeur en monnaie d'un nombre de points. */
export function valueOfPoints(points: number, currency: string): Prisma.Decimal {
  return roundTo(new Prisma.Decimal(points).times(env.touma.loyaltyPointValue), currency);
}

async function accountFor(userId: string, tx: Prisma.TransactionClient = prisma) {
  const existing = await tx.toumaLoyaltyAccount.findUnique({ where: { userId } });
  if (existing) return existing;
  return tx.toumaLoyaltyAccount.create({ data: { userId, tier: tierFor(0) } });
}

/**
 * Enregistre un mouvement de points et met le solde en cohérence, dans la même
 * transaction. Un solde ne devient jamais négatif.
 */
async function record(
  tx: Prisma.TransactionClient,
  input: { userId: string; type: 'EARNED' | 'REDEEMED' | 'REVERSED' | 'ADJUSTED'; points: number; orderId?: string | null; orderGroupId?: string | null; reason?: string },
) {
  const account = await accountFor(input.userId, tx);
  const balance = Math.max(0, account.balance + input.points);
  // Les points repris ne réduisent pas le cumul de vie : un palier acquis le reste.
  const lifetime = input.points > 0 ? account.lifetimePoints + input.points : account.lifetimePoints;

  await tx.toumaLoyaltyEvent.create({
    data: {
      accountId: account.id,
      type: input.type,
      points: input.points,
      orderId: input.orderId ?? null,
      orderGroupId: input.orderGroupId ?? null,
      reason: input.reason ?? '',
    },
  });
  return tx.toumaLoyaltyAccount.update({
    where: { id: account.id },
    data: { balance, lifetimePoints: lifetime, tier: tierFor(lifetime) },
  });
}

export const loyaltyService = {
  tierFor,
  pointsFor,
  valueOfPoints,

  get enabled() {
    return env.touma.loyaltyEnabled;
  },

  /** Solde, palier et historique de l'acheteur connecté. */
  async summary(user: ToumaRequestUser) {
    const account = await accountFor(user.id);
    const events = await prisma.toumaLoyaltyEvent.findMany({
      where: { accountId: account.id },
      include: { order: { select: { orderNumber: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      enabled: env.touma.loyaltyEnabled,
      balance: account.balance,
      lifetimePoints: account.lifetimePoints,
      tier: account.tier,
      nextTier: nextTier(account.lifetimePoints),
      currency: env.touma.loyaltyCurrency,
      pointValue: env.touma.loyaltyPointValue,
      /** Ce que vaut le solde actuel, en monnaie. */
      balanceValue: valueOfPoints(account.balance, env.touma.loyaltyCurrency).toString(),
      maxShare: env.touma.loyaltyMaxShare,
      earnRate: env.touma.loyaltyEarnRate,
      tiers: tiers(),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        points: e.points,
        reason: e.reason,
        orderNumber: e.order?.orderNumber ?? null,
        createdAt: e.createdAt,
      })),
    };
  },

  /**
   * Points réellement utilisables sur un panier : bornés par le solde, par la
   * part maximale configurée, et par ce que valent les points.
   */
  async usablePoints(userId: string, merchandise: Prisma.Decimal, currency: string): Promise<number> {
    if (!env.touma.loyaltyEnabled) return 0;
    if (currency.toUpperCase() !== env.touma.loyaltyCurrency.toUpperCase()) return 0;
    const account = await prisma.toumaLoyaltyAccount.findUnique({ where: { userId } });
    if (!account || account.balance <= 0) return 0;

    const cap = merchandise.times(env.touma.loyaltyMaxShare);
    const maxPoints = Math.floor(Number(cap.toString()) / env.touma.loyaltyPointValue);
    return Math.max(0, Math.min(account.balance, maxPoints));
  },

  /**
   * Débite les points au moment du checkout. Le contrôle du solde est fait par
   * une mise à jour **conditionnelle** : deux paniers simultanés ne peuvent pas
   * dépenser deux fois les mêmes points.
   */
  async redeem(tx: Prisma.TransactionClient, input: { userId: string; points: number; orderGroupId: string; currency: string }) {
    if (input.points <= 0) return ZERO;
    if (!env.touma.loyaltyEnabled) throw badRequest('Le programme de fidélité est désactivé.');
    if (input.currency.toUpperCase() !== env.touma.loyaltyCurrency.toUpperCase()) {
      throw badRequest(`Les points ne sont utilisables que sur les commandes en ${env.touma.loyaltyCurrency}.`);
    }

    const account = await accountFor(input.userId, tx);
    const debited = await tx.toumaLoyaltyAccount.updateMany({
      where: { id: account.id, balance: { gte: input.points } },
      data: { balance: { decrement: input.points } },
    });
    if (debited.count !== 1) throw badRequest('Solde de points insuffisant.');

    await tx.toumaLoyaltyEvent.create({
      data: {
        accountId: account.id,
        type: 'REDEEMED',
        points: -input.points,
        orderGroupId: input.orderGroupId,
        reason: 'Points utilisés sur une commande',
      },
    });
    return valueOfPoints(input.points, input.currency);
  },

  /**
   * Crédite les points d'une commande livrée. Idempotent : la contrainte
   * d'unicité (commande, type) empêche un double crédit si la livraison est
   * rejouée.
   */
  async awardForOrder(orderId: string): Promise<number> {
    if (!env.touma.loyaltyEnabled) return 0;
    const order = await prisma.toumaOrder.findUnique({
      where: { id: orderId },
      select: { id: true, buyerId: true, subtotal: true, discountTotal: true, currency: true, orderNumber: true, status: true },
    });
    if (!order) return 0;
    if (!['DELIVERED', 'COMPLETED'].includes(order.status)) return 0;
    if (order.currency.toUpperCase() !== env.touma.loyaltyCurrency.toUpperCase()) return 0;

    // Les points récompensent ce qui a réellement été payé, remise déduite.
    const base = order.subtotal.minus(order.discountTotal);
    const points = pointsFor(base.greaterThan(0) ? base : ZERO);
    if (points <= 0) return 0;

    try {
      await prisma.$transaction((tx) =>
        record(tx, {
          userId: order.buyerId,
          type: 'EARNED',
          points,
          orderId: order.id,
          reason: `Commande ${order.orderNumber}`,
        }),
      );
    } catch (err) {
      // P2002 = points déjà crédités pour cette commande : rien à faire.
      if ((err as { code?: string }).code === 'P2002') return 0;
      logger.error('Points de fidélité non crédités', { orderId, err: err instanceof Error ? err.message : String(err) });
      return 0;
    }

    await notify({
      userId: order.buyerId,
      type: 'ORDER_STATUS_CHANGED',
      title: 'Points TOUMA crédités',
      body: `${points} point(s) pour la commande ${order.orderNumber}.`,
      data: { orderId: order.id, points },
    });
    return points;
  },

  /**
   * Reprend les points d'une commande remboursée, au prorata du remboursement.
   * Sans cela, rembourser une commande reviendrait à offrir ses points.
   */
  async reverseForOrder(orderId: string, refundRatio = 1): Promise<number> {
    if (!env.touma.loyaltyEnabled) return 0;
    const earned = await prisma.toumaLoyaltyEvent.findFirst({ where: { orderId, type: 'EARNED' } });
    if (!earned || earned.points <= 0) return 0;

    const alreadyReversed = await prisma.toumaLoyaltyEvent.aggregate({
      where: { orderId, type: 'REVERSED' },
      _sum: { points: true },
    });
    const reversedSoFar = Math.abs(alreadyReversed._sum.points ?? 0);
    const target = Math.min(earned.points, Math.round(earned.points * Math.min(1, Math.max(0, refundRatio))));
    const toReverse = target - reversedSoFar;
    if (toReverse <= 0) return 0;

    const order = await prisma.toumaOrder.findUnique({ where: { id: orderId }, select: { buyerId: true, orderNumber: true } });
    if (!order) return 0;

    await prisma.$transaction((tx) =>
      record(tx, {
        userId: order.buyerId,
        type: 'REVERSED',
        points: -toReverse,
        orderId,
        reason: `Remboursement de la commande ${order.orderNumber}`,
      }),
    );
    return toReverse;
  },

  /** Ajustement manuel par l'administration (geste commercial, correction). */
  async adjust(actor: ToumaRequestUser, userId: string, points: number, reason: string) {
    if (actor.role !== 'ADMIN') throw notFound('Compte de fidélité introuvable.');
    if (!Number.isInteger(points) || points === 0) throw badRequest('Indiquez un nombre de points non nul.');
    const account = await prisma.$transaction((tx) => record(tx, { userId, type: 'ADJUSTED', points, reason }));
    return { balance: account.balance, lifetimePoints: account.lifetimePoints, tier: account.tier };
  },
};

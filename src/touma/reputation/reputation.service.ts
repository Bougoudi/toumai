import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { notFound } from '../lib/errors.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * RÉPUTATION VENDEUR — calculée sur les transactions réelles.
 *
 * Touma Verified contrôle des **pièces** ; la réputation mesure des **faits** :
 * délais tenus, annulations, litiges, retours, réactivité aux messages. Les
 * deux sont complémentaires, et aucun des deux ne garantit une transaction.
 *
 * Deux règles tiennent tout le module :
 *
 * 1. **Aucun chiffre inventé.** Chaque indicateur vient d'un agrégat sur des
 *    commandes, expéditions, litiges ou messages réels. Rien n'est saisi à la
 *    main, rien n'est estimé.
 * 2. **Pas d'indicateur sans volume.** En dessous du seuil configuré, les taux
 *    valent `null` et l'interface dit « pas encore assez de commandes » — un
 *    « 100 % de livraisons à l'heure » sur deux ventes tromperait l'acheteur.
 */

/**
 * Pondérations du score, publiées telles quelles : un vendeur doit pouvoir
 * comprendre ce qui le fait monter ou descendre. La somme vaut 1.
 */
export const SCORE_WEIGHTS = {
  /** Livrer dans le délai annoncé — la promesse la plus visible. */
  onTime: 0.3,
  /** Satisfaction déclarée par les acheteurs. */
  rating: 0.25,
  /** Ne pas annuler ce qu'on a accepté de vendre. */
  cancellation: 0.2,
  /** Litiges et retours : le signal le plus coûteux pour l'acheteur. */
  problems: 0.15,
  /** Réactivité aux messages avant achat. */
  responsiveness: 0.1,
} as const;

/** Paliers du score. Ce sont des repères, pas une garantie. */
const LEVELS: Array<{ name: string; min: number }> = [
  { name: 'EXCELLENT', min: 85 },
  { name: 'FIABLE', min: 70 },
  { name: 'CORRECT', min: 50 },
  { name: 'A_SURVEILLER', min: 0 },
];

const PAID_STATUSES: Prisma.EnumToumaOrderStatusFilter['in'] = [
  'PAID',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
  'REFUNDED',
  'DISPUTED',
];

const decimal = (value: number) => new Prisma.Decimal(value.toFixed(4));
const hours = (ms: number) => ms / 3_600_000;

function levelFor(score: number | null): string {
  if (score === null) return 'NOUVEAU';
  return LEVELS.find((l) => score >= l.min)?.name ?? 'A_SURVEILLER';
}

/** Médiane d'une série (renvoie null sur une série vide). */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Recalcule l'instantané de réputation d'une boutique à partir de ses données
 * réelles. Opération de lecture lourde mais bornée : tout est agrégé par la
 * base, aucune commande n'est chargée en mémoire hormis les dates nécessaires
 * aux délais.
 */
export async function compute(storeId: string) {
  const store = await prisma.toumaStore.findUnique({
    where: { id: storeId },
    select: { id: true, ratingAverage: true, ratingCount: true },
  });
  if (!store) throw notFound('Boutique introuvable.');

  const [ordersPaid, cancelled, delivered, disputes, returns, conversations] = await Promise.all([
    prisma.toumaOrder.count({ where: { storeId, status: { in: PAID_STATUSES } } }),
    // Annulations après paiement : celles qui pénalisent réellement l'acheteur.
    prisma.toumaOrder.count({ where: { storeId, status: 'CANCELLED', paidAt: { not: null } } }),
    prisma.toumaOrder.findMany({
      where: { storeId, deliveredAt: { not: null } },
      select: { paidAt: true, shippedAt: true, deliveredAt: true, shipments: { select: { etaMaxDays: true, shippedAt: true } } },
    }),
    prisma.toumaDispute.count({ where: { order: { storeId } } }),
    prisma.toumaReturnRequest.count({ where: { storeId, status: { notIn: ['CANCELLED', 'REJECTED'] } } }),
    prisma.toumaConversation.findMany({
      where: { storeId },
      select: {
        createdAt: true,
        messages: { select: { authorId: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
        store: { select: { ownerId: true } },
      },
      take: 200,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const ordersDelivered = delivered.length;
  const enough = ordersDelivered >= env.touma.reputationMinOrders;

  // ── Délais réellement observés ────────────────────────────────────────────
  const preparation: number[] = [];
  const deliveryDays: number[] = [];
  let onTime = 0;
  let onTimeMeasurable = 0;

  for (const order of delivered) {
    if (order.paidAt && order.shippedAt) preparation.push(hours(order.shippedAt.getTime() - order.paidAt.getTime()));
    if (order.shippedAt && order.deliveredAt) {
      deliveryDays.push((order.deliveredAt.getTime() - order.shippedAt.getTime()) / 86_400_000);
    }
    // « À l'heure » se mesure contre le délai que le transporteur avait annoncé.
    const shipment = order.shipments[0];
    const start = shipment?.shippedAt ?? order.shippedAt;
    if (shipment && start && order.deliveredAt && shipment.etaMaxDays > 0) {
      onTimeMeasurable += 1;
      const promised = start.getTime() + shipment.etaMaxDays * 86_400_000;
      if (order.deliveredAt.getTime() <= promised) onTime += 1;
    }
  }

  // ── Réactivité : une conversation où le vendeur a répondu, et en combien de temps ──
  let answered = 0;
  const responseDelays: number[] = [];
  for (const conversation of conversations) {
    const ownerId = conversation.store?.ownerId;
    if (!ownerId) continue;
    const firstBuyerMessage = conversation.messages.find((m) => m.authorId !== ownerId);
    if (!firstBuyerMessage) continue;
    const reply = conversation.messages.find((m) => m.authorId === ownerId && m.createdAt > firstBuyerMessage.createdAt);
    if (reply) {
      answered += 1;
      responseDelays.push(hours(reply.createdAt.getTime() - firstBuyerMessage.createdAt.getTime()));
    }
  }
  const conversationsWithQuestion = conversations.filter((c) =>
    c.messages.some((m) => m.authorId !== c.store?.ownerId),
  ).length;

  const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

  const onTimeRate = enough && onTimeMeasurable > 0 ? onTime / onTimeMeasurable : null;
  const cancellationRate = ordersPaid + cancelled > 0 && enough ? cancelled / (ordersPaid + cancelled) : null;
  const disputeRate = enough && ordersPaid > 0 ? disputes / ordersPaid : null;
  const returnRate = enough && ordersPaid > 0 ? returns / ordersPaid : null;
  const responseRate = conversationsWithQuestion >= 3 ? answered / conversationsWithQuestion : null;
  const avgPreparationHours = average(preparation);
  const avgDeliveryDays = average(deliveryDays);
  const medianResponseHours = median(responseDelays);

  // ── Score : uniquement si l'échantillon le permet ─────────────────────────
  let score: number | null = null;
  if (enough) {
    const ratingPart = store.ratingCount > 0 ? Number(store.ratingAverage) / 5 : null;
    const parts: Array<{ weight: number; value: number }> = [];
    if (onTimeRate !== null) parts.push({ weight: SCORE_WEIGHTS.onTime, value: onTimeRate });
    if (ratingPart !== null) parts.push({ weight: SCORE_WEIGHTS.rating, value: ratingPart });
    if (cancellationRate !== null) parts.push({ weight: SCORE_WEIGHTS.cancellation, value: 1 - cancellationRate });
    if (disputeRate !== null && returnRate !== null) {
      parts.push({ weight: SCORE_WEIGHTS.problems, value: Math.max(0, 1 - (disputeRate + returnRate)) });
    }
    if (responseRate !== null) parts.push({ weight: SCORE_WEIGHTS.responsiveness, value: responseRate });

    // Les composantes indisponibles ne pénalisent pas : on renormalise sur ce
    // qui a pu être mesuré, plutôt que de compter un zéro qui serait faux.
    const totalWeight = parts.reduce((acc, p) => acc + p.weight, 0);
    if (totalWeight > 0) {
      score = Math.round((parts.reduce((acc, p) => acc + p.weight * p.value, 0) / totalWeight) * 100);
    }
  }

  const data = {
    ordersPaid,
    ordersDelivered,
    onTimeRate: onTimeRate === null ? null : decimal(onTimeRate),
    cancellationRate: cancellationRate === null ? null : decimal(cancellationRate),
    disputeRate: disputeRate === null ? null : decimal(disputeRate),
    returnRate: returnRate === null ? null : decimal(returnRate),
    responseRate: responseRate === null ? null : decimal(responseRate),
    avgPreparationHours: avgPreparationHours === null ? null : new Prisma.Decimal(avgPreparationHours.toFixed(2)),
    avgDeliveryDays: avgDeliveryDays === null ? null : new Prisma.Decimal(avgDeliveryDays.toFixed(2)),
    medianResponseHours: medianResponseHours === null ? null : new Prisma.Decimal(medianResponseHours.toFixed(2)),
    ratingAverage: store.ratingAverage,
    ratingCount: store.ratingCount,
    score,
    level: levelFor(score),
    computedAt: new Date(),
  };

  return prisma.toumaStoreReputation.upsert({
    where: { storeId },
    create: { storeId, ...data },
    update: data,
  });
}

function serialize(row: Awaited<ReturnType<typeof compute>>) {
  const rate = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));
  return {
    storeId: row.storeId,
    /** Faux tant que le volume minimal n'est pas atteint. */
    published: row.score !== null,
    minimumOrders: env.touma.reputationMinOrders,
    ordersPaid: row.ordersPaid,
    ordersDelivered: row.ordersDelivered,
    score: row.score,
    level: row.level,
    metrics: {
      onTimeRate: rate(row.onTimeRate),
      cancellationRate: rate(row.cancellationRate),
      disputeRate: rate(row.disputeRate),
      returnRate: rate(row.returnRate),
      responseRate: rate(row.responseRate),
      avgPreparationHours: rate(row.avgPreparationHours),
      avgDeliveryDays: rate(row.avgDeliveryDays),
      medianResponseHours: rate(row.medianResponseHours),
    },
    rating: { average: Number(row.ratingAverage), count: row.ratingCount },
    weights: SCORE_WEIGHTS,
    computedAt: row.computedAt,
  };
}

export const reputationService = {
  compute,
  SCORE_WEIGHTS,

  /**
   * Réputation d'une boutique. L'instantané est recalculé quand il a dépassé sa
   * durée de validité : le calcul reste hors du chemin critique d'une commande.
   */
  async get(storeId: string, options: { refresh?: boolean } = {}) {
    const existing = await prisma.toumaStoreReputation.findUnique({ where: { storeId } });
    const stale =
      !existing || Date.now() - existing.computedAt.getTime() > env.touma.reputationTtlSeconds * 1000;
    const row = options.refresh || stale ? await compute(storeId) : existing;
    return serialize(row);
  },

  /**
   * Marque l'instantané comme périmé après un événement qui change la
   * réputation (livraison, litige, retour). Le recalcul se fera à la lecture :
   * un acheteur qui ouvre un litige n'a pas à attendre un agrégat.
   */
  async invalidate(storeId: string) {
    try {
      await prisma.toumaStoreReputation.updateMany({
        where: { storeId },
        data: { computedAt: new Date(0) },
      });
    } catch (err) {
      logger.error('Réputation non invalidée', { storeId, err: err instanceof Error ? err.message : String(err) });
    }
  },

  /** Vue vendeur : sa réputation, toujours recalculée à la demande. */
  async forSeller(user: ToumaRequestUser, storeId: string) {
    const store = await prisma.toumaStore.findUnique({ where: { id: storeId }, select: { ownerId: true } });
    if (!store) throw notFound('Boutique introuvable.');
    if (store.ownerId !== user.id && user.role !== 'ADMIN') throw notFound('Boutique introuvable.');
    return this.get(storeId, { refresh: true });
  },

  /** Classement des boutiques par score — administration. */
  async leaderboard(limit = 20) {
    const rows = await prisma.toumaStoreReputation.findMany({
      where: { score: { not: null } },
      include: { store: { select: { id: true, name: true, slug: true, countryCode: true, verificationStatus: true } } },
      orderBy: [{ score: 'desc' }, { ordersDelivered: 'desc' }],
      take: limit,
    });
    return {
      items: rows.map((r) => ({
        store: r.store,
        score: r.score,
        level: r.level,
        ordersDelivered: r.ordersDelivered,
        onTimeRate: r.onTimeRate === null ? null : Number(r.onTimeRate),
        computedAt: r.computedAt,
      })),
    };
  },
};

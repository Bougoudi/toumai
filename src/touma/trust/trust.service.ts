import type { TrustEntityType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { notFound } from '../lib/errors.js';
import { reputationService } from '../reputation/reputation.service.js';
import { assemble, levelFor, type Measure } from './scoring.js';
import {
  BUYER_FACTORS,
  MIN_SAMPLE,
  PRODUCT_FACTORS,
  SELLER_FACTORS,
  SUPPLIER_FACTORS,
  THRESHOLDS,
  VERIFICATION_VALUE,
  decayFactor,
} from './weights.js';
import type { TrustBreakdown } from './trust.types.js';
import { awardBadges } from './badges.js';

/**
 * TOUMA TRUST — le moteur.
 *
 * **Ce qu'il n'est pas.** Il ne recalcule ni la performance d'une boutique ni
 * le risque d'un compte : `reputation.service.ts` (V17) et `risk.service.ts`
 * existent, mesurent déjà des faits réels, et les refaire ici aurait produit
 * deux chiffres divergents pour la même chose. Le moteur **agrège**.
 *
 * **Ce qu'il est.** Une fonction qui prend des mesures existantes, les
 * normalise avec des seuils publiés, et rend une ventilation. Le score n'est
 * qu'un total : c'est la ventilation qui est le produit.
 *
 * **Trois règles tiennent le module.**
 *
 * 1. Sous le volume minimal, le score vaut `null`. Pas zéro — `null`. Un
 *    vendeur nouveau n'est pas un mauvais vendeur, et l'interface dit « pas
 *    encore assez de commandes ».
 * 2. Aucun chiffre n'est inventé. Chaque composante cite le décompte qui l'a
 *    produite, et une mesure impossible vaut `null` plutôt qu'une estimation.
 * 3. Rien n'est écrasé. Chaque calcul dépose un instantané daté avec son motif,
 *    de sorte qu'une baisse puisse être datée, expliquée et contestée.
 */

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

/** Normalise un taux « mauvais quand il monte » vers une pénalité 0–1. */
const penalty = (rate: number | null, full: number) => (rate === null ? null : Math.min(1, rate / full));

const PAID_STATUSES = [
  'PAID',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
  'REFUNDED',
  'DISPUTED',
] as const;

// ── Mesures : une fonction par type d'entité ────────────────────────────────

/**
 * Vendeur. La performance vient de l'instantané de réputation V17 ; la
 * vérification, de la boutique ; le risque, du compte propriétaire.
 */
async function measureSeller(storeId: string): Promise<{ measures: Record<string, Measure>; sample: number }> {
  const store = await prisma.toumaStore.findUnique({
    where: { id: storeId },
    select: { id: true, ownerId: true, verificationStatus: true, verificationLevel: true },
  });
  if (!store) throw notFound('Boutique introuvable.');

  const [reputation, risk] = await Promise.all([
    reputationService.get(storeId),
    prisma.toumaRiskScore.findUnique({ where: { userId: store.ownerId }, select: { score: true } }),
  ]);

  // Une vérification n'est prise en compte que si elle est **en cours de
  // validité**. Suspendue ou périmée, elle ne vaut rien : afficher « vendeur
  // vérifié » sur une vérification retirée serait la faute que V21 interdit.
  const verified = store.verificationStatus === 'APPROVED';
  const verificationValue = verified ? (VERIFICATION_VALUE[store.verificationLevel] ?? 0.5) : 0;

  const m = reputation.metrics;
  const measures: Record<string, Measure> = {
    VERIFICATION: {
      value: verificationValue,
      detail: { status: store.verificationStatus, level: store.verificationLevel },
    },
    DELIVERY: {
      value: m.onTimeRate,
      detail: { onTimeRate: m.onTimeRate, ordersDelivered: reputation.ordersDelivered },
    },
    TRANSACTIONS: {
      value: Math.min(1, reputation.ordersDelivered / THRESHOLDS.sellerTrackRecord),
      detail: { ordersDelivered: reputation.ordersDelivered, target: THRESHOLDS.sellerTrackRecord },
    },
    REVIEWS: {
      value: reputation.rating.count > 0 ? reputation.rating.average / 5 : null,
      detail: { average: reputation.rating.average, count: reputation.rating.count },
    },
    CANCELLATION: {
      value: m.cancellationRate === null ? null : 1 - m.cancellationRate,
      detail: { cancellationRate: m.cancellationRate },
    },
    RESPONSIVENESS: {
      value: m.responseRate,
      detail: { responseRate: m.responseRate, medianResponseHours: m.medianResponseHours },
    },
    DISPUTES: {
      value: penalty(m.disputeRate, THRESHOLDS.disputeRateFull),
      detail: { disputeRate: m.disputeRate, fullPenaltyAt: THRESHOLDS.disputeRateFull },
    },
    FRAUD_SIGNALS: {
      value: risk ? risk.score / 100 : null,
      detail: { riskScore: risk?.score ?? null },
    },
  };
  return { measures, sample: reputation.ordersDelivered };
}

/**
 * Acheteur.
 *
 * **Aucune variable de personne.** Le moteur ne lit ni nationalité, ni origine,
 * ni genre, ni religion — la requête ci-dessous ne les sélectionne pas, et
 * c'est la garantie la plus solide qu'on puisse donner : la donnée n'entre pas.
 * La province non plus : elle sert à livrer, pas à juger quelqu'un.
 */
async function measureBuyer(userId: string): Promise<{ measures: Record<string, Measure>; sample: number }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, createdAt: true, phone: true },
  });
  if (!user) throw notFound('Compte introuvable.');

  const [total, completed, cancelled, paymentsFailed, paymentsOk, disputesOpened, disputesAgainst, risk] =
    await Promise.all([
      prisma.toumaOrder.count({ where: { buyerId: userId } }),
      prisma.toumaOrder.count({ where: { buyerId: userId, status: 'COMPLETED' } }),
      prisma.toumaOrder.count({ where: { buyerId: userId, status: 'CANCELLED' } }),
      prisma.toumaPayment.count({ where: { order: { buyerId: userId }, status: 'FAILED' } }),
      prisma.toumaPayment.count({ where: { order: { buyerId: userId }, status: 'SUCCEEDED' } }),
      prisma.toumaDispute.count({ where: { openedById: userId } }),
      // Un litige tranché en faveur du vendeur : le seul signal d'abus qui
      // repose sur une décision humaine, et non sur une suspicion. Un litige
      // perdu n'est pas un abus en soi — c'est leur accumulation qui parle, et
      // c'est pourquoi la composante mesure un taux et non un décompte.
      prisma.toumaDispute.count({
        where: { openedById: userId, resolutionType: { in: ['NO_REFUND', 'SELLER_FAVOR'] } },
      }),
      prisma.toumaRiskScore.findUnique({ where: { userId }, select: { score: true } }),
    ]);

  const ageDays = (Date.now() - user.createdAt.getTime()) / 86_400_000;
  const abusRate = ratio(disputesAgainst, disputesOpened);

  const measures: Record<string, Measure> = {
    COMPLETED_ORDERS: {
      value: Math.min(1, completed / THRESHOLDS.buyerTrackRecord),
      detail: { completed, target: THRESHOLDS.buyerTrackRecord },
    },
    PAYMENT_RELIABILITY: {
      value: ratio(paymentsOk, paymentsOk + paymentsFailed),
      detail: { succeeded: paymentsOk, failed: paymentsFailed },
    },
    ACCOUNT_AGE: {
      value: Math.min(1, ageDays / THRESHOLDS.accountAgeDays),
      detail: { ageDays: Math.floor(ageDays), target: THRESHOLDS.accountAgeDays },
    },
    // Ce n'est **pas** « téléphone vérifié ». TOUMA n'envoie pas encore de SMS :
    // aucun numéro n'a été confirmé par son porteur. Ce qui est mesuré, et donc
    // ce qui est nommé, c'est qu'un numéro normalisé figure au dossier.
    VERIFIED_CONTACT: {
      value: user.phone ? 1 : 0,
      detail: { phoneOnFile: Boolean(user.phone), phoneConfirmedBySms: false },
    },
    NO_ABUSE: {
      value: abusRate === null ? null : 1 - abusRate,
      detail: { disputesOpened, disputesRejected: disputesAgainst },
    },
    CANCELLATIONS: {
      value: penalty(ratio(cancelled, total), THRESHOLDS.cancelRateFull),
      detail: { cancelled, total, fullPenaltyAt: THRESHOLDS.cancelRateFull },
    },
    FRAUD_SIGNALS: { value: risk ? risk.score / 100 : null, detail: { riskScore: risk?.score ?? null } },
  };
  return { measures, sample: completed };
}

/** Produit : son vendeur, son volume, ses avis, ses retours. */
async function measureProduct(productId: string): Promise<{ measures: Record<string, Measure>; sample: number }> {
  const product = await prisma.toumaProduct.findUnique({
    where: { id: productId },
    select: { id: true, storeId: true, ratingAverage: true, ratingCount: true, createdAt: true },
  });
  if (!product) throw notFound('Produit introuvable.');

  const [ordered, returned, sellerScore] = await Promise.all([
    prisma.toumaOrderItem.count({ where: { productId, order: { status: { in: [...PAID_STATUSES] } } } }),
    prisma.toumaReturnItem.count({
      where: { orderItem: { productId }, returnRequest: { status: { notIn: ['CANCELLED', 'REJECTED'] } } },
    }),
    prisma.toumaTrustScore.findUnique({
      where: { entityType_entityId: { entityType: 'SELLER', entityId: product.storeId } },
      select: { score: true },
    }),
  ]);

  const returnRate = ratio(returned, ordered);
  const measures: Record<string, Measure> = {
    SELLER_TRUST: {
      value: sellerScore?.score == null ? null : sellerScore.score / 100,
      detail: { sellerTrustScore: sellerScore?.score ?? null, storeId: product.storeId },
    },
    ORDER_VOLUME: {
      value: Math.min(1, ordered / THRESHOLDS.productTrackRecord),
      detail: { ordered, target: THRESHOLDS.productTrackRecord },
    },
    REVIEWS: {
      value: product.ratingCount > 0 ? Number(product.ratingAverage) / 5 : null,
      detail: { average: Number(product.ratingAverage), count: product.ratingCount },
    },
    LOW_RETURNS: { value: returnRate === null ? null : 1 - returnRate, detail: { returned, ordered } },
    RETURNS: {
      value: penalty(returnRate, THRESHOLDS.returnRateFull),
      detail: { returnRate, fullPenaltyAt: THRESHOLDS.returnRateFull },
    },
  };
  return { measures, sample: ordered };
}

/**
 * Fournisseur B2B.
 *
 * Distinct du score vendeur, et pas par goût de la symétrie : un bon vendeur au
 * détail peut être un fournisseur médiocre. Répondre à un appel d'offres, tenir
 * un délai annoncé, honorer un devis ne se mesurent nulle part ailleurs.
 */
async function measureSupplier(userId: string): Promise<{ measures: Record<string, Measure>; sample: number }> {
  // Une invitation à un appel d'offres vise une **boutique**, pas un compte :
  // un fournisseur qui en tient deux doit être mesuré sur les deux.
  const stores = await prisma.toumaStore.findMany({ where: { ownerId: userId }, select: { id: true } });
  const storeIds = stores.map((s) => s.id);

  const [invitations, quotes, risk] = await Promise.all([
    prisma.toumaRfqInvitation.count({ where: { storeId: { in: storeIds } } }),
    prisma.toumaQuote.findMany({
      where: { sellerId: userId },
      select: { id: true, status: true, createdAt: true, acceptedAt: true, rfq: { select: { createdAt: true } } },
    }),
    prisma.toumaRiskScore.findUnique({ where: { userId }, select: { score: true } }),
  ]);

  const accepted = quotes.filter((q) => q.status === 'ACCEPTED').length;
  const delays = quotes
    .map((q) => (q.rfq ? (q.createdAt.getTime() - q.rfq.createdAt.getTime()) / 3_600_000 : null))
    .filter((d): d is number => d !== null && d >= 0);
  const medianHours = delays.length
    ? [...delays].sort((a, b) => a - b)[Math.floor(delays.length / 2)]
    : null;

  const measures: Record<string, Measure> = {
    VERIFICATION: await (async () => {
      const store = await prisma.toumaStore.findFirst({
        where: { ownerId: userId },
        select: { verificationStatus: true, verificationLevel: true },
        orderBy: { createdAt: 'asc' },
      });
      const verified = store?.verificationStatus === 'APPROVED';
      return {
        value: verified ? (VERIFICATION_VALUE[store.verificationLevel] ?? 0.5) : 0,
        detail: { status: store?.verificationStatus ?? 'UNVERIFIED', level: store?.verificationLevel ?? 'NONE' },
      };
    })(),
    QUOTE_RESPONSE: {
      value: ratio(quotes.length, invitations),
      detail: { invitations, quotes: quotes.length },
    },
    QUOTE_ACCEPTANCE: {
      value: ratio(accepted, quotes.length),
      detail: { accepted, submitted: quotes.length },
    },
    B2B_ORDERS: {
      value: Math.min(1, accepted / MIN_SAMPLE.supplier),
      detail: { acceptedQuotes: accepted, target: MIN_SAMPLE.supplier },
    },
    RESPONSE_SPEED: {
      value: medianHours === null ? null : Math.max(0, 1 - medianHours / THRESHOLDS.quoteResponseHours),
      detail: { medianQuoteHours: medianHours, target: THRESHOLDS.quoteResponseHours },
    },
    DISPUTES: { value: risk ? risk.score / 100 : null, detail: { riskScore: risk?.score ?? null } },
  };
  return { measures, sample: quotes.length };
}

const FACTORS = {
  SELLER: SELLER_FACTORS,
  BUYER: BUYER_FACTORS,
  PRODUCT: PRODUCT_FACTORS,
  SUPPLIER: SUPPLIER_FACTORS,
} as const;

const MINIMUM = {
  SELLER: MIN_SAMPLE.seller,
  BUYER: MIN_SAMPLE.buyer,
  PRODUCT: MIN_SAMPLE.product,
  SUPPLIER: MIN_SAMPLE.supplier,
} as const;

async function measure(entityType: TrustEntityType, entityId: string) {
  switch (entityType) {
    case 'SELLER':
      return measureSeller(entityId);
    case 'BUYER':
      return measureBuyer(entityId);
    case 'PRODUCT':
      return measureProduct(entityId);
    case 'SUPPLIER':
      return measureSupplier(entityId);
  }
}

export const trustService = {
  /**
   * Recalcule le score d'une entité, dépose un instantané et met à jour les
   * badges. `reason` est conservé tel quel dans l'historique : c'est lui qui
   * permettra de dire « votre score a baissé le 12 mars, à l'ouverture d'un
   * litige » plutôt que « votre score a baissé ».
   */
  async compute(entityType: TrustEntityType, entityId: string, reason = 'SCHEDULED'): Promise<TrustBreakdown> {
    const { measures, sample } = await measure(entityType, entityId);
    const minimum = MINIMUM[entityType];
    const { components, score: brut } = assemble(FACTORS[entityType], measures);

    // Le seuil s'applique **après** le calcul : la ventilation reste complète
    // et lisible, seul le total est retenu tant que l'échantillon est mince.
    const score = sample >= minimum ? brut : null;
    const level = levelFor(score);
    const computedAt = new Date();

    const previous = await prisma.toumaTrustScore.findUnique({
      where: { entityType_entityId: { entityType, entityId } },
      select: { score: true },
    });

    const payload = {
      score,
      level,
      breakdown: components as unknown as Prisma.InputJsonValue,
      sampleSize: sample,
      computedAt,
    };

    await prisma.$transaction([
      prisma.toumaTrustScore.upsert({
        where: { entityType_entityId: { entityType, entityId } },
        create: { entityType, entityId, ...payload },
        update: payload,
      }),
      prisma.toumaTrustScoreSnapshot.create({
        data: {
          entityType,
          entityId,
          score,
          level,
          breakdown: components as unknown as Prisma.InputJsonValue,
          reason,
          delta: previous?.score != null && score != null ? score - previous.score : null,
        },
      }),
    ]);

    await awardBadges(entityType, entityId, components, sample).catch((err) => {
      logger.error('Badges non recalculés', { entityType, entityId, err: String(err) });
    });

    return {
      entityType,
      entityId,
      score,
      level,
      sampleSize: sample,
      minimumSample: minimum,
      components,
      computedAt,
    };
  },

  /** Lecture, avec recalcul si l'instantané a dépassé sa durée de validité. */
  async get(entityType: TrustEntityType, entityId: string, options: { refresh?: boolean } = {}) {
    const existing = await prisma.toumaTrustScore.findUnique({
      where: { entityType_entityId: { entityType, entityId } },
    });
    const stale = !existing || Date.now() - existing.computedAt.getTime() > env.touma.trust.ttlSeconds * 1000;
    if (options.refresh || stale) return this.compute(entityType, entityId, options.refresh ? 'REFRESH' : 'STALE');
    return {
      entityType,
      entityId,
      score: existing.score,
      level: existing.level,
      sampleSize: existing.sampleSize,
      minimumSample: MINIMUM[entityType],
      components: existing.breakdown as unknown as TrustBreakdown['components'],
      computedAt: existing.computedAt,
    } satisfies TrustBreakdown;
  },

  /** Historique daté d'une entité — c'est ce qui rend une baisse contestable. */
  async history(entityType: TrustEntityType, entityId: string, limit = 30) {
    const rows = await prisma.toumaTrustScoreSnapshot.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { score: true, level: true, reason: true, delta: true, createdAt: true },
    });
    return { items: rows };
  },

  /** Facteur de décroissance, exposé pour que le calcul reste vérifiable. */
  decayFactor,
};

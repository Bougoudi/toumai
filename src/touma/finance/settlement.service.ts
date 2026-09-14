import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * Règlement des vendeurs : ce qui leur est dû, et quand.
 *
 * **Le défaut corrigé.** `ToumaSellerPayout` était déclaré depuis plusieurs
 * versions et n'était **lu ni écrit nulle part** — une seule occurrence dans
 * tout le dépôt, à l'intérieur d'un commentaire. Un vendeur n'avait donc aucun
 * moyen de savoir ce qui lui revenait, quand il serait payé, ni pourquoi un
 * versement tardait.
 *
 * **Ce que ce module n'est pas.** Il ne détient pas d'argent. Il dit ce qui est
 * **dû**, pas ce qu'un vendeur posséderait chez TOUMA : la distinction n'est pas
 * rhétorique, elle sépare une place de marché d'un établissement de paiement.
 * Voir `docs/payments/compliance-boundaries.md`.
 *
 * **Et il ne verse rien tout seul.** Marquer une part « réglable » ne fait
 * partir aucun franc : un humain crée le versement, un humain l'exécute, et les
 * deux sont nommés. Tant qu'aucun prestataire de virement n'est raccordé,
 * l'exécution est une opération d'exploitation consignée — pas un transfert.
 */

/** Jours de protection après livraison avant qu'une part devienne réglable. */
const PROTECTION_DAYS = Number(process.env.TOUMA_SETTLEMENT_PROTECTION_DAYS ?? 14);

/** Statuts de litige qui retiennent l'argent. */
const BLOCKING_DISPUTES = ['OPEN', 'SELLER_RESPONSE_REQUIRED', 'BUYER_RESPONSE_REQUIRED', 'UNDER_REVIEW', 'MEDIATION', 'ESCALATED'];

function payoutReference(): string {
  const d = new Date();
  const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  // Cinq octets, comme au checkout : trois ne donnaient que 16,7 millions de
  // valeurs par jour, et la collision se manifeste par une erreur serveur chez
  // celui qui a perdu au tirage.
  return `VS-${day}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

/** Net dû sur une part : brut + transport − commission − remboursé, jamais négatif. */
export function netOf(a: { grossAmount: Prisma.Decimal; shippingAmount: Prisma.Decimal; commissionAmount: Prisma.Decimal; refundedAmount: Prisma.Decimal }): Prisma.Decimal {
  const net = a.grossAmount.plus(a.shippingAmount).minus(a.commissionAmount).minus(a.refundedAmount);
  return net.greaterThan(0) ? net : new Prisma.Decimal(0);
}

/**
 * Crée les parts de règlement d'un paiement encaissé, une par boutique.
 *
 * Idempotent : `orderId` est unique, donc rejouer un webhook ou une reprise
 * après incident n'en crée pas une seconde. Et un doublon ne fait jamais échouer
 * l'opération métier — une vente ne doit pas être refusée parce que sa part
 * existait déjà.
 */
export async function allocateForPayment(
  paymentId: string,
  orders: { id: string; storeId: string; subtotal: Prisma.Decimal; shippingTotal: Prisma.Decimal; commissionTotal: Prisma.Decimal; currency: string }[],
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  if (orders.length === 0) return 0;
  const { count } = await tx.toumaSettlementAllocation.createMany({
    data: orders.map((o) => ({
      paymentId,
      orderId: o.id,
      storeId: o.storeId,
      grossAmount: o.subtotal,
      shippingAmount: o.shippingTotal,
      commissionAmount: o.commissionTotal,
      currency: o.currency,
      status: 'PENDING' as const,
    })),
    skipDuplicates: true,
  });
  return count;
}

/** Répercute un remboursement sur la part concernée. */
export async function applyRefundToAllocation(orderId: string, amount: Prisma.Decimal, tx: Prisma.TransactionClient = prisma): Promise<void> {
  const allocation = await tx.toumaSettlementAllocation.findUnique({ where: { orderId }, select: { id: true } });
  if (!allocation) return;
  await tx.toumaSettlementAllocation.update({
    where: { id: allocation.id },
    data: { refundedAmount: { increment: amount } },
  });
}

export interface EligibilityResult {
  promoted: number;
  cancelled: number;
  /** Parts examinées. Utile pour distinguer « rien à faire » de « rien vu ». */
  examined: number;
  /**
   * Vrai si le balayage s'est arrêté avant d'avoir tout vu.
   *
   * Il ne s'arrête jamais **en silence** : un arrêt silencieux laisserait des
   * vendeurs sans règlement sans que rien ne le dise.
   */
  truncated: boolean;
}

/**
 * Passe en revue les parts en attente et promeut celles qui remplissent les
 * conditions.
 *
 * Trois conditions simultanées, et elles sont dans cet ordre parce que c'est
 * l'ordre dans lequel elles échouent : la commande est **livrée**, la fenêtre de
 * protection est **écoulée**, et **aucun litige bloquant** ne pèse sur elle.
 *
 * Une part intégralement remboursée n'est pas « réglable à zéro » : elle est
 * annulée. Payer zéro franc à quelqu'un est une écriture inutile qui brouille
 * l'histoire.
 */
/** Taille d'un lot. Bornée pour ne pas charger la base d'un seul coup. */
const ELIGIBILITY_BATCH = 500;

/**
 * Garde-fou absolu, en nombre de lots.
 *
 * Il existe pour qu'un défaut de progression ne devienne pas une boucle
 * infinie, pas pour plafonner le travail utile. Quand il est atteint, le
 * résultat le **dit** — `truncated` — au lieu de laisser croire que tout a été
 * examiné.
 */
const ELIGIBILITY_MAX_BATCHES = 200;

export async function refreshEligibility(now = new Date()): Promise<EligibilityResult> {
  const limite = new Date(now.getTime() - PROTECTION_DAYS * 86_400_000);

  let promoted = 0;
  let cancelled = 0;
  let examined = 0;
  let truncated = false;
  let curseur: string | undefined;

  // Parcours par lots plutôt qu'un plafond unique.
  //
  // Le défaut corrigé : un seul `take: 500`, sans ordre ni suite. Au-delà de
  // 500 parts en attente — une situation parfaitement ordinaire pour une place
  // de marché — les suivantes n'étaient jamais examinées. Aucune erreur, aucun
  // journal : des vendeurs cessaient simplement d'être réglés, et le balayage
  // avait l'air de fonctionner.
  //
  // Le curseur porte sur l'identifiant : les parts promues ou annulées sortent
  // de `PENDING`, celles qu'on laisse en place y restent, et l'ordre stable
  // garantit qu'on avance dans les deux cas.
  for (let lot = 0; lot < ELIGIBILITY_MAX_BATCHES; lot += 1) {
    const candidates = await prisma.toumaSettlementAllocation.findMany({
      where: { status: 'PENDING', ...(curseur ? { id: { gt: curseur } } : {}) },
      select: {
        id: true,
        orderId: true,
        grossAmount: true,
        shippingAmount: true,
        commissionAmount: true,
        refundedAmount: true,
        order: {
          select: {
            status: true,
            deliveredAt: true,
            disputes: { where: { status: { in: BLOCKING_DISPUTES as never } }, select: { id: true } },
          },
        },
      },
      orderBy: { id: 'asc' },
      take: ELIGIBILITY_BATCH,
    });

    if (candidates.length === 0) break;
    curseur = candidates[candidates.length - 1].id;
    examined += candidates.length;

    for (const a of candidates) {
      // Intégralement remboursée : il n'y a plus rien à régler.
      if (netOf(a).lessThanOrEqualTo(0)) {
        await prisma.toumaSettlementAllocation.updateMany({
          where: { id: a.id, status: 'PENDING' },
          data: { status: 'CANCELLED' },
        });
        cancelled += 1;
        continue;
      }

      if (!['DELIVERED', 'COMPLETED'].includes(a.order.status)) continue;
      const livree = a.order.deliveredAt;
      if (!livree || livree > limite) continue;
      if (a.order.disputes.length > 0) continue;

      // Prise conditionnée au statut : un remboursement arrivé dans le même
      // instant l'emporte, et le balayage passe son chemin.
      const pris = await prisma.toumaSettlementAllocation.updateMany({
        where: { id: a.id, status: 'PENDING' },
        data: { status: 'ELIGIBLE', eligibleAt: now },
      });
      if (pris.count === 1) promoted += 1;
    }

    if (candidates.length < ELIGIBILITY_BATCH) break;
    if (lot === ELIGIBILITY_MAX_BATCHES - 1) truncated = true;
  }

  if (truncated) {
    logger.error('Balayage des règlements interrompu avant la fin : des parts n’ont pas été examinées', {
      examined,
      maxBatches: ELIGIBILITY_MAX_BATCHES,
    });
  }
  if (promoted > 0 || cancelled > 0) logger.info('Parts de règlement mises à jour', { promoted, cancelled, examined });
  return { promoted, cancelled, examined, truncated };
}

/** Intervalle minimal entre deux balayages déclenchés par le trafic. */
const SWEEP_INTERVAL_MS = Number(process.env.TOUMA_SETTLEMENT_SWEEP_MS ?? 300_000);
let lastSweep = 0;

/** Balayage opportuniste, sur le chemin de la consultation financière. */
export async function sweepSettlements(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  try {
    await refreshEligibility();
  } catch (err) {
    logger.error('Balayage des règlements en échec', { err: err instanceof Error ? err.message : String(err) });
  }
}

/** Remet le compteur à zéro (tests). */
export function resetSettlementSweep(): void {
  lastSweep = 0;
}

export const settlementService = {
  netOf,
  refreshEligibility,

  /** Ce qu'une boutique a gagné, ce qui est réglable, ce qui attend. */
  async storeFinance(storeId: string) {
    const allocations = await prisma.toumaSettlementAllocation.findMany({
      where: { storeId },
      select: {
        id: true,
        orderId: true,
        status: true,
        grossAmount: true,
        shippingAmount: true,
        commissionAmount: true,
        refundedAmount: true,
        currency: true,
        eligibleAt: true,
        payoutId: true,
        order: { select: { orderNumber: true, status: true, deliveredAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    // Les devises ne sont jamais additionnées : sans taux officiel, une somme
    // XAF + EUR serait un chiffre inventé.
    const parDevise = new Map<string, { pending: Prisma.Decimal; eligible: Prisma.Decimal; settled: Prisma.Decimal }>();
    for (const a of allocations) {
      const bucket = parDevise.get(a.currency) ?? { pending: new Prisma.Decimal(0), eligible: new Prisma.Decimal(0), settled: new Prisma.Decimal(0) };
      const net = netOf(a);
      if (a.status === 'PENDING') bucket.pending = bucket.pending.plus(net);
      if (a.status === 'ELIGIBLE') bucket.eligible = bucket.eligible.plus(net);
      if (a.status === 'SETTLED') bucket.settled = bucket.settled.plus(net);
      parDevise.set(a.currency, bucket);
    }

    return {
      balances: [...parDevise.entries()].map(([currency, b]) => ({
        currency,
        /** Encaissé, fenêtre de protection en cours. */
        pending: b.pending.toString(),
        /** Réglable : un versement peut être créé. */
        eligible: b.eligible.toString(),
        /** Déjà rattaché à un versement. */
        settled: b.settled.toString(),
      })),
      allocations: allocations.map((a) => ({
        ...a,
        grossAmount: a.grossAmount.toString(),
        shippingAmount: a.shippingAmount.toString(),
        commissionAmount: a.commissionAmount.toString(),
        refundedAmount: a.refundedAmount.toString(),
        netAmount: netOf(a).toString(),
      })),
      protectionDays: PROTECTION_DAYS,
    };
  },

  /** Versements d'une boutique. */
  async payouts(storeId: string) {
    const items = await prisma.toumaSellerPayout.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, reference: true, amount: true, currency: true, status: true,
        paidAt: true, holdReason: true, failureReason: true, createdAt: true,
        _count: { select: { allocations: true } },
      },
    });
    return {
      items: items.map((p) => ({ ...p, amount: p.amount.toString(), orderCount: p._count.allocations, _count: undefined })),
    };
  },

  /**
   * Crée un versement regroupant les parts réglables d'une boutique.
   *
   * Réservé à l'administration : c'est un acte d'exploitation, pas un droit de
   * tirage. Rien ne part d'un compte ici — le versement consigne ce qui doit
   * être viré, et par qui il a été décidé.
   */
  async createPayout(actor: ToumaRequestUser, storeId: string, currency: string) {
    const eligibles = await prisma.toumaSettlementAllocation.findMany({
      where: { storeId, status: 'ELIGIBLE', currency, payoutId: null },
      select: { id: true, grossAmount: true, shippingAmount: true, commissionAmount: true, refundedAmount: true },
    });
    if (eligibles.length === 0) throw conflict('Aucune part réglable pour cette boutique dans cette devise.');

    const total = eligibles.reduce((acc, a) => acc.plus(netOf(a)), new Prisma.Decimal(0));
    if (!total.greaterThan(0)) throw conflict('Le montant réglable est nul.');

    const payout = await prisma.$transaction(async (tx) => {
      const created = await tx.toumaSellerPayout.create({
        data: {
          storeId,
          amount: total,
          currency,
          status: 'ELIGIBLE',
          reference: payoutReference(),
          decidedById: actor.id,
        },
      });
      // Prise conditionnée : une part déjà rattachée par un versement
      // concurrent n'est pas volée à celui-ci.
      const pris = await tx.toumaSettlementAllocation.updateMany({
        where: { id: { in: eligibles.map((a) => a.id) }, status: 'ELIGIBLE', payoutId: null },
        data: { status: 'SETTLED', payoutId: created.id },
      });
      if (pris.count !== eligibles.length) {
        throw conflict('Les parts ont changé pendant la création du versement : réessayez.');
      }
      return created;
    });

    await audit({
      actorId: actor.id,
      action: 'payout.created',
      entity: 'ToumaSellerPayout',
      entityId: payout.id,
      metadata: { storeId, amount: total.toString(), currency, allocations: eligibles.length },
    });
    return { ...payout, amount: payout.amount.toString() };
  },

  /**
   * Marque un versement exécuté.
   *
   * **Aucun virement n'est déclenché ici.** Tant qu'aucun prestataire de
   * virement n'est raccordé, c'est la consignation d'un mouvement fait ailleurs,
   * par quelqu'un de nommé, avec sa référence. Prétendre le contraire donnerait
   * à un vendeur la certitude d'avoir été payé alors que rien n'est parti.
   */
  async processPayout(actor: ToumaRequestUser, payoutId: string, providerRef?: string) {
    const payout = await prisma.toumaSellerPayout.findUnique({ where: { id: payoutId } });
    if (!payout) throw notFound('Versement introuvable.');
    if (!['ELIGIBLE', 'PROCESSING', 'FAILED'].includes(payout.status)) {
      throw conflict(`Un versement au statut ${payout.status} ne peut pas être exécuté.`);
    }

    const updated = await prisma.toumaSellerPayout.update({
      where: { id: payout.id },
      data: { status: 'PAID', paidAt: new Date(), decidedById: actor.id, providerRef: providerRef ?? null, failureReason: null },
    });
    await audit({ actorId: actor.id, action: 'payout.processed', entity: 'ToumaSellerPayout', entityId: payout.id, metadata: { providerRef: providerRef ?? null } });

    const store = await prisma.toumaStore.findUnique({ where: { id: payout.storeId }, select: { ownerId: true, name: true } });
    if (store) {
      await notify({
        userId: store.ownerId,
        type: 'PAYOUT_PAID',
        title: 'Versement effectué',
        body: `Un versement de ${payout.amount.toString()} ${payout.currency} a été marqué comme effectué.`,
        data: { payoutId: payout.id },
      });
    }
    return { ...updated, amount: updated.amount.toString() };
  },

  /** Retient un versement. Le motif est obligatoire et visible du vendeur. */
  async holdPayout(actor: ToumaRequestUser, payoutId: string, reason: string) {
    if (!reason.trim()) throw badRequest('Un motif est requis pour retenir un versement.');
    const payout = await prisma.toumaSellerPayout.findUnique({ where: { id: payoutId } });
    if (!payout) throw notFound('Versement introuvable.');
    if (payout.status === 'PAID') throw conflict('Un versement déjà effectué ne se retient pas.');

    const updated = await prisma.toumaSellerPayout.update({
      where: { id: payout.id },
      data: { status: 'ON_HOLD', holdReason: reason.slice(0, 500), decidedById: actor.id },
    });
    await audit({ actorId: actor.id, action: 'payout.held', entity: 'ToumaSellerPayout', entityId: payout.id, metadata: { reason: reason.slice(0, 200) } });

    const store = await prisma.toumaStore.findUnique({ where: { id: payout.storeId }, select: { ownerId: true } });
    if (store) {
      await notify({
        userId: store.ownerId,
        type: 'PAYOUT_HELD',
        title: 'Versement retenu',
        body: `Un versement est retenu : ${reason.slice(0, 200)}`,
        data: { payoutId: payout.id },
      });
    }
    return { ...updated, amount: updated.amount.toString() };
  },

  /** Lève une retenue : le versement redevient réglable. */
  async releasePayout(actor: ToumaRequestUser, payoutId: string) {
    const payout = await prisma.toumaSellerPayout.findUnique({ where: { id: payoutId } });
    if (!payout) throw notFound('Versement introuvable.');
    if (payout.status !== 'ON_HOLD') throw conflict('Ce versement n’est pas retenu.');

    const updated = await prisma.toumaSellerPayout.update({
      where: { id: payout.id },
      data: { status: 'ELIGIBLE', holdReason: null, decidedById: actor.id },
    });
    await audit({ actorId: actor.id, action: 'payout.released', entity: 'ToumaSellerPayout', entityId: payout.id, metadata: {} });
    return { ...updated, amount: updated.amount.toString() };
  },

  /**
   * Annule un versement et **rend ses parts au vendeur**. Sans cela, annuler un
   * versement reviendrait à faire disparaître ce qui lui est dû.
   */
  async cancelPayout(actor: ToumaRequestUser, payoutId: string, reason: string) {
    if (!reason.trim()) throw badRequest('Un motif est requis pour annuler un versement.');
    const payout = await prisma.toumaSellerPayout.findUnique({ where: { id: payoutId } });
    if (!payout) throw notFound('Versement introuvable.');
    if (payout.status === 'PAID') throw conflict('Un versement déjà effectué ne s’annule pas : passez par une écriture de correction.');

    const updated = await prisma.$transaction(async (tx) => {
      await tx.toumaSettlementAllocation.updateMany({
        where: { payoutId: payout.id },
        data: { status: 'ELIGIBLE', payoutId: null },
      });
      return tx.toumaSellerPayout.update({
        where: { id: payout.id },
        data: { status: 'CANCELLED', holdReason: reason.slice(0, 500), decidedById: actor.id },
      });
    });
    await audit({ actorId: actor.id, action: 'payout.cancelled', entity: 'ToumaSellerPayout', entityId: payout.id, metadata: { reason: reason.slice(0, 200) } });
    return { ...updated, amount: updated.amount.toString() };
  },
};

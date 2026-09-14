import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { recordRefund } from '../finance/ledger.js';
import { applyRefundToAllocation } from '../finance/settlement.service.js';
import { env } from '../../config/env.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { money, roundTo } from '../lib/money.js';
import { notify } from '../lib/notifications.js';
import { documentService } from '../documents/document.service.js';
import { loyaltyService } from '../loyalty/loyalty.service.js';
import { getPaymentProvider } from './payment.service.js';

/**
 * Moteur de remboursement, au niveau **commande**.
 *
 * Un panier multi-vendeurs est payé en une fois : rembourser une commande ne
 * doit jamais toucher à l'argent d'une autre boutique. Ce module borne donc
 * chaque remboursement à deux plafonds simultanés :
 *   1. le total de la commande concernée, moins ce qui a déjà été remboursé ;
 *   2. le montant réellement encaissé par le paiement qui la couvre.
 *
 * Aucune décision automatique : l'appelant fournit toujours l'humain
 * (vendeur ou administration) qui assume le mouvement d'argent.
 */

export interface RefundRequest {
  /** Humain à l'origine de la décision — jamais un automatisme. */
  actorId: string;
  orderId: string;
  /** Montant demandé ; absent = solde remboursable de la commande. */
  amount?: string;
  reason?: string;
  returnRequestId?: string | null;
}

function refundReference(): string {
  const d = new Date();
  const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `RB-${day}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

/**
 * Paiement abouti couvrant cette commande : soit son propre paiement, soit
 * celui du groupe multi-vendeurs auquel elle appartient.
 */
async function settledPaymentFor(orderId: string) {
  const order = await prisma.toumaOrder.findUnique({
    where: { id: orderId },
    select: { id: true, groupId: true },
  });
  if (!order) throw notFound('Commande introuvable.');
  return prisma.toumaPayment.findFirst({
    where: {
      status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] },
      OR: [{ orderId: order.id }, ...(order.groupId ? [{ orderGroupId: order.groupId }] : [])],
    },
    orderBy: { createdAt: 'desc' },
  });
}

/** Somme déjà remboursée sur cette commande (remboursements aboutis ou en cours). */
export async function refundedTotal(orderId: string): Promise<Prisma.Decimal> {
  const agg = await prisma.toumaRefund.aggregate({
    where: { orderId, status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] } },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? new Prisma.Decimal(0);
}

/** Solde encore remboursable d'une commande (jamais négatif). */
export async function refundableAmount(orderId: string): Promise<Prisma.Decimal> {
  const order = await prisma.toumaOrder.findUnique({ where: { id: orderId }, select: { total: true } });
  if (!order) throw notFound('Commande introuvable.');
  const already = await refundedTotal(orderId);
  const left = order.total.minus(already);
  return left.greaterThan(0) ? left : new Prisma.Decimal(0);
}

export const refundService = {
  refundableAmount,
  refundedTotal,

  /**
   * Rembourse **au niveau du paiement**, en répartissant sur les commandes
   * qu'il couvre.
   *
   * **Le défaut corrigé.** Il existait deux chemins de remboursement qui
   * s'ignoraient. Celui de l'administration mettait à jour le paiement et
   * s'arrêtait là : aucune ligne de remboursement créée, **rien au registre
   * comptable**, et **aucune contre-passation de commission**. Autrement dit,
   * après un remboursement administratif, le registre continuait d'affirmer que
   * la boutique avait gagné l'argent rendu à l'acheteur, et TOUMA gardait sa
   * commission sur une vente annulée.
   *
   * Un seul moteur désormais, celui qui tient les deux bouts. La répartition
   * suit l'ordre des commandes et s'arrête quand le montant est épuisé : une
   * boutique n'est jamais débitée pour une autre.
   */
  async executeForPayment(input: { actorId: string; paymentId: string; amount?: string; reason?: string }) {
    const payment = await prisma.toumaPayment.findUnique({
      where: { id: input.paymentId },
      include: { order: { select: { id: true } }, orderGroup: { include: { orders: { select: { id: true } } } } },
    });
    if (!payment) throw notFound('Paiement introuvable.');
    if (!['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
      throw conflict('Seul un paiement abouti peut être remboursé.');
    }

    const orderIds = payment.orderGroup ? payment.orderGroup.orders.map((o) => o.id) : payment.order ? [payment.order.id] : [];
    if (orderIds.length === 0) throw conflict('Ce paiement ne couvre aucune commande.');

    // Sans montant : on rend tout ce qui reste remboursable, commande par
    // commande.
    let reste = input.amount ? roundTo(money(input.amount), payment.currency) : null;
    if (reste && !reste.greaterThan(0)) throw badRequest('Le montant du remboursement doit être supérieur à zéro.');

    const faits: Awaited<ReturnType<typeof refundService.execute>>[] = [];
    for (const orderId of orderIds) {
      if (reste && !reste.greaterThan(0)) break;
      const remboursable = await refundableAmount(orderId);
      if (!remboursable.greaterThan(0)) continue;

      const part = reste ? (reste.lessThan(remboursable) ? reste : remboursable) : remboursable;
      faits.push(
        await refundService.execute({
          actorId: input.actorId,
          orderId,
          amount: part.toString(),
          reason: input.reason,
        }),
      );
      if (reste) reste = reste.minus(part);
    }

    if (faits.length === 0) throw conflict('Il ne reste rien à rembourser sur ce paiement.');
    if (reste && reste.greaterThan(0)) {
      // On ne tait pas un reste non réparti : l'appelant a demandé plus que ce
      // que les commandes permettent de rendre.
      throw badRequest(`Montant trop élevé : ${reste.toString()} ${payment.currency} n’ont pas pu être répartis sur les commandes de ce paiement.`);
    }

    return { refunds: faits };
  },

  /**
   * Exécute un remboursement : contrôle des plafonds, appel au prestataire,
   * puis écriture atomique (remboursement, paiement, commande, commission).
   *
   * La contre-passation de commission est une ligne négative : l'historique
   * comptable n'est jamais réécrit, il est corrigé.
   */
  async execute(request: RefundRequest) {
    const order = await prisma.toumaOrder.findUnique({
      where: { id: request.orderId },
      include: { store: { select: { id: true, name: true, ownerId: true } } },
    });
    if (!order) throw notFound('Commande introuvable.');
    if (!['PAID', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'DISPUTED', 'REFUNDED'].includes(order.status)) {
      throw conflict('Cette commande n’a pas été payée : il n’y a rien à rembourser.');
    }

    const payment = await settledPaymentFor(order.id);
    if (!payment) throw conflict('Aucun paiement abouti ne couvre cette commande.');

    const remaining = await refundableAmount(order.id);
    const amount = roundTo(request.amount ? money(request.amount) : remaining, order.currency);
    if (!amount.greaterThan(0)) throw badRequest('Le montant du remboursement doit être supérieur à zéro.');
    if (amount.greaterThan(remaining)) {
      throw badRequest(`Montant trop élevé : il reste ${remaining.toString()} ${order.currency} remboursables sur cette commande.`);
    }
    // Second plafond : le paiement lui-même (cas d'un paiement de groupe).
    if (payment.refundedAmount.plus(amount).greaterThan(payment.amount)) {
      throw badRequest('Le montant remboursé dépasserait le montant réellement encaissé.');
    }

    // Trace la demande AVANT l'appel externe : un remboursement parti chez le
    // prestataire sans trace en base serait de l'argent perdu de vue.
    const pending = await prisma.toumaRefund.create({
      data: {
        reference: refundReference(),
        orderId: order.id,
        paymentId: payment.id,
        returnRequestId: request.returnRequestId ?? null,
        amount,
        currency: order.currency,
        status: 'PROCESSING',
        reason: request.reason ?? '',
        provider: payment.provider,
        initiatedById: request.actorId,
      },
    });

    // Vérification après écriture : deux remboursements lancés au même instant
    // auraient tous deux vu le même solde. La ligne créée ci-dessus les rend
    // visibles l'un à l'autre — celui qui fait déborder le total s'annule.
    if ((await refundedTotal(order.id)).greaterThan(order.total)) {
      await prisma.toumaRefund.update({
        where: { id: pending.id },
        data: { status: 'FAILED', failureReason: 'Un autre remboursement a épuisé le solde de cette commande.' },
      });
      throw conflict('Un autre remboursement vient d’épuiser le solde de cette commande.');
    }

    let providerRef: string | null = null;
    try {
      const provider = getPaymentProvider(payment.provider);
      const result = await provider.refundPayment(payment.providerRef ?? payment.id, amount.toString());
      providerRef = result.providerRef;
    } catch (err) {
      const failure = err instanceof Error ? err.message : 'Échec du remboursement.';
      await prisma.toumaRefund.update({
        where: { id: pending.id },
        data: { status: 'FAILED', failureReason: failure },
      });
      throw conflict(`Le prestataire a refusé le remboursement : ${failure}`);
    }

    const orderFullyRefunded = (await refundedTotal(order.id)).greaterThanOrEqualTo(order.total);

    const refund = await prisma.$transaction(async (tx) => {
      const done = await tx.toumaRefund.update({
        where: { id: pending.id },
        data: { status: 'COMPLETED', providerRef, processedAt: new Date() },
      });

      // Incrément atomique, jamais une valeur absolue calculée depuis une
      // lecture d'avant l'appel au prestataire. Deux remboursements partiels
      // simultanés lisaient tous deux le même cumul et s'écrasaient l'un
      // l'autre : le paiement finissait par porter le montant du dernier, pas
      // la somme.
      const compte = await tx.toumaPayment.update({
        where: { id: payment.id },
        data: { refundedAmount: { increment: amount } },
        select: { refundedAmount: true, amount: true },
      });
      // Le statut se décide sur la valeur relue après incrément, pas avant.
      await tx.toumaPayment.update({
        where: { id: payment.id },
        data: {
          status: compte.refundedAmount.greaterThanOrEqualTo(compte.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        },
      });
      await tx.toumaPaymentEvent.create({
        data: {
          paymentId: payment.id,
          type: 'payment.refunded',
          payload: { refundId: done.id, orderId: order.id, amount: amount.toString(), currency: order.currency } as object,
        },
      });

      // Contre-passation de la commission, au prorata du montant remboursé.
      const commissions = await tx.toumaCommission.findMany({ where: { orderId: order.id } });
      const netCommission = commissions.reduce((acc, c) => acc.plus(c.amount), new Prisma.Decimal(0));
      let commissionReversed = new Prisma.Decimal(0);
      if (netCommission.greaterThan(0)) {
        const share = order.total.greaterThan(0) ? amount.dividedBy(order.total) : new Prisma.Decimal(0);
        const reversal = roundTo(netCommission.times(share), order.currency);
        const capped = reversal.greaterThan(netCommission) ? netCommission : reversal;
        commissionReversed = capped;
        if (capped.greaterThan(0)) {
          await tx.toumaCommission.create({
            data: {
              orderId: order.id,
              storeId: order.storeId,
              rate: new Prisma.Decimal(env.touma.commissionRate.toString()),
              amount: capped.negated(),
              currency: order.currency,
            },
          });
        }
      }

      // La part de règlement suit : ce qui est remboursé n'est plus dû au
      // vendeur. Sans cela, un remboursement laisserait la boutique créditée de
      // l'argent rendu à l'acheteur — le défaut même que la convergence des
      // deux moteurs vient de corriger, une couche plus haut.
      await applyRefundToAllocation(order.id, amount, tx);

      // Registre : le remboursement part de la boutique, la commission lui
      // revient. Deux lignes de sens opposé — les fondre en une seule
      // masquerait l'un des deux mouvements.
      await recordRefund(
        { id: done.id, storeId: order.storeId, amount, commissionReversed, currency: order.currency },
        tx,
      );

      if (orderFullyRefunded && order.status !== 'REFUNDED') {
        await tx.toumaOrder.update({ where: { id: order.id }, data: { status: 'REFUNDED' } });
        if (order.groupId) {
          const siblings = await tx.toumaOrder.findMany({ where: { groupId: order.groupId }, select: { status: true } });
          if (siblings.every((o) => o.status === 'REFUNDED')) {
            await tx.toumaOrderGroup.update({ where: { id: order.groupId }, data: { status: 'REFUNDED' } });
          }
        }
      }
      return done;
    });

    // Avoir : un remboursement corrige une facture, il ne la réécrit pas.
    await documentService.issueCreditNoteForRefund(refund.id);

    // Rembourser une commande reprend les points qu'elle avait rapportés, au
    // prorata : sans cela, un remboursement reviendrait à offrir ses points.
    const refundedForOrder = await refundedTotal(order.id);
    const ratio = order.total.greaterThan(0) ? Number(refundedForOrder.dividedBy(order.total).toString()) : 1;
    await loyaltyService.reverseForOrder(order.id, ratio);

    await audit({
      actorId: request.actorId,
      action: 'order.refund',
      entity: 'ToumaOrder',
      entityId: order.id,
      metadata: {
        refundId: refund.id,
        amount: amount.toString(),
        currency: order.currency,
        returnRequestId: request.returnRequestId ?? null,
        fullyRefunded: orderFullyRefunded,
      },
    });

    await notify({
      userId: order.buyerId,
      type: 'ORDER_STATUS_CHANGED',
      title: `Remboursement de la commande ${order.orderNumber}`,
      body: `${amount.toString()} ${order.currency} vous ont été remboursés.`,
      data: { orderId: order.id, refundId: refund.id, amount: amount.toString(), currency: order.currency },
    });

    return {
      id: refund.id,
      reference: refund.reference,
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: refund.amount.toString(),
      currency: refund.currency,
      status: refund.status,
      providerRef: refund.providerRef,
      processedAt: refund.processedAt,
      orderFullyRefunded,
    };
  },

  /** Historique des remboursements d'une commande. */
  async listForOrder(orderId: string) {
    const rows = await prisma.toumaRefund.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      amount: r.amount.toString(),
      currency: r.currency,
      status: r.status,
      reason: r.reason,
      returnRequestId: r.returnRequestId,
      createdAt: r.createdAt,
      processedAt: r.processedAt,
      failureReason: r.failureReason,
    }));
  },
};

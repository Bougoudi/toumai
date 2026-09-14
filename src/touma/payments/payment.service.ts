import { Prisma, type PaymentStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { refreshGroupStatus } from '../orders/group-status.js';
import { recordSale } from '../finance/ledger.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import { documentService } from '../documents/document.service.js';
import { codAvailability, openCashCollection } from './cod.service.js';
import { MockPaymentProvider } from './providers/mock.provider.js';
import type { PaymentMethod, PaymentProvider, ProviderPaymentStatus } from './payment.types.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/** Registre des prestataires. Raccorder un PSP = enregistrer un adaptateur. */
const providers = new Map<string, PaymentProvider>();

export function registerPaymentProvider(provider: PaymentProvider): void {
  providers.set(provider.code, provider);
}

registerPaymentProvider(new MockPaymentProvider());

/**
 * Prestataire enregistré sous ce code, ou celui configuré par le serveur.
 * Aucun repli silencieux : un code inconnu lève une erreur explicite. Retomber
 * en douce sur l'adaptateur de démonstration en production reviendrait à
 * encaisser des commandes sans jamais les faire payer.
 */
export function getPaymentProvider(code?: string): PaymentProvider {
  const wanted = code ?? env.touma.paymentProvider;
  const provider = providers.get(wanted);
  if (!provider) throw new Error(`Prestataire de paiement inconnu : « ${wanted} ».`);
  return provider;
}

/** Traduction statut prestataire → statut Touma. */
function toPaymentStatus(status: ProviderPaymentStatus): PaymentStatus {
  return status as PaymentStatus;
}

/**
 * Applique le succès d'un paiement : commandes payées, commissions
 * enregistrées, notifications envoyées.
 *
 * Un paiement couvre soit une commande unique, soit un **groupe** de commandes
 * (panier multi-vendeurs, payé en une fois). Dans les deux cas l'opération est
 * idempotente : rejouer un webhook ne double ni les commandes ni les commissions.
 */
/**
 * Applique la réussite d'un paiement : registre, commission, documents,
 * notifications. Exporté parce que l'encaissement à la livraison doit passer
 * par **ce** chemin et pas par un second — deux entrées au registre, c'est deux
 * occasions de diverger.
 */
export async function applySuccess(paymentId: string, providerRef: string | null, metadata: Record<string, unknown> = {}) {
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.toumaPayment.findUnique({
      where: { id: paymentId },
      include: {
        order: { include: { store: true } },
        orderGroup: { include: { orders: { include: { store: true } } } },
      },
    });
    if (!payment) throw notFound('Paiement introuvable.');

    // Commandes couvertes par ce paiement.
    const orders = payment.orderGroup ? payment.orderGroup.orders : payment.order ? [payment.order] : [];
    if (orders.length === 0) throw notFound('Paiement sans commande rattachée.');

    if (payment.status === 'SUCCEEDED') return { payment, orders, alreadyApplied: true };

    const updated = await tx.toumaPayment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCEEDED',
        providerRef: providerRef ?? payment.providerRef,
        succeededAt: new Date(),
        metadata: { ...(payment.metadata as object), ...metadata } as object,
      },
    });

    for (const order of orders) {
      // La commande passe à PAID uniquement depuis PENDING (jamais en arrière).
      if (order.status === 'PENDING') {
        await tx.toumaOrder.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: new Date() } });
      }
      // Registre : la vente et la commission laissent chacune leur ligne. Écrit
      // dans la même transaction que le paiement — un mouvement d'argent qui
      // n'apparaîtrait pas au registre serait exactement le trou qu'on cherche
      // à éviter.
      await recordSale(
        { id: order.id, storeId: order.storeId, total: order.total, commissionTotal: order.commissionTotal, currency: order.currency },
        tx,
      );

      // Commission plateforme : enregistrée une seule fois par commande.
      const existingCommission = await tx.toumaCommission.count({ where: { orderId: order.id } });
      if (existingCommission === 0) {
        await tx.toumaCommission.create({
          data: {
            orderId: order.id,
            storeId: order.storeId,
            rate: new Prisma.Decimal(env.touma.commissionRate.toString()),
            amount: order.commissionTotal,
            currency: order.currency,
          },
        });
      }
    }

    if (payment.orderGroup) {
      await tx.toumaOrderGroup.update({
        where: { id: payment.orderGroup.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
      // Puis on laisse le calcul faire autorité : si une sous-commande avait
      // déjà été annulée, le groupe ne doit pas prétendre être simplement
      // « payé ».
      await refreshGroupStatus(payment.orderGroup.id, tx);
    }

    return { payment: updated, orders, alreadyApplied: false };
  });

  if (!result.alreadyApplied) {
    const notifications = result.orders.flatMap((order) => [
      notify({
        userId: order.buyerId,
        type: 'PAYMENT_SUCCEEDED' as const,
        title: 'Paiement confirmé',
        body: `Le paiement de la commande ${order.orderNumber} a été confirmé.`,
        data: { orderId: order.id, paymentId: result.payment.id },
      }),
      notify({
        userId: order.store.ownerId,
        type: 'NEW_ORDER_FOR_SELLER' as const,
        title: 'Nouvelle commande payée',
        body: `Commande ${order.orderNumber} payée : préparez l'expédition.`,
        data: { orderId: order.id },
      }),
    ]);
    // Documents commerciaux : une facture par boutique (c'est elle qui vend) et
    // un reçu du paiement encaissé par TOUMA. Émission idempotente.
    await Promise.all([
      ...result.orders.map((order) => documentService.issueInvoiceForOrder(order.id)),
      documentService.issueReceiptForPayment(result.payment.id),
    ]);

    await Promise.all([
      ...notifications,
      audit({
        actorId: null,
        action: 'payment.succeeded',
        entity: 'ToumaPayment',
        entityId: result.payment.id,
        metadata: {
          orders: result.orders.map((o) => o.id),
          amount: result.payment.amount.toString(),
          currency: result.payment.currency,
        },
      }),
    ]);
  }
  return result.payment;
}

export const paymentService = {
  listProviders() {
    return [...providers.values()].map((p) => ({ code: p.code, name: p.name, methods: p.methods }));
  },

  /**
   * Crée l'intention de paiement d'une commande.
   * `idempotencyKey` garantit qu'un double clic ne crée pas deux paiements.
   */
  async create(
    user: ToumaRequestUser,
    input: { orderId?: string; orderGroupId?: string; method: PaymentMethod; idempotencyKey?: string; returnUrl?: string },
  ) {
    if (!input.orderId && !input.orderGroupId) throw badRequest('Indiquez la commande ou le groupe à régler.');

    // Cible du paiement : un groupe (panier multi-vendeurs) ou une commande seule.
    const group = input.orderGroupId
      ? await prisma.toumaOrderGroup.findUnique({ where: { id: input.orderGroupId }, include: { orders: true, payments: true } })
      : null;
    const order = !group && input.orderId
      ? await prisma.toumaOrder.findUnique({ where: { id: input.orderId }, include: { payments: true, group: { include: { orders: true, payments: true } } } })
      : null;

    if (!group && !order) throw notFound('Commande introuvable.');

    // Une commande appartenant à un groupe se règle au niveau du groupe :
    // l'acheteur paie une seule fois pour tout son panier.
    const target = group ?? order?.group ?? null;
    const buyerId = target?.buyerId ?? order!.buyerId;
    if (buyerId !== user.id && user.role !== 'ADMIN') throw notFound('Commande introuvable.');

    const coveredOrders = target ? target.orders : [order!];
    const pending = coveredOrders.filter((o) => o.status !== 'PENDING');
    if (pending.length > 0) {
      throw conflict(`La commande ${pending[0].orderNumber} n'attend pas de paiement (statut ${pending[0].status}).`);
    }

    const currency = coveredOrders[0].currency;
    const amount = target
      ? new Prisma.Decimal(target.total)
      : new Prisma.Decimal(order!.total);

    const key = input.idempotencyKey ? `${user.id}:${input.idempotencyKey}` : null;
    if (key) {
      const existing = await prisma.toumaPayment.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        return { payment: existing, checkoutUrl: (existing.metadata as { checkoutUrl?: string }).checkoutUrl ?? null, idempotent: true as const };
      }
    }
    const existingPayments = target ? target.payments : order!.payments;
    const inFlight = existingPayments.find((p) => p.status === 'PENDING' || p.status === 'PROCESSING');
    if (inFlight) {
      return { payment: inFlight, checkoutUrl: (inFlight.metadata as { checkoutUrl?: string }).checkoutUrl ?? null, idempotent: true as const };
    }

    // Le prestataire vient de la configuration du serveur, jamais de la requête :
    // laisser le client le choisir lui permettrait de désigner un adaptateur de
    // démonstration et de valider lui-même son paiement.
    const provider = getPaymentProvider();
    if (!provider.methods.includes(input.method)) {
      throw badRequest(`Le prestataire ${provider.code} ne propose pas la méthode ${input.method}.`);
    }

    // Le paiement à la livraison n'est pas une méthode comme les autres :
    // encaisser du liquide engage un vendeur et un livreur, et cela ne s'ouvre
    // pas par défaut. Fermé tant qu'aucune règle ne l'autorise (§26).
    if (input.method === 'CASH_ON_DELIVERY') {
      // La destination décide : c'est là que le livreur devra encaisser.
      const addressId = coveredOrders[0].shippingAddressId;
      const destination = addressId
        ? await prisma.toumaAddress.findUnique({ where: { id: addressId }, select: { countryCode: true, provinceId: true } })
        : null;
      if (!destination) {
        throw badRequest('Le paiement à la livraison demande une adresse de livraison connue.');
      }
      const ouverture = await codAvailability({
        countryCode: destination.countryCode,
        provinceId: destination.provinceId,
        storeIds: coveredOrders.map((o) => o.storeId),
        amount,
      });
      if (!ouverture.allowed) throw badRequest(ouverture.reason ?? 'Paiement à la livraison indisponible.');
    }
    const buyer = await prisma.user.findUniqueOrThrow({
      where: { id: buyerId },
      select: { id: true, email: true, name: true, phone: true, countryCode: true },
    });
    const reference = target ? target.reference : order!.orderNumber;

    const created = await provider.createPayment({
      reference,
      amount: amount.toString(),
      currency,
      method: input.method,
      customer: buyer,
      returnUrl: input.returnUrl,
      metadata: { orderGroupId: target?.id ?? null, orderId: target ? null : order!.id },
    });

    const payment = await prisma.toumaPayment.create({
      data: {
        orderId: target ? null : order!.id,
        orderGroupId: target?.id ?? null,
        provider: provider.code,
        providerRef: created.providerRef,
        method: input.method,
        status: toPaymentStatus(created.status),
        amount,
        currency,
        idempotencyKey: key,
        // Aucune donnée bancaire : uniquement des références et instructions publiques.
        metadata: { checkoutUrl: created.checkoutUrl ?? null, instructions: created.instructions ?? {} } as object,
      },
    });
    // Paiement à la livraison : on ouvre le suivi du montant à collecter. Sans
    // lui, personne ne sait combien le livreur doit rapporter — c'est
    // exactement l'exigence du §28.
    if (input.method === 'CASH_ON_DELIVERY') {
      await openCashCollection(payment.id, amount, currency);
    }

    await prisma.toumaPaymentEvent.create({
      data: { paymentId: payment.id, type: 'payment.created', payload: { providerRef: created.providerRef, status: created.status } as object },
    });
    await audit({
      actorId: user.id,
      action: 'payment.create',
      entity: 'ToumaPayment',
      entityId: payment.id,
      metadata: { orderGroupId: target?.id ?? null, orders: coveredOrders.map((o) => o.id) },
    });

    return { payment, checkoutUrl: created.checkoutUrl ?? null, idempotent: false as const };
  },

  /**
   * Confirme un paiement **côté serveur**. Le client ne décide jamais qu'un
   * paiement a réussi : Touma interroge le prestataire et applique son verdict.
   */
  async confirm(user: ToumaRequestUser, input: { paymentId: string; payload?: Record<string, unknown> }) {
    const payment = await prisma.toumaPayment.findUnique({
      where: { id: input.paymentId },
      include: { order: true, orderGroup: { include: { orders: true } } },
    });
    if (!payment) throw notFound('Paiement introuvable.');
    const coveredOrders = payment.orderGroup ? payment.orderGroup.orders : payment.order ? [payment.order] : [];
    const buyerId = payment.orderGroup?.buyerId ?? payment.order?.buyerId;
    if (buyerId !== user.id && user.role !== 'ADMIN') throw notFound('Paiement introuvable.');
    if (payment.status === 'SUCCEEDED') return payment;
    if (['FAILED', 'CANCELLED', 'REFUNDED'].includes(payment.status)) {
      throw conflict(`Ce paiement est déjà au statut ${payment.status}.`);
    }

    // **Un paiement à la livraison ne se confirme pas ici.** C'était le défaut :
    // l'adaptateur répondait SUCCEEDED comme pour n'importe quelle méthode, et
    // la commande passait à « payée » avant qu'un franc ait été collecté. Il
    // n'entre au registre qu'au moment où un vendeur constate la remise, et
    // c'est une autre route.
    if (payment.method === 'CASH_ON_DELIVERY') {
      throw conflict(
        'Un paiement à la livraison se constate à la remise de l’argent, par le vendeur : POST /payments/:id/cash/collect.',
      );
    }

    const provider = getPaymentProvider(payment.provider);
    const result = await provider.confirmPayment(payment.providerRef ?? payment.id, input.payload);
    await prisma.toumaPaymentEvent.create({
      data: { paymentId: payment.id, type: `payment.${result.status.toLowerCase()}`, payload: { ...result } as object },
    });

    if (result.status === 'SUCCEEDED') return applySuccess(payment.id, result.providerRef, result.metadata ?? {});

    const updated = await prisma.toumaPayment.update({
      where: { id: payment.id },
      data: { status: toPaymentStatus(result.status), failureReason: result.failureReason ?? null },
    });
    if (result.status === 'FAILED' && buyerId) {
      const references = coveredOrders.map((o) => o.orderNumber).join(', ');
      await Promise.all([
        notify({
          userId: buyerId,
          type: 'PAYMENT_FAILED',
          title: 'Paiement refusé',
          body: `Le paiement de la commande ${references} a échoué : ${result.failureReason ?? 'raison inconnue'}.`,
          data: { orderGroupId: payment.orderGroupId, orderId: payment.orderId },
        }),
        // Signal de risque : les échecs répétés nourrissent le score (Touma Risk).
        prisma.toumaFraudEvent.create({
          data: { userId: buyerId, code: 'PAYMENT_FAILED', weight: 3, detail: { orderGroupId: payment.orderGroupId } as object },
        }),
      ]);
    }
    return updated;
  },

  /**
   * Webhook prestataire : la signature est vérifiée sur le corps **brut** et
   * chaque événement n'est traité qu'une fois (contrainte d'unicité `externalId`).
   */
  async handleWebhook(providerCode: string, rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const provider = getPaymentProvider(providerCode);
    const verification = provider.verifyWebhook(rawBody, headers);
    if (!verification.valid) {
      logger.error('Webhook de paiement rejeté : signature invalide', { provider: provider.code });
      throw forbidden('Signature de webhook invalide.');
    }
    if (!verification.providerRef) throw badRequest('Webhook sans référence de paiement.');

    const payment = await prisma.toumaPayment.findFirst({ where: { provider: provider.code, providerRef: verification.providerRef } });
    if (!payment) throw notFound('Paiement inconnu pour ce webhook.');

    // Anti-rejeu : un même événement prestataire n'est appliqué qu'une seule fois.
    if (verification.eventId) {
      const seen = await prisma.toumaPaymentEvent.findUnique({ where: { externalId: verification.eventId } });
      if (seen) return { duplicate: true as const, paymentId: payment.id };
    }
    await prisma.toumaPaymentEvent.create({
      data: {
        paymentId: payment.id,
        type: verification.type,
        externalId: verification.eventId,
        payload: (verification.raw ?? {}) as object,
      },
    });

    if (verification.status === 'SUCCEEDED') {
      await applySuccess(payment.id, verification.providerRef);
    } else if (verification.status) {
      await prisma.toumaPayment.update({ where: { id: payment.id }, data: { status: toPaymentStatus(verification.status) } });
    }
    return { duplicate: false as const, paymentId: payment.id };
  },

  /** Détail d'un paiement (acheteur, vendeur de la commande, ou admin). */
  async get(user: ToumaRequestUser, paymentId: string) {
    const payment = await prisma.toumaPayment.findUnique({
      where: { id: paymentId },
      include: {
        order: { include: { store: { select: { ownerId: true, name: true } } } },
        orderGroup: { include: { orders: { include: { store: { select: { ownerId: true } } } } } },
        events: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!payment) throw notFound('Paiement introuvable.');
    const orders = payment.orderGroup ? payment.orderGroup.orders : payment.order ? [payment.order] : [];
    const buyerId = payment.orderGroup?.buyerId ?? payment.order?.buyerId;
    const allowed = buyerId === user.id || orders.some((o) => o.store.ownerId === user.id) || user.role === 'ADMIN';
    if (!allowed) throw notFound('Paiement introuvable.');
    return {
      id: payment.id,
      orderId: payment.orderId,
      orderGroupId: payment.orderGroupId,
      reference: payment.orderGroup?.reference ?? payment.order?.orderNumber ?? null,
      orderNumbers: orders.map((o) => o.orderNumber),
      provider: payment.provider,
      providerRef: payment.providerRef,
      method: payment.method,
      status: payment.status,
      amount: payment.amount.toString(),
      currency: payment.currency,
      refundedAmount: payment.refundedAmount.toString(),
      createdAt: payment.createdAt,
      succeededAt: payment.succeededAt,
      events: payment.events.map((e) => ({ id: e.id, type: e.type, createdAt: e.createdAt })),
    };
  },

  /** Remboursement (administration ou résolution de litige). */
  async refund(actor: ToumaRequestUser, paymentId: string, amount?: string) {
    if (actor.role !== 'ADMIN') throw forbidden('Le remboursement est réservé à l’administration Touma.');
    const payment = await prisma.toumaPayment.findUnique({
      where: { id: paymentId },
      include: { order: true, orderGroup: { include: { orders: true } } },
    });
    if (!payment) throw notFound('Paiement introuvable.');
    if (payment.status !== 'SUCCEEDED' && payment.status !== 'PARTIALLY_REFUNDED') {
      throw conflict('Seul un paiement abouti peut être remboursé.');
    }
    const refundAmount = new Prisma.Decimal(amount ?? payment.amount.toString());
    const alreadyRefunded = payment.refundedAmount;
    if (alreadyRefunded.plus(refundAmount).greaterThan(payment.amount)) {
      throw badRequest('Le montant remboursé dépasserait le montant payé.');
    }

    const provider = getPaymentProvider(payment.provider);
    const result = await provider.refundPayment(payment.providerRef ?? payment.id, refundAmount.toString());
    const totalRefunded = alreadyRefunded.plus(refundAmount);
    const fullyRefunded = totalRefunded.equals(payment.amount);

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.toumaPayment.update({
        where: { id: payment.id },
        data: { refundedAmount: totalRefunded, status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
      });
      await tx.toumaPaymentEvent.create({ data: { paymentId: payment.id, type: 'payment.refunded', payload: { ...result } as object } });
      if (fullyRefunded) {
        // Un remboursement intégral concerne toutes les commandes couvertes.
        const orderIds = payment.orderGroup ? payment.orderGroup.orders.map((o) => o.id) : payment.orderId ? [payment.orderId] : [];
        await tx.toumaOrder.updateMany({ where: { id: { in: orderIds } }, data: { status: 'REFUNDED' } });
        if (payment.orderGroupId) {
          await tx.toumaOrderGroup.update({ where: { id: payment.orderGroupId }, data: { status: 'REFUNDED' } });
        }
      }
      return p;
    });
    await audit({
      actorId: actor.id,
      action: 'payment.refund',
      entity: 'ToumaPayment',
      entityId: payment.id,
      metadata: { amount: refundAmount.toString(), currency: payment.currency, orderId: payment.orderId, orderGroupId: payment.orderGroupId },
    });
    return updated;
  },
};

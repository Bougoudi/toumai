import { Prisma, type PaymentStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import { MockPaymentProvider } from './providers/mock.provider.js';
import type { PaymentMethod, PaymentProvider, ProviderPaymentStatus } from './payment.types.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/** Registre des prestataires. Raccorder un PSP = enregistrer un adaptateur. */
const providers = new Map<string, PaymentProvider>();

export function registerPaymentProvider(provider: PaymentProvider): void {
  providers.set(provider.code, provider);
}

registerPaymentProvider(new MockPaymentProvider());

export function getPaymentProvider(code?: string): PaymentProvider {
  const provider = providers.get(code ?? env.touma.paymentProvider) ?? providers.get('mock');
  if (!provider) throw new Error('Aucun prestataire de paiement enregistré.');
  return provider;
}

/** Traduction statut prestataire → statut Touma. */
function toPaymentStatus(status: ProviderPaymentStatus): PaymentStatus {
  return status as PaymentStatus;
}

/**
 * Applique le succès d'un paiement : commande payée, commission enregistrée,
 * notifications. Idempotent : rejouer l'opération ne double ni la commande ni
 * la commission (contrôle du statut courant dans la transaction).
 */
async function applySuccess(paymentId: string, providerRef: string | null, metadata: Record<string, unknown> = {}) {
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.toumaPayment.findUnique({ where: { id: paymentId }, include: { order: { include: { store: true } } } });
    if (!payment) throw notFound('Paiement introuvable.');
    if (payment.status === 'SUCCEEDED') return { payment, order: payment.order, alreadyApplied: true };

    const updated = await tx.toumaPayment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCEEDED',
        providerRef: providerRef ?? payment.providerRef,
        succeededAt: new Date(),
        metadata: { ...(payment.metadata as object), ...metadata } as object,
      },
    });

    // La commande passe à PAID uniquement depuis PENDING (jamais en arrière).
    if (payment.order.status === 'PENDING') {
      await tx.toumaOrder.update({ where: { id: payment.orderId }, data: { status: 'PAID', paidAt: new Date() } });
    }

    // Commission plateforme : enregistrée une seule fois par commande.
    const existingCommission = await tx.toumaCommission.count({ where: { orderId: payment.orderId } });
    if (existingCommission === 0) {
      await tx.toumaCommission.create({
        data: {
          orderId: payment.orderId,
          storeId: payment.order.storeId,
          rate: new Prisma.Decimal(env.touma.commissionRate.toString()),
          amount: payment.order.commissionTotal,
          currency: payment.order.currency,
        },
      });
    }
    return { payment: updated, order: payment.order, alreadyApplied: false };
  });

  if (!result.alreadyApplied) {
    await Promise.all([
      notify({
        userId: result.order.buyerId,
        type: 'PAYMENT_SUCCEEDED',
        title: 'Paiement confirmé',
        body: `Le paiement de la commande ${result.order.orderNumber} a été confirmé.`,
        data: { orderId: result.order.id, paymentId: result.payment.id },
      }),
      notify({
        userId: result.order.store.ownerId,
        type: 'NEW_ORDER_FOR_SELLER',
        title: 'Nouvelle commande payée',
        body: `Commande ${result.order.orderNumber} payée : préparez l'expédition.`,
        data: { orderId: result.order.id },
      }),
      audit({
        actorId: null,
        action: 'payment.succeeded',
        entity: 'ToumaPayment',
        entityId: result.payment.id,
        metadata: { orderId: result.order.id, amount: result.payment.amount.toString(), currency: result.payment.currency },
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
  async create(user: ToumaRequestUser, input: { orderId: string; method: PaymentMethod; provider?: string; idempotencyKey?: string; returnUrl?: string }) {
    const order = await prisma.toumaOrder.findUnique({ where: { id: input.orderId }, include: { payments: true } });
    if (!order) throw notFound('Commande introuvable.');
    if (order.buyerId !== user.id && user.role !== 'ADMIN') throw notFound('Commande introuvable.');
    if (order.status !== 'PENDING') throw conflict(`La commande ${order.orderNumber} n'attend pas de paiement (statut ${order.status}).`);

    const key = input.idempotencyKey ? `${user.id}:${input.idempotencyKey}` : null;
    if (key) {
      const existing = await prisma.toumaPayment.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        return { payment: existing, checkoutUrl: (existing.metadata as { checkoutUrl?: string }).checkoutUrl ?? null, idempotent: true as const };
      }
    }
    const pending = order.payments.find((p) => p.status === 'PENDING' || p.status === 'PROCESSING');
    if (pending) {
      return { payment: pending, checkoutUrl: (pending.metadata as { checkoutUrl?: string }).checkoutUrl ?? null, idempotent: true as const };
    }

    const provider = getPaymentProvider(input.provider);
    if (!provider.methods.includes(input.method)) {
      throw badRequest(`Le prestataire ${provider.code} ne propose pas la méthode ${input.method}.`);
    }
    const buyer = await prisma.user.findUniqueOrThrow({ where: { id: order.buyerId }, select: { id: true, email: true, name: true, phone: true, countryCode: true } });

    const created = await provider.createPayment({
      reference: order.orderNumber,
      amount: order.total.toString(),
      currency: order.currency,
      method: input.method,
      customer: buyer,
      returnUrl: input.returnUrl,
      metadata: { orderId: order.id },
    });

    const payment = await prisma.toumaPayment.create({
      data: {
        orderId: order.id,
        provider: provider.code,
        providerRef: created.providerRef,
        method: input.method,
        status: toPaymentStatus(created.status),
        amount: order.total,
        currency: order.currency,
        idempotencyKey: key,
        // Aucune donnée bancaire : uniquement des références et instructions publiques.
        metadata: { checkoutUrl: created.checkoutUrl ?? null, instructions: created.instructions ?? {} } as object,
      },
    });
    await prisma.toumaPaymentEvent.create({
      data: { paymentId: payment.id, type: 'payment.created', payload: { providerRef: created.providerRef, status: created.status } as object },
    });
    await audit({ actorId: user.id, action: 'payment.create', entity: 'ToumaPayment', entityId: payment.id, metadata: { orderId: order.id } });

    return { payment, checkoutUrl: created.checkoutUrl ?? null, idempotent: false as const };
  },

  /**
   * Confirme un paiement **côté serveur**. Le client ne décide jamais qu'un
   * paiement a réussi : Touma interroge le prestataire et applique son verdict.
   */
  async confirm(user: ToumaRequestUser, input: { paymentId: string; payload?: Record<string, unknown> }) {
    const payment = await prisma.toumaPayment.findUnique({ where: { id: input.paymentId }, include: { order: true } });
    if (!payment) throw notFound('Paiement introuvable.');
    if (payment.order.buyerId !== user.id && user.role !== 'ADMIN') throw notFound('Paiement introuvable.');
    if (payment.status === 'SUCCEEDED') return payment;
    if (['FAILED', 'CANCELLED', 'REFUNDED'].includes(payment.status)) {
      throw conflict(`Ce paiement est déjà au statut ${payment.status}.`);
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
    if (result.status === 'FAILED') {
      await Promise.all([
        notify({
          userId: payment.order.buyerId,
          type: 'PAYMENT_FAILED',
          title: 'Paiement refusé',
          body: `Le paiement de la commande ${payment.order.orderNumber} a échoué : ${result.failureReason ?? 'raison inconnue'}.`,
          data: { orderId: payment.orderId },
        }),
        // Signal de risque : les échecs répétés nourrissent le score (Touma Risk).
        prisma.toumaFraudEvent.create({
          data: { userId: payment.order.buyerId, code: 'PAYMENT_FAILED', weight: 3, detail: { orderId: payment.orderId } as object },
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
      include: { order: { include: { store: { select: { ownerId: true, name: true } } } }, events: { orderBy: { createdAt: 'desc' } } },
    });
    if (!payment) throw notFound('Paiement introuvable.');
    const allowed = payment.order.buyerId === user.id || payment.order.store.ownerId === user.id || user.role === 'ADMIN';
    if (!allowed) throw notFound('Paiement introuvable.');
    return {
      id: payment.id,
      orderId: payment.orderId,
      orderNumber: payment.order.orderNumber,
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
    const payment = await prisma.toumaPayment.findUnique({ where: { id: paymentId }, include: { order: true } });
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
        await tx.toumaOrder.update({ where: { id: payment.orderId }, data: { status: 'REFUNDED' } });
      }
      return p;
    });
    await audit({
      actorId: actor.id,
      action: 'payment.refund',
      entity: 'ToumaPayment',
      entityId: payment.id,
      metadata: { amount: refundAmount.toString(), currency: payment.currency, orderId: payment.orderId },
    });
    return updated;
  },
};

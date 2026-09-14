import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * Paiement à la livraison.
 *
 * **Le défaut corrigé.** `CASH_ON_DELIVERY` était accepté comme n'importe quelle
 * autre méthode, et l'adaptateur de démonstration le confirmait `SUCCEEDED`.
 * Dans l'ordre où cela se produisait : la commande passait à « payée », la
 * facture et le reçu étaient émis, le vendeur recevait « commande payée :
 * préparez l'expédition », et la vente entrait au registre comptable — **avant
 * qu'un seul franc ait été collecté**.
 *
 * La règle tenue ici est celle du §28, et elle tient en une phrase : **une
 * commande payée à la livraison n'est jamais dite payée avant que l'argent ait
 * changé de mains**. La commande avance — elle est acceptée, préparée,
 * expédiée — mais l'argent n'entre au registre qu'au moment où quelqu'un le
 * constate, et ce quelqu'un est nommé.
 */

/** Ce qu'une décision d'ouverture dit, et pourquoi. */
export interface CodAvailability {
  allowed: boolean;
  /** Motif lisible quand c'est non. Un refus sans raison est incompréhensible. */
  reason?: string;
  /** Plafond appliqué, le cas échéant. */
  maxAmount?: string;
}

/**
 * Le paiement à la livraison est-il ouvert pour cette commande ?
 *
 * **Fermé par défaut.** Sans règle, la réponse est non : encaisser du liquide
 * engage un vendeur et un livreur, et cela ne s'active pas par oubli de
 * configuration. Le §80 va dans le même sens — ne jamais déclarer disponible ce
 * qui n'a pas été ouvert.
 *
 * La règle la plus précise l'emporte : boutique, puis province, puis pays. Une
 * règle qui interdit ferme, quelle que soit sa portée.
 */
export async function codAvailability(input: {
  countryCode: string;
  provinceId?: string | null;
  storeIds?: string[];
  categoryIds?: string[];
  amount: Prisma.Decimal | string;
}): Promise<CodAvailability> {
  const rules = await prisma.toumaCodRule.findMany({
    where: {
      active: true,
      countryCode: input.countryCode.toUpperCase(),
      OR: [
        { provinceId: null, storeId: null, categoryId: null },
        ...(input.provinceId ? [{ provinceId: input.provinceId }] : []),
        ...(input.storeIds?.length ? [{ storeId: { in: input.storeIds } }] : []),
        ...(input.categoryIds?.length ? [{ categoryId: { in: input.categoryIds } }] : []),
      ],
    },
  });

  if (rules.length === 0) {
    return { allowed: false, reason: 'Le paiement à la livraison n’est pas ouvert pour cette destination.' };
  }

  // Une interdiction l'emporte sur une autorisation : on ferme une province ou
  // une boutique sans avoir à défaire le reste.
  const interdiction = rules.find((r) => !r.allowed);
  if (interdiction) {
    return {
      allowed: false,
      reason: interdiction.note ?? 'Le paiement à la livraison n’est pas ouvert pour cette destination.',
    };
  }

  // Précision croissante : la règle de boutique prime sur la province, qui prime
  // sur le pays.
  const precision = (r: (typeof rules)[number]) => (r.storeId ? 3 : r.categoryId ? 2 : r.provinceId ? 1 : 0);
  const retenue = rules.slice().sort((a, b) => precision(b) - precision(a))[0];

  if (retenue.maxAmount) {
    const montant = new Prisma.Decimal(input.amount);
    if (montant.greaterThan(retenue.maxAmount)) {
      return {
        allowed: false,
        reason: `Le paiement à la livraison est limité à ${retenue.maxAmount.toString()} pour cette destination.`,
        maxAmount: retenue.maxAmount.toString(),
      };
    }
    return { allowed: true, maxAmount: retenue.maxAmount.toString() };
  }

  return { allowed: true };
}

/** Crée le suivi d'encaissement d'un paiement à la livraison. */
export async function openCashCollection(
  paymentId: string,
  amountDue: Prisma.Decimal | string,
  currency: string,
  tx: Prisma.TransactionClient = prisma,
) {
  return tx.toumaCashCollection.create({
    data: { paymentId, amountDue: new Prisma.Decimal(amountDue), currency, status: 'COD_PENDING' },
  });
}

/** Qui peut agir sur un encaissement : le vendeur concerné, ou l'administration. */
async function requireCollector(user: ToumaRequestUser, paymentId: string) {
  const payment = await prisma.toumaPayment.findUnique({
    where: { id: paymentId },
    include: {
      cashCollection: true,
      order: { include: { store: true } },
      orderGroup: { include: { orders: { include: { store: true } } } },
    },
  });
  if (!payment) throw notFound('Paiement introuvable.');
  if (!payment.cashCollection) throw badRequest('Ce paiement n’est pas un encaissement à la livraison.');

  const orders = payment.orderGroup ? payment.orderGroup.orders : payment.order ? [payment.order] : [];
  const vendeurs = new Set(orders.map((o) => o.store.ownerId));
  const acheteur = payment.orderGroup?.buyerId ?? payment.order?.buyerId;

  // L'acheteur voit son encaissement mais ne le constate jamais : déclarer
  // soi-même avoir payé n'est pas une preuve de paiement.
  if (user.role !== 'ADMIN' && !vendeurs.has(user.id)) {
    if (acheteur === user.id) throw forbidden('Seul le vendeur constate la remise de l’argent.');
    throw notFound('Paiement introuvable.');
  }

  return { payment, orders, collection: payment.cashCollection };
}

export const codService = {
  /** Lecture, pour les parties concernées. */
  async get(user: ToumaRequestUser, paymentId: string) {
    const { collection } = await requireCollector(user, paymentId);
    return { ...collection, amountDue: collection.amountDue.toString(), amountCollected: collection.amountCollected?.toString() ?? null };
  },

  /**
   * Le vendeur confirme qu'il prend en charge l'encaissement. Cela ne fait
   * entrer aucun argent : c'est un engagement, pas une recette.
   */
  async confirm(user: ToumaRequestUser, paymentId: string) {
    const { collection } = await requireCollector(user, paymentId);
    if (collection.status !== 'COD_PENDING') throw conflict(`Cet encaissement est au statut ${collection.status}.`);

    const updated = await prisma.toumaCashCollection.update({
      where: { id: collection.id },
      data: { status: 'COD_CONFIRMED' },
    });
    await audit({ actorId: user.id, action: 'cod.confirmed', entity: 'ToumaCashCollection', entityId: collection.id, metadata: {} });
    return { ...updated, amountDue: updated.amountDue.toString(), amountCollected: null };
  },

  /**
   * L'argent a été remis. C'est **ici seulement** que le paiement devient un
   * paiement : la vente entre au registre, la facture et le reçu sont émis.
   *
   * Le montant collecté est celui qui est constaté, et il ne peut pas dépasser
   * le montant dû — un encaissement supérieur à la commande n'est pas une bonne
   * nouvelle, c'est une erreur de saisie ou pire.
   */
  async collect(user: ToumaRequestUser, paymentId: string, input: { amount?: string; note?: string }) {
    const { collection, orders } = await requireCollector(user, paymentId);
    if (collection.status === 'COD_COLLECTED') throw conflict('Cet encaissement est déjà constaté.');
    if (collection.status === 'COD_FAILED') throw conflict('Cet encaissement a été déclaré en échec.');

    const montant = input.amount ? new Prisma.Decimal(input.amount) : collection.amountDue;
    if (montant.lessThanOrEqualTo(0)) throw badRequest('Le montant collecté doit être positif.');
    if (montant.greaterThan(collection.amountDue)) {
      throw badRequest(`Le montant collecté (${montant.toString()}) dépasse le montant dû (${collection.amountDue.toString()}).`);
    }

    const updated = await prisma.toumaCashCollection.update({
      where: { id: collection.id },
      data: {
        status: 'COD_COLLECTED',
        amountCollected: montant,
        collectedById: user.id,
        collectedAt: new Date(),
        note: input.note?.slice(0, 500) ?? null,
      },
    });

    await audit({
      actorId: user.id,
      action: 'cod.collected',
      entity: 'ToumaCashCollection',
      entityId: collection.id,
      metadata: { paymentId, amount: montant.toString(), orders: orders.map((o) => o.id) },
    });

    return {
      collection: { ...updated, amountDue: updated.amountDue.toString(), amountCollected: montant.toString() },
      /** Le service de paiement applique la réussite : c'est lui qui tient le registre. */
      shouldApplyPayment: true as const,
    };
  },

  /**
   * L'encaissement a échoué : refus au seuil de la porte, destinataire
   * introuvable. Aucun argent n'entre, et le motif reste au dossier — c'est lui
   * qui permettra de distinguer un incident d'un comportement répété.
   */
  async fail(user: ToumaRequestUser, paymentId: string, reason: string) {
    const { collection, payment } = await requireCollector(user, paymentId);
    if (collection.status === 'COD_COLLECTED') throw conflict('Cet encaissement est déjà constaté : il ne peut plus échouer.');
    if (!reason.trim()) throw badRequest('Un motif est requis.');

    const updated = await prisma.toumaCashCollection.update({
      where: { id: collection.id },
      data: { status: 'COD_FAILED', failureReason: reason.slice(0, 500) },
    });
    await prisma.toumaPayment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: reason.slice(0, 500) } });

    const acheteur = payment.orderGroup?.buyerId ?? payment.order?.buyerId;
    if (acheteur) {
      await notify({
        userId: acheteur,
        type: 'PAYMENT_FAILED',
        title: 'Encaissement à la livraison non abouti',
        body: 'La remise de l’argent n’a pas pu être constatée. Contactez l’assistance si vous pensez qu’il s’agit d’une erreur.',
        data: { paymentId: payment.id },
      });
    }

    await audit({ actorId: user.id, action: 'cod.failed', entity: 'ToumaCashCollection', entityId: collection.id, metadata: { reason: reason.slice(0, 200) } });
    return { ...updated, amountDue: updated.amountDue.toString(), amountCollected: null };
  },
};

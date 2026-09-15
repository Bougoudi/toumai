import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { notFound } from '../lib/errors.js';
import { codAvailability } from './cod.service.js';
import { getPaymentProvider } from './payment.service.js';
import type { PaymentMethod } from './payment.types.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * Moyens de paiement réellement proposables.
 *
 * Le §80 gouverne ce fichier entier : **ne jamais déclarer « paiement
 * disponible » si aucun prestataire réel n'est connecté**. Un adaptateur qui
 * existe dans le code n'est pas un moyen de paiement ouvert — la disponibilité
 * dépend du prestataire configuré, du pays, de la devise et, pour le paiement à
 * la livraison, d'une règle explicite.
 *
 * D'où la forme de la réponse : chaque méthode sort avec un `available` **et**
 * un motif quand c'est non. Une liste qui se contenterait de taire les méthodes
 * fermées laisserait l'interface inventer ses propres explications.
 */

/** Ce que l'adaptateur de démonstration est, et n'est pas. */
export interface ProviderStatus {
  code: string;
  name: string;
  /** Un prestataire agréé est-il raccordé ? */
  real: boolean;
  /** Peut-on s'en servir dans cet environnement ? */
  usable: boolean;
  message: string;
}

/**
 * État du prestataire configuré.
 *
 * `mock` est une **simulation**. Elle rend le parcours déroulable en
 * développement et en test, et elle est refusée en production : transformer une
 * simulation en prétendu paiement réel est exactement ce que le §52 interdit.
 */
export function providerStatus(): ProviderStatus {
  const code = env.touma.paymentProvider;
  let provider;
  try {
    provider = getPaymentProvider(code);
  } catch {
    return { code, name: code, real: false, usable: false, message: `Prestataire « ${code} » inconnu — configuration requise.` };
  }

  const real = code !== 'mock';
  if (!real) {
    return {
      code,
      name: provider.name,
      real: false,
      usable: env.nodeEnv !== 'production',
      message:
        env.nodeEnv === 'production'
          ? 'Provider réel non activé — configuration requise.'
          : 'Simulation de démonstration : aucun paiement réel n’est effectué.',
    };
  }
  return { code, name: provider.name, real: true, usable: true, message: `Paiements opérés par ${provider.name}.` };
}

export interface MethodAvailability {
  method: PaymentMethod;
  label: string;
  available: boolean;
  /** Pourquoi non. Un refus sans raison est incompréhensible pour l'acheteur. */
  reason?: string;
  /** Vrai quand la méthode ne débouche sur aucun mouvement d'argent réel. */
  simulated?: boolean;
  /** Plafond applicable, le cas échéant (paiement à la livraison). */
  maxAmount?: string;
}

const LABELS: Record<PaymentMethod, string> = {
  MOBILE_MONEY: 'Mobile Money',
  CARD: 'Carte bancaire',
  BANK_TRANSFER: 'Virement bancaire',
  CASH_ON_DELIVERY: 'Paiement à la livraison',
  MOCK: 'Paiement simulé (démonstration)',
};

export interface MethodsQuery {
  countryCode?: string | null;
  currency?: string | null;
  orderId?: string | null;
  orderGroupId?: string | null;
}

/**
 * Moyens proposables pour un contexte donné.
 *
 * Quand une commande est indiquée, le contexte en est déduit — pays de
 * livraison, province, boutiques, catégories, montant — parce que le paiement à
 * la livraison dépend de tout cela. Sans commande, la réponse reste générale et
 * le dit.
 */
export async function paymentMethodsFor(user: ToumaRequestUser, query: MethodsQuery) {
  const provider = providerStatus();

  let countryCode = query.countryCode?.toUpperCase() ?? null;
  let currency = query.currency?.toUpperCase() ?? null;
  let provinceId: string | null = null;
  let storeIds: string[] = [];
  let categoryIds: string[] = [];
  let amount: Prisma.Decimal | null = null;

  if (query.orderId || query.orderGroupId) {
    const orders = await ordersOf(user, query);
    countryCode = orders[0].buyerCountry ?? countryCode;
    currency = orders[0].currency;
    provinceId = orders[0].shippingAddress?.provinceId ?? null;
    storeIds = [...new Set(orders.map((o) => o.storeId))];
    categoryIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.product?.categoryId)).filter((c): c is string => Boolean(c)))];
    amount = orders.reduce((acc, o) => acc.plus(o.total), new Prisma.Decimal(0));
  }

  const methods: MethodAvailability[] = [];

  // Méthodes portées par le prestataire. Leur disponibilité est celle du
  // prestataire : sans lui, aucune n'est proposable, quoi qu'en dise le code.
  const supportees = (() => {
    try {
      return new Set(getPaymentProvider(provider.code).methods);
    } catch {
      return new Set<PaymentMethod>();
    }
  })();

  for (const method of ['MOBILE_MONEY', 'CARD', 'BANK_TRANSFER'] as const) {
    if (!provider.usable) {
      methods.push({ method, label: LABELS[method], available: false, reason: provider.message });
      continue;
    }
    if (!supportees.has(method)) {
      methods.push({ method, label: LABELS[method], available: false, reason: `${provider.name} ne propose pas ce moyen de paiement.` });
      continue;
    }
    methods.push({ method, label: LABELS[method], available: true, simulated: !provider.real });
  }

  // Paiement à la livraison : il ne dépend d'aucun prestataire — il dépend
  // d'une règle. Fermé par défaut, il s'ouvre par pays, province, boutique ou
  // catégorie, et un plafond peut s'appliquer.
  if (countryCode) {
    const cod = await codAvailability({
      countryCode,
      provinceId,
      storeIds,
      categoryIds,
      amount: amount ?? new Prisma.Decimal(0),
    });
    methods.push({
      method: 'CASH_ON_DELIVERY',
      label: LABELS.CASH_ON_DELIVERY,
      available: cod.allowed,
      reason: cod.allowed ? undefined : cod.reason,
      maxAmount: cod.maxAmount,
    });
  } else {
    methods.push({
      method: 'CASH_ON_DELIVERY',
      label: LABELS.CASH_ON_DELIVERY,
      available: false,
      reason: 'Indiquez le pays de livraison : le paiement à la livraison dépend de la destination.',
    });
  }

  return {
    provider: { code: provider.code, name: provider.name, real: provider.real, message: provider.message },
    countryCode,
    currency,
    /** Montant considéré, quand une commande a été indiquée. */
    amount: amount?.toString() ?? null,
    methods,
    /**
     * Aucune méthode ouverte est un état normal tant qu'aucun prestataire n'est
     * raccordé et qu'aucune règle d'encaissement n'est posée. Le dire vaut
     * mieux que de rendre une liste vide sans explication.
     */
    anyAvailable: methods.some((m) => m.available),
  };
}

/** Commandes visées, en refusant celles d'autrui — 404, jamais 403. */
async function ordersOf(user: ToumaRequestUser, query: MethodsQuery) {
  const include = {
    shippingAddress: { select: { provinceId: true } },
    items: { select: { product: { select: { categoryId: true } } } },
  } as const;

  if (query.orderGroupId) {
    const group = await prisma.toumaOrderGroup.findUnique({ where: { id: query.orderGroupId }, include: { orders: { include } } });
    if (!group || (group.buyerId !== user.id && user.role !== 'ADMIN')) throw notFound('Commande introuvable.');
    if (group.orders.length === 0) throw notFound('Commande introuvable.');
    return group.orders;
  }

  const order = await prisma.toumaOrder.findUnique({ where: { id: query.orderId! }, include });
  if (!order || (order.buyerId !== user.id && user.role !== 'ADMIN')) throw notFound('Commande introuvable.');
  return [order];
}

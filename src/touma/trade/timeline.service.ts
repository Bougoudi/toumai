import { prisma } from '../../db/prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';
import type { TradeEventKind } from '@prisma/client';

/**
 * CHRONOLOGIE ET MACHINE D'ÉTAT (§40, §41).
 *
 * Les événements **proviennent des systèmes réels** : le paiement écrit les
 * siens, la logistique les siens, le grand livre les siens. Aucun n'est
 * fabriqué pour remplir une frise. Une chronologie complétée par
 * interpolation raconte une opération qui n'a pas eu lieu.
 *
 * La machine d'état refuse les transitions incohérentes. « Livré » puis
 * « paiement initié » n'est pas un ordre inhabituel : c'est le signe qu'un
 * appelant s'est trompé, et le laisser passer écrirait dans le registre une
 * histoire fausse que personne ne pourrait ensuite démêler.
 */

/**
 * Ce qui peut suivre quoi.
 *
 * Volontairement permissif sur les branches parallèles — les documents se
 * préparent pendant que le paiement se règle — et strict sur l'ordre des
 * jalons irréversibles : on ne revient pas avant le paiement une fois livré.
 */
const SUITES: Record<TradeEventKind, TradeEventKind[]> = {
  RFQ_CREATED: ['QUOTE_RECEIVED', 'CANCELLED', 'EXCEPTION_RAISED'],
  QUOTE_RECEIVED: ['QUOTE_RECEIVED', 'QUOTE_ACCEPTED', 'CANCELLED', 'EXCEPTION_RAISED'],
  QUOTE_ACCEPTED: ['PROFORMA_CREATED', 'ORDER_CREATED', 'CANCELLED', 'EXCEPTION_RAISED'],
  PROFORMA_CREATED: ['ORDER_CREATED', 'CANCELLED', 'EXCEPTION_RAISED'],
  ORDER_CREATED: ['PAYMENT_INITIATED', 'DOCUMENTS_READY', 'CANCELLED', 'EXCEPTION_RAISED'],
  PAYMENT_INITIATED: ['PAYMENT_CONFIRMED', 'PAYMENT_INITIATED', 'CANCELLED', 'EXCEPTION_RAISED'],
  PAYMENT_CONFIRMED: ['DOCUMENTS_READY', 'SHIPMENT_CREATED', 'CANCELLED', 'EXCEPTION_RAISED'],
  DOCUMENTS_READY: ['PAYMENT_INITIATED', 'PAYMENT_CONFIRMED', 'SHIPMENT_CREATED', 'CANCELLED', 'EXCEPTION_RAISED'],
  SHIPMENT_CREATED: ['IN_TRANSIT', 'CUSTOMS_REVIEW', 'EXCEPTION_RAISED', 'CANCELLED'],
  IN_TRANSIT: ['CUSTOMS_REVIEW', 'OUT_FOR_DELIVERY', 'IN_TRANSIT', 'DELIVERED', 'EXCEPTION_RAISED'],
  CUSTOMS_REVIEW: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'EXCEPTION_RAISED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'OUT_FOR_DELIVERY', 'EXCEPTION_RAISED'],
  DELIVERED: ['SETTLED', 'EXCEPTION_RAISED'],
  SETTLED: [],
  // Une exception n'est pas un état : c'est un incident. On en revient au
  // jalon où l'on était, d'où cette liste large.
  EXCEPTION_RAISED: ['IN_TRANSIT', 'CUSTOMS_REVIEW', 'OUT_FOR_DELIVERY', 'DELIVERED', 'SHIPMENT_CREATED', 'PAYMENT_INITIATED', 'PAYMENT_CONFIRMED', 'DOCUMENTS_READY', 'CANCELLED', 'SETTLED'],
  CANCELLED: [],
};

/** Libellés français des jalons, pour l'affichage et les documents. */
export const LIBELLES: Record<TradeEventKind, string> = {
  RFQ_CREATED: 'Demande de devis créée',
  QUOTE_RECEIVED: 'Devis reçu',
  QUOTE_ACCEPTED: 'Devis accepté',
  PROFORMA_CREATED: 'Proforma établie',
  ORDER_CREATED: 'Commande créée',
  PAYMENT_INITIATED: 'Paiement initié',
  PAYMENT_CONFIRMED: 'Paiement confirmé',
  DOCUMENTS_READY: 'Documents prêts',
  SHIPMENT_CREATED: 'Expédition créée',
  IN_TRANSIT: 'En transit',
  CUSTOMS_REVIEW: 'Contrôle douanier',
  OUT_FOR_DELIVERY: 'En cours de livraison',
  DELIVERED: 'Livré',
  SETTLED: 'Réglé au vendeur',
  EXCEPTION_RAISED: 'Incident signalé',
  CANCELLED: 'Annulé',
};

export function transitionAutorisee(depuis: TradeEventKind | null, vers: TradeEventKind): boolean {
  // Premier événement : seuls les vrais débuts sont recevables. Commencer une
  // chronologie par « livré » la rendrait inexplicable.
  if (depuis === null) return ['RFQ_CREATED', 'ORDER_CREATED', 'QUOTE_RECEIVED'].includes(vers);
  return SUITES[depuis].includes(vers);
}

/** Entrée d'un événement de chronologie. */
export interface EntreeEvenement {
  tradeOrderId: string;
  kind: TradeEventKind;
  origin: string;
  detail?: Record<string, unknown>;
  referenceId?: string | null;
  occurredAt?: Date;
}

export const timelineService = {
  /**
   * Inscrit un événement, après vérification de la transition.
   *
   * `origin` dit quel système l'a produit : un événement sans origine ne
   * permet pas de savoir s'il vient d'un fait ou d'une supposition.
   */
  async record(input: EntreeEvenement) {
    const dernier = await prisma.toumaTradeEvent.findFirst({
      where: { tradeOrderId: input.tradeOrderId },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      select: { kind: true },
    });

    if (!transitionAutorisee(dernier?.kind ?? null, input.kind)) {
      throw badRequest(
        dernier
          ? `Transition impossible : « ${LIBELLES[dernier.kind]} » ne peut pas être suivi de « ${LIBELLES[input.kind]} ».`
          : `« ${LIBELLES[input.kind]} » ne peut pas ouvrir une chronologie commerciale.`,
      );
    }

    return prisma.toumaTradeEvent.create({
      data: {
        tradeOrderId: input.tradeOrderId,
        kind: input.kind,
        origin: input.origin,
        detail: (input.detail ?? {}) as object,
        referenceId: input.referenceId ?? null,
        occurredAt: input.occurredAt ?? new Date(),
      },
    });
  },

  /**
   * Inscrit sans échouer si la transition est refusée.
   *
   * Employée depuis les webhooks et les tâches de fond : un événement de
   * transporteur arrivé dans le désordre ne doit pas faire échouer le
   * traitement du webhook. Il est ignoré, et l'ordre en base reste cohérent.
   */
  async tryRecord(input: EntreeEvenement): Promise<boolean> {
    try {
      await this.record(input);
      return true;
    } catch {
      return false;
    }
  },

  /** Chronologie d'une commande, avec les jalons non encore atteints. */
  async forTradeOrder(user: ToumaRequestUser, tradeOrderId: string) {
    const lien = await prisma.toumaTradeOrder.findUnique({
      where: { id: tradeOrderId },
      select: { id: true, order: { select: { buyerId: true, orderNumber: true, store: { select: { ownerId: true, name: true } } } } },
    });
    if (!lien) throw notFound('Commande transfrontalière introuvable.');
    if (user.role !== 'ADMIN' && lien.order.buyerId !== user.id && lien.order.store.ownerId !== user.id) {
      throw notFound('Commande transfrontalière introuvable.');
    }

    const evenements = await prisma.toumaTradeEvent.findMany({
      where: { tradeOrderId },
      orderBy: { occurredAt: 'asc' },
      select: { id: true, kind: true, origin: true, detail: true, referenceId: true, occurredAt: true },
    });

    const atteints = new Set(evenements.map((e) => e.kind));
    const dernier = evenements.at(-1)?.kind ?? null;

    return {
      tradeOrderId,
      orderNumber: lien.order.orderNumber,
      events: evenements.map((e) => ({ ...e, label: LIBELLES[e.kind] })),
      currentStage: dernier ? { kind: dernier, label: LIBELLES[dernier] } : null,
      /**
       * Prochaines étapes possibles — **possibles**, pas prévues. Annoncer une
       * suite comme certaine reviendrait à promettre une livraison au nom d'un
       * transporteur qui n'a rien promis.
       */
      possibleNext: (dernier ? SUITES[dernier] : (['RFQ_CREATED', 'ORDER_CREATED'] as TradeEventKind[]))
        .filter((k) => k !== dernier)
        .map((k) => ({ kind: k, label: LIBELLES[k] })),
      reached: [...atteints],
    };
  },

  /**
   * Liste de contrôle (§45).
   *
   * Chaque ligne vient d'un **fait vérifiable** : un document existe ou non,
   * un paiement est confirmé ou non, un transporteur couvre le corridor ou
   * non. Aucune case n'est cochée par principe.
   */
  async checklist(user: ToumaRequestUser, tradeOrderId: string) {
    const lien = await prisma.toumaTradeOrder.findUnique({
      where: { id: tradeOrderId },
      include: {
        corridor: true,
        documents: { select: { kind: true, status: true } },
        order: {
          select: {
            buyerId: true,
            status: true,
            currency: true,
            buyerCountry: true,
            sellerCountry: true,
            store: { select: { ownerId: true, verificationStatus: true, countryCode: true } },
            payments: { select: { status: true } },
            shipments: { select: { status: true, trackingNumber: true } },
          },
        },
      },
    });
    if (!lien) throw notFound('Commande transfrontalière introuvable.');
    if (user.role !== 'ADMIN' && lien.order.buyerId !== user.id && lien.order.store.ownerId !== user.id) {
      throw notFound('Commande transfrontalière introuvable.');
    }

    const documentsPresents = new Map(lien.documents.map((d) => [d.kind, d.status]));
    const exiges = lien.corridor?.requiredDocuments ?? [];
    const paiementConfirme = lien.order.payments.some((p) => p.status === 'SUCCEEDED');
    const expedie = lien.order.shipments.length > 0;

    const items = [
      {
        code: 'SELLER_VERIFIED',
        label: 'Vendeur vérifié par Touma',
        done: lien.order.store.verificationStatus === 'APPROVED',
        detail: lien.order.store.verificationStatus === 'APPROVED' ? null : 'Le vendeur n’a pas passé la vérification Touma.',
      },
      {
        code: 'PAYMENT_CONFIRMED',
        label: 'Paiement confirmé',
        done: paiementConfirme,
        detail: paiementConfirme ? null : 'Aucun paiement confirmé sur cette commande.',
      },
      ...exiges.map((kind) => {
        const statut = documentsPresents.get(kind);
        return {
          code: `DOCUMENT_${kind}`,
          label: `Document exigé : ${kind}`,
          // Un document téléversé n'est pas un document vérifié. Cocher à la
          // réception viderait la vérification de son sens.
          done: statut === 'VERIFIED',
          detail: statut ? `Présent, état : ${statut}.` : 'Absent.',
        };
      }),
      {
        code: 'SHIPMENT_CREATED',
        label: 'Expédition créée',
        done: expedie,
        detail: expedie ? null : 'Aucune expédition enregistrée.',
      },
      {
        code: 'DELIVERED',
        label: 'Livraison confirmée',
        done: lien.order.status === 'DELIVERED' || lien.order.status === 'COMPLETED',
        detail: null,
      },
    ];

    return {
      tradeOrderId,
      items,
      complete: items.every((i) => i.done),
      remaining: items.filter((i) => !i.done).length,
    };
  },
};

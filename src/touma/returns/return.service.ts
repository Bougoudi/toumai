import { randomBytes } from 'node:crypto';
import { Prisma, type ReturnReason, type ReturnStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { money, multiply, roundTo, sum } from '../lib/money.js';
import { notify } from '../lib/notifications.js';
import { paginated, type PageParams } from '../lib/pagination.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';
import { refundService } from '../payments/refund.service.js';
import { reputationService } from '../reputation/reputation.service.js';
import { recordTrustEvent } from '../trust/events.js';
import type { ApproveReturnInput, CreateReturnInput, ListReturnsQuery, ReceiveReturnInput, RefundInput } from './return.schema.js';

/**
 * RETOURS & REMBOURSEMENTS.
 *
 * Le cycle réel d'un après-vente :
 *   demande de l'acheteur → décision du vendeur → renvoi du colis →
 *   réception → remboursement.
 *
 * Deux règles ne se négocient pas :
 *   • le montant est **recalculé** depuis les instantanés de la commande ;
 *     un client qui annonce son propre montant serait un client qui se sert.
 *   • un retour ne rembourse rien tout seul ; le remboursement est un acte
 *     humain distinct (voir `refundService`).
 */

/** Motifs imputables au vendeur : les frais de livraison sont alors remboursés. */
const SELLER_FAULT: ReturnReason[] = ['DAMAGED', 'NOT_AS_DESCRIBED', 'WRONG_ITEM', 'MISSING_PARTS', 'NOT_DELIVERED'];

/**
 * Transitions autorisées d'une demande de retour.
 *
 * Vers l'avant, plusieurs chemins sont ouverts : un vendeur qui rembourse tout
 * de suite ne doit pas passer par quatre écrans. Vers l'arrière, aucun — un
 * retour remboursé ne redevient jamais « en examen ».
 *
 * `CLOSED` est l'état d'archivage : il vient après une issue, quelle qu'elle
 * soit, et ne mène nulle part.
 */
export const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  REQUESTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['IN_TRANSIT', 'RECEIVED', 'REFUND_PENDING', 'REFUNDED', 'CANCELLED'],
  REJECTED: ['CLOSED'],
  IN_TRANSIT: ['RECEIVED', 'CANCELLED'],
  RECEIVED: ['REFUND_PENDING', 'REFUNDED'],
  // Le retour est reçu et accepté, l'argent n'est pas encore parti. C'est
  // l'état où se trouve une demande pendant qu'un humain exécute le
  // remboursement — jusqu'ici il n'existait pas, et l'acheteur ne voyait rien
  // entre « reçu » et « remboursé ».
  REFUND_PENDING: ['REFUNDED', 'CANCELLED'],
  REFUNDED: ['CLOSED'],
  CANCELLED: ['CLOSED'],
  CLOSED: [],
};

/** Statuts de commande ouvrant droit à un retour, selon le motif. */
const RETURNABLE_STATUSES = ['DELIVERED', 'COMPLETED'];
/**
 * « Colis jamais reçu » ne vaut que pour une commande réellement partie : tant
 * qu'elle n'est pas expédiée, l'acheteur annule ou ouvre un litige.
 */
const NOT_DELIVERED_STATUSES = ['SHIPPED', 'IN_TRANSIT'];

function reference(): string {
  const d = new Date();
  const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  // Cinq octets, comme au checkout : trois ne donnaient que 16,7 millions de
  // valeurs par jour, et la collision se manifeste par une erreur serveur chez
  // celui qui a perdu au tirage.
  return `RT-${day}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

const returnInclude = {
  items: true,
  refunds: { orderBy: { createdAt: 'desc' as const } },
  order: { select: { id: true, orderNumber: true, currency: true, total: true, shippingTotal: true, status: true, deliveredAt: true } },
  store: { select: { id: true, name: true, slug: true, ownerId: true } },
  buyer: { select: { id: true, name: true } },
};

type ReturnRow = Prisma.ToumaReturnRequestGetPayload<{ include: typeof returnInclude }>;

function serialize(row: ReturnRow) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    reason: row.reason,
    comment: row.comment,
    currency: row.currency,
    requestedAmount: row.requestedAmount.toString(),
    approvedAmount: row.approvedAmount?.toString() ?? null,
    refundShipping: row.refundShipping,
    evidence: row.evidence,
    sellerNote: row.sellerNote,
    rejectionNote: row.rejectionNote,
    trackingNumber: row.trackingNumber,
    requestedAt: row.requestedAt,
    decidedAt: row.decidedAt,
    receivedAt: row.receivedAt,
    refundedAt: row.refundedAt,
    order: {
      id: row.order.id,
      orderNumber: row.order.orderNumber,
      status: row.order.status,
      total: row.order.total.toString(),
      shippingTotal: row.order.shippingTotal.toString(),
      currency: row.order.currency,
      deliveredAt: row.order.deliveredAt,
    },
    store: { id: row.store.id, name: row.store.name, slug: row.store.slug },
    buyer: { id: row.buyer.id, name: row.buyer.name },
    items: row.items.map((i) => ({
      id: i.id,
      orderItemId: i.orderItemId,
      title: i.titleSnapshot,
      quantity: i.quantity,
      unitPrice: i.unitPrice.toString(),
      lineTotal: i.lineTotal.toString(),
      currency: i.currency,
      condition: i.condition,
    })),
    refunds: row.refunds.map((r) => ({
      id: r.id,
      reference: r.reference,
      amount: r.amount.toString(),
      currency: r.currency,
      status: r.status,
      processedAt: r.processedAt,
    })),
  };
}

/** Fin de la fenêtre de retour pour une commande livrée. */
function returnDeadline(deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + env.touma.returnWindowDays * 24 * 3600 * 1000);
}

async function loadForActor(user: ToumaRequestUser, id: string): Promise<ReturnRow> {
  const row = await prisma.toumaReturnRequest.findFirst({
    where: { OR: [{ id }, { reference: id }] },
    include: returnInclude,
  });
  if (!row) throw notFound('Demande de retour introuvable.');
  const allowed = row.buyerId === user.id || row.store.ownerId === user.id || user.role === 'ADMIN';
  // Anti-IDOR : une demande d'autrui répond « introuvable », jamais « interdit ».
  if (!allowed) throw notFound('Demande de retour introuvable.');
  return row;
}

function assertTransition(from: ReturnStatus, to: ReturnStatus) {
  if (!RETURN_TRANSITIONS[from].includes(to)) throw conflict(`Transition ${from} → ${to} impossible.`);
}

function isSeller(user: ToumaRequestUser, row: ReturnRow) {
  return row.store.ownerId === user.id || user.role === 'ADMIN';
}

export const returnService = {
  /**
   * Ce qui est encore retournable sur une commande : quantité commandée moins
   * les quantités déjà engagées dans une demande vivante.
   */
  async eligibility(user: ToumaRequestUser, orderId: string) {
    const order = await prisma.toumaOrder.findFirst({
      where: { OR: [{ id: orderId }, { orderNumber: orderId }] },
      include: { items: true, store: { select: { ownerId: true } } },
    });
    if (!order) throw notFound('Commande introuvable.');
    if (order.buyerId !== user.id && order.store.ownerId !== user.id && user.role !== 'ADMIN') {
      throw notFound('Commande introuvable.');
    }

    const open = await prisma.toumaReturnItem.groupBy({
      by: ['orderItemId'],
      where: {
        orderItem: { orderId: order.id },
        returnRequest: { status: { notIn: ['REJECTED', 'CANCELLED'] } },
      },
      _sum: { quantity: true },
    });
    const used = new Map(open.map((o) => [o.orderItemId, o._sum.quantity ?? 0]));

    const deadline = order.deliveredAt ? returnDeadline(order.deliveredAt) : null;
    const windowOpen = deadline ? deadline.getTime() >= Date.now() : NOT_DELIVERED_STATUSES.includes(order.status);
    const eligible =
      windowOpen &&
      (RETURNABLE_STATUSES.includes(order.status) || NOT_DELIVERED_STATUSES.includes(order.status)) &&
      order.status !== 'REFUNDED';

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      currency: order.currency,
      status: order.status,
      eligible,
      windowDays: env.touma.returnWindowDays,
      deadline,
      /** Motifs recevables selon l'état réel de la commande. */
      reasons: RETURNABLE_STATUSES.includes(order.status)
        ? ['DAMAGED', 'NOT_AS_DESCRIBED', 'WRONG_ITEM', 'MISSING_PARTS', 'CHANGED_MIND', 'OTHER']
        : ['NOT_DELIVERED'],
      items: order.items.map((i) => {
        const already = used.get(i.id) ?? 0;
        return {
          orderItemId: i.id,
          title: i.titleSnapshot,
          image: i.imageSnapshot,
          unitPrice: i.unitPrice.toString(),
          currency: i.currency,
          quantity: i.quantity,
          alreadyReturned: already,
          returnable: Math.max(0, i.quantity - already),
        };
      }),
    };
  },

  /** L'acheteur ouvre une demande de retour. */
  async create(user: ToumaRequestUser, input: CreateReturnInput) {
    const order = await prisma.toumaOrder.findFirst({
      where: { OR: [{ id: input.orderId }, { orderNumber: input.orderId }] },
      include: { items: true, store: { select: { id: true, name: true, ownerId: true } } },
    });
    if (!order) throw notFound('Commande introuvable.');
    if (order.buyerId !== user.id) throw notFound('Commande introuvable.');

    const notDelivered = input.reason === 'NOT_DELIVERED';
    if (notDelivered) {
      if (!NOT_DELIVERED_STATUSES.includes(order.status)) {
        throw conflict('Cette commande est marquée livrée : choisissez un autre motif.');
      }
    } else {
      if (!RETURNABLE_STATUSES.includes(order.status)) {
        throw conflict('Un retour n’est possible qu’une fois la commande livrée.');
      }
      if (order.deliveredAt && returnDeadline(order.deliveredAt).getTime() < Date.now()) {
        throw conflict(`Le délai de retour de ${env.touma.returnWindowDays} jours est dépassé.`);
      }
    }

    // Quantités déjà engagées dans une demande vivante.
    const open = await prisma.toumaReturnItem.groupBy({
      by: ['orderItemId'],
      where: { orderItem: { orderId: order.id }, returnRequest: { status: { notIn: ['REJECTED', 'CANCELLED'] } } },
      _sum: { quantity: true },
    });
    const used = new Map(open.map((o) => [o.orderItemId, o._sum.quantity ?? 0]));

    const lines = input.items.map((requested) => {
      const item = order.items.find((i) => i.id === requested.orderItemId);
      if (!item) throw badRequest('Un article sélectionné n’appartient pas à cette commande.');
      const available = item.quantity - (used.get(item.id) ?? 0);
      if (requested.quantity > available) {
        throw conflict(`« ${item.titleSnapshot} » : ${available} unité(s) retournable(s) au maximum.`);
      }
      // Prix figé de la commande : le prix courant du produit n'entre jamais en jeu.
      const lineTotal = roundTo(multiply(item.unitPrice, requested.quantity), item.currency);
      return {
        orderItemId: item.id,
        titleSnapshot: item.titleSnapshot,
        quantity: requested.quantity,
        unitPrice: item.unitPrice,
        lineTotal,
        currency: item.currency,
      };
    });

    // Frais de livraison remboursés seulement si le tort vient du vendeur ET
    // si la commande est retournée en totalité.
    const fullOrder = order.items.every((i) => {
      const asked = lines.find((l) => l.orderItemId === i.id)?.quantity ?? 0;
      return asked + (used.get(i.id) ?? 0) >= i.quantity;
    });
    const refundShipping = SELLER_FAULT.includes(input.reason) && fullOrder;
    const itemsTotal = sum(lines.map((l) => l.lineTotal));
    const requestedAmount = roundTo(refundShipping ? itemsTotal.plus(order.shippingTotal) : itemsTotal, order.currency);

    const created = await prisma.toumaReturnRequest.create({
      data: {
        reference: reference(),
        orderId: order.id,
        buyerId: user.id,
        storeId: order.storeId,
        reason: input.reason,
        comment: input.comment,
        currency: order.currency,
        requestedAmount,
        refundShipping,
        evidence: input.evidence as object,
        items: { create: lines },
      },
      include: returnInclude,
    });

    // Un retour compte dans la réputation de la boutique.
    await reputationService.invalidate(order.storeId);
    await recordTrustEvent({
      entityType: 'SELLER',
      entityId: order.storeId,
      type: 'ORDER_REFUNDED',
      detail: { orderId: order.id },
    });

    await audit({
      actorId: user.id,
      action: 'return.create',
      entity: 'ToumaReturnRequest',
      entityId: created.id,
      metadata: { orderId: order.id, reason: input.reason, amount: requestedAmount.toString(), currency: order.currency },
    });
    await notify({
      userId: order.store.ownerId,
      type: 'ORDER_STATUS_CHANGED',
      title: `Demande de retour ${created.reference}`,
      body: `${user.email} demande un retour sur la commande ${order.orderNumber}.`,
      data: { returnId: created.id, orderId: order.id },
    });

    return serialize(created);
  },

  async list(user: ToumaRequestUser, query: ListReturnsQuery) {
    const page: PageParams = { page: query.page, limit: query.limit, skip: (query.page - 1) * query.limit };
    const where: Prisma.ToumaReturnRequestWhereInput =
      query.scope === 'seller'
        ? { store: user.role === 'ADMIN' ? {} : { ownerId: user.id }, ...(query.status ? { status: query.status } : {}) }
        : { buyerId: user.id, ...(query.status ? { status: query.status } : {}) };

    const [rows, total] = await Promise.all([
      prisma.toumaReturnRequest.findMany({ where, include: returnInclude, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }),
      prisma.toumaReturnRequest.count({ where }),
    ]);
    return paginated(rows.map(serialize), total, page);
  },

  async get(user: ToumaRequestUser, id: string) {
    return serialize(await loadForActor(user, id));
  },

  /** Le vendeur (ou l'administration) accepte le retour, éventuellement partiellement. */
  async approve(user: ToumaRequestUser, id: string, input: ApproveReturnInput) {
    const row = await loadForActor(user, id);
    if (!isSeller(user, row)) throw notFound('Demande de retour introuvable.');
    assertTransition(row.status, 'APPROVED');

    let approved = row.requestedAmount;
    if (input.approvedAmount) {
      approved = roundTo(money(input.approvedAmount), row.currency);
      if (approved.greaterThan(row.requestedAmount)) {
        throw badRequest('Le montant validé ne peut pas dépasser le montant demandé.');
      }
      if (approved.lessThan(0)) throw badRequest('Le montant validé ne peut pas être négatif.');
    }

    const updated = await prisma.toumaReturnRequest.update({
      where: { id: row.id },
      data: { status: 'APPROVED', approvedAmount: approved, sellerNote: input.note ?? null, decidedById: user.id, decidedAt: new Date() },
      include: returnInclude,
    });
    await audit({ actorId: user.id, action: 'return.approve', entity: 'ToumaReturnRequest', entityId: row.id, metadata: { approvedAmount: approved.toString() } });
    await notify({
      userId: row.buyerId,
      type: 'ORDER_STATUS_CHANGED',
      title: `Retour ${row.reference} accepté`,
      body: `Le vendeur accepte votre retour pour ${approved.toString()} ${row.currency}.`,
      data: { returnId: row.id, orderId: row.orderId },
    });
    return serialize(updated);
  },

  async reject(user: ToumaRequestUser, id: string, note: string) {
    const row = await loadForActor(user, id);
    if (!isSeller(user, row)) throw notFound('Demande de retour introuvable.');
    assertTransition(row.status, 'REJECTED');

    const updated = await prisma.toumaReturnRequest.update({
      where: { id: row.id },
      data: { status: 'REJECTED', rejectionNote: note, decidedById: user.id, decidedAt: new Date(), closedAt: new Date() },
      include: returnInclude,
    });
    await audit({ actorId: user.id, action: 'return.reject', entity: 'ToumaReturnRequest', entityId: row.id });
    await notify({
      userId: row.buyerId,
      type: 'ORDER_STATUS_CHANGED',
      title: `Retour ${row.reference} refusé`,
      body: note,
      data: { returnId: row.id, orderId: row.orderId },
    });
    return serialize(updated);
  },

  /** L'acheteur déclare avoir réexpédié le colis. */
  async ship(user: ToumaRequestUser, id: string, trackingNumber: string) {
    const row = await loadForActor(user, id);
    if (row.buyerId !== user.id) throw notFound('Demande de retour introuvable.');
    assertTransition(row.status, 'IN_TRANSIT');
    const updated = await prisma.toumaReturnRequest.update({
      where: { id: row.id },
      data: { status: 'IN_TRANSIT', trackingNumber },
      include: returnInclude,
    });
    await notify({
      userId: row.store.ownerId,
      type: 'ORDER_STATUS_CHANGED',
      title: `Retour ${row.reference} expédié`,
      body: `Suivi : ${trackingNumber}.`,
      data: { returnId: row.id, orderId: row.orderId },
    });
    return serialize(updated);
  },

  /** Le vendeur accuse réception ; les articles peuvent revenir en stock. */
  async receive(user: ToumaRequestUser, id: string, input: ReceiveReturnInput) {
    const row = await loadForActor(user, id);
    if (!isSeller(user, row)) throw notFound('Demande de retour introuvable.');
    assertTransition(row.status, 'RECEIVED');

    const updated = await prisma.$transaction(async (tx) => {
      if (input.restock) {
        const items = await tx.toumaReturnItem.findMany({
          where: { returnRequestId: row.id },
          include: { orderItem: { select: { productId: true, variantId: true } } },
        });
        for (const item of items) {
          if (!item.orderItem.productId) continue;
          // La réservation posée au checkout est libérée en même temps que le
          // stock revient : sans cela `reserved` ne redescendrait jamais.
          await tx.toumaInventory.updateMany({
            where: { productId: item.orderItem.productId, variantId: item.orderItem.variantId ?? null },
            data: { quantity: { increment: item.quantity }, reserved: { decrement: item.quantity } },
          });
        }
      }
      if (input.condition) {
        await tx.toumaReturnItem.updateMany({ where: { returnRequestId: row.id }, data: { condition: input.condition } });
      }
      return tx.toumaReturnRequest.update({
        where: { id: row.id },
        data: { status: 'RECEIVED', receivedAt: new Date() },
        include: returnInclude,
      });
    });

    await audit({ actorId: user.id, action: 'return.receive', entity: 'ToumaReturnRequest', entityId: row.id, metadata: { restock: input.restock } });
    await notify({
      userId: row.buyerId,
      type: 'ORDER_STATUS_CHANGED',
      title: `Retour ${row.reference} reçu`,
      body: 'Le vendeur a reçu votre colis. Le remboursement va être traité.',
      data: { returnId: row.id, orderId: row.orderId },
    });
    return serialize(updated);
  },

  /** L'acheteur retire sa demande tant qu'elle n'est pas remboursée. */
  async cancel(user: ToumaRequestUser, id: string) {
    const row = await loadForActor(user, id);
    if (row.buyerId !== user.id && user.role !== 'ADMIN') throw notFound('Demande de retour introuvable.');
    assertTransition(row.status, 'CANCELLED');
    const updated = await prisma.toumaReturnRequest.update({
      where: { id: row.id },
      data: { status: 'CANCELLED', closedAt: new Date() },
      include: returnInclude,
    });
    return serialize(updated);
  },

  /**
   * Remboursement du retour. Décision humaine : le vendeur de la boutique
   * concernée ou l'administration. Rien n'est déclenché automatiquement, et un
   * retour déjà remboursé ne peut pas l'être deux fois.
   */
  async refund(user: ToumaRequestUser, id: string, input: RefundInput) {
    const row = await loadForActor(user, id);
    if (!isSeller(user, row)) throw notFound('Demande de retour introuvable.');
    if (row.status === 'REFUNDED') throw conflict('Ce retour a déjà été remboursé.');
    if (!['APPROVED', 'RECEIVED'].includes(row.status)) {
      throw conflict('Le retour doit d’abord être accepté (et reçu, le cas échéant).');
    }

    const ceiling = row.approvedAmount ?? row.requestedAmount;
    const amount = input.amount ? roundTo(money(input.amount), row.currency) : ceiling;
    if (amount.greaterThan(ceiling)) {
      throw badRequest(`Le remboursement ne peut pas dépasser le montant validé (${ceiling.toString()} ${row.currency}).`);
    }

    const refund = await refundService.execute({
      actorId: user.id,
      orderId: row.orderId,
      amount: amount.toString(),
      reason: input.reason ?? `Retour ${row.reference} (${row.reason})`,
      returnRequestId: row.id,
    });

    const updated = await prisma.toumaReturnRequest.update({
      where: { id: row.id },
      data: { status: 'REFUNDED', refundedAt: new Date(), closedAt: new Date(), approvedAmount: amount },
      include: returnInclude,
    });
    return { ...serialize(updated), refund };
  },
};

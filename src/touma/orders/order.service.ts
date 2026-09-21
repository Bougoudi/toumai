import { Prisma, type ToumaOrderStatus } from '@prisma/client';
import { libererReservation } from './reservation-counter.js';
import { prisma } from '../../db/prisma.js';
import { refreshGroupStatus } from './group-status.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import { paginated, type PageParams } from '../lib/pagination.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';
import { loyaltyService } from '../loyalty/loyalty.service.js';
import { reputationService } from '../reputation/reputation.service.js';
import { recordTrustEvent, type TrustEventType } from '../trust/events.js';
import { referralService } from '../growth/referral.service.js';
import { refundService } from '../payments/refund.service.js';
import type { ListOrdersQuery } from './order.schema.js';

/**
 * Transitions autorisées du cycle de vie d'une commande. Toute autre transition
 * est refusée : le statut d'une commande n'est jamais « libre ».
 */
const TRANSITIONS: Record<ToumaOrderStatus, ToumaOrderStatus[]> = {
  PENDING: ['PAID', 'CANCELLED'],
  // Vers l'avant, la machine est permissive : un vendeur qui emballe tout de
  // suite ne doit pas cliquer trois fois pour le dire. Vers l'arrière, elle ne
  // cède jamais.
  PAID: ['CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'CANCELLED', 'REFUNDED', 'DISPUTED'],
  CONFIRMED: ['PROCESSING', 'READY_TO_SHIP', 'CANCELLED', 'DISPUTED'],
  // Le colis peut partir directement, ou attendre le passage du transporteur.
  PROCESSING: ['READY_TO_SHIP', 'SHIPPED', 'CANCELLED', 'DISPUTED'],
  READY_TO_SHIP: ['SHIPPED', 'CANCELLED', 'DISPUTED'],
  SHIPPED: ['IN_TRANSIT', 'DELIVERED', 'DISPUTED'],
  IN_TRANSIT: ['DELIVERED', 'DISPUTED', 'CANCELLED'],
  DELIVERED: ['COMPLETED', 'DISPUTED', 'REFUNDED'],
  COMPLETED: ['DISPUTED'],
  CANCELLED: [],
  REFUNDED: [],
  DISPUTED: ['REFUNDED', 'COMPLETED', 'CANCELLED'],
};

/** Qui a le droit de demander cette transition ? */
const SELLER_ALLOWED: ToumaOrderStatus[] = ['CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
const BUYER_ALLOWED: ToumaOrderStatus[] = ['COMPLETED', 'CANCELLED'];

const orderInclude = {
  items: true,
  store: { select: { id: true, name: true, slug: true, countryCode: true, ownerId: true } },
  payments: { orderBy: { createdAt: 'desc' as const } },
  shipments: { include: { events: { orderBy: { occurredAt: 'desc' as const } } } },
  buyer: { select: { id: true, name: true, email: true } },
};

function serialize(order: Awaited<ReturnType<typeof prisma.toumaOrder.findFirstOrThrow>> & Record<string, unknown>) {
  // L'empreinte du code de retrait ne sort jamais. Ce n'est pas le code, mais
  // rien ne justifie de la servir : une valeur dérivée d'un secret qui n'a
  // aucun usage côté client n'a rien à faire dans une réponse. Trouvé par le
  // test qui vérifiait que le code ne fuit pas.
  const { pickupCodeHash: _hash, ...sansSecret } = order as Record<string, unknown> & { pickupCodeHash?: string | null };
  return {
    ...(sansSecret as typeof order),
    subtotal: order.subtotal.toString(),
    shippingTotal: order.shippingTotal.toString(),
    commissionTotal: order.commissionTotal.toString(),
    discountTotal: order.discountTotal.toString(),
    sellerFundedDiscount: order.sellerFundedDiscount.toString(),
    total: order.total.toString(),
  };
}

export const orderService = {
  /** Commandes de l'acheteur (`buyer`) ou des boutiques du vendeur (`seller`). */
  async list(user: ToumaRequestUser, query: ListOrdersQuery) {
    const page: PageParams = { page: query.page, limit: query.limit, skip: (query.page - 1) * query.limit };
    const where =
      query.scope === 'seller'
        ? {
            store: user.role === 'ADMIN' && query.storeId ? { id: query.storeId } : { ownerId: user.id, ...(query.storeId ? { id: query.storeId } : {}) },
            ...(query.status ? { status: query.status } : {}),
          }
        : { buyerId: user.id, ...(query.status ? { status: query.status } : {}) };

    const [rows, total] = await Promise.all([
      prisma.toumaOrder.findMany({
        where,
        include: { items: true, store: { select: { id: true, name: true, slug: true } }, shipments: { select: { id: true, status: true, trackingNumber: true } } },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaOrder.count({ where }),
    ]);
    return paginated(
      rows.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        currency: o.currency,
        total: o.total.toString(),
        subtotal: o.subtotal.toString(),
        shippingTotal: o.shippingTotal.toString(),
        discountTotal: o.discountTotal.toString(),
        crossBorder: o.crossBorder,
        itemCount: o.items.reduce((acc, i) => acc + i.quantity, 0),
        store: o.store,
        shipment: o.shipments[0] ?? null,
        createdAt: o.createdAt,
      })),
      total,
      page,
    );
  },

  /** Détail d'une commande : acheteur, vendeur propriétaire ou admin uniquement. */
  async get(user: ToumaRequestUser, orderId: string) {
    const order = await prisma.toumaOrder.findFirst({
      where: { OR: [{ id: orderId }, { orderNumber: orderId }] },
      include: orderInclude,
    });
    if (!order) throw notFound('Commande introuvable.');
    const allowed = order.buyerId === user.id || order.store.ownerId === user.id || user.role === 'ADMIN';
    // Réponse identique à « inexistant » : ne révèle pas l'existence d'une commande tierce.
    if (!allowed) throw notFound('Commande introuvable.');
    const refunds = await refundService.listForOrder(order.id);
    return {
      ...serialize(order as never),
      refunds,
      // Somme en Decimal : un total d'argent ne transite jamais par un float.
      refundedTotal: refunds
        .filter((r) => r.status === 'COMPLETED')
        .reduce((acc, r) => acc.plus(r.amount), new Prisma.Decimal(0))
        .toString(),
      payments: order.payments.map((p) => ({
        id: p.id,
        provider: p.provider,
        method: p.method,
        status: p.status,
        amount: p.amount.toString(),
        currency: p.currency,
        createdAt: p.createdAt,
        succeededAt: p.succeededAt,
      })),
    };
  },

  /**
   * Détail d'un groupe de commande : ce que l'acheteur a payé en une fois, et
   * l'état de chaque sous-commande vendeur.
   */
  async getGroup(user: ToumaRequestUser, groupId: string) {
    const group = await prisma.toumaOrderGroup.findFirst({
      where: { OR: [{ id: groupId }, { reference: groupId }] },
      include: {
        orders: {
          include: {
            items: true,
            store: { select: { id: true, name: true, slug: true, countryCode: true, ownerId: true } },
            shipments: { select: { id: true, status: true, trackingNumber: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!group) throw notFound('Groupe de commande introuvable.');
    const allowed = group.buyerId === user.id || group.orders.some((o) => o.store.ownerId === user.id) || user.role === 'ADMIN';
    if (!allowed) throw notFound('Groupe de commande introuvable.');

    return {
      id: group.id,
      reference: group.reference,
      status: group.status,
      currency: group.currency,
      itemsTotal: group.itemsTotal.toString(),
      shippingTotal: group.shippingTotal.toString(),
      discountTotal: group.discountTotal.toString(),
      total: group.total.toString(),
      crossBorder: group.crossBorder,
      shippingSnapshot: group.shippingSnapshot,
      createdAt: group.createdAt,
      paidAt: group.paidAt,
      payment: group.payments[0]
        ? {
            id: group.payments[0].id,
            status: group.payments[0].status,
            method: group.payments[0].method,
            amount: group.payments[0].amount.toString(),
            currency: group.payments[0].currency,
          }
        : null,
      orders: group.orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total.toString(),
        currency: o.currency,
        crossBorder: o.crossBorder,
        store: { id: o.store.id, name: o.store.name, slug: o.store.slug, countryCode: o.store.countryCode },
        itemCount: o.items.reduce((acc, i) => acc + i.quantity, 0),
        shipment: o.shipments[0] ?? null,
      })),
    };
  },

  /**
   * Change le statut d'une commande en respectant les transitions autorisées et
   * le rôle du demandeur. Une annulation restitue le stock réservé.
   */
  /**
   * Suivi d'une commande : ses expéditions et leurs événements.
   *
   * Une commande multi-vendeurs a plusieurs colis, qui n'avancent pas au même
   * rythme. On rend donc une liste, jamais un objet unique — supposer « une
   * commande, un colis » est exactement l'erreur que la V15 corrige.
   */
  async tracking(user: ToumaRequestUser, orderId: string) {
    const order = await prisma.toumaOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        buyerId: true,
        store: { select: { id: true, name: true, ownerId: true } },
        shipments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            providerCode: true,
            trackingNumber: true,
            status: true,
            originCountry: true,
            destinationCountry: true,
            etaMinDays: true,
            etaMaxDays: true,
            shippedAt: true,
            deliveredAt: true,
            events: { orderBy: { occurredAt: 'desc' }, select: { status: true, label: true, location: true, occurredAt: true } },
          },
        },
      },
    });
    // Anti-IDOR : la commande d'autrui est « introuvable », jamais « interdite ».
    if (!order || (order.buyerId !== user.id && order.store.ownerId !== user.id && user.role !== 'ADMIN')) {
      throw notFound('Commande introuvable.');
    }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      store: { id: order.store.id, name: order.store.name },
      shipments: order.shipments,
    };
  },

  async updateStatus(user: ToumaRequestUser, orderId: string, status: ToumaOrderStatus, reason?: string) {
    const order = await prisma.toumaOrder.findUnique({ where: { id: orderId }, include: { store: true, items: true } });
    if (!order) throw notFound('Commande introuvable.');

    const isSeller = order.store.ownerId === user.id;
    const isBuyer = order.buyerId === user.id;
    const isAdmin = user.role === 'ADMIN';
    if (!isSeller && !isBuyer && !isAdmin) throw notFound('Commande introuvable.');

    if (!isAdmin) {
      if (isSeller && !SELLER_ALLOWED.includes(status)) throw forbidden('Transition non autorisée pour un vendeur.');
      if (isBuyer && !isSeller && !BUYER_ALLOWED.includes(status)) throw forbidden('Transition non autorisée pour un acheteur.');
      // Un acheteur n'annule que tant que la commande n'est pas en préparation.
      if (isBuyer && !isSeller && status === 'CANCELLED' && !['PENDING', 'PAID'].includes(order.status)) {
        throw conflict('Cette commande ne peut plus être annulée : contactez le vendeur ou ouvrez un litige.');
      }
    }

    if (!TRANSITIONS[order.status].includes(status)) {
      throw conflict(`Transition ${order.status} → ${status} impossible.`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (status === 'CANCELLED') {
        // Restitution du stock réservé.
        for (const item of order.items) {
          if (!item.productId) continue;
          await libererReservation(tx, {
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
            restock: true,
          });
        }
      }
      const saved = await tx.toumaOrder.update({
        where: { id: order.id },
        data: {
          status,
          cancelReason: status === 'CANCELLED' ? (reason ?? null) : order.cancelReason,
          cancelledAt: status === 'CANCELLED' ? new Date() : order.cancelledAt,
          shippedAt: status === 'SHIPPED' ? new Date() : order.shippedAt,
          deliveredAt: status === 'DELIVERED' ? new Date() : order.deliveredAt,
          completedAt: status === 'COMPLETED' ? new Date() : order.completedAt,
        },
      });

      // La commande globale suit ses sous-commandes. Dans la même transaction :
      // un groupe qui annoncerait un état que ses sous-commandes ne portent pas
      // encore serait pire que pas d'état du tout.
      await refreshGroupStatus(order.groupId, tx);
      return saved;
    });

    // Les points de fidélité se gagnent à la livraison, pas au paiement : une
    // commande annulée avant d'arriver n'a jamais rien rapporté.
    if (status === 'DELIVERED' || status === 'COMPLETED') await loyaltyService.awardForOrder(order.id);

    // Un parrainage se qualifie sur une commande **terminée**, jamais sur une
    // inscription : sinon il suffirait de créer des comptes.
    if (status === 'COMPLETED') await referralService.qualifyFromOrder(order.id, order.buyerId);

    // Livraison et annulation changent la réputation de la boutique : son
    // instantané est périmé, il sera recalculé à la prochaine lecture.
    if (['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(status)) {
      await reputationService.invalidate(order.storeId);
      // La confiance du vendeur, celle de l'acheteur et celle de chaque produit
      // de la commande bougent ensemble. Consigner plutôt que recalculer : le
      // recalcul suit en tâche de fond, hors du chemin de l'acheteur.
      const items = await prisma.toumaOrderItem.findMany({
        where: { orderId: order.id },
        select: { productId: true },
      });
      const type: TrustEventType =
        status === 'CANCELLED' ? 'ORDER_CANCELLED' : status === 'DELIVERED' ? 'DELIVERY_COMPLETED' : 'ORDER_COMPLETED';
      await recordTrustEvent([
        { entityType: 'SELLER', entityId: order.storeId, type, detail: { orderId: order.id } },
        { entityType: 'BUYER', entityId: order.buyerId, type, detail: { orderId: order.id } },
        ...items
          .filter((i): i is { productId: string } => Boolean(i.productId))
          .map((i) => ({ entityType: 'PRODUCT' as const, entityId: i.productId, type, detail: { orderId: order.id } })),
      ]);
    }

    await notify({
      userId: order.buyerId,
      type: 'ORDER_STATUS_CHANGED',
      title: `Commande ${order.orderNumber}`,
      body: `Nouveau statut : ${status}.`,
      data: { orderId: order.id, status },
    });
    return serialize(updated as never);
  },
};

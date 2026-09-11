import { Prisma, type ToumaOrderStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import { paginated, type PageParams } from '../lib/pagination.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';
import { refundService } from '../payments/refund.service.js';
import type { ListOrdersQuery } from './order.schema.js';

/**
 * Transitions autorisées du cycle de vie d'une commande. Toute autre transition
 * est refusée : le statut d'une commande n'est jamais « libre ».
 */
const TRANSITIONS: Record<ToumaOrderStatus, ToumaOrderStatus[]> = {
  PENDING: ['PAID', 'CANCELLED'],
  PAID: ['CONFIRMED', 'PROCESSING', 'CANCELLED', 'REFUNDED', 'DISPUTED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED', 'DISPUTED'],
  PROCESSING: ['SHIPPED', 'CANCELLED', 'DISPUTED'],
  SHIPPED: ['IN_TRANSIT', 'DELIVERED', 'DISPUTED'],
  IN_TRANSIT: ['DELIVERED', 'DISPUTED', 'CANCELLED'],
  DELIVERED: ['COMPLETED', 'DISPUTED', 'REFUNDED'],
  COMPLETED: ['DISPUTED'],
  CANCELLED: [],
  REFUNDED: [],
  DISPUTED: ['REFUNDED', 'COMPLETED', 'CANCELLED'],
};

/** Qui a le droit de demander cette transition ? */
const SELLER_ALLOWED: ToumaOrderStatus[] = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
const BUYER_ALLOWED: ToumaOrderStatus[] = ['COMPLETED', 'CANCELLED'];

const orderInclude = {
  items: true,
  store: { select: { id: true, name: true, slug: true, countryCode: true, ownerId: true } },
  payments: { orderBy: { createdAt: 'desc' as const } },
  shipments: { include: { events: { orderBy: { occurredAt: 'desc' as const } } } },
  buyer: { select: { id: true, name: true, email: true } },
};

function serialize(order: Awaited<ReturnType<typeof prisma.toumaOrder.findFirstOrThrow>> & Record<string, unknown>) {
  return {
    ...order,
    subtotal: order.subtotal.toString(),
    shippingTotal: order.shippingTotal.toString(),
    commissionTotal: order.commissionTotal.toString(),
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
          await tx.toumaInventory.updateMany({
            where: { productId: item.productId ?? '', variantId: item.variantId ?? null },
            data: { quantity: { increment: item.quantity }, reserved: { decrement: item.quantity } },
          });
        }
      }
      return tx.toumaOrder.update({
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
    });

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

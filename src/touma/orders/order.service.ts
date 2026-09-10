import type { ToumaOrderStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import { paginated, type PageParams } from '../lib/pagination.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';
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
    return {
      ...serialize(order as never),
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

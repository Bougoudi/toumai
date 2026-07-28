import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import type { CreateCustomerInput, CreateOrderInput } from './order.schema.js';

function generateOrderNumber(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `TM-${stamp}-${rand}`;
}

export const orderService = {
  async createCustomer(input: CreateCustomerInput) {
    return prisma.customer.create({ data: input });
  },

  async listCustomers(params: { take: number; skip: number }) {
    const [items, total] = await Promise.all([
      prisma.customer.findMany({ take: params.take, skip: params.skip, orderBy: { createdAt: 'desc' } }),
      prisma.customer.count(),
    ]);
    return { items, total, take: params.take, skip: params.skip };
  },

  /** Crée une commande, calcule le total et (option) la marque payée. */
  async create(input: CreateOrderInput) {
    // Résout le client (existant ou créé à la volée).
    let customerId = input.customerId;
    if (!customerId && input.customer) {
      const customer = await prisma.customer.create({ data: input.customer });
      customerId = customer.id;
    }
    if (!customerId) throw new HttpError(400, 'Client manquant');

    // Charge les produits et construit les lignes.
    const productIds = input.items.map((i) => i.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    const byId = new Map(products.map((p) => [p.id, p]));

    let total = 0;
    const itemsData = input.items.map((item) => {
      const product = byId.get(item.productId);
      if (!product) throw new HttpError(404, `Produit introuvable : ${item.productId}`);
      const unitSalePrice = product.salePrice ?? 0;
      total += unitSalePrice * item.quantity;
      return {
        productId: product.id,
        quantity: item.quantity,
        unitSalePrice,
        unitCostPrice: product.costPrice ?? null,
      };
    });

    const order = await prisma.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        customerId,
        status: input.markPaid ? 'PAID' : 'PENDING',
        total: Number(total.toFixed(2)),
        items: { create: itemsData },
      },
      include: { items: true, customer: true },
    });

    return order;
  },

  async getById(id: string) {
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        items: { include: { product: true } },
        purchaseOrders: { include: { supplier: true, offer: true } },
      },
    });
    if (!order) throw new HttpError(404, 'Commande introuvable');
    return order;
  },

  async list(params: { status?: string; take: number; skip: number }) {
    const where = params.status ? { status: params.status } : {};
    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where,
        take: params.take,
        skip: params.skip,
        orderBy: { createdAt: 'desc' },
        include: { customer: true, _count: { select: { items: true, purchaseOrders: true } } },
      }),
      prisma.order.count({ where }),
    ]);
    return { items, total, take: params.take, skip: params.skip };
  },

  async cancel(id: string) {
    const order = await this.getById(id);
    if (['SHIPPED', 'DELIVERED'].includes(order.status)) {
      throw new HttpError(409, 'Commande déjà expédiée, annulation impossible');
    }
    return prisma.order.update({ where: { id }, data: { status: 'CANCELLED' } });
  },

  /** Vraie si un article a déjà été expédié chez le fournisseur (adresse figée). */
  hasShippedPurchase(order: { purchaseOrders?: { status: string }[] }): boolean {
    return (order.purchaseOrders ?? []).some((p) => ['SHIPPED', 'DELIVERED'].includes(p.status));
  },

  /**
   * Met à jour l'adresse de livraison d'une commande AVANT son envoi au
   * fournisseur. Refusé si la commande est déjà expédiée/livrée/annulée ou si un
   * bon d'achat est déjà parti.
   */
  async updateShipping(
    id: string,
    addr: { name?: string; phone?: string; address?: string; city?: string; country?: string; zip?: string },
  ) {
    const order = await this.getById(id);
    if (['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(order.status) || this.hasShippedPurchase(order)) {
      throw new HttpError(409, 'Commande déjà expédiée : l’adresse ne peut plus être modifiée.');
    }
    await prisma.customer.update({ where: { id: order.customerId }, data: addr });
    return this.getById(id);
  },

  /** Met (ou retire) une commande « en attente de vérification ». */
  async setHold(id: string, onHold: boolean) {
    const order = await this.getById(id);
    if (['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(order.status) || this.hasShippedPurchase(order)) {
      throw new HttpError(409, 'Commande déjà traitée : mise en attente impossible.');
    }
    await prisma.order.update({ where: { id }, data: { onHold } });
    return this.getById(id);
  },
};

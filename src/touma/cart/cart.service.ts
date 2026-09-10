import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { assertSameCurrency, sum } from '../lib/money.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

/**
 * Panier Touma.
 *
 * Le panier est un **brouillon** : les prix y sont indicatifs et sont toujours
 * revérifiés au moment du checkout (le prix vendeur fait foi). Le stock est
 * vérifié à l'ajout *et* au checkout — seule la transaction du checkout est
 * autoritaire (voir `checkout.service.ts`).
 */

const itemInclude = {
  product: {
    select: {
      id: true,
      title: true,
      slug: true,
      price: true,
      currency: true,
      status: true,
      minOrderQty: true,
      weightGrams: true,
      countryCode: true,
      images: { select: { url: true }, orderBy: { position: 'asc' as const }, take: 1 },
      store: { select: { id: true, name: true, slug: true, status: true, countryCode: true } },
      inventory: { select: { quantity: true, variantId: true } },
    },
  },
  variant: { select: { id: true, name: true, priceDelta: true, active: true } },
} satisfies Prisma.ToumaCartItemInclude;

type CartItemWithRelations = Prisma.ToumaCartItemGetPayload<{ include: typeof itemInclude }>;

/** Stock disponible pour une ligne (variante précise ou produit simple). */
function availableStock(item: CartItemWithRelations): number {
  const rows = item.product.inventory.filter((i) => i.variantId === (item.variantId ?? null));
  return rows.reduce((acc, r) => acc + r.quantity, 0);
}

/** Prix unitaire courant (produit + éventuel delta de variante). */
function currentUnitPrice(item: CartItemWithRelations): Prisma.Decimal {
  return item.product.price.plus(item.variant?.priceDelta ?? 0);
}

function serializeItem(item: CartItemWithRelations) {
  const unitPrice = currentUnitPrice(item);
  const stock = availableStock(item);
  const issues: string[] = [];
  if (item.product.status !== 'ACTIVE' || item.product.store.status !== 'ACTIVE') issues.push('PRODUCT_UNAVAILABLE');
  if (item.variant && !item.variant.active) issues.push('VARIANT_UNAVAILABLE');
  if (stock < item.quantity) issues.push('INSUFFICIENT_STOCK');
  if (!unitPrice.equals(item.unitPrice)) issues.push('PRICE_CHANGED');
  if (item.quantity < item.product.minOrderQty) issues.push('BELOW_MIN_ORDER_QTY');

  return {
    id: item.id,
    productId: item.productId,
    variantId: item.variantId,
    title: item.product.title,
    slug: item.product.slug,
    image: item.product.images[0]?.url ?? null,
    variantName: item.variant?.name ?? null,
    quantity: item.quantity,
    minOrderQty: item.product.minOrderQty,
    /// Poids unitaire : nécessaire pour demander un devis de transport exact.
    weightGrams: item.product.weightGrams,
    unitPrice: unitPrice.toString(),
    /** Prix vu lors de l'ajout : sert à prévenir l'acheteur d'un changement. */
    unitPriceAtAdd: item.unitPrice.toString(),
    lineTotal: unitPrice.times(item.quantity).toString(),
    currency: item.currency,
    stock,
    store: item.product.store,
    issues,
  };
}

async function loadCart(userId: string) {
  const cart = await prisma.toumaCart.findUnique({ where: { userId }, include: { items: { include: itemInclude, orderBy: { createdAt: 'asc' } } } });
  return cart;
}

/**
 * Vue du panier, regroupée par boutique : un panier multi-boutiques donne
 * plusieurs commandes (une par vendeur), chacune avec sa livraison.
 */
function summarize(items: ReturnType<typeof serializeItem>[]) {
  const groups = new Map<string, { store: CartItemWithRelations['product']['store']; items: typeof items; subtotal: string; currency: string }>();
  for (const item of items) {
    const key = item.store.id;
    const group = groups.get(key) ?? { store: item.store, items: [], subtotal: '0', currency: item.currency };
    group.items.push(item);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.subtotal = sum(group.items.map((i) => i.lineTotal)).toString();
  }
  return [...groups.values()];
}

export const cartService = {
  /** Panier courant (créé à la volée s'il n'existe pas). */
  async get(userId: string) {
    const cart = (await loadCart(userId)) ?? (await prisma.toumaCart.create({ data: { userId }, include: { items: { include: itemInclude } } }));
    const items = cart.items.map(serializeItem);
    return {
      id: cart.id,
      items,
      stores: summarize(items),
      itemCount: items.reduce((acc, i) => acc + i.quantity, 0),
      subtotal: sum(items.map((i) => i.lineTotal)).toString(),
      currency: items[0]?.currency ?? null,
      /** Le panier ne peut être validé que si aucune ligne n'a de problème. */
      checkoutReady: items.length > 0 && items.every((i) => i.issues.length === 0),
    };
  },

  /** Ajoute (ou incrémente) une ligne, après contrôle produit / stock / devise. */
  async addItem(userId: string, input: { productId: string; variantId?: string | null; quantity: number }) {
    const product = await prisma.toumaProduct.findUnique({
      where: { id: input.productId },
      include: { store: true, inventory: true, variants: true },
    });
    if (!product || product.status !== 'ACTIVE' || product.store.status !== 'ACTIVE') {
      throw notFound('Produit indisponible.');
    }
    if (product.store.ownerId === userId) throw badRequest('Vous ne pouvez pas acheter vos propres produits.');

    const variantId = input.variantId ?? null;
    if (variantId) {
      const variant = product.variants.find((v) => v.id === variantId);
      if (!variant || !variant.active) throw badRequest('Variante indisponible.');
    }
    const unitPrice = product.price.plus(product.variants.find((v) => v.id === variantId)?.priceDelta ?? 0);
    const stock = product.inventory.filter((i) => i.variantId === variantId).reduce((acc, i) => acc + i.quantity, 0);

    const cart = (await prisma.toumaCart.findUnique({ where: { userId } })) ?? (await prisma.toumaCart.create({ data: { userId } }));
    // Un panier reste mono-devise tant qu'aucun taux de change officiel n'est raccordé.
    const firstItem = await prisma.toumaCartItem.findFirst({ where: { cartId: cart.id } });
    if (firstItem) assertSameCurrency(firstItem.currency, product.currency);

    const existing = await prisma.toumaCartItem.findFirst({ where: { cartId: cart.id, productId: product.id, variantId } });
    const quantity = (existing?.quantity ?? 0) + input.quantity;
    if (quantity < product.minOrderQty) {
      throw badRequest(`Quantité minimale de commande : ${product.minOrderQty}.`);
    }
    if (quantity > stock) throw conflict(`Stock insuffisant : ${stock} disponible(s).`);

    if (existing) {
      await prisma.toumaCartItem.update({ where: { id: existing.id }, data: { quantity, unitPrice, currency: product.currency } });
    } else {
      await prisma.toumaCartItem.create({
        data: { cartId: cart.id, productId: product.id, variantId, quantity, unitPrice, currency: product.currency },
      });
    }
    return this.get(userId);
  },

  /** Modifie la quantité d'une ligne (0 = suppression). */
  async updateItem(userId: string, itemId: string, quantity: number) {
    const cart = await prisma.toumaCart.findUnique({ where: { userId } });
    if (!cart) throw notFound('Panier introuvable.');
    const item = await prisma.toumaCartItem.findFirst({ where: { id: itemId, cartId: cart.id }, include: itemInclude });
    if (!item) throw notFound('Ligne de panier introuvable.');

    if (quantity <= 0) {
      await prisma.toumaCartItem.delete({ where: { id: item.id } });
      return this.get(userId);
    }
    if (quantity < item.product.minOrderQty) {
      throw badRequest(`Quantité minimale de commande : ${item.product.minOrderQty}.`);
    }
    const stock = availableStock(item);
    if (quantity > stock) throw conflict(`Stock insuffisant : ${stock} disponible(s).`);
    await prisma.toumaCartItem.update({ where: { id: item.id }, data: { quantity, unitPrice: currentUnitPrice(item) } });
    return this.get(userId);
  },

  async removeItem(userId: string, itemId: string) {
    const cart = await prisma.toumaCart.findUnique({ where: { userId } });
    if (!cart) throw notFound('Panier introuvable.');
    const deleted = await prisma.toumaCartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
    if (deleted.count === 0) throw notFound('Ligne de panier introuvable.');
    return this.get(userId);
  },

  async clear(userId: string) {
    const cart = await prisma.toumaCart.findUnique({ where: { userId } });
    if (cart) await prisma.toumaCartItem.deleteMany({ where: { cartId: cart.id } });
    return this.get(userId);
  },
};

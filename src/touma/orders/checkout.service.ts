import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { applyRate, assertSameCurrency, sum } from '../lib/money.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import { logisticsService } from '../logistics/logistics.service.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';
import type { CheckoutInput } from './order.schema.js';

/** Numéro de commande lisible et non devinable. */
function orderNumber(): string {
  const d = new Date();
  const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `TM-${day}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

/**
 * CHECKOUT TOUMA
 *
 * Déroulé (entièrement dans une transaction base de données) :
 *   1. récupérer le panier                6. calculer les frais de livraison
 *   2. vérifier les produits              7. calculer le total (Decimal)
 *   3. vérifier les prix (vendeur = vérité) 8. créer la ou les commandes
 *   4. vérifier le stock                  9. décrémenter le stock (anti-concurrence)
 *   5. vérifier l'adresse                10. préparer le paiement
 *
 * Un panier contenant des produits de plusieurs boutiques produit **une
 * commande par boutique** : chaque vendeur a son paiement, son expédition et
 * son propre cycle de vie.
 */
export const checkoutService = {
  async checkout(user: ToumaRequestUser, input: CheckoutInput) {
    // 1. Panier
    const cart = await prisma.toumaCart.findUnique({
      where: { userId: user.id },
      include: {
        items: {
          include: {
            product: { include: { store: true, inventory: true } },
            variant: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!cart || cart.items.length === 0) throw badRequest('Votre panier est vide.');

    // 5. Adresse : doit appartenir à l'acheteur (anti-IDOR) et pointer un pays desservi.
    const address = await prisma.toumaAddress.findFirst({ where: { id: input.addressId, userId: user.id }, include: { country: true } });
    if (!address) throw notFound('Adresse de livraison introuvable.');
    if (!address.country.active || !address.country.buyingEnabled) {
      throw badRequest(`Livraison non disponible vers « ${address.countryCode} » pour l'instant.`);
    }

    // Idempotence : rejouer la même clé renvoie les commandes déjà créées
    // (un double clic, une reprise réseau, un retry mobile ne facturent pas deux fois).
    if (input.idempotencyKey) {
      const existing = await prisma.toumaOrder.findMany({
        where: { buyerId: user.id, checkoutKey: input.idempotencyKey },
        include: { items: true, store: { select: { id: true, name: true, slug: true } } },
      });
      if (existing.length > 0) return { orders: existing, idempotent: true as const };
    }

    // 2/3/4. Contrôles produit, prix et stock, boutique par boutique.
    const groups = new Map<string, typeof cart.items>();
    for (const item of cart.items) {
      const list = groups.get(item.product.storeId) ?? [];
      list.push(item);
      groups.set(item.product.storeId, list);
    }

    for (const item of cart.items) {
      if (item.product.status !== 'ACTIVE' || item.product.store.status !== 'ACTIVE') {
        throw conflict(`« ${item.product.title} » n'est plus disponible.`);
      }
      if (item.variant && !item.variant.active) throw conflict(`Variante indisponible pour « ${item.product.title} ».`);
      if (item.quantity < item.product.minOrderQty) {
        throw badRequest(`Quantité minimale de ${item.product.minOrderQty} pour « ${item.product.title} ».`);
      }
      assertSameCurrency(item.currency, item.product.currency);
    }

    // 6. Frais de livraison : un devis par boutique (choisi par l'acheteur ou le moins cher).
    const shippingByStore = new Map<string, { quoteId: string | null; amount: Prisma.Decimal }>();
    for (const [storeId, items] of groups) {
      const store = items[0].product.store;
      const currency = items[0].currency;
      const chosenId = input.shippingQuotes?.[storeId];
      if (chosenId) {
        const quote = await prisma.toumaShippingQuote.findUnique({ where: { id: chosenId } });
        if (!quote) throw badRequest('Devis de transport introuvable.');
        if (quote.expiresAt.getTime() < Date.now()) throw conflict('Devis de transport expiré : demandez un nouveau tarif.');
        assertSameCurrency(quote.currency, currency);
        shippingByStore.set(storeId, { quoteId: quote.id, amount: quote.amount });
        continue;
      }
      const weightGrams = items.reduce((acc, i) => acc + i.product.weightGrams * i.quantity, 0);
      const quotes = await logisticsService.quote({
        origin: { countryCode: store.countryCode, city: store.city },
        destination: { countryCode: address.countryCode, city: address.city },
        parcel: { weightGrams },
        currency,
      });
      const cheapest = quotes.reduce((a, b) => (new Prisma.Decimal(a.amount).lessThanOrEqualTo(new Prisma.Decimal(b.amount)) ? a : b));
      shippingByStore.set(storeId, { quoteId: cheapest.id, amount: new Prisma.Decimal(cheapest.amount) });
    }

    // 7/8/9. Création des commandes + décrément du stock, dans UNE transaction.
    const orderIds = await prisma.$transaction(async (tx) => {
      const created: string[] = [];

      for (const [storeId, items] of groups) {
        const currency = items[0].currency;
        const store = items[0].product.store;

        const lines = items.map((item) => {
          // 3. Le prix de la commande est TOUJOURS relu depuis le produit :
          //    un prix envoyé par le client n'a aucune valeur.
          const unitPrice = item.product.price.plus(item.variant?.priceDelta ?? 0);
          return {
            item,
            unitPrice,
            lineTotal: unitPrice.times(item.quantity),
          };
        });

        const subtotal = sum(lines.map((l) => l.lineTotal));
        const shipping = shippingByStore.get(storeId)!;
        const commission = applyRate(subtotal, env.touma.commissionRate, currency);
        const total = subtotal.plus(shipping.amount);

        const order = await tx.toumaOrder.create({
          data: {
            orderNumber: orderNumber(),
            buyerId: user.id,
            storeId,
            currency,
            subtotal,
            shippingTotal: shipping.amount,
            commissionTotal: commission,
            total,
            shippingAddressId: address.id,
            // Copie figée : modifier l'adresse plus tard ne change pas la commande.
            shippingSnapshot: {
              fullName: address.fullName,
              phone: address.phone,
              line1: address.line1,
              line2: address.line2,
              city: address.city,
              region: address.region,
              postalCode: address.postalCode,
              countryCode: address.countryCode,
            } as object,
            crossBorder: address.countryCode !== store.countryCode,
            buyerCountry: address.countryCode,
            sellerCountry: store.countryCode,
            note: input.note ?? null,
            checkoutKey: input.idempotencyKey ?? null,
          },
        });

        for (const line of lines) {
          const { item } = line;
          // 9. Décrément atomique : la condition `quantity >= q` empêche deux
          //    acheteurs simultanés de vendre le même dernier article.
          const decremented = await tx.toumaInventory.updateMany({
            where: { productId: item.productId, variantId: item.variantId ?? null, quantity: { gte: item.quantity } },
            data: { quantity: { decrement: item.quantity }, reserved: { increment: item.quantity } },
          });
          if (decremented.count !== 1) {
            throw conflict(`Stock insuffisant pour « ${item.product.title} ». Votre panier n'a pas été validé.`);
          }

          await tx.toumaOrderItem.create({
            data: {
              orderId: order.id,
              productId: item.productId,
              variantId: item.variantId,
              titleSnapshot: item.product.title,
              skuSnapshot: item.product.sku,
              variantSnapshot: item.variant?.name ?? null,
              imageSnapshot: null,
              unitPrice: line.unitPrice,
              quantity: item.quantity,
              lineTotal: line.lineTotal,
              currency,
            },
          });
        }

        if (shipping.quoteId) {
          await tx.toumaShippingQuote.update({ where: { id: shipping.quoteId }, data: { orderId: order.id } });
        }
        created.push(order.id);
      }

      // Le panier est vidé : les articles sont désormais des commandes.
      await tx.toumaCartItem.deleteMany({ where: { cartId: cart.id } });
      return created;
    });

    const orders = await prisma.toumaOrder.findMany({ where: { id: { in: orderIds } }, include: { items: true, store: { select: { id: true, name: true, slug: true } } } });

    // 10. Notifications (acheteur + vendeurs). Le paiement se prépare ensuite
    //     via POST /api/v1/payments/create : la commande reste PENDING.
    await Promise.all([
      ...orders.map((o) =>
        notify({
          userId: user.id,
          type: 'ORDER_CREATED',
          title: 'Commande enregistrée',
          body: `Votre commande ${o.orderNumber} est en attente de paiement.`,
          data: { orderId: o.id, orderNumber: o.orderNumber },
        }),
      ),
    ]);

    return { orders, idempotent: false as const };
  },
};

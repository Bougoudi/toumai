import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { applyRate, assertSameCurrency, roundTo, sum, ZERO } from '../lib/money.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import { logisticsService } from '../logistics/logistics.service.js';
import { couponService, type BasketStoreLine } from '../promotions/coupon.service.js';
import { loyaltyService } from '../loyalty/loyalty.service.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';
import { loadTiers, resolveUnitPrice, tiersFor } from '../catalog/pricing.js';
import { sweepReservations } from './reservation.js';
import type { CheckoutInput } from './order.schema.js';

/** Numéro de commande lisible et non devinable. */
function orderNumber(): string {
  return reference('TM');
}

/** Référence de groupe de commande (un panier validé = un groupe). */
function groupReference(): string {
  return reference('TMG');
}

function reference(prefix: string): string {
  const d = new Date();
  const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${prefix}-${day}-${randomBytes(3).toString('hex').toUpperCase()}`;
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
    // 0. Idempotence — AVANT toute autre vérification : après un checkout
    //    réussi le panier est vide, et une reprise réseau doit retrouver la
    //    commande déjà créée plutôt que se voir répondre « panier vide ».
    if (input.idempotencyKey) {
      const existing = await prisma.toumaOrderGroup.findFirst({
        where: { buyerId: user.id, checkoutKey: input.idempotencyKey },
        include: { orders: { include: { items: true, store: { select: { id: true, name: true, slug: true } } } } },
      });
      if (existing) return { group: existing, orders: existing.orders, idempotent: true as const };
    }

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

    // 4 bis. Les réservations périmées sont libérées avant de contrôler le
    // stock : sans cela, un panier abandonné il y a une heure bloquerait
    // encore l'acheteur qui paie maintenant.
    await sweepReservations();

    // 5. Adresse : doit appartenir à l'acheteur (anti-IDOR) et pointer un pays desservi.
    const address = await prisma.toumaAddress.findFirst({ where: { id: input.addressId, userId: user.id }, include: { country: true } });
    if (!address) throw notFound('Adresse de livraison introuvable.');
    if (!address.country.active || !address.country.buyingEnabled) {
      throw badRequest(`Livraison non disponible vers « ${address.countryCode} » pour l'instant.`);
    }

    // 5 bis. Mode de remise : le point relais est contrôlé (existant, actif, et
    // desservant bien le pays de livraison).
    let pickupPoint: Awaited<ReturnType<typeof prisma.toumaPickupPoint.findUnique>> = null;
    if (input.deliveryMethod === 'PICKUP_POINT') {
      if (!input.pickupPointId) throw badRequest('Choisissez un point relais.');
      pickupPoint = await prisma.toumaPickupPoint.findUnique({ where: { id: input.pickupPointId } });
      if (!pickupPoint || !pickupPoint.active) throw badRequest('Point relais indisponible.');
      if (pickupPoint.countryCode !== address.countryCode) {
        throw badRequest('Ce point relais ne dessert pas le pays de livraison choisi.');
      }
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
      const weightGrams = items.reduce((acc, i) => acc + i.product.weightGrams * i.quantity, 0);
      const chosenId = input.shippingQuotes?.[storeId];
      if (chosenId) {
        const quote = await prisma.toumaShippingQuote.findUnique({ where: { id: chosenId } });
        if (!quote) throw badRequest('Devis de transport introuvable.');
        if (quote.expiresAt.getTime() < Date.now()) throw conflict('Devis de transport expiré : demandez un nouveau tarif.');
        assertSameCurrency(quote.currency, currency);
        // Le devis doit correspondre au trajet et au poids RÉELS de la commande :
        // sans ce contrôle, un acheteur pourrait présenter un tarif national
        // (moins cher) pour une expédition transfrontalière et sous-payer le
        // transport.
        if (
          quote.originCountry !== store.countryCode ||
          quote.destinationCountry !== address.countryCode ||
          quote.weightGrams < weightGrams
        ) {
          throw badRequest('Ce devis de transport ne correspond pas à votre commande : demandez un nouveau tarif.');
        }
        shippingByStore.set(storeId, { quoteId: quote.id, amount: quote.amount });
        continue;
      }
      const quotes = await logisticsService.quote({
        origin: { countryCode: store.countryCode, city: store.city },
        destination: { countryCode: address.countryCode, city: pickupPoint?.city ?? address.city },
        parcel: { weightGrams },
        currency,
      });
      const cheapest = quotes.reduce((a, b) => (new Prisma.Decimal(a.amount).lessThanOrEqualTo(new Prisma.Decimal(b.amount)) ? a : b));
      shippingByStore.set(storeId, { quoteId: cheapest.id, amount: new Prisma.Decimal(cheapest.amount) });
    }

    // 5 ter. Paliers de prix B2B. Le palier est choisi par le serveur à partir
    // de la quantité réellement commandée : un palier réclamé par le client
    // n'existe pas. Chargés en une requête pour tout le panier.
    const tiersByProduct = await loadTiers(cart.items.map((i) => i.productId));
    /** Prix unitaire retenu pour chaque ligne, et sa justification. */
    const priceByItem = new Map<string, ReturnType<typeof resolveUnitPrice>>();
    for (const item of cart.items) {
      const listPrice = item.product.price.plus(item.variant?.priceDelta ?? 0);
      priceByItem.set(
        item.id,
        resolveUnitPrice(listPrice, item.currency, item.quantity, tiersFor(tiersByProduct.get(item.productId), item.variantId)),
      );
    }

    // 6 bis. Remises : code de réduction puis points de fidélité.
    //
    // Le sous-total par boutique est calculé ici avec la MÊME formule que dans
    // la transaction (prix du produit + delta de variante) : l'acheteur voit
    // exactement la remise qui lui sera appliquée.
    const subtotalByStore = new Map<string, Prisma.Decimal>();
    for (const [storeId, items] of groups) {
      subtotalByStore.set(
        storeId,
        sum(items.map((i) => priceByItem.get(i.id)!.unitPrice.times(i.quantity))),
      );
    }
    const basketLines: BasketStoreLine[] = [...groups.keys()].map((storeId) => ({
      storeId,
      subtotal: subtotalByStore.get(storeId)!,
      shipping: shippingByStore.get(storeId)!.amount,
      currency: groups.get(storeId)![0].currency,
    }));
    const basketCurrency = basketLines[0].currency;
    const merchandise = sum(basketLines.map((l) => l.subtotal));

    /** Remise imputée à chaque boutique, et part financée par le vendeur. */
    const discountByStore = new Map<string, Prisma.Decimal>();
    const sellerFundedByStore = new Map<string, Prisma.Decimal>();
    const addDiscount = (storeId: string, amount: Prisma.Decimal, sellerFunded: boolean) => {
      discountByStore.set(storeId, (discountByStore.get(storeId) ?? ZERO).plus(amount));
      if (sellerFunded) sellerFundedByStore.set(storeId, (sellerFundedByStore.get(storeId) ?? ZERO).plus(amount));
    };

    let coupon: Awaited<ReturnType<typeof couponService.findCoupon>> = null;
    let couponDiscount = ZERO;
    if (input.couponCode) {
      coupon = await couponService.findCoupon(input.couponCode);
      if (!coupon) throw badRequest('Code de réduction inconnu.');
      const [previousOrderCount, userRedemptions] = await Promise.all([
        prisma.toumaOrder.count({ where: { buyerId: user.id, status: { notIn: ['CANCELLED'] } } }),
        prisma.toumaCouponRedemption.count({ where: { couponId: coupon.id, userId: user.id } }),
      ]);
      const allocation = await couponService.computeDiscount({
        coupon,
        userId: user.id,
        lines: basketLines,
        destinationCountry: address.countryCode,
        previousOrderCount,
        userRedemptions,
      });
      couponDiscount = allocation.total;
      for (const [storeId, share] of allocation.byStore) {
        addDiscount(storeId, share, allocation.funding === 'STORE');
      }
    }

    // Les points s'appliquent après le code, sur la marchandise restant à payer :
    // cumuler les deux sur la même base pourrait dépasser le montant du panier.
    let loyaltyPoints = 0;
    let loyaltyDiscount = ZERO;
    if (input.loyaltyPoints > 0) {
      const merchandiseAfterCoupon = merchandise.minus(
        sum(basketLines.map((l) => discountByStore.get(l.storeId) ?? ZERO)),
      );
      const usable = await loyaltyService.usablePoints(user.id, merchandiseAfterCoupon.greaterThan(0) ? merchandiseAfterCoupon : ZERO, basketCurrency);
      if (input.loyaltyPoints > usable) {
        throw badRequest(`Vous pouvez utiliser au plus ${usable} point(s) sur ce panier.`);
      }
      loyaltyPoints = input.loyaltyPoints;
      loyaltyDiscount = loyaltyService.valueOfPoints(loyaltyPoints, basketCurrency);

      // Répartition au prorata de ce que chaque boutique reste à facturer.
      const bases = basketLines.map((l) => ({
        storeId: l.storeId,
        base: l.subtotal.minus(discountByStore.get(l.storeId) ?? ZERO),
      }));
      const totalBase = sum(bases.map((b) => b.base));
      let distributed = ZERO;
      const eligible = bases.filter((b) => b.base.greaterThan(0));
      eligible.forEach((entry, index) => {
        const share = index === eligible.length - 1
          ? loyaltyDiscount.minus(distributed)
          : roundTo(loyaltyDiscount.times(entry.base).dividedBy(totalBase), basketCurrency);
        distributed = distributed.plus(share);
        // La fidélité est une campagne TOUMA : jamais à la charge du vendeur.
        addDiscount(entry.storeId, share, false);
      });
    }

    // Copie figée de l'adresse : modifier l'adresse plus tard ne change rien.
    const shippingSnapshot = {
      fullName: address.fullName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      district: address.district,
      landmark: address.landmark,
      instructions: address.instructions,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      countryCode: address.countryCode,
      deliveryMethod: input.deliveryMethod,
      pickupPoint: pickupPoint
        ? { id: pickupPoint.id, code: pickupPoint.code, name: pickupPoint.name, addressLine: pickupPoint.addressLine, city: pickupPoint.city, landmark: pickupPoint.landmark }
        : null,
    };

    // 7/8/9. Création du groupe, des sous-commandes et décrément du stock,
    //        dans UNE transaction : tout réussit ou rien n'est écrit.
    const groupId = await prisma.$transaction(async (tx) => {
      const orderGroup = await tx.toumaOrderGroup.create({
        data: {
          reference: groupReference(),
          buyerId: user.id,
          currency: cart.items[0].currency,
          itemsTotal: new Prisma.Decimal(0),
          shippingTotal: new Prisma.Decimal(0),
          total: new Prisma.Decimal(0),
          shippingSnapshot: shippingSnapshot as object,
          checkoutKey: input.idempotencyKey ?? null,
        },
      });
      let groupItems = new Prisma.Decimal(0);
      let groupShipping = new Prisma.Decimal(0);
      let groupDiscount = new Prisma.Decimal(0);
      let groupCrossBorder = false;

      for (const [storeId, items] of groups) {
        const currency = items[0].currency;
        const store = items[0].product.store;

        const lines = items.map((item) => {
          // 3. Le prix de la commande est TOUJOURS relu depuis le produit :
          //    un prix envoyé par le client n'a aucune valeur.
          const unitPrice = priceByItem.get(item.id)!.unitPrice;
          return {
            item,
            unitPrice,
            lineTotal: unitPrice.times(item.quantity),
          };
        });

        const subtotal = sum(lines.map((l) => l.lineTotal));
        const shipping = shippingByStore.get(storeId)!;
        const discount = discountByStore.get(storeId) ?? ZERO;
        const sellerFunded = sellerFundedByStore.get(storeId) ?? ZERO;
        // La commission est assise sur ce que le vendeur encaisse réellement :
        // une remise qu'il finance la réduit, une campagne TOUMA non.
        const commission = applyRate(subtotal.minus(sellerFunded), env.touma.commissionRate, currency);
        const beforeDiscount = subtotal.plus(shipping.amount);
        // Garde-fou : une commande ne peut jamais devenir négative.
        const total = beforeDiscount.minus(discount).greaterThan(0) ? beforeDiscount.minus(discount) : ZERO;

        const crossBorder = address.countryCode !== store.countryCode;
        groupItems = groupItems.plus(subtotal);
        groupShipping = groupShipping.plus(shipping.amount);
        groupDiscount = groupDiscount.plus(discount);
        groupCrossBorder = groupCrossBorder || crossBorder;

        const order = await tx.toumaOrder.create({
          data: {
            orderNumber: orderNumber(),
            groupId: orderGroup.id,
            buyerId: user.id,
            storeId,
            currency,
            subtotal,
            shippingTotal: shipping.amount,
            commissionTotal: commission,
            discountTotal: discount,
            sellerFundedDiscount: sellerFunded,
            total,
            shippingAddressId: address.id,
            shippingSnapshot: shippingSnapshot as object,
            deliveryMethod: input.deliveryMethod,
            pickupPointId: pickupPoint?.id ?? null,
            crossBorder,
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
              // Pourquoi ce prix-là : sans cette trace, personne ne peut
              // l'expliquer six mois plus tard.
              metadata: priceByItem.get(item.id)!.appliedTier
                ? { appliedTier: priceByItem.get(item.id)!.appliedTier, listPrice: priceByItem.get(item.id)!.listPrice.toString() }
                : undefined,
            },
          });
        }

        if (shipping.quoteId) {
          await tx.toumaShippingQuote.update({ where: { id: shipping.quoteId }, data: { orderId: order.id } });
        }
      }

      // Utilisation du code : compteur incrémenté de façon CONDITIONNELLE, comme
      // pour le stock — deux paniers simultanés ne peuvent pas dépasser la limite.
      if (coupon && couponDiscount.greaterThan(0)) {
        const claimed = await tx.toumaCoupon.updateMany({
          where: coupon.usageLimit === null ? { id: coupon.id } : { id: coupon.id, usageCount: { lt: coupon.usageLimit } },
          data: { usageCount: { increment: 1 } },
        });
        if (claimed.count !== 1) throw conflict('Ce code vient d’atteindre sa limite d’utilisation.');
        await tx.toumaCouponRedemption.create({
          data: {
            couponId: coupon.id,
            userId: user.id,
            orderGroupId: orderGroup.id,
            amount: couponDiscount,
            currency: cart.items[0].currency,
          },
        });
        if (coupon.usageLimit !== null && coupon.usageCount + 1 >= coupon.usageLimit) {
          await tx.toumaCoupon.update({ where: { id: coupon.id }, data: { status: 'EXHAUSTED' } });
        }
      }

      // Débit des points : contrôle du solde par mise à jour conditionnelle.
      if (loyaltyPoints > 0) {
        await loyaltyService.redeem(tx, {
          userId: user.id,
          points: loyaltyPoints,
          orderGroupId: orderGroup.id,
          currency: cart.items[0].currency,
        });
      }

      await tx.toumaOrderGroup.update({
        where: { id: orderGroup.id },
        data: {
          itemsTotal: groupItems,
          shippingTotal: groupShipping,
          discountTotal: groupDiscount,
          total: groupItems.plus(groupShipping).minus(groupDiscount),
          crossBorder: groupCrossBorder,
        },
      });

      // Le panier est vidé : les articles sont désormais des commandes.
      await tx.toumaCartItem.deleteMany({ where: { cartId: cart.id } });
      return orderGroup.id;
    });

    const group = await prisma.toumaOrderGroup.findUniqueOrThrow({
      where: { id: groupId },
      include: { orders: { include: { items: true, store: { select: { id: true, name: true, slug: true } } } } },
    });
    const orders = group.orders;

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

    return { group, orders, idempotent: false as const };
  },
};

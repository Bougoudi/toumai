import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, parseBody, parseQuery } from '../../middleware/validate.js';
import { badRequest } from '../lib/errors.js';
import { sum, ZERO } from '../lib/money.js';
import { authenticate, currentUser } from '../middleware/toumaAuth.js';
import { couponService } from './coupon.service.js';
import { createCouponSchema, listCouponsSchema, previewSchema, updateCouponSchema } from './coupon.schema.js';

/**
 * Promotions : création et suivi des codes (vendeur ou administration), et
 * simulation sur le panier courant avant validation de commande.
 */
export const couponRouter = Router();

couponRouter.use(authenticate);

couponRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await couponService.list(currentUser(req), parseQuery(listCouponsSchema, req)));
  }),
);

couponRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    res.status(201).json(await couponService.create(currentUser(req), parseBody(createCouponSchema, req)));
  }),
);

couponRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await couponService.update(currentUser(req), req.params.id, parseBody(updateCouponSchema, req)));
  }),
);

couponRouter.get(
  '/:id/redemptions',
  asyncHandler(async (req, res) => {
    res.json(await couponService.redemptions(currentUser(req), req.params.id));
  }),
);

/**
 * Simulation d'un code sur le panier courant. La remise affichée ici est
 * calculée par la **même fonction** que celle appliquée au checkout : ce que
 * l'acheteur voit est ce qu'il paiera.
 *
 * La livraison n'étant pas encore choisie à ce stade, une remise de type
 * « livraison offerte » est annoncée sans montant : elle sera appliquée sur le
 * transport réel au moment de valider.
 */
couponRouter.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = parseBody(previewSchema, req);

    const cart = await prisma.toumaCart.findUnique({
      where: { userId: user.id },
      include: { items: { include: { product: { select: { storeId: true, price: true, currency: true } }, variant: { select: { priceDelta: true } } } } },
    });
    if (!cart || cart.items.length === 0) throw badRequest('Votre panier est vide.');

    const bystore = new Map<string, Prisma.Decimal>();
    for (const item of cart.items) {
      const line = item.product.price.plus(item.variant?.priceDelta ?? 0).times(item.quantity);
      bystore.set(item.product.storeId, (bystore.get(item.product.storeId) ?? ZERO).plus(line));
    }
    const currency = cart.items[0].product.currency;
    const lines = [...bystore.entries()].map(([storeId, subtotal]) => ({ storeId, subtotal, shipping: ZERO, currency }));

    const coupon = await couponService.findCoupon(input.code);
    if (!coupon) throw badRequest('Code de réduction inconnu.');

    // Le pays de livraison n'est pas encore arrêté : on retient celui proposé,
    // à défaut celui du compte, et le contrôle définitif se fera au checkout.
    const fallback = await prisma.user.findUnique({ where: { id: user.id }, select: { countryCode: true } });
    const destination = input.countryCode ?? fallback?.countryCode ?? '';

    const [previousOrderCount, userRedemptions] = await Promise.all([
      prisma.toumaOrder.count({ where: { buyerId: user.id, status: { notIn: ['CANCELLED'] } } }),
      prisma.toumaCouponRedemption.count({ where: { couponId: coupon.id, userId: user.id } }),
    ]);

    const allocation = await couponService.computeDiscount({
      coupon,
      userId: user.id,
      lines,
      destinationCountry: destination,
      previousOrderCount,
      userRedemptions,
    });

    res.json({
      code: coupon.code,
      description: coupon.description,
      type: coupon.type,
      label: allocation.label,
      /** Nul pour « livraison offerte » : le transport n'est pas encore calculé. */
      discount: allocation.total.toString(),
      onShipping: allocation.onShipping,
      currency: allocation.currency,
      merchandise: sum(lines.map((l) => l.subtotal)).toString(),
    });
  }),
);

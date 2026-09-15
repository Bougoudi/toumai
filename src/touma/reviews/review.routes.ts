import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { authenticate, currentUser } from '../middleware/toumaAuth.js';

/**
 * Avis Touma. Règle stricte : **seul un acheteur ayant réellement reçu le
 * produit** peut laisser un avis, et une seule fois par couple commande/produit.
 */
export const reviewRouter = Router();

const createSchema = z.object({
  orderId: z.string().cuid(),
  productId: z.string().cuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
});

/** Avis publiés d'un produit. */
reviewRouter.get(
  '/product/:productId',
  asyncHandler(async (req, res) => {
    const items = await prisma.toumaReview.findMany({
      where: { productId: req.params.productId, status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, rating: true, comment: true, createdAt: true, author: { select: { name: true } } },
    });
    res.json({ items });
  }),
);

reviewRouter.post(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = parseBody(createSchema, req);

    const order = await prisma.toumaOrder.findUnique({ where: { id: input.orderId }, include: { items: true, store: true } });
    if (!order) throw notFound('Commande introuvable.');
    if (order.buyerId !== user.id) throw forbidden('Vous ne pouvez noter que vos propres achats.');
    if (!['DELIVERED', 'COMPLETED'].includes(order.status)) {
      throw badRequest('Vous pourrez laisser un avis une fois la commande livrée.');
    }
    if (!order.items.some((i) => i.productId === input.productId)) {
      throw badRequest('Ce produit ne figure pas dans cette commande.');
    }
    const existing = await prisma.toumaReview.findUnique({
      where: { orderId_productId: { orderId: input.orderId, productId: input.productId } },
    });
    if (existing) throw conflict('Vous avez déjà laissé un avis pour ce produit sur cette commande.');

    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.toumaReview.create({
        data: { orderId: order.id, productId: input.productId, authorId: user.id, rating: input.rating, comment: input.comment ?? null },
      });
      // Notes moyennes recalculées à partir des avis publiés : au niveau du
      // produit (affiché dans le catalogue) et de la boutique.
      const productStats = await tx.toumaReview.aggregate({
        where: { status: 'PUBLISHED', productId: input.productId },
        _avg: { rating: true },
        _count: { _all: true },
      });
      await tx.toumaProduct.update({
        where: { id: input.productId },
        data: {
          ratingAverage: new Prisma.Decimal((productStats._avg.rating ?? 0).toFixed(2)),
          ratingCount: productStats._count._all,
        },
      });

      const storeStats = await tx.toumaReview.aggregate({
        where: { status: 'PUBLISHED', product: { storeId: order.storeId } },
        _avg: { rating: true },
        _count: { _all: true },
      });
      await tx.toumaStore.update({
        where: { id: order.storeId },
        data: {
          ratingAverage: new Prisma.Decimal((storeStats._avg.rating ?? 0).toFixed(2)),
          ratingCount: storeStats._count._all,
        },
      });
      return created;
    });
    res.status(201).json(review);
  }),
);

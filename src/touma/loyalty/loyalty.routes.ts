import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { sum } from '../lib/money.js';
import { authenticate, currentUser, requireAdmin } from '../middleware/toumaAuth.js';
import { loyaltyService } from './loyalty.service.js';

/** Fidélité TOUMA : solde, palier et historique de l'acheteur. */
export const loyaltyRouter = Router();

loyaltyRouter.use(authenticate);

loyaltyRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await loyaltyService.summary(currentUser(req)));
  }),
);

/** Points réellement utilisables sur le panier courant (solde, plafond, valeur). */
loyaltyRouter.get(
  '/usable',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const cart = await prisma.toumaCart.findUnique({
      where: { userId: user.id },
      include: { items: { include: { product: { select: { price: true, currency: true } }, variant: { select: { priceDelta: true } } } } },
    });
    const items = cart?.items ?? [];
    const merchandise = sum(items.map((i) => i.product.price.plus(i.variant?.priceDelta ?? 0).times(i.quantity)));
    const currency = items[0]?.product.currency ?? '';
    const usable = currency ? await loyaltyService.usablePoints(user.id, merchandise, currency) : 0;
    res.json({
      usablePoints: usable,
      value: currency ? loyaltyService.valueOfPoints(usable, currency).toString() : '0',
      /** Valeur unitaire : l'interface multiplie, elle ne décide pas du taux. */
      pointValue: env.touma.loyaltyPointValue,
      currency: currency || null,
    });
  }),
);

/** Geste commercial ou correction — administration uniquement, toujours tracé. */
loyaltyRouter.post(
  '/adjust',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = parseBody(
      z.object({
        userId: z.string().cuid(),
        points: z.number().int().min(-1_000_000).max(1_000_000),
        reason: z.string().trim().min(3).max(300),
      }),
      req,
    );
    res.json(await loyaltyService.adjust(currentUser(req), input.userId, input.points, input.reason));
  }),
);

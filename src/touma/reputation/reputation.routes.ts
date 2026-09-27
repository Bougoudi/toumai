import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, parseQuery } from '../../middleware/validate.js';
import { notFound } from '../lib/errors.js';
import { authenticate, currentUser, requireAdmin } from '../middleware/toumaAuth.js';
import { reputationService } from './reputation.service.js';

/**
 * Réputation vendeur. La fiche publique d'une boutique est consultable sans
 * compte : c'est justement ce qui aide un acheteur à décider avant de
 * s'inscrire.
 */
export const reputationRouter = Router();

reputationRouter.get(
  '/store/:idOrSlug',
  asyncHandler(async (req, res) => {
    const store = await prisma.toumaStore.findFirst({
      where: { OR: [{ id: req.params.idOrSlug }, { slug: req.params.idOrSlug }] },
      select: { id: true, status: true },
    });
    if (!store || store.status !== 'ACTIVE') throw notFound('Boutique introuvable.');
    res.json(await reputationService.get(store.id));
  }),
);

/** Vue vendeur : recalcul à la demande, avec le détail des pondérations. */
reputationRouter.get(
  '/mine/:storeId',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await reputationService.forSeller(currentUser(req), req.params.storeId));
  }),
);

reputationRouter.get(
  '/leaderboard',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { limit } = parseQuery(z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }), req);
    res.json(await reputationService.leaderboard(limit));
  }),
);

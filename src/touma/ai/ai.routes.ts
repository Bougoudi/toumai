import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { authenticate, currentUser, optionalAuth } from '../middleware/toumaAuth.js';
import { aiService } from './ai.service.js';

/**
 * TOUMA AI. Toutes les routes renvoient des **propositions** : rien n'est
 * publié, tarifé ni payé automatiquement. La validation reste humaine.
 */
export const aiRouter = Router();

const generateSchema = z.object({
  useCase: z.enum(['product_description', 'product_title', 'store_pitch', 'support_reply']),
  prompt: z.string().trim().min(2).max(2000),
  context: z.record(z.unknown()).optional(),
  maxWords: z.number().int().min(10).max(500).optional(),
});

const classifySchema = z.object({
  useCase: z.enum(['category_suggestion', 'moderation']),
  text: z.string().trim().min(2).max(4000),
  labels: z.array(z.string().trim().min(1).max(120)).min(2).max(50),
});

const recommendSchema = z.object({
  useCase: z.enum(['similar_products', 'supplier_match', 'opportunity']),
  seedProductId: z.string().cuid().optional(),
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(24).optional(),
});

aiRouter.get('/provider', asyncHandler(async (_req, res) => res.json(aiService.providerInfo())));

aiRouter.post(
  '/generate',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = parseBody(generateSchema, req);
    const result = await aiService.generate(currentUser(req).id, input);
    res.json({ ...result, requiresHumanReview: true });
  }),
);

aiRouter.post(
  '/classify',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = parseBody(classifySchema, req);
    res.json({ ...(await aiService.classify(currentUser(req).id, input)), requiresHumanReview: true });
  }),
);

/** Recommandations : ouvertes aux visiteurs (recherche naturelle du catalogue). */
aiRouter.post(
  '/recommend',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const input = parseBody(recommendSchema, req);
    res.json(await aiService.recommend(req.toumaUser?.id ?? null, { ...input, userId: req.toumaUser?.id ?? null }));
  }),
);

import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { authenticate, currentUser, optionalAuth } from '../middleware/toumaAuth.js';
import { aiService } from './ai.service.js';

/**
 * TOUMA AI — points d'entrée de premier niveau.
 *
 * Tout ce qui sort d'ici est une **proposition**. Rien n'est publié, tarifé,
 * commandé ni payé par ces routes.
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
    res.json(await aiService.generate(currentUser(req).id, input));
  }),
);

aiRouter.post(
  '/classify',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = parseBody(classifySchema, req);
    res.json(await aiService.classify(currentUser(req).id, input));
  }),
);

/**
 * Recommandations : lisibles par un visiteur, parce qu'un acheteur non
 * connecté a besoin de voir des produits voisins sur une fiche. La trace et la
 * persistance, elles, sont réservées aux utilisateurs connus — une lecture
 * anonyme ne doit pas écrire en base (défaut relevé à l'audit V23).
 */
aiRouter.post(
  '/recommend',
  optionalAuth,
  asyncHandler(async (req, res) => {
    if (!env.touma.ai.recommendationsEnabled) return res.status(503).json({ error: 'Recommandations désactivées.' });
    const input = parseBody(recommendSchema, req);
    res.json(await aiService.recommend(req.toumaUser?.id ?? null, input));
  }),
);

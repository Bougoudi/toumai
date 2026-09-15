import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseQuery } from '../../middleware/validate.js';
import { optionalAuth } from '../middleware/toumaAuth.js';
import { sourcingService } from './sourcing.service.js';

/**
 * Sourcing fournisseurs. Consultable **sans compte** : un acheteur en gros
 * évalue l'offre disponible avant de s'inscrire, pas l'inverse.
 */
export const sourcingRouter = Router();

const searchSchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(120).optional(),
  /** Pays du fournisseur. */
  country: z.string().trim().toUpperCase().length(2).optional(),
  /** Pays de livraison visé : on regarde s'il a déjà été desservi. */
  destination: z.string().trim().toUpperCase().length(2).optional(),
  minQuantity: z.coerce.number().int().min(1).max(100_000_000).optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  sort: z.enum(['relevance', 'capacity', 'reputation', 'price']).default('relevance'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

sourcingRouter.get(
  '/suppliers',
  optionalAuth,
  asyncHandler(async (req, res) => {
    res.json(await sourcingService.searchSuppliers(parseQuery(searchSchema, req)));
  }),
);

sourcingRouter.get(
  '/suppliers/:idOrSlug',
  optionalAuth,
  asyncHandler(async (req, res) => {
    res.json(await sourcingService.supplierProfile(req.params.idOrSlug));
  }),
);

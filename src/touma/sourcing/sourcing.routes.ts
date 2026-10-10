import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseBody, parseQuery } from '../../middleware/validate.js';
import { authenticate, currentUser, optionalAuth } from '../middleware/toumaAuth.js';
import { sourcingService } from './sourcing.service.js';
import { declarer } from './supplier-profile.service.js';

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
  sort: z.enum(['relevance', 'capacity', 'reputation', 'price', 'trust']).default('relevance'),
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

/**
 * Le fournisseur déclare son profil commercial (V28 §1, §2).
 *
 * Réservé au propriétaire de la boutique. Rien de ce qui est écrit ici n'est
 * vérifié, et rien ne peut l'être par ce chemin : la vérification passe par
 * Touma Verified, avec des pièces justificatives.
 */
const profilSchema = z.object({
  types: z.array(z.enum(['MANUFACTURER', 'WHOLESALER', 'DISTRIBUTOR', 'RETAILER', 'TRADER', 'SERVICE_PROVIDER'])).max(6).optional(),
  countries: z.array(z.string().trim().length(2)).max(60).optional(),
  currencies: z.array(z.string().trim().length(3)).max(10).optional(),
  leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
  // Montant en chaîne : un flottant perdrait des unités, et V20 §49 l'interdit.
  minOrderValue: z.string().trim().regex(/^\d+(\.\d{1,4})?$/).nullable().optional(),
  minOrderQty: z.number().int().min(1).max(100_000_000).nullable().optional(),
  paymentTerms: z.string().trim().max(500).nullable().optional(),
  shippingNotes: z.string().trim().max(1000).nullable().optional(),
});

sourcingRouter.put(
  '/suppliers/:storeId/profile',
  authenticate,
  asyncHandler(async (req, res) => {
    const entree = parseBody(profilSchema, req);
    res.json(await declarer(currentUser(req), req.params.storeId, entree));
  }),
);

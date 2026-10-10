import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseBody, parseQuery } from '../../middleware/validate.js';
import { badRequest } from '../lib/errors.js';
import { auditRequest } from '../lib/audit.js';
import { authenticate, currentUser, optionalAuth, requireRole } from '../middleware/toumaAuth.js';
import { createProductSchema, listProductsSchema, priceTiersSchema, updateProductSchema } from './product.schema.js';
import { productService } from './product.service.js';
import { productAvailability } from '../logistics/service-zones.js';
import { facetsService } from './facets.service.js';
import { intelligenceService } from '../admin/intelligence.service.js';

export const productRouter = Router();

const stockSchema = z.object({
  variantId: z.string().cuid().nullable().optional(),
  quantity: z.number().int().min(0).max(10_000_000),
});

const sellerListSchema = z.object({
  storeId: z.string().cuid().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED', 'SUSPENDED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Catalogue du vendeur connecté (avant `/:id` pour ne pas être capturé). */
productRouter.get(
  '/mine',
  authenticate,
  requireRole('SELLER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const query = parseQuery(sellerListSchema, req);
    res.json(await productService.listForSeller(currentUser(req), query));
  }),
);

/** Catalogue public : filtres, tri et pagination côté serveur. */
productRouter.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const query = parseQuery(listProductsSchema, req);
    const result = await productService.list(query);

    // Mesure de la demande : ce que les acheteurs cherchent sans trouver est le
    // meilleur indice de ce qui manque au catalogue. Journalisé de façon
    // anonyme (terme, nombre de résultats, pays) — jamais rattaché à un compte.
    // La première page seule est comptée : la pagination n'est pas une nouvelle
    // recherche.
    if (query.q && query.page === 1) {
      void intelligenceService.recordSearch({ term: query.q, resultCount: result.total, userId: req.toumaUser?.id });
    }
    res.json(result);
  }),
);

/**
 * Facettes de la recherche en cours : combien de résultats chaque filtre
 * donnerait. Sans ces compteurs, l'acheteur clique à l'aveugle et tombe sur des
 * listes vides.
 */
productRouter.get(
  '/facets',
  asyncHandler(async (req, res) => {
    res.json(await facetsService.forQuery(parseQuery(listProductsSchema, req)));
  }),
);

productRouter.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    res.json(await productService.get(req.params.id, req.toumaUser));
  }),
);

/**
 * « Est-ce que ça peut arriver chez moi ? »
 *
 * La première question d'un acheteur d'Abéché, et la seule à laquelle rien ne
 * répondait. Deux conditions s'y rencontrent : le vendeur accepte d'envoyer
 * là-bas, **et** un transporteur y va. Les deux doivent dire oui.
 *
 * Quatre réponses possibles, et aucune n'est « probablement » : quand le
 * système ne sait pas, il le dit.
 */
productRouter.get(
  '/:id/disponibilite',
  asyncHandler(async (req, res) => {
    const province = typeof req.query.province === 'string' ? req.query.province : '';
    if (!province) throw badRequest('Indiquez la province de livraison.');
    res.json(await productAvailability(req.params.id, province));
  }),
);

productRouter.post(
  '/',
  authenticate,
  requireRole('SELLER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = parseBody(createProductSchema, req);
    const product = await productService.create(currentUser(req), input);
    await auditRequest(req, 'product.create', 'ToumaProduct', product.id, { storeId: product.storeId });
    res.status(201).json(product);
  }),
);

productRouter.patch(
  '/:id',
  authenticate,
  requireRole('SELLER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = parseBody(updateProductSchema, req);
    const product = await productService.update(req.params.id, currentUser(req), input);
    await auditRequest(req, 'product.update', 'ToumaProduct', product.id, { fields: Object.keys(input) });
    res.json(product);
  }),
);

/** Grille de paliers : lecture publique, écriture réservée au vendeur. */
productRouter.get(
  '/:id/paliers',
  asyncHandler(async (req, res) => res.json(await productService.priceTiers(req.params.id))),
);

productRouter.put(
  '/:id/paliers',
  authenticate,
  requireRole('SELLER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = parseBody(priceTiersSchema, req);
    const result = await productService.setPriceTiers(req.params.id, currentUser(req), input.tiers);
    await auditRequest(req, 'product.price_tiers.set', 'ToumaProduct', result.productId, { paliers: input.tiers.length });
    res.json(result);
  }),
);

productRouter.put(
  '/:id/stock',
  authenticate,
  requireRole('SELLER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = parseBody(stockSchema, req);
    res.json(await productService.setStock(req.params.id, currentUser(req), input));
  }),
);

/** Suppression = archivage : l'historique des commandes reste intact. */
productRouter.delete(
  '/:id',
  authenticate,
  requireRole('SELLER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const product = await productService.archive(req.params.id, currentUser(req));
    await auditRequest(req, 'product.archive', 'ToumaProduct', product.id);
    res.json({ archived: true, id: product.id });
  }),
);

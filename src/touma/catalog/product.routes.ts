import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseBody, parseQuery } from '../../middleware/validate.js';
import { auditRequest } from '../lib/audit.js';
import { authenticate, currentUser, optionalAuth, requireRole } from '../middleware/toumaAuth.js';
import { createProductSchema, listProductsSchema, updateProductSchema } from './product.schema.js';
import { productService } from './product.service.js';

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
  asyncHandler(async (req, res) => {
    res.json(await productService.list(parseQuery(listProductsSchema, req)));
  }),
);

productRouter.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    res.json(await productService.get(req.params.id, req.toumaUser));
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

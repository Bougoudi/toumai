import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody, parseQuery } from '../../middleware/validate.js';
import { cjService } from './cj.service.js';
import { generationService } from './generation.service.js';
import {
  createProductSchema,
  generateProductsSchema,
  listProductsQuerySchema,
  updateProductSchema,
} from './product.schema.js';
import { productService } from './product.service.js';

const cjImportSchema = z.object({
  url: z.string().trim().min(5).max(500),
  exchangeRate: z.number().positive().max(100_000).optional(),
  markup: z.number().min(1).max(20).optional(),
  salePrice: z.number().positive().optional(),
  publish: z.boolean().default(true),
});

const paginationSchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

export const productController = {
  async list(req: Request, res: Response) {
    const query = parseQuery(listProductsQuerySchema, req);
    res.json(await productService.list(query));
  },

  async get(req: Request, res: Response) {
    res.json(await productService.getById(req.params.id));
  },

  async create(req: Request, res: Response) {
    const input = parseBody(createProductSchema, req);
    res.status(201).json(await productService.create(input));
  },

  async update(req: Request, res: Response) {
    const input = parseBody(updateProductSchema, req);
    res.json(await productService.update(req.params.id, input));
  },

  async remove(req: Request, res: Response) {
    await productService.remove(req.params.id);
    res.status(204).send();
  },

  /** POST /api/products/generate — génération en masse (pilier 2). */
  async generate(req: Request, res: Response) {
    const input = parseBody(generateProductsSchema, req);
    const run = await generationService.generate(input);
    res.status(201).json(run);
  },

  /** POST /api/products/import/cj — importe un produit depuis un lien CJdropshipping. */
  async importCj(req: Request, res: Response) {
    const input = parseBody(cjImportSchema, req);
    res.status(201).json(await cjService.importFromUrl(input));
  },

  async listRuns(req: Request, res: Response) {
    const query = parseQuery(paginationSchema, req);
    res.json(await generationService.listRuns(query));
  },

  async getRun(req: Request, res: Response) {
    res.json(await generationService.getRun(req.params.id));
  },
};

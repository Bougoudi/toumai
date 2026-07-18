import type { Request, Response } from 'express';
import { parseBody, parseQuery } from '../../middleware/validate.js';
import {
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
} from './product.schema.js';
import { productService } from './product.service.js';

export const productController = {
  async list(req: Request, res: Response) {
    const query = parseQuery(listProductsQuerySchema, req);
    const result = await productService.list(query);
    res.json(result);
  },

  async get(req: Request, res: Response) {
    const product = await productService.getById(req.params.id);
    res.json(product);
  },

  async create(req: Request, res: Response) {
    const input = parseBody(createProductSchema, req);
    const product = await productService.create(input);
    res.status(201).json(product);
  },

  async update(req: Request, res: Response) {
    const input = parseBody(updateProductSchema, req);
    const product = await productService.update(req.params.id, input);
    res.json(product);
  },

  async remove(req: Request, res: Response) {
    await productService.remove(req.params.id);
    res.status(204).send();
  },
};

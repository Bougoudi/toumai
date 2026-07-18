import type { Request, Response } from 'express';
import { parseBody, parseQuery } from '../../middleware/validate.js';
import {
  createSupplierSchema,
  listSuppliersQuerySchema,
  offerInputSchema,
  updateSupplierSchema,
} from './supplier.schema.js';
import { supplierService } from './supplier.service.js';

export const supplierController = {
  async list(req: Request, res: Response) {
    const query = parseQuery(listSuppliersQuerySchema, req);
    res.json(await supplierService.list(query));
  },

  async get(req: Request, res: Response) {
    res.json(await supplierService.getById(req.params.id));
  },

  async create(req: Request, res: Response) {
    const input = parseBody(createSupplierSchema, req);
    res.status(201).json(await supplierService.create(input));
  },

  async update(req: Request, res: Response) {
    const input = parseBody(updateSupplierSchema, req);
    res.json(await supplierService.update(req.params.id, input));
  },

  async remove(req: Request, res: Response) {
    await supplierService.remove(req.params.id);
    res.status(204).send();
  },

  async addOffer(req: Request, res: Response) {
    const input = parseBody(offerInputSchema, req);
    res.status(201).json(await supplierService.addOffer(req.params.id, input));
  },
};

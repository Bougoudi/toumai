import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody, parseQuery } from '../../middleware/validate.js';
import { fulfillmentService } from './fulfillment.service.js';
import { createCustomerSchema, createOrderSchema, listOrdersQuerySchema } from './order.schema.js';
import { orderService } from './order.service.js';

const paginationSchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

export const orderController = {
  async createCustomer(req: Request, res: Response) {
    const input = parseBody(createCustomerSchema, req);
    res.status(201).json(await orderService.createCustomer(input));
  },

  async listCustomers(req: Request, res: Response) {
    const query = parseQuery(paginationSchema, req);
    res.json(await orderService.listCustomers(query));
  },

  async create(req: Request, res: Response) {
    const input = parseBody(createOrderSchema, req);
    res.status(201).json(await orderService.create(input));
  },

  async list(req: Request, res: Response) {
    const query = parseQuery(listOrdersQuerySchema, req);
    res.json(await orderService.list(query));
  },

  async get(req: Request, res: Response) {
    res.json(await orderService.getById(req.params.id));
  },

  async cancel(req: Request, res: Response) {
    res.json(await orderService.cancel(req.params.id));
  },

  /** POST /api/orders/:id/fulfill — force l'exécution immédiate (pilier 3). */
  async fulfill(req: Request, res: Response) {
    const order = await orderService.getById(req.params.id);
    const status = await fulfillmentService.fulfillOrder(order);
    res.json({ orderId: order.id, status });
  },
};

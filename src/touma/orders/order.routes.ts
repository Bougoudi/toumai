import { Router } from 'express';
import { asyncHandler, parseBody, parseQuery } from '../../middleware/validate.js';
import { auditRequest } from '../lib/audit.js';
import { authenticate, currentUser } from '../middleware/toumaAuth.js';
import { checkoutService } from './checkout.service.js';
import { checkoutSchema, listOrdersSchema, updateOrderStatusSchema } from './order.schema.js';
import { orderService } from './order.service.js';

export const orderRouter = Router();
export const checkoutRouter = Router();

orderRouter.use(authenticate);
checkoutRouter.use(authenticate);

/** Aperçu du checkout (frais, totaux) — ne crée rien. */
checkoutRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parseBody(checkoutSchema, req);
    const result = await checkoutService.checkout(currentUser(req), input);
    await auditRequest(req, 'checkout.complete', 'ToumaOrder', result.orders[0]?.id, {
      orders: result.orders.length,
      idempotent: result.idempotent,
    });
    res.status(result.idempotent ? 200 : 201).json({
      orders: result.orders.map((o) => ({ ...o, subtotal: o.subtotal.toString(), shippingTotal: o.shippingTotal.toString(), total: o.total.toString(), commissionTotal: o.commissionTotal.toString() })),
      idempotent: result.idempotent,
    });
  }),
);

/** POST /orders = checkout (alias explicite demandé par l'API v1). */
orderRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parseBody(checkoutSchema, req);
    const result = await checkoutService.checkout(currentUser(req), input);
    await auditRequest(req, 'order.create', 'ToumaOrder', result.orders[0]?.id, { orders: result.orders.length });
    res.status(result.idempotent ? 200 : 201).json({
      orders: result.orders.map((o) => ({ ...o, subtotal: o.subtotal.toString(), shippingTotal: o.shippingTotal.toString(), total: o.total.toString(), commissionTotal: o.commissionTotal.toString() })),
      idempotent: result.idempotent,
    });
  }),
);

orderRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await orderService.list(currentUser(req), parseQuery(listOrdersSchema, req)));
  }),
);

orderRouter.get('/:id', asyncHandler(async (req, res) => res.json(await orderService.get(currentUser(req), req.params.id))));

orderRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const input = parseBody(updateOrderStatusSchema, req);
    const order = await orderService.updateStatus(currentUser(req), req.params.id, input.status, input.reason);
    await auditRequest(req, 'order.status.update', 'ToumaOrder', req.params.id, { status: input.status });
    res.json(order);
  }),
);

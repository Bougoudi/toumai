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

/** Sérialise un groupe et ses sous-commandes (montants en chaînes décimales). */
function serializeCheckout(result: Awaited<ReturnType<typeof checkoutService.checkout>>) {
  return {
    group: {
      id: result.group.id,
      reference: result.group.reference,
      status: result.group.status,
      currency: result.group.currency,
      itemsTotal: result.group.itemsTotal.toString(),
      shippingTotal: result.group.shippingTotal.toString(),
      discountTotal: result.group.discountTotal.toString(),
      total: result.group.total.toString(),
      crossBorder: result.group.crossBorder,
      orderCount: result.orders.length,
    },
    orders: result.orders.map((o) => ({
      ...o,
      subtotal: o.subtotal.toString(),
      shippingTotal: o.shippingTotal.toString(),
      total: o.total.toString(),
      commissionTotal: o.commissionTotal.toString(),
    })),
    idempotent: result.idempotent,
  };
}

/**
 * Validation du panier. Un panier multi-vendeurs crée UN groupe (payé en une
 * fois) et une sous-commande par boutique.
 */
async function handleCheckout(req: Parameters<typeof currentUser>[0], res: { status: (code: number) => { json: (body: unknown) => void } }, action: string) {
  const input = parseBody(checkoutSchema, req);
  const result = await checkoutService.checkout(currentUser(req), input);
  await auditRequest(req, action, 'ToumaOrderGroup', result.group.id, {
    orders: result.orders.length,
    idempotent: result.idempotent,
  });
  res.status(result.idempotent ? 200 : 201).json(serializeCheckout(result));
}

checkoutRouter.post('/', asyncHandler(async (req, res) => handleCheckout(req, res, 'checkout.complete')));

/** POST /orders = checkout (alias explicite demandé par l'API v1). */
orderRouter.post('/', asyncHandler(async (req, res) => handleCheckout(req, res, 'order.create')));

/** Détail d'un groupe de commande (paiement unique, plusieurs vendeurs). */
orderRouter.get(
  '/groups/:id',
  asyncHandler(async (req, res) => {
    res.json(await orderService.getGroup(currentUser(req), req.params.id));
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

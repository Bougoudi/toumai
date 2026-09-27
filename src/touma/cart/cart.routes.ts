import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { authenticate, currentUser } from '../middleware/toumaAuth.js';
import { cartService } from './cart.service.js';

export const cartRouter = Router();

const addSchema = z.object({
  productId: z.string().cuid(),
  variantId: z.string().cuid().nullable().optional(),
  quantity: z.number().int().min(1).max(100000).default(1),
});

const updateSchema = z.object({ quantity: z.number().int().min(0).max(100000) });

// Le panier appartient toujours à l'utilisateur connecté : aucun identifiant de
// panier n'est accepté depuis le client (protection IDOR par construction).
cartRouter.use(authenticate);

cartRouter.get('/', asyncHandler(async (req, res) => res.json(await cartService.get(currentUser(req).id))));

cartRouter.post(
  '/items',
  asyncHandler(async (req, res) => {
    const input = parseBody(addSchema, req);
    res.status(201).json(await cartService.addItem(currentUser(req).id, input));
  }),
);

cartRouter.patch(
  '/items/:id',
  asyncHandler(async (req, res) => {
    const { quantity } = parseBody(updateSchema, req);
    res.json(await cartService.updateItem(currentUser(req).id, req.params.id, quantity));
  }),
);

cartRouter.delete('/items/:id', asyncHandler(async (req, res) => res.json(await cartService.removeItem(currentUser(req).id, req.params.id))));

cartRouter.delete('/', asyncHandler(async (req, res) => res.json(await cartService.clear(currentUser(req).id))));

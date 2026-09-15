import { Router } from 'express';
import { asyncHandler, parseBody, parseQuery } from '../../middleware/validate.js';
import { authenticate, currentUser } from '../middleware/toumaAuth.js';
import { supportService } from './support.service.js';
import { createTicketSchema, listTicketsSchema, replySchema, updateTicketSchema } from './support.schema.js';

/** Assistance : tickets ouverts par les acheteurs, vendeurs et entreprises. */
export const supportRouter = Router();

supportRouter.use(authenticate);

supportRouter.get(
  '/tickets',
  asyncHandler(async (req, res) => {
    res.json(await supportService.list(currentUser(req), parseQuery(listTicketsSchema, req)));
  }),
);

supportRouter.post(
  '/tickets',
  asyncHandler(async (req, res) => {
    res.status(201).json(await supportService.create(currentUser(req), parseBody(createTicketSchema, req)));
  }),
);

supportRouter.get(
  '/tickets/:id',
  asyncHandler(async (req, res) => {
    res.json(await supportService.get(currentUser(req), req.params.id));
  }),
);

supportRouter.post(
  '/tickets/:id/messages',
  asyncHandler(async (req, res) => {
    res.status(201).json(await supportService.reply(currentUser(req), req.params.id, parseBody(replySchema, req)));
  }),
);

supportRouter.patch(
  '/tickets/:id',
  asyncHandler(async (req, res) => {
    res.json(await supportService.update(currentUser(req), req.params.id, parseBody(updateTicketSchema, req)));
  }),
);

supportRouter.post(
  '/tickets/:id/close',
  asyncHandler(async (req, res) => {
    res.json(await supportService.close(currentUser(req), req.params.id));
  }),
);

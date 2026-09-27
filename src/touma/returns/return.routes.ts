import { Router } from 'express';
import { asyncHandler, parseBody, parseQuery } from '../../middleware/validate.js';
import { authenticate, currentUser } from '../middleware/toumaAuth.js';
import { returnService } from './return.service.js';
import {
  approveReturnSchema,
  createReturnSchema,
  listReturnsSchema,
  receiveReturnSchema,
  refundSchema,
  rejectReturnSchema,
  shipReturnSchema,
} from './return.schema.js';

/**
 * Après-vente : demandes de retour et remboursements associés.
 * Toutes les routes exigent un compte ; chaque action revérifie la propriété
 * de la demande (acheteur, vendeur de la boutique, ou administration).
 */
export const returnRouter = Router();

returnRouter.use(authenticate);

/** Ce qui est retournable sur une commande, et jusqu'à quelle date. */
returnRouter.get(
  '/eligibility/:orderId',
  asyncHandler(async (req, res) => {
    res.json(await returnService.eligibility(currentUser(req), req.params.orderId));
  }),
);

returnRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await returnService.list(currentUser(req), parseQuery(listReturnsSchema, req)));
  }),
);

returnRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    res.status(201).json(await returnService.create(currentUser(req), parseBody(createReturnSchema, req)));
  }),
);

returnRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await returnService.get(currentUser(req), req.params.id));
  }),
);

returnRouter.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    res.json(await returnService.approve(currentUser(req), req.params.id, parseBody(approveReturnSchema, req)));
  }),
);

returnRouter.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const { note } = parseBody(rejectReturnSchema, req);
    res.json(await returnService.reject(currentUser(req), req.params.id, note));
  }),
);

returnRouter.post(
  '/:id/ship',
  asyncHandler(async (req, res) => {
    const { trackingNumber } = parseBody(shipReturnSchema, req);
    res.json(await returnService.ship(currentUser(req), req.params.id, trackingNumber));
  }),
);

returnRouter.post(
  '/:id/receive',
  asyncHandler(async (req, res) => {
    res.json(await returnService.receive(currentUser(req), req.params.id, parseBody(receiveReturnSchema, req)));
  }),
);

returnRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    res.json(await returnService.cancel(currentUser(req), req.params.id));
  }),
);

/** Remboursement du retour — mouvement d'argent, toujours décidé par un humain. */
returnRouter.post(
  '/:id/refund',
  asyncHandler(async (req, res) => {
    res.json(await returnService.refund(currentUser(req), req.params.id, parseBody(refundSchema, req)));
  }),
);

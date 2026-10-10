import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseQuery } from '../../middleware/validate.js';
import { authenticate, currentUser } from '../middleware/toumaAuth.js';
import { documentService } from './document.service.js';

/**
 * Documents commerciaux. Tous privés : facture, avoir, reçu, bon de commande et
 * bon de livraison ne sont visibles que de leurs deux parties (et de
 * l'administration). Un document d'autrui répond « introuvable ».
 */
export const documentRouter = Router();

documentRouter.use(authenticate);

const listSchema = z.object({
  /** `buyer` = mes documents ; `seller` = ceux émis par mes boutiques. */
  scope: z.enum(['buyer', 'seller']).default('buyer'),
  type: z.enum(['INVOICE', 'CREDIT_NOTE', 'PAYMENT_RECEIPT', 'PURCHASE_ORDER', 'DELIVERY_NOTE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

documentRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await documentService.list(currentUser(req), parseQuery(listSchema, req)));
  }),
);

/** Documents rattachés à une commande, pour les afficher sur sa page. */
documentRouter.get(
  '/order/:orderId',
  asyncHandler(async (req, res) => {
    res.json(await documentService.forOrder(currentUser(req), req.params.orderId));
  }),
);

/** Ce qu'une boutique a facturé et avoiré, par devise. */
documentRouter.get(
  '/store/:storeId/totals',
  asyncHandler(async (req, res) => {
    res.json(await documentService.sellerTotals(currentUser(req), req.params.storeId));
  }),
);

documentRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await documentService.get(currentUser(req), req.params.id));
  }),
);

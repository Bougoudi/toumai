import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { authenticate, currentUser, requireAdmin } from '../middleware/toumaAuth.js';
import { paymentService } from './payment.service.js';

export const paymentRouter = Router();

const createSchema = z.object({
  orderId: z.string().cuid(),
  method: z.enum(['MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'CASH_ON_DELIVERY', 'MOCK']).default('MOBILE_MONEY'),
  provider: z.string().trim().max(40).optional(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  returnUrl: z.string().trim().url().max(500).optional(),
});

const confirmSchema = z.object({
  paymentId: z.string().cuid(),
  /** Charge utile transmise au prestataire (jamais de données bancaires). */
  payload: z.record(z.unknown()).optional(),
});

const refundSchema = z.object({ paymentId: z.string().cuid(), amount: z.string().regex(/^\d+(\.\d{1,4})?$/).optional() });

paymentRouter.get('/providers', asyncHandler(async (_req, res) => res.json({ items: paymentService.listProviders() })));

paymentRouter.post(
  '/create',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = parseBody(createSchema, req);
    // L'en-tête standard `Idempotency-Key` est accepté comme alternative.
    const headerKey = req.header('idempotency-key') ?? undefined;
    const result = await paymentService.create(currentUser(req), { ...input, idempotencyKey: input.idempotencyKey ?? headerKey });
    res.status(result.idempotent ? 200 : 201).json({
      payment: { ...result.payment, amount: result.payment.amount.toString(), refundedAmount: result.payment.refundedAmount.toString() },
      checkoutUrl: result.checkoutUrl,
      idempotent: result.idempotent,
    });
  }),
);

/**
 * Confirmation : le serveur interroge le prestataire. Le front ne peut jamais
 * décider seul qu'un paiement a réussi.
 */
paymentRouter.post(
  '/confirm',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = parseBody(confirmSchema, req);
    const payment = await paymentService.confirm(currentUser(req), input);
    res.json({ ...payment, amount: payment.amount.toString(), refundedAmount: payment.refundedAmount.toString() });
  }),
);

paymentRouter.post(
  '/refund',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = parseBody(refundSchema, req);
    const payment = await paymentService.refund(currentUser(req), input.paymentId, input.amount);
    res.json({ ...payment, amount: payment.amount.toString(), refundedAmount: payment.refundedAmount.toString() });
  }),
);

paymentRouter.get('/:id', authenticate, asyncHandler(async (req, res) => res.json(await paymentService.get(currentUser(req), req.params.id))));

/**
 * Webhook prestataire — **public** (le PSP n'a pas de jeton Touma) mais la
 * signature est obligatoire. Le corps brut est requis pour la vérifier : ce
 * routeur est monté avant `express.json()` (voir `touma.routes.ts`).
 */
export const paymentWebhookRouter = Router();

paymentWebhookRouter.post(
  '/:provider',
  express.raw({ type: '*/*', limit: '512kb' }),
  asyncHandler(async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
    const result = await paymentService.handleWebhook(req.params.provider, raw, req.headers);
    res.json({ received: true, ...result });
  }),
);

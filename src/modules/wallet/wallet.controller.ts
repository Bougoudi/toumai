import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody } from '../../middleware/validate.js';
import { walletService } from './wallet.service.js';

const withdrawSchema = z
  .object({
    amount: z.number().positive(),
    method: z.enum(['bank', 'paypal', 'card', 'stripe']),
    destination: z.string().optional(),
  })
  .refine((v) => v.method === 'stripe' || (v.destination?.trim().length ?? 0) >= 3, {
    message: 'Destination requise (IBAN, email PayPal ou numéro de carte).',
    path: ['destination'],
  });

export const walletController = {
  async overview(_req: Request, res: Response) {
    const [balance, withdrawals, payouts] = await Promise.all([
      walletService.balance(),
      walletService.list(),
      walletService.payoutStatus(),
    ]);
    res.json({ ...balance, withdrawals, payouts });
  },

  /** POST /api/wallet/withdraw — protégé par step-up (ré-authentification). */
  async withdraw(req: Request, res: Response) {
    const input = parseBody(withdrawSchema, req);
    res.status(201).json(await walletService.request(input));
  },

  async cancel(req: Request, res: Response) {
    res.json(await walletService.cancel(req.params.id));
  },

  /** GET /api/wallet/payouts — état de la connexion Stripe Payouts. */
  async payoutStatus(_req: Request, res: Response) {
    res.json(await walletService.payoutStatus());
  },

  /** POST /api/wallet/connect — démarre l'onboarding Stripe Payouts (step-up). */
  async connect(_req: Request, res: Response) {
    res.json(await walletService.connectStripe());
  },
};

import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody } from '../../middleware/validate.js';
import { walletService } from './wallet.service.js';

const withdrawSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(['bank', 'paypal']),
  destination: z.string().min(3, 'Destination requise (IBAN ou email PayPal)'),
});

export const walletController = {
  async overview(_req: Request, res: Response) {
    const [balance, withdrawals] = await Promise.all([walletService.balance(), walletService.list()]);
    res.json({ ...balance, withdrawals });
  },

  /** POST /api/wallet/withdraw — protégé par step-up (ré-authentification). */
  async withdraw(req: Request, res: Response) {
    const input = parseBody(withdrawSchema, req);
    res.status(201).json(await walletService.request(input));
  },

  async cancel(req: Request, res: Response) {
    res.json(await walletService.cancel(req.params.id));
  },
};

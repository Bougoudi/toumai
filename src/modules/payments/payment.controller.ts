import type { Request, Response } from 'express';
import { paymentService } from './payment.service.js';

export const paymentController = {
  /** GET /api/payments/status — indique si le paiement est configuré. */
  status(_req: Request, res: Response) {
    res.json({ enabled: paymentService.enabled() });
  },

  /** POST /api/payments/checkout/:orderId — crée une session de paiement Stripe. */
  async checkout(req: Request, res: Response) {
    const result = await paymentService.createCheckout(req.params.orderId);
    res.json(result);
  },

  /**
   * POST /api/webhooks/stripe — reçoit les événements Stripe (corps brut requis).
   * Monté séparément avec express.raw dans app.ts.
   */
  async webhook(req: Request, res: Response) {
    const result = await paymentService.handleWebhook(
      req.body as Buffer,
      req.header('stripe-signature'),
    );
    res.json(result);
  },
};

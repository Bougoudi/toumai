import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { paymentService } from './payment.service.js';
import { iyzicoService } from './iyzico.service.js';

export const paymentController = {
  /** GET /api/payments/status — indique si le paiement est configuré + prestataire. */
  status(_req: Request, res: Response) {
    res.json({
      enabled: paymentService.enabled(),
      provider: paymentService.provider(),
      sandbox: paymentService.provider() === 'iyzico' ? env.iyzico.sandbox : undefined,
    });
  },

  /** POST /api/payments/checkout/:orderId — crée une page de paiement carte. */
  async checkout(req: Request, res: Response) {
    const result = await paymentService.createCheckout(req.params.orderId);
    res.json(result);
  },

  /**
   * POST /api/payments/iyzico/callback — retour de la page de paiement iyzico.
   * iyzico redirige le NAVIGATEUR du client ici (corps urlencoded avec `token`).
   * Monté séparément et en public dans app.ts (le client n'a pas notre jeton).
   * On relit le paiement, on marque la commande, puis on renvoie le client vers
   * l'appli avec un statut lisible (?paid=… / ?canceled=…).
   */
  async iyzicoCallback(req: Request, res: Response) {
    const token = (req.body?.token as string | undefined) ?? (req.query.token as string | undefined);
    try {
      const { orderNumber, paid } = await iyzicoService.handleCallback(token);
      const q = paid
        ? `paid=${encodeURIComponent(orderNumber ?? '1')}`
        : `canceled=${encodeURIComponent(orderNumber ?? '1')}`;
      res.redirect(`${env.publicUrl}/?${q}`);
    } catch {
      res.redirect(`${env.publicUrl}/?canceled=1`);
    }
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

import type Stripe from 'stripe';
import { env } from '../../config/env.js';
import { stripeClient } from '../../config/stripe.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { iyzicoService } from './iyzico.service.js';

function stripe(): Stripe {
  if (!env.stripe.enabled) {
    throw new HttpError(501, 'Paiement non configuré : définissez STRIPE_SECRET_KEY.');
  }
  return stripeClient();
}

export const paymentService = {
  /** Prestataire carte actif : 'iyzico' (Turquie), 'stripe' (Europe) ou 'none'. */
  provider: () => env.paymentProvider,

  /** Un prestataire de paiement carte est-il configuré ? */
  enabled: () => env.paymentProvider !== 'none',

  /**
   * Crée une page de paiement carte pour une commande et renvoie l'URL de
   * redirection. Aiguille vers le prestataire actif : iyzico (Turquie —
   * carte → portefeuille → retrait IBAN) ou Stripe Checkout (Europe).
   */
  async createCheckout(orderId: string): Promise<{ url: string | null; provider: string }> {
    const provider = env.paymentProvider;
    if (provider === 'iyzico') {
      const res = await iyzicoService.createCheckout(orderId);
      return { url: res.url, provider };
    }
    if (provider === 'stripe') {
      const res = await this.createStripeCheckout(orderId);
      return { url: res.url, provider };
    }
    throw new HttpError(501, 'Paiement non configuré : ajoutez IYZICO_API_KEY (Turquie) ou STRIPE_SECRET_KEY.');
  },

  /**
   * Crée une session de paiement Stripe Checkout pour une commande.
   * Le client paie par carte (Visa, Mastercard...) sur la page sécurisée Stripe.
   * Retourne l'URL vers laquelle rediriger le client.
   */
  async createStripeCheckout(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, customer: true },
    });
    if (!order) throw new HttpError(404, 'Commande introuvable');
    if (order.status !== 'PENDING') {
      throw new HttpError(409, `Commande déjà « ${order.status} », paiement inutile.`);
    }

    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      customer_email: order.customer.email,
      client_reference_id: order.id,
      metadata: { orderId: order.id, orderNumber: order.orderNumber },
      line_items: order.items.map((it) => ({
        quantity: it.quantity,
        price_data: {
          currency: order.currency.toLowerCase(),
          unit_amount: Math.round(it.unitSalePrice * 100),
          product_data: { name: it.product?.name ?? 'Produit' },
        },
      })),
      success_url: `${env.publicUrl}/?paid=${order.orderNumber}`,
      cancel_url: `${env.publicUrl}/?canceled=${order.orderNumber}`,
    });

    logger.info('Session Stripe créée', { orderId: order.id, sessionId: session.id });
    return { url: session.url, sessionId: session.id };
  },

  /**
   * Traite un webhook Stripe (vérifie la signature).
   * Sur paiement réussi, marque la commande PAID → l'expédition s'enclenche
   * automatiquement au prochain cycle `fulfillOrders`.
   */
  async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    if (!env.stripe.webhookSecret) {
      throw new HttpError(501, 'Webhook non configuré : définissez STRIPE_WEBHOOK_SECRET.');
    }
    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(rawBody, signature ?? '', env.stripe.webhookSecret);
    } catch (err) {
      throw new HttpError(400, `Signature webhook invalide: ${err instanceof Error ? err.message : ''}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId || session.client_reference_id;
      if (orderId) {
        await prisma.order.updateMany({
          where: { id: orderId, status: 'PENDING' },
          data: { status: 'PAID' },
        });
        logger.info('Paiement confirmé, commande marquée PAID', { orderId });
      }
    }
    return { received: true, type: event.type };
  },
};

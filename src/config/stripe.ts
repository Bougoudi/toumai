import Stripe from 'stripe';
import { env } from './env.js';

/**
 * Fabrique le client Stripe partagé (paiements + versements).
 *
 * En production, seule `STRIPE_SECRET_KEY` est requise. Les variables
 * `STRIPE_API_HOST` / `STRIPE_API_PORT` / `STRIPE_API_PROTOCOL` permettent
 * de pointer vers un serveur factice pendant les tests (jamais en prod).
 */
let client: Stripe | null = null;

export function stripeClient(): Stripe {
  if (!client) {
    const opts: Stripe.StripeConfig = {};
    const host = process.env.STRIPE_API_HOST;
    if (host) {
      opts.host = host;
      opts.protocol = (process.env.STRIPE_API_PROTOCOL as 'https' | 'http') ?? 'http';
      if (process.env.STRIPE_API_PORT) opts.port = Number(process.env.STRIPE_API_PORT);
    }
    client = new Stripe(env.stripe.secretKey, opts);
  }
  return client;
}

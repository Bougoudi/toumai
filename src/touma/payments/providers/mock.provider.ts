import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../../config/env.js';
import type {
  ConfirmPaymentResult,
  CreatePaymentRequest,
  CreatePaymentResult,
  PaymentMethod,
  PaymentProvider,
  ProviderPaymentStatus,
  RefundResult,
  WebhookVerification,
} from '../payment.types.js';

/**
 * Prestataire de démonstration : permet de dérouler **réellement** le parcours
 * de paiement (création → confirmation → webhook signé → remboursement) sans
 * dépendre d'un PSP externe, et sert de référence de conformité aux futurs
 * adaptateurs réels (signature de webhook, idempotence, anti-rejeu).
 *
 * Il ne manipule aucune donnée bancaire : le « paiement » est une référence.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly code = 'mock';
  readonly name = 'Touma Mock Pay';
  readonly methods: PaymentMethod[] = ['MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'CASH_ON_DELIVERY', 'MOCK'];

  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult> {
    const providerRef = `mockpay_${randomBytes(9).toString('hex')}`;
    return {
      providerRef,
      status: 'PENDING',
      checkoutUrl: `${env.publicUrl}/touma/pay/${providerRef}`,
      instructions: {
        message: 'Paiement simulé : confirmez-le via POST /api/v1/payments/confirm.',
        reference: request.reference,
        method: request.method,
      },
    };
  }

  /**
   * Confirmation. En démonstration on peut forcer l'échec en passant
   * `{ outcome: 'FAILED' }` — indispensable pour tester le chemin d'erreur.
   */
  async confirmPayment(providerRef: string, payload?: Record<string, unknown>): Promise<ConfirmPaymentResult> {
    const outcome = (payload?.outcome as string | undefined)?.toUpperCase();
    if (outcome === 'FAILED') {
      return { providerRef, status: 'FAILED', failureReason: 'Paiement refusé (simulation).' };
    }
    return { providerRef, status: 'SUCCEEDED', metadata: { simulated: true } };
  }

  async refundPayment(providerRef: string, amount: string): Promise<RefundResult> {
    return { providerRef, status: 'REFUNDED', refundedAmount: amount };
  }

  /**
   * Webhook signé en HMAC-SHA256 sur le corps **brut**, exactement comme un PSP
   * réel. En-tête attendu : `x-touma-signature: sha256=<hex>`.
   */
  verifyWebhook(rawBody: Buffer | string, headers: Record<string, string | string[] | undefined>): WebhookVerification {
    const header = headers['x-touma-signature'];
    const provided = Array.isArray(header) ? header[0] : header;
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const expected = `sha256=${createHmac('sha256', env.touma.paymentWebhookSecret).update(body).digest('hex')}`;

    const a = Buffer.from(provided ?? '');
    const b = Buffer.from(expected);
    const valid = a.length === b.length && timingSafeEqual(a, b);
    if (!valid) return { valid: false, eventId: null, type: 'unknown', providerRef: null, status: null, raw: null };

    try {
      const parsed = JSON.parse(body.toString()) as {
        id?: string;
        type?: string;
        data?: { providerRef?: string; status?: string };
      };
      return {
        valid: true,
        eventId: parsed.id ?? null,
        type: parsed.type ?? 'payment.updated',
        providerRef: parsed.data?.providerRef ?? null,
        status: (parsed.data?.status as ProviderPaymentStatus | undefined) ?? null,
        raw: parsed,
      };
    } catch {
      return { valid: false, eventId: null, type: 'invalid', providerRef: null, status: null, raw: null };
    }
  }
}

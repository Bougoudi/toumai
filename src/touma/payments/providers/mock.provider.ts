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
   * Webhook signé en HMAC-SHA256 sur **l'horodatage et le corps brut**, selon
   * le schéma répandu chez les prestataires réels :
   *
   * ```
   * x-touma-signature: t=<secondes unix>,v1=<hex hmac de "<t>.<corps brut>">
   * ```
   *
   * L'horodatage est **dans** la signature, et c'est tout l'intérêt. Un
   * horodatage transmis à côté serait réécrit par quiconque rejoue la requête ;
   * couvert par la signature, il fixe le moment où le prestataire a émis, et
   * borne donc la fenêtre pendant laquelle un webhook capté reste utilisable.
   *
   * La forme précédente — `sha256=<hex>` sur le seul corps — n'est plus
   * acceptée. La maintenir « pour compatibilité » aurait laissé la porte grande
   * ouverte : il aurait suffi de l'employer pour échapper à la fenêtre.
   */
  verifyWebhook(rawBody: Buffer | string, headers: Record<string, string | string[] | undefined>): WebhookVerification {
    const header = headers['x-touma-signature'];
    const provided = Array.isArray(header) ? header[0] : header;
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);

    const refus = (reason: string): WebhookVerification => ({
      valid: false,
      eventId: null,
      type: 'unknown',
      providerRef: null,
      status: null,
      raw: null,
      requiresTimestamp: true,
      reason,
    });

    if (!provided) return refus('En-tête x-touma-signature absent.');

    const parts = new Map(
      provided
        .split(',')
        .map((part) => part.trim().split('='))
        .filter((pair): pair is [string, string] => pair.length === 2)
        .map(([k, v]) => [k.trim(), v.trim()] as [string, string]),
    );
    const t = parts.get('t');
    const v1 = parts.get('v1');
    if (!t || !v1) return refus('Signature mal formée : « t » et « v1 » sont attendus.');

    const seconds = Number(t);
    if (!Number.isFinite(seconds) || !Number.isInteger(seconds)) return refus('Horodatage de signature illisible.');

    // Concaténation d'octets, pas de chaînes : un corps en UTF-8 mal recodé
    // donnerait une signature valide côté émetteur et invalide ici.
    const signed = Buffer.concat([Buffer.from(`${t}.`, 'utf8'), body]);
    const expected = createHmac('sha256', env.touma.paymentWebhookSecret).update(signed).digest('hex');
    const a = Buffer.from(v1);
    const b = Buffer.from(expected);
    // Longueurs comparées d'abord : timingSafeEqual lève sur des tailles
    // différentes, et la longueur d'une signature n'est pas un secret.
    if (a.length !== b.length || !timingSafeEqual(a, b)) return refus('Signature invalide.');

    const timestamp = new Date(seconds * 1000);

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
        timestamp,
        requiresTimestamp: true,
      };
    } catch {
      // Signature valide mais corps illisible : l'appelant détient bien le
      // secret, donc ce n'est pas une forge — c'est une anomalie de protocole,
      // et elle mérite d'être distinguée dans la trace.
      return { ...refus('Corps signé mais illisible (JSON invalide).'), timestamp };
    }
  }
}

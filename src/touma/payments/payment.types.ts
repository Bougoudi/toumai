/**
 * TOUMA PAY — contrat d'orchestration des paiements.
 *
 * Touma n'est **pas** un établissement financier : elle orchestre des
 * prestataires régulés (PSP, mobile money, banques) derrière une interface
 * unique. Aucune donnée bancaire n'est stockée : seules des références.
 */

export interface CreatePaymentRequest {
  /** Référence interne (numéro de commande) transmise au prestataire. */
  reference: string;
  /** Montant en chaîne décimale — jamais un float. */
  amount: string;
  currency: string;
  method: PaymentMethod;
  customer: { id: string; email: string; name: string; phone?: string | null; countryCode?: string | null };
  /** URL de retour après paiement hébergé, le cas échéant. */
  returnUrl?: string;
  metadata?: Record<string, unknown>;
}

export type PaymentMethod = 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER' | 'CASH_ON_DELIVERY' | 'MOCK';

export type ProviderPaymentStatus = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'REFUNDED';

export interface CreatePaymentResult {
  providerRef: string;
  status: ProviderPaymentStatus;
  /** Page de paiement hébergée (mobile money, 3-D Secure…), si le PSP en fournit une. */
  checkoutUrl?: string | null;
  /** Informations non sensibles à afficher (instructions USSD, référence…). */
  instructions?: Record<string, unknown>;
}

export interface ConfirmPaymentResult {
  providerRef: string;
  status: ProviderPaymentStatus;
  failureReason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RefundResult {
  providerRef: string;
  status: ProviderPaymentStatus;
  refundedAmount: string;
}

export interface WebhookVerification {
  valid: boolean;
  /** Identifiant unique de l'événement chez le prestataire (anti-rejeu). */
  eventId: string | null;
  type: string;
  providerRef: string | null;
  status: ProviderPaymentStatus | null;
  raw: unknown;
  /**
   * Horodatage **signé** par le prestataire, quand son protocole en fournit un.
   *
   * Il doit être couvert par la signature, sinon il ne prouve rien : un
   * horodatage qu'un tiers peut réécrire sans invalider la signature n'est pas
   * une protection, c'est une décoration. Quand il est absent, le service
   * l'exige ou non selon `requiresTimestamp`.
   */
  timestamp?: Date | null;
  /**
   * Le protocole de ce prestataire impose-t-il un horodatage signé ?
   *
   * Un adaptateur qui répond `false` déclare que son prestataire n'en fournit
   * pas — et accepte donc qu'un webhook capté puisse être rejoué plus tard.
   * C'est un aveu, pas un réglage de confort.
   */
  requiresTimestamp?: boolean;
  /** Motif du rejet, pour la trace. Jamais renvoyé à l'appelant. */
  reason?: string;
}

/**
 * Adaptateur de paiement. Une implémentation = un prestataire raccordé.
 * Touma ne dépend jamais directement d'un prestataire particulier.
 */
export interface PaymentProvider {
  readonly code: string;
  readonly name: string;
  /** Méthodes réellement supportées par ce prestataire. */
  readonly methods: PaymentMethod[];
  createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult>;
  confirmPayment(providerRef: string, payload?: Record<string, unknown>): Promise<ConfirmPaymentResult>;
  refundPayment(providerRef: string, amount: string): Promise<RefundResult>;
  /** Vérifie la signature d'un webhook : un webhook non signé n'est jamais accepté. */
  verifyWebhook(rawBody: Buffer | string, headers: Record<string, string | string[] | undefined>): WebhookVerification;
}

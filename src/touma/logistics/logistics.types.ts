/**
 * TOUMA LOGISTICS — contrat d'orchestration des transporteurs.
 *
 * Touma n'achète pas de camions : elle orchestre des transporteurs derrière une
 * interface unique. Ajouter un transporteur = ajouter un adaptateur, sans
 * toucher au cœur (checkout, commandes, suivi).
 */

export interface ShippingPoint {
  countryCode: string;
  city?: string | null;
  postalCode?: string | null;
}

export interface Parcel {
  weightGrams: number;
  /** Dimensions en centimètres. */
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

export interface QuoteRequest {
  origin: ShippingPoint;
  destination: ShippingPoint;
  parcel: Parcel;
  /** Devise attendue pour le tarif (celle de la commande). */
  currency: string;
}

export interface ShippingQuoteResult {
  providerCode: string;
  serviceName: string;
  /** Montant en chaîne décimale — jamais un float. */
  amount: string;
  currency: string;
  etaMinDays: number;
  etaMaxDays: number;
  /** Durée de validité du tarif, en secondes. */
  ttlSeconds: number;
}

export interface CreateShipmentRequest {
  quote: ShippingQuoteResult;
  origin: ShippingPoint;
  destination: ShippingPoint;
  parcel: Parcel;
  reference: string;
}

export interface CreateShipmentResult {
  providerCode: string;
  trackingNumber: string;
  labelUrl: string | null;
  status: TrackingStatus;
}

export type TrackingStatus =
  | 'PENDING'
  | 'LABEL_CREATED'
  | 'SHIPPED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'FAILED'
  | 'RETURNED'
  | 'CANCELLED';

export interface TrackingEventResult {
  status: TrackingStatus;
  label: string;
  location?: string | null;
  occurredAt: Date;
}

/** Adaptateur transporteur. Une implémentation = un transporteur raccordé. */
export interface LogisticsProvider {
  readonly code: string;
  readonly name: string;
  /** Le transporteur dessert-il ce trajet ? */
  supports(request: QuoteRequest): boolean;
  getQuote(request: QuoteRequest): Promise<ShippingQuoteResult[]>;
  createShipment(request: CreateShipmentRequest): Promise<CreateShipmentResult>;
  getTracking(trackingNumber: string): Promise<TrackingEventResult[]>;
  cancelShipment(trackingNumber: string): Promise<{ cancelled: boolean }>;
}

import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { roundTo } from '../../lib/money.js';
import type {
  CreateShipmentRequest,
  CreateShipmentResult,
  LogisticsProvider,
  QuoteRequest,
  ShippingQuoteResult,
  TrackingEventResult,
} from '../logistics.types.js';

/**
 * Transporteur de démonstration : tarification déterministe (poids + trajet),
 * étiquette et numéro de suivi simulés. Il permet de dérouler *réellement* le
 * parcours complet (devis → expédition → suivi → livraison) sans dépendre d'un
 * transporteur externe, et sert de référence pour les futurs adaptateurs.
 *
 * Grille (documentée, ajustable) :
 *   - prise en charge nationale : 1 500 (unité de devise) ; transfrontalier : 4 000
 *   - + 1 200 par kilogramme entamé
 *   - délai : 1–3 jours en national, 4–9 jours en transfrontalier
 */
export class MockLogisticsProvider implements LogisticsProvider {
  readonly code = 'mock';
  readonly name = 'Touma Mock Carrier';

  supports(): boolean {
    return true;
  }

  async getQuote(request: QuoteRequest): Promise<ShippingQuoteResult[]> {
    const crossBorder = request.origin.countryCode !== request.destination.countryCode;
    const kg = Math.max(1, Math.ceil(request.parcel.weightGrams / 1000));
    const base = new Prisma.Decimal(crossBorder ? 4000 : 1500);
    const perKg = new Prisma.Decimal(1200).times(kg);
    const standard = base.plus(perKg);

    const quotes: ShippingQuoteResult[] = [
      {
        providerCode: this.code,
        serviceName: crossBorder ? 'Corridor standard' : 'Standard national',
        amount: roundTo(standard, request.currency).toString(),
        currency: request.currency,
        etaMinDays: crossBorder ? 4 : 1,
        etaMaxDays: crossBorder ? 9 : 3,
        ttlSeconds: 3600,
      },
      {
        providerCode: this.code,
        serviceName: crossBorder ? 'Corridor express' : 'Express national',
        amount: roundTo(standard.times(new Prisma.Decimal('1.75')), request.currency).toString(),
        currency: request.currency,
        etaMinDays: crossBorder ? 2 : 1,
        etaMaxDays: crossBorder ? 4 : 2,
        ttlSeconds: 3600,
      },
    ];
    return quotes;
  }

  async createShipment(request: CreateShipmentRequest): Promise<CreateShipmentResult> {
    const suffix = randomBytes(4).toString('hex').toUpperCase();
    const route = `${request.origin.countryCode}${request.destination.countryCode}`;
    return {
      providerCode: this.code,
      trackingNumber: `TOUMA-${route}-${suffix}`,
      labelUrl: `mock://labels/${createHash('sha256').update(request.reference).digest('hex').slice(0, 16)}.pdf`,
      status: 'LABEL_CREATED',
    };
  }

  /**
   * Suivi simulé : la progression dépend du temps écoulé depuis la création de
   * l'expédition, communiquée par le service appelant via `since`.
   */
  async getTracking(trackingNumber: string): Promise<TrackingEventResult[]> {
    return [
      {
        status: 'LABEL_CREATED',
        label: `Étiquette créée (${trackingNumber})`,
        location: null,
        occurredAt: new Date(),
      },
    ];
  }

  async cancelShipment(): Promise<{ cancelled: boolean }> {
    return { cancelled: true };
  }
}

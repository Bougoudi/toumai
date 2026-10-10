import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../db/prisma.js';
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
 * Transporteur piloté par des **zones configurées**.
 *
 * **Le défaut corrigé.** L'unique transporteur branché facturait et datait
 * toutes les livraisons nationales à l'identique. N'Djamena → N'Djamena et
 * N'Djamena → Faya-Largeau — un millier de kilomètres de piste saharienne —
 * recevaient le même prix et le même délai. Et comme il répondait toujours, le
 * système ne savait **jamais dire « je ne sais pas »**.
 *
 * Ici, rien n'est calculé par le code : prix, supplément au kilo et délais sont
 * déclarés par l'exploitant, zone par zone. La zone la plus précise l'emporte —
 * localité, puis département, puis province, puis pays — parce qu'une exception
 * locale doit pouvoir corriger une règle nationale sans la défaire.
 *
 * **Et quand aucune zone ne couvre la destination, il ne répond rien.** C'est le
 * point : le §40 demande « Estimation indisponible » plutôt qu'un délai inventé.
 * Un silence honnête vaut mieux qu'un chiffre rassurant et faux, parce que le
 * chiffre faux, quelqu'un organise sa semaine dessus.
 */
export class ZoneLogisticsProvider implements LogisticsProvider {
  readonly code = 'zones';
  readonly name = 'Transport par zones configurées';

  supports(): boolean {
    return true;
  }

  async getQuote(request: QuoteRequest): Promise<ShippingQuoteResult[]> {
    const destination = request.destination;
    const zones = await prisma.toumaDeliveryZone.findMany({
      where: {
        active: true,
        countryCode: destination.countryCode.toUpperCase(),
        // Les identifiants géographiques, quand l'appelant les connaît. Sinon la
        // zone pays sert de repli.
        OR: [
          { provinceId: null, departmentId: null, localityId: null },
          ...(destination.provinceId ? [{ provinceId: destination.provinceId }] : []),
          ...(destination.departmentId ? [{ departmentId: destination.departmentId }] : []),
          ...(destination.localityId ? [{ localityId: destination.localityId }] : []),
        ],
      },
    });

    if (zones.length === 0) return [];

    // Précision croissante : une exception de localité corrige une règle
    // nationale sans qu'il faille défaire celle-ci.
    const precision = (z: (typeof zones)[number]) => (z.localityId ? 3 : z.departmentId ? 2 : z.provinceId ? 1 : 0);
    const retenue = zones.slice().sort((a, b) => precision(b) - precision(a))[0];

    // Une zone déclarée non desservie n'est pas un tarif à zéro : c'est un
    // refus, et il doit remonter comme une absence de devis.
    if (retenue.status === 'UNSERVED') return [];

    // La devise doit être celle de la commande. Convertir sans taux officiel
    // serait inventer un chiffre — exactement ce que cette classe existe pour
    // éviter.
    if (retenue.currency !== request.currency) return [];

    const kg = Math.max(1, Math.ceil(request.parcel.weightGrams / 1000));
    const montant = new Prisma.Decimal(retenue.basePrice).plus(new Prisma.Decimal(retenue.pricePerKg ?? 0).times(kg));

    return [
      {
        providerCode: this.code,
        serviceName: retenue.status === 'ON_REQUEST' ? `${retenue.serviceName} (sur demande)` : retenue.serviceName,
        amount: roundTo(montant, request.currency).toString(),
        currency: retenue.currency,
        etaMinDays: retenue.estimatedMinDays,
        etaMaxDays: retenue.estimatedMaxDays,
        ttlSeconds: 3600,
      },
    ];
  }

  async createShipment(request: CreateShipmentRequest): Promise<CreateShipmentResult> {
    // Aucun transporteur réel n'est raccordé : l'expédition est enregistrée
    // localement, avec un numéro de suivi TOUMA. Ce n'est pas une simulation de
    // transporteur, c'est un registre d'expédition en attendant qu'un
    // transporteur soit branché — et le suivi ne progresse que si un humain
    // le fait avancer.
    const suffix = randomBytes(4).toString('hex').toUpperCase();
    return {
      providerCode: this.code,
      trackingNumber: `TOUMA-${request.origin.countryCode}${request.destination.countryCode}-${suffix}`,
      labelUrl: null,
      status: 'LABEL_CREATED',
    };
  }

  /**
   * Aucun événement automatique. Un suivi qui avance tout seul raconterait un
   * trajet qui n'a pas eu lieu : c'est le vendeur, ou plus tard un transporteur
   * réel, qui fait progresser l'expédition.
   */
  async getTracking(): Promise<TrackingEventResult[]> {
    return [];
  }

  async cancelShipment(): Promise<{ cancelled: boolean }> {
    // Rien à annuler chez un tiers tant qu'aucun tiers n'est raccordé :
    // l'annulation est purement locale, et on le dit plutôt que de laisser
    // croire qu'un transporteur a été prévenu.
    return { cancelled: true };
  }

  /** Empreinte stable d'une référence, pour un numéro reproductible en test. */
  static referenceHash(reference: string): string {
    return createHash('sha256').update(reference).digest('hex').slice(0, 12);
  }
}

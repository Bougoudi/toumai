import { prisma } from '../../db/prisma.js';
import { logisticsService } from '../logistics/logistics.service.js';
import { corridorService } from './corridor.service.js';
import { timelineService } from './timeline.service.js';
import { notFound } from '../lib/errors.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';
import type { TradeExceptionKind } from '@prisma/client';

/**
 * EXPÉDITION TRANSFRONTALIÈRE (§28 à §34).
 *
 * V18 orchestre déjà les transporteurs : devis, expédition, suivi. V24 n'en
 * refait rien. Il ajoute ce que V18 ne sait pas : **le corridor est-il
 * couvert**, et que faire quand un colis s'arrête.
 *
 * Deux règles, et la seconde est celle qui coûte cher quand on l'oublie.
 *
 * **Aucun tarif n'est inventé** (§29). Si aucun transporteur ne répond, le
 * résultat est `unavailable` avec le motif — jamais une estimation de
 * complaisance.
 *
 * **Aucune cause n'est attribuée sans source** (§34). Un colis en retard n'est
 * pas un colis bloqué en douane. Annoncer « retenu en douane » sans que le
 * transporteur l'ait dit envoie l'acheteur réclamer auprès d'une
 * administration qui n'a jamais vu son colis.
 */

export type DisponibiliteTransport = 'available' | 'unavailable' | 'requires_review';

export interface DevisTransfrontalier {
  status: DisponibiliteTransport;
  corridor: { code: string; operational: boolean } | null;
  quotes: unknown[];
  /** Pourquoi il n'y a pas de tarif, quand il n'y en a pas. */
  reason: string | null;
  /** Délai annoncé par le transporteur. Une estimation, jamais une garantie. */
  estimate: { minDays: number; maxDays: number; source: string } | null;
}

export const tradeShippingService = {
  /**
   * Devis transfrontalier (§29).
   *
   * Passe par `logisticsService.quote`, qui interroge les transporteurs
   * configurés. Le corridor est vérifié **avant** : inutile de déranger un
   * transporteur pour une destination que Touma ne dessert pas.
   */
  async quote(input: {
    originCountry: string;
    destinationCountry: string;
    destinationProvinceId?: string | null;
    weightGrams: number;
    currency: string;
  }): Promise<DevisTransfrontalier> {
    const o = input.originCountry.toUpperCase();
    const d = input.destinationCountry.toUpperCase();

    if (o === d) {
      // Vente nationale : c'est V18 seul, sans corridor.
      const devis = await logisticsService
        .quote({ origin: { countryCode: o }, destination: { countryCode: d, provinceId: input.destinationProvinceId ?? null }, parcel: { weightGrams: input.weightGrams }, currency: input.currency })
        .catch(() => null);
      const options = normaliser(devis);
      return {
        status: options.length > 0 ? 'available' : 'unavailable',
        corridor: null,
        quotes: options,
        reason: options.length > 0 ? null : 'Estimation indisponible : aucun transporteur configuré ne dessert cette destination.',
        estimate: premierDelai(options),
      };
    }

    const capacite = await corridorService.capability(o, d);
    if (!capacite.operational) {
      return {
        status: 'unavailable',
        corridor: { code: `${o}_${d}`, operational: false },
        quotes: [],
        reason: capacite.missing.join(' '),
        estimate: null,
      };
    }

    const devis = await logisticsService
      .quote({
        origin: { countryCode: o },
        destination: { countryCode: d, provinceId: input.destinationProvinceId ?? null },
        parcel: { weightGrams: input.weightGrams },
        currency: input.currency,
      })
      .catch(() => null);

    const options = normaliser(devis);
    if (options.length === 0) {
      // Le corridor est ouvert et aucun transporteur ne répond : ce n'est pas
      // la même chose qu'un corridor fermé, et l'exploitant doit le voir.
      return {
        status: 'requires_review',
        corridor: { code: `${o}_${d}`, operational: true },
        quotes: [],
        reason:
          'Estimation indisponible : le corridor est ouvert mais aucun transporteur n’a répondu pour cette expédition. Aucun tarif n’est proposé — il serait inventé.',
        estimate: null,
      };
    }

    return {
      status: 'available',
      corridor: { code: `${o}_${d}`, operational: true },
      quotes: options,
      reason: null,
      estimate: premierDelai(options),
    };
  },

  /**
   * Incident d'acheminement (§34).
   *
   * `kind` par défaut : `UNKNOWN`. C'est l'état le plus fréquent et le plus
   * honnête. Une cause précise n'est enregistrée qu'avec le nom de qui
   * l'affirme — `sourceName` — parce que c'est ce nom qui distingue un fait
   * d'une supposition.
   */
  async raiseException(input: {
    tradeOrderId: string;
    kind?: TradeExceptionKind;
    sourceName?: string | null;
    detail?: string | null;
    shipmentId?: string | null;
  }) {
    const lien = await prisma.toumaTradeOrder.findUnique({ where: { id: input.tradeOrderId }, select: { id: true } });
    if (!lien) throw notFound('Commande transfrontalière introuvable.');

    // Une cause sans source retombe sur `UNKNOWN`. Le détail est conservé —
    // il dit ce qu'on a observé — mais la cause n'est pas affirmée.
    const source = input.sourceName?.trim() || null;
    const kind = source ? (input.kind ?? 'UNKNOWN') : 'UNKNOWN';

    const incident = await prisma.toumaTradeShipmentException.create({
      data: {
        tradeOrderId: input.tradeOrderId,
        shipmentId: input.shipmentId ?? null,
        kind,
        sourceName: source,
        detail: input.detail?.trim() || null,
      },
    });

    await timelineService.tryRecord({
      tradeOrderId: input.tradeOrderId,
      kind: 'EXCEPTION_RAISED',
      origin: 'LOGISTICS',
      detail: { exceptionId: incident.id, kind, attributed: Boolean(source) },
      referenceId: incident.id,
    });

    return incident;
  },

  async resolveException(id: string, resolution: string) {
    const incident = await prisma.toumaTradeShipmentException.findUnique({ where: { id } });
    if (!incident) throw notFound('Incident introuvable.');
    return prisma.toumaTradeShipmentException.update({
      where: { id },
      data: { resolvedAt: new Date(), resolution: resolution.trim() || null },
    });
  },

  /** Incidents d'une commande, pour qui y a droit. */
  async listExceptions(user: ToumaRequestUser, tradeOrderId: string) {
    const lien = await prisma.toumaTradeOrder.findUnique({
      where: { id: tradeOrderId },
      select: { order: { select: { buyerId: true, store: { select: { ownerId: true } } } } },
    });
    if (!lien) throw notFound('Commande transfrontalière introuvable.');
    if (user.role !== 'ADMIN' && lien.order.buyerId !== user.id && lien.order.store.ownerId !== user.id) {
      throw notFound('Commande transfrontalière introuvable.');
    }
    const items = await prisma.toumaTradeShipmentException.findMany({ where: { tradeOrderId }, orderBy: { raisedAt: 'desc' } });
    return items.map((i) => ({
      ...i,
      /**
       * Rendu explicitement : l'interface doit pouvoir écrire « cause non
       * établie » plutôt que d'afficher `UNKNOWN` comme si c'était un
       * diagnostic.
       */
      causeAttributed: Boolean(i.sourceName),
    }));
  },

  /**
   * Le panier peut-il partir en une seule expédition ? (§30)
   *
   * Non dès que deux boutiques sont concernées : le checkout crée déjà une
   * commande par boutique (V17), et deux vendeurs distincts remettent leurs
   * colis à deux endroits. Promettre une livraison unique alors que les
   * transporteurs ne la font pas serait une promesse impossible à tenir.
   */
  async groupability(orderGroupId: string) {
    const commandes = await prisma.toumaOrder.findMany({
      where: { groupId: orderGroupId },
      select: { id: true, storeId: true, store: { select: { name: true, countryCode: true } }, buyerCountry: true },
    });
    if (commandes.length === 0) throw notFound('Groupe de commandes introuvable.');

    const boutiques = new Map(commandes.map((c) => [c.storeId, c.store]));
    const paysOrigine = new Set(commandes.map((c) => c.store.countryCode));

    return {
      shipments: commandes.length,
      /** Regroupable seulement s'il n'y a qu'un vendeur et un pays d'origine. */
      groupable: boutiques.size === 1 && paysOrigine.size === 1,
      sellers: [...boutiques.entries()].map(([id, s]) => ({ storeId: id, name: s.name, countryCode: s.countryCode })),
      originCountries: [...paysOrigine],
      note:
        boutiques.size > 1
          ? `Ce panier porte sur ${boutiques.size} vendeurs : il donnera ${commandes.length} expéditions distinctes. Aucune livraison unique n’est promise.`
          : null,
    };
  },
};

function normaliser(devis: unknown): unknown[] {
  if (Array.isArray(devis)) return devis;
  const quotes = (devis as { quotes?: unknown[] } | null)?.quotes;
  return Array.isArray(quotes) ? quotes : [];
}

function premierDelai(options: unknown[]) {
  const premier = options[0] as { etaMinDays?: number; etaMaxDays?: number; providerCode?: string } | undefined;
  if (!premier || premier.etaMinDays === undefined || premier.etaMaxDays === undefined) return null;
  return { minDays: premier.etaMinDays, maxDays: premier.etaMaxDays, source: premier.providerCode ?? 'transporteur' };
}

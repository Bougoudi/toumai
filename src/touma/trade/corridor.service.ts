import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { badRequest, notFound } from '../lib/errors.js';
import type { TradeCorridorStatus } from '@prisma/client';

/**
 * CORRIDORS ET CONFIGURATION PAYS (§4, §5, §6, §7).
 *
 * Un corridor est **orienté**. TD → CM et CM → TD sont deux lignes distinctes,
 * et ce n'est pas une redondance : les moyens de paiement, les transporteurs
 * et les documents exigés diffèrent selon le sens. Un corridor symétrique
 * obligerait à mentir dans un des deux sens.
 *
 * Le point central de ce fichier : **`ACTIVE` ne se décrète pas, il se
 * constate**. Le statut enregistré dit l'intention de l'exploitant ; la
 * capacité réelle est recalculée à chaque lecture depuis les prestataires
 * effectivement configurés. Un corridor marqué `ACTIVE` sans transporteur qui
 * le dessert est rendu comme indisponible, avec le motif — c'est §72 pris au
 * mot : « ne jamais déclarer un corridor production-ready uniquement parce que
 * le code existe ».
 */

export interface CapaciteReelle {
  /** Statut enregistré par l'exploitant. */
  declaredStatus: TradeCorridorStatus;
  /** Ce que la configuration permet réellement, aujourd'hui. */
  operational: boolean;
  /** Ce qui manque pour que le corridor fonctionne. Vide s'il fonctionne. */
  missing: string[];
  paymentMethods: string[];
  shippingProviders: string[];
  currencies: string[];
}

/** Entrée de création ou de modification d'un corridor. */
export interface EntreeCorridor {
  originCountry: string;
  destinationCountry: string;
  status?: TradeCorridorStatus;
  supportedCurrencies?: string[];
  supportedPaymentMethods?: string[];
  supportedShippingMethods?: string[];
  requiredDocuments?: string[];
  estimatedTransitMinDays?: number | null;
  estimatedTransitMaxDays?: number | null;
  notes?: string | null;
}

/** Code canonique d'un corridor : `TD_CM`. */
export function corridorCode(origine: string, destination: string): string {
  return `${origine.toUpperCase()}_${destination.toUpperCase()}`;
}

export const corridorService = {
  /**
   * Corridor d'un couple de pays, dans **ce sens**.
   *
   * `null` quand le couple n'est pas configuré : c'est le cas par défaut, et
   * l'appelant doit le traiter comme « pas de commerce possible », jamais
   * comme « à vérifier plus tard ».
   */
  async find(origine: string, destination: string) {
    return prisma.toumaTradeCorridor.findUnique({
      where: { originCountry_destinationCountry: { originCountry: origine.toUpperCase(), destinationCountry: destination.toUpperCase() } },
    });
  },

  async byCode(code: string) {
    const corridor = await prisma.toumaTradeCorridor.findUnique({ where: { code: code.toUpperCase() } });
    if (!corridor) throw notFound('Corridor introuvable.');
    return corridor;
  },

  /** Corridors configurés, avec leur capacité réelle recalculée. */
  async list(options: { status?: TradeCorridorStatus } = {}) {
    const corridors = await prisma.toumaTradeCorridor.findMany({
      where: options.status ? { status: options.status } : {},
      orderBy: [{ originCountry: 'asc' }, { destinationCountry: 'asc' }],
    });
    return Promise.all(
      corridors.map(async (c) => ({
        ...c,
        capability: await this.capability(c.originCountry, c.destinationCountry),
      })),
    );
  },

  /**
   * Capacité réelle d'un corridor.
   *
   * Croise trois sources : le corridor, la configuration commerciale des deux
   * pays, et les transporteurs réellement enregistrés. Ce qui n'est présent
   * que d'un côté ne compte pas — un moyen de paiement disponible au Tchad et
   * pas au Cameroun ne permet pas de payer un vendeur camerounais.
   */
  async capability(origine: string, destination: string): Promise<CapaciteReelle> {
    const o = origine.toUpperCase();
    const d = destination.toUpperCase();
    const manquants: string[] = [];

    const corridor = await this.find(o, d);
    if (!corridor) {
      return {
        declaredStatus: 'COMING_SOON',
        operational: false,
        missing: [`Aucun corridor configuré de ${o} vers ${d}.`],
        paymentMethods: [],
        shippingProviders: [],
        currencies: [],
      };
    }

    const [configOrigine, configDestination, transporteurs] = await Promise.all([
      prisma.toumaTradeCountryConfig.findUnique({ where: { countryCode: o } }),
      prisma.toumaTradeCountryConfig.findUnique({ where: { countryCode: d } }),
      prisma.toumaShippingProvider.findMany({ where: { active: true }, select: { code: true, countries: true } }),
    ]);

    if (!configOrigine?.tradeEnabled) manquants.push(`Le pays ${o} n’est pas ouvert au commerce transfrontalier.`);
    if (!configDestination?.tradeEnabled) manquants.push(`Le pays ${d} n’est pas ouvert au commerce transfrontalier.`);

    // Un moyen de paiement doit exister **des deux côtés** et être admis par
    // le corridor. L'intersection, jamais l'union.
    const paiements = intersection(
      corridor.supportedPaymentMethods,
      intersection(configOrigine?.paymentMethods ?? [], configDestination?.paymentMethods ?? []),
    );
    if (paiements.length === 0) manquants.push('Aucun moyen de paiement n’est disponible des deux côtés de ce corridor.');

    /**
     * Un transporteur « dessert TD » ne dit pas qu'il « achemine de TD vers
     * CM ». La liste `countries` de V18 répond à la première question ; la
     * seconde exige les deux pays chez le même transporteur, ce qui est le
     * minimum vérifiable sans interroger le prestataire.
     */
    const desservants = transporteurs
      .filter((t) => {
        const pays = t.countries
          .split(',')
          .map((x) => x.trim().toUpperCase())
          .filter(Boolean);
        // Liste vide = dessert partout, convention V18 conservée.
        if (pays.length === 0) return true;
        return pays.includes(o) && pays.includes(d);
      })
      .map((t) => t.code);

    const expedition = corridor.supportedShippingMethods.length > 0 ? intersection(corridor.supportedShippingMethods, desservants) : desservants;
    if (expedition.length === 0) manquants.push('Aucun transporteur enregistré ne couvre les deux pays de ce corridor.');

    const devises = corridor.supportedCurrencies.length > 0 ? corridor.supportedCurrencies : [];
    if (devises.length === 0) manquants.push('Aucune devise n’est déclarée pour ce corridor.');

    if (corridor.status === 'SUSPENDED') manquants.push('Le corridor est suspendu par l’exploitant.');
    if (corridor.status === 'COMING_SOON') manquants.push('Le corridor n’est pas encore ouvert.');

    return {
      declaredStatus: corridor.status,
      // Le statut déclaré ne suffit jamais : il faut aussi que rien ne manque.
      operational: manquants.length === 0 && (corridor.status === 'ACTIVE' || corridor.status === 'LIMITED'),
      missing: manquants,
      paymentMethods: paiements,
      shippingProviders: expedition,
      currencies: devises,
    };
  },

  /** Configuration commerciale d'un pays. */
  async countryConfig(countryCode: string) {
    return prisma.toumaTradeCountryConfig.findUnique({
      where: { countryCode: countryCode.toUpperCase() },
      include: { country: { select: { name: true, currency: true, dialCode: true, active: true } } },
    });
  },

  async listCountryConfigs() {
    return prisma.toumaTradeCountryConfig.findMany({
      orderBy: { countryCode: 'asc' },
      include: { country: { select: { name: true, currency: true, dialCode: true, active: true } } },
    });
  },

  // ── Administration ────────────────────────────────────────────────────────

  async upsertCountryConfig(
    countryCode: string,
    input: {
      tradeEnabled?: boolean;
      languages?: string[];
      currencies?: string[];
      paymentMethods?: string[];
      shippingProviders?: string[];
      documentKinds?: string[];
      notes?: string | null;
    },
  ) {
    const code = countryCode.toUpperCase();
    const pays = await prisma.country.findUnique({ where: { code } });
    // Un pays doit exister avant d'être configuré : créer une configuration
    // pour un code inexistant fabriquerait un pays par effet de bord.
    if (!pays) throw notFound(`Pays ${code} inconnu du référentiel.`);

    const data = {
      tradeEnabled: input.tradeEnabled,
      languages: input.languages,
      currencies: input.currencies?.map((c) => c.toUpperCase()),
      paymentMethods: input.paymentMethods,
      shippingProviders: input.shippingProviders,
      documentKinds: input.documentKinds as never,
      notes: input.notes ?? undefined,
    };
    return prisma.toumaTradeCountryConfig.upsert({
      where: { countryCode: code },
      update: data,
      create: { countryCode: code, ...data, tradeEnabled: input.tradeEnabled ?? false },
    });
  },

  async createCorridor(input: EntreeCorridor) {
    const o = input.originCountry.toUpperCase();
    const d = input.destinationCountry.toUpperCase();
    if (o === d) throw badRequest('Un corridor relie deux pays différents.');

    const pays = await prisma.country.findMany({ where: { code: { in: [o, d] } }, select: { code: true } });
    if (pays.length !== 2) throw notFound('Les deux pays doivent exister dans le référentiel.');

    const min = input.estimatedTransitMinDays ?? null;
    const max = input.estimatedTransitMaxDays ?? null;
    if (min !== null && max !== null && min > max) throw badRequest('Le délai minimal dépasse le délai maximal.');

    return prisma.toumaTradeCorridor.create({
      data: {
        code: corridorCode(o, d),
        originCountry: o,
        destinationCountry: d,
        // Jamais `ACTIVE` à la création : un corridor s'ouvre après
        // vérification des prestataires, pas au moment où on le saisit.
        status: input.status ?? 'COMING_SOON',
        supportedCurrencies: (input.supportedCurrencies ?? []).map((c) => c.toUpperCase()),
        supportedPaymentMethods: input.supportedPaymentMethods ?? [],
        supportedShippingMethods: input.supportedShippingMethods ?? [],
        requiredDocuments: (input.requiredDocuments ?? []) as never,
        estimatedTransitMinDays: min,
        estimatedTransitMaxDays: max,
        notes: input.notes ?? null,
      },
    });
  },

  /**
   * Modifie un corridor.
   *
   * Passer à `ACTIVE` est refusé tant que la capacité réelle n'est pas
   * réunie. Ce n'est pas une politesse : un corridor annoncé actif sans
   * transporteur promet une livraison que personne ne peut faire.
   */
  async updateCorridor(id: string, input: Partial<EntreeCorridor>) {
    const corridor = await prisma.toumaTradeCorridor.findUnique({ where: { id } });
    if (!corridor) throw notFound('Corridor introuvable.');

    if (input.status === 'ACTIVE' && corridor.status !== 'ACTIVE') {
      const capacite = await this.capability(corridor.originCountry, corridor.destinationCountry);
      const bloquants = capacite.missing.filter((m) => !m.includes('n’est pas encore ouvert') && !m.includes('est suspendu'));
      if (bloquants.length > 0) {
        throw badRequest(`Le corridor ne peut pas être activé : ${bloquants.join(' ')}`);
      }
    }

    return prisma.toumaTradeCorridor.update({
      where: { id },
      data: {
        status: input.status,
        supportedCurrencies: input.supportedCurrencies?.map((c) => c.toUpperCase()),
        supportedPaymentMethods: input.supportedPaymentMethods,
        supportedShippingMethods: input.supportedShippingMethods,
        requiredDocuments: input.requiredDocuments as never,
        estimatedTransitMinDays: input.estimatedTransitMinDays,
        estimatedTransitMaxDays: input.estimatedTransitMaxDays,
        notes: input.notes ?? undefined,
      },
    });
  },
};

function intersection(a: string[], b: string[]): string[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const ensemble = new Set(b.map((x) => x.toUpperCase()));
  return a.filter((x) => ensemble.has(x.toUpperCase()));
}

/** Le transfrontalier est-il ouvert du tout ? Coupe-circuit général (§77). */
export function crossBorderEnabled(): boolean {
  return env.touma.trade.enabled;
}

import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { badRequest, notFound } from '../lib/errors.js';
import { type Blocage, bloquantsALActivation, phraseFr } from './corridor-blocages.js';
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
  /**
   * Ce qui manque pour que le corridor fonctionne, sous forme de codes. Vide
   * s'il fonctionne. C'est la donnée : `missing` n'en est que le rendu
   * français, conservé pour les clients qui l'affichaient déjà.
   */
  blockers: Blocage[];
  /** Rendu français de `blockers`. Ne jamais s'en servir pour décider. */
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

/**
 * Fragment d'URL d'un nom de pays : `Côte d'Ivoire` → `cote-d-ivoire`.
 *
 * Les accents sont décomposés puis retirés, et tout ce qui n'est ni lettre ni
 * chiffre devient un tiret. Un nom entièrement non latin — l'arabe, par
 * exemple — ne laisserait rien : l'appelant retombe alors sur le code pays,
 * qui est toujours écrivable en URL.
 */
export function slugPays(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Adresse lisible d'un corridor : `tchad-cameroun`.
 *
 * C'est le serveur qui la calcule, et lui seul. La vitrine publique en a
 * besoin pour ses pages, et si elle la recalculait de son côté, la moindre
 * divergence — une apostrophe, un accent — produirait des liens morts que
 * personne ne verrait avant un moteur de recherche.
 *
 * Les noms manquants retombent sur les codes pays : `td-cm` reste une adresse
 * valide, et c'est préférable à une page sans URL.
 */
export function corridorSlug(nomOrigine: string | null | undefined, nomDestination: string | null | undefined, codeOrigine: string, codeDestination: string): string {
  const origine = slugPays(nomOrigine ?? '') || codeOrigine.toLowerCase();
  const destination = slugPays(nomDestination ?? '') || codeDestination.toLowerCase();
  return `${origine}-${destination}`;
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
    const noms = await this.countryNames(corridors.flatMap((c) => [c.originCountry, c.destinationCountry]));
    return Promise.all(
      corridors.map(async (c) => ({
        ...c,
        originCountryName: noms.get(c.originCountry) ?? null,
        destinationCountryName: noms.get(c.destinationCountry) ?? null,
        slug: corridorSlug(noms.get(c.originCountry), noms.get(c.destinationCountry), c.originCountry, c.destinationCountry),
        capability: await this.capability(c.originCountry, c.destinationCountry),
      })),
    );
  },

  /**
   * Noms des pays, indexés par code.
   *
   * Le corridor ne porte que des codes ISO ; les noms vivent dans le
   * référentiel géographique. Une page publique écrite « TD → CM » ne veut
   * rien dire pour un commerçant, d'où cette jointure.
   */
  async countryNames(codes: string[]): Promise<Map<string, string>> {
    const uniques = [...new Set(codes.map((c) => c.toUpperCase()))];
    if (uniques.length === 0) return new Map();
    const pays = await prisma.country.findMany({ where: { code: { in: uniques } }, select: { code: true, name: true } });
    return new Map(pays.map((p) => [p.code, p.name]));
  },

  /**
   * Corridor désigné par son code (`TD_CM`) **ou** par son adresse lisible
   * (`tchad-cameroun`), avec sa capacité réelle.
   *
   * Les deux références rendent le même objet : une page publique et un écran
   * d'administration ne doivent pas lire deux formes différentes du même
   * corridor. Rien ne correspond → 404, jamais un corridor deviné d'après une
   * URL.
   */
  async byReference(reference: string) {
    const normalise = reference.trim().toLowerCase();
    const corridors = await this.list();
    const trouve = corridors.find((c) => c.slug === normalise || c.code.toLowerCase() === normalise);
    if (!trouve) throw notFound('Corridor introuvable.');
    return trouve;
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
    const manquants: Blocage[] = [];

    const corridor = await this.find(o, d);
    if (!corridor) {
      return {
        declaredStatus: 'COMING_SOON',
        operational: false,
        ...rendre([{ code: 'CORRIDOR_NOT_CONFIGURED', params: { origin: o, destination: d } }]),
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

    if (!configOrigine?.tradeEnabled) manquants.push({ code: 'ORIGIN_TRADE_DISABLED', params: { country: o } });
    if (!configDestination?.tradeEnabled) manquants.push({ code: 'DESTINATION_TRADE_DISABLED', params: { country: d } });

    // Un moyen de paiement doit exister **des deux côtés** et être admis par
    // le corridor. L'intersection, jamais l'union.
    const paiements = intersection(
      corridor.supportedPaymentMethods,
      intersection(configOrigine?.paymentMethods ?? [], configDestination?.paymentMethods ?? []),
    );
    if (paiements.length === 0) manquants.push({ code: 'NO_SHARED_PAYMENT_METHOD' });

    /**
     * Un transporteur « dessert TD » ne dit pas qu'il « achemine de TD vers
     * CM ». La liste `countries` de V18 répond à la première question ; la
     * seconde exige les deux pays chez le même transporteur, ce qui est le
     * minimum vérifiable sans interroger le prestataire.
     *
     * **Un adaptateur de simulation ne compte pas.** Il répond à tout, y
     * compris à des corridors que personne ne dessert, et le laisser compter
     * rendait un corridor « opérationnel » sur la foi d'un prestataire qui
     * n'existe pas. C'est exactement ce que §72 interdit — et c'est un essai
     * en navigateur qui l'a montré, pas une relecture du code.
     */
    const desservants = transporteurs
      .filter((t) => !estSimulation(t.code))
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
    if (expedition.length === 0) {
      const simules = transporteurs.filter((t) => estSimulation(t.code)).map((t) => t.code);
      manquants.push(
        simules.length > 0
          ? { code: 'ONLY_SIMULATED_CARRIER', params: { providers: simules.join(', ') } }
          : { code: 'NO_CARRIER_COVERING_BOTH' },
      );
    }

    const devises = corridor.supportedCurrencies.length > 0 ? corridor.supportedCurrencies : [];
    if (devises.length === 0) manquants.push({ code: 'NO_DECLARED_CURRENCY' });

    if (corridor.status === 'SUSPENDED') manquants.push({ code: 'CORRIDOR_SUSPENDED' });
    if (corridor.status === 'COMING_SOON') manquants.push({ code: 'CORRIDOR_NOT_YET_OPEN' });

    return {
      declaredStatus: corridor.status,
      // Le statut déclaré ne suffit jamais : il faut aussi que rien ne manque.
      operational: manquants.length === 0 && (corridor.status === 'ACTIVE' || corridor.status === 'LIMITED'),
      ...rendre(manquants),
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
      // Sur les codes, jamais sur les phrases : reformuler un message ne doit
      // pas pouvoir changer ce qui bloque une activation.
      const bloquants = bloquantsALActivation(capacite.blockers);
      if (bloquants.length > 0) {
        throw badRequest(`Le corridor ne peut pas être activé : ${bloquants.map(phraseFr).join(' ')}`);
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

/**
 * Codes d'adaptateurs de simulation.
 *
 * Ils existent pour faire tourner l'application en développement et ne
 * transportent rien. Les compter comme couverture ferait promettre une
 * livraison à un acheteur réel sur la foi d'un prestataire fictif — la
 * promesse que V20 §52 et V24 §72 interdisent l'une comme l'autre.
 */
const SIMULATIONS = new Set(['mock', 'test', 'sandbox', 'fake', 'dummy']);

export function estSimulation(code: string): boolean {
  return SIMULATIONS.has(code.trim().toLowerCase());
}

/**
 * Assemble les deux formes d'un même motif : les codes, et leur rendu français.
 *
 * Les garder côte à côte dans un seul endroit évite qu'ils divergent — une
 * `missing` calculée à un autre moment que `blockers` finirait par décrire un
 * corridor différent de celui que les codes décrivent.
 */
function rendre(blocages: Blocage[]): { blockers: Blocage[]; missing: string[] } {
  return { blockers: blocages, missing: blocages.map(phraseFr) };
}

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

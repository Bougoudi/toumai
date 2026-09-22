import type { CountryProviderStatus, CountryProviderType, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { badRequest } from '../lib/errors.js';

/**
 * REGISTRE DES PRESTATAIRES PAR MARCHÉ (V26 §11, §12).
 *
 * **Ce que cela remplace.** Le prestataire de paiement était une variable
 * d'environnement unique : `TOUMA_PAYMENT_PROVIDER`. Une plateforme présente
 * au Tchad et au Cameroun ne peut pas fonctionner ainsi — les opérateurs de
 * monnaie mobile, les transporteurs et les passerelles SMS diffèrent d'un pays
 * à l'autre, et un contrat signé dans l'un ne vaut pas dans l'autre.
 *
 * **La règle qui gouverne tout ce fichier** : on ne sélectionne jamais un
 * prestataire qui ne peut pas réellement rendre le service. Ni un adaptateur
 * de simulation, ni un prestataire en configuration, ni un prestataire
 * suspendu. Quand il n'y en a aucun, la fonction rend `null` **et le motif** —
 * parce qu'un appelant qui reçoit `null` sans explication finit par inventer
 * la sienne.
 */

/**
 * Noms de champs qu'on refuse d'écrire en configuration.
 *
 * `configuration` est destiné aux identifiants publics : un nom de marchand,
 * une URL de rappel, un identifiant d'expéditeur SMS. Une clé d'API dans une
 * colonne `Json` de PostgreSQL se retrouve dans les sauvegardes, les journaux
 * de réplication et les exports d'administration — c'est exactement ce que
 * V25 §4 interdit. Le refus est explicite plutôt que documenté : une règle
 * qu'on peut contourner par distraction n'est pas une règle.
 */
const CHAMPS_INTERDITS = /(secret|password|passwd|apikey|api_key|token|private|credential|signature|salt)/i;

/** Vérifie récursivement qu'aucune clé de configuration n'évoque un secret. */
export function champsSecrets(configuration: unknown, chemin = ''): string[] {
  if (!configuration || typeof configuration !== 'object') return [];
  if (Array.isArray(configuration)) {
    return configuration.flatMap((v, i) => champsSecrets(v, `${chemin}[${i}]`));
  }
  const trouves: string[] = [];
  for (const [cle, valeur] of Object.entries(configuration)) {
    const complet = chemin ? `${chemin}.${cle}` : cle;
    if (CHAMPS_INTERDITS.test(cle)) trouves.push(complet);
    trouves.push(...champsSecrets(valeur, complet));
  }
  return trouves;
}

export interface EntreePrestataire {
  countryCode: string;
  type: CountryProviderType;
  code: string;
  name: string;
  priority?: number;
  status?: CountryProviderStatus;
  simulation?: boolean;
  supportedMethods?: string[];
  configuration?: Record<string, unknown> | null;
  notes?: string | null;
}

/** Enregistre ou met à jour un prestataire sur un marché. */
export async function enregistrer(entree: EntreePrestataire) {
  const secrets = champsSecrets(entree.configuration);
  if (secrets.length > 0) {
    throw badRequest(
      `La configuration d'un prestataire ne peut pas contenir de secret : ${secrets.join(', ')}. ` +
        'Les clés et jetons restent dans l’environnement du serveur, jamais en base.',
    );
  }

  const code = entree.code.trim().toLowerCase();
  const pays = entree.countryCode.toUpperCase();
  const valeurs = {
    name: entree.name.trim(),
    priority: entree.priority ?? 100,
    status: entree.status ?? 'PLANNED',
    simulation: entree.simulation ?? false,
    supportedMethods: entree.supportedMethods ?? [],
    configuration: (entree.configuration ?? undefined) as Prisma.InputJsonValue | undefined,
    notes: entree.notes ?? null,
  };

  return prisma.toumaCountryProvider.upsert({
    where: { countryCode_type_code: { countryCode: pays, type: entree.type, code } },
    update: valeurs,
    create: { countryCode: pays, type: entree.type, code, ...valeurs },
  });
}

export interface Selection {
  /** Le prestataire retenu, ou `null` si aucun ne peut rendre le service. */
  provider: { code: string; name: string; supportedMethods: string[]; priority: number } | null;
  /** Pourquoi celui-là, ou pourquoi aucun. Toujours renseigné. */
  reason: string;
  /** Les suivants dans l'ordre, prêts à prendre le relais (§12). */
  fallbacks: Array<{ code: string; name: string; priority: number }>;
}

/**
 * Choisit un prestataire pour un marché et un métier.
 *
 * L'ordre est **déterministe** : priorité croissante, puis code alphabétique.
 * Un choix qui change d'une requête à l'autre rend un incident irreproductible,
 * et c'est précisément quand tout va mal qu'on a besoin de le rejouer.
 *
 * `method` restreint aux prestataires qui couvrent ce moyen : un opérateur de
 * monnaie mobile n'encaisse pas un paiement à la livraison.
 */
export async function selectionner(
  countryCode: string,
  type: CountryProviderType,
  options: { method?: string; autoriserSimulation?: boolean } = {},
): Promise<Selection> {
  const pays = countryCode.toUpperCase();
  const tous = await prisma.toumaCountryProvider.findMany({
    where: { countryCode: pays, type },
    orderBy: [{ priority: 'asc' }, { code: 'asc' }],
  });

  if (tous.length === 0) {
    return { provider: null, reason: `Aucun prestataire ${type} n’est enregistré pour ${pays}.`, fallbacks: [] };
  }

  // Un adaptateur de simulation répond à tout, y compris à ce que personne ne
  // peut faire. Le laisser être choisi transformerait une absence de
  // prestataire en apparence de service — ce que §79 et V25 §52 interdisent.
  const reels = options.autoriserSimulation ? tous : tous.filter((p) => !p.simulation);
  if (reels.length === 0) {
    return {
      provider: null,
      reason: `Aucun prestataire ${type} réel pour ${pays} : seuls des adaptateurs de simulation sont enregistrés (${tous.map((p) => p.code).join(', ')}).`,
      fallbacks: [],
    };
  }

  const actifs = reels.filter((p) => p.status === 'ACTIVE');
  if (actifs.length === 0) {
    const etats = reels.map((p) => `${p.code} (${p.status})`).join(', ');
    return { provider: null, reason: `Aucun prestataire ${type} actif pour ${pays} : ${etats}.`, fallbacks: [] };
  }

  const couvrants = options.method
    ? actifs.filter((p) => p.supportedMethods.length === 0 || p.supportedMethods.includes(options.method as string))
    : actifs;
  if (couvrants.length === 0) {
    return {
      provider: null,
      reason: `Aucun prestataire ${type} actif pour ${pays} ne couvre « ${options.method} ».`,
      fallbacks: [],
    };
  }

  const [retenu, ...suite] = couvrants;
  return {
    provider: { code: retenu.code, name: retenu.name, supportedMethods: retenu.supportedMethods, priority: retenu.priority },
    reason: `${retenu.name} (priorité ${retenu.priority})${suite.length > 0 ? `, ${suite.length} relais possible(s)` : ', aucun relais'}.`,
    fallbacks: suite.map((p) => ({ code: p.code, name: p.name, priority: p.priority })),
  };
}

/**
 * Matrice marché × métier × prestataire (§13, §14).
 *
 * Ce que l'interface doit afficher, et **seulement** cela : un moyen de
 * paiement qu'aucun prestataire actif ne couvre n'apparaît pas comme
 * disponible.
 */
export async function matrice(type?: CountryProviderType) {
  const lignes = await prisma.toumaCountryProvider.findMany({
    where: type ? { type } : {},
    orderBy: [{ countryCode: 'asc' }, { type: 'asc' }, { priority: 'asc' }, { code: 'asc' }],
    include: { country: { select: { currency: true, status: true } } },
  });

  return lignes.map((p) => ({
    country: p.countryCode,
    countryStatus: p.country.status,
    currency: p.country.currency,
    type: p.type,
    provider: p.code,
    name: p.name,
    status: p.status,
    simulation: p.simulation,
    priority: p.priority,
    methods: p.supportedMethods,
    // « Jamais vérifié » n'est pas « en panne ». Les confondre ferait passer
    // pour défaillant un prestataire qu'aucune sonde n'a encore interrogé.
    health: p.lastCheckedAt ? (p.lastHealthyAt ? 'HEALTHY' : 'UNHEALTHY') : 'NEVER_CHECKED',
    healthDetail: p.healthDetail,
    lastCheckedAt: p.lastCheckedAt,
  }));
}

/** Enregistre le résultat d'une sonde réelle. Rien d'autre n'écrit la santé. */
export async function noterSante(id: string, sain: boolean, detail: string) {
  const maintenant = new Date();
  return prisma.toumaCountryProvider.update({
    where: { id },
    data: { lastCheckedAt: maintenant, lastHealthyAt: sain ? maintenant : undefined, healthDetail: detail },
  });
}

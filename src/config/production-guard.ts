import { env } from './env.js';

/**
 * CONTRÔLE DE CONFIGURATION DE PRODUCTION (V25 §3).
 *
 * Module volontairement **sans effet de bord** : il est importé par les tests,
 * et un contrôle de sécurité qu'on ne peut pas éprouver sans démarrer le
 * serveur ne s'éprouve pas.
 */

/**
 * Longueur minimale d'un secret. Trente-deux caractères aléatoires, pas
 * trente-deux caractères : « motdepasse-de-la-production-2024 » en fait
 * trente-deux et ne vaut rien. La longueur est ce qu'un programme peut
 * vérifier ; le reste relève de la procédure d'exploitation.
 */
const LONGUEUR_MINIMALE = 32;

/** Valeurs de développement publiées dans ce dépôt : jamais en production. */
const VALEURS_DE_DEVELOPPEMENT = new Set(['dev-secret-change-me', 'changeme', 'secret', 'password']);

/**
 * Secrets contrôlés au démarrage.
 *
 * `derive` dit si la variable retombe sur `JWT_SECRET` quand elle est absente.
 * Une variable dérivée absente n'est pas une faute — elle hérite d'un secret
 * déjà contrôlé — mais une variable dérivée **présente et faible** en est une :
 * elle remplace silencieusement un secret fort par un secret court.
 */
const SECRETS = [
  { nom: 'JWT_SECRET', valeur: () => env.auth.jwtSecret, derive: false },
  { nom: 'ENCRYPTION_KEY', valeur: () => env.security.encryptionKey, derive: false },
  { nom: 'JWT_ACCESS_SECRET', valeur: () => env.touma.accessSecret, derive: true },
  { nom: 'JWT_REFRESH_SECRET', valeur: () => env.touma.refreshSecret, derive: true },
  { nom: 'TOUMA_PAYMENT_WEBHOOK_SECRET', valeur: () => env.touma.paymentWebhookSecret, derive: true },
] as const;

/**
 * Refuse de démarrer en production avec une configuration non sécurisée.
 *
 * Aucune valeur de secret n'est écrite dans les journaux, ni en clair ni
 * tronquée : un extrait de secret dans un journal d'incident est un secret
 * dans un journal d'incident.
 *
 * Attention en relisant ce garde-fou depuis un poste de développement : le
 * client Prisma charge le `.env` du dépôt au moment où il est importé, c'est-à-dire
 * **avant** cette fonction. Un essai lancé ici hérite donc des secrets du
 * fichier même si l'environnement ne les porte pas — ce qui donne
 * l'impression que le contrôle ne se déclenche jamais. L'image de production
 * n'embarque pas de `.env` ; le test associé force donc les valeurs.
 */
export function configurationFaible(source: {
  defini: (nom: string) => boolean;
  valeur: (nom: string) => string;
  databaseUrl: string;
}): string[] {
  const faibles: string[] = [];

  for (const secret of SECRETS) {
    const defini = source.defini(secret.nom);
    // Une variable dérivée absente hérite d'un secret déjà contrôlé.
    if (!defini && secret.derive) continue;
    if (!defini) {
      faibles.push(`${secret.nom} (absent)`);
      continue;
    }
    const valeur = source.valeur(secret.nom);
    if (VALEURS_DE_DEVELOPPEMENT.has(valeur)) faibles.push(`${secret.nom} (valeur de développement publiée)`);
    else if (valeur.length < LONGUEUR_MINIMALE) faibles.push(`${secret.nom} (${LONGUEUR_MINIMALE} caractères aléatoires minimum)`);
  }

  // La base est la source de vérité : démarrer la production sur le fichier
  // SQLite de repli créerait une base vide que personne ne sauvegarde, et dont
  // la disparition passerait pour une panne.
  if (!source.defini('DATABASE_URL')) faibles.push('DATABASE_URL (absent)');
  else if (!/^postgres(ql)?:\/\//.test(source.databaseUrl)) faibles.push('DATABASE_URL (PostgreSQL attendu en production)');

  return faibles;
}

/**
 * Refuse de démarrer en production avec une configuration non sécurisée.
 *
 * Aucune valeur de secret n'est écrite dans les journaux, ni en clair ni
 * tronquée : un extrait de secret dans un journal d'incident est un secret
 * dans un journal d'incident.
 *
 * Attention en relisant ce garde-fou depuis un poste de développement : le
 * client Prisma charge le `.env` du dépôt au moment où il est importé,
 * c'est-à-dire **avant** ce contrôle. Un essai lancé ici hérite donc des
 * secrets du fichier même si l'environnement ne les porte pas, ce qui donne
 * l'impression que le contrôle ne se déclenche jamais. L'image de production
 * n'embarque pas de `.env` ; le test associé force donc les valeurs.
 */
export function assertSecureConfig(journal: { error: (m: string, d?: Record<string, unknown>) => void; warn: (m: string) => void }): void {
  if (env.nodeEnv !== 'production') return;
  const parNom = new Map<string, () => string>(SECRETS.map((s) => [s.nom, s.valeur]));
  const faibles = configurationFaible({
    defini: (nom) => Boolean(process.env[nom]),
    valeur: (nom) => parNom.get(nom)?.() ?? '',
    databaseUrl: env.databaseUrl,
  });

  if (faibles.length) {
    journal.error('Démarrage refusé : configuration non sécurisée en production', { variables: faibles });
    throw new Error(`Configuration non sécurisée : ${faibles.join(', ')}`);
  }

  /**
   * Réutilisation de clé : signalée, pas bloquante.
   *
   * Le secret des webhooks retombe sur `JWT_SECRET`. Une même clé pour signer
   * des jetons et vérifier des webhooks est une faiblesse de séparation, pas
   * une porte ouverte — les deux restent côté serveur. Refuser ici arrêterait
   * des déploiements qui fonctionnent, pour un risque qui ne le justifie pas.
   */
  if (!process.env.TOUMA_PAYMENT_WEBHOOK_SECRET) {
    journal.warn('TOUMA_PAYMENT_WEBHOOK_SECRET non défini : la clé des jetons sert aussi à vérifier les webhooks. Une clé distincte est préférable.');
  }
}

import { prisma } from '../../db/prisma.js';

/**
 * FUSEAUX ET LANGUES PAR MARCHÉ (V26 §18, §19).
 *
 * **Le défaut corrigé.** `Country.timezone` existait dans le schéma, était
 * renseigné par le seed — `Africa/Ndjamena`, `Africa/Douala` — et n'était lu
 * **nulle part**. Pas une seule fois dans les 311 fichiers du serveur. Les
 * dates rendues à l'utilisateur passaient par `toLocaleDateString('fr-FR')`
 * sans fuseau, c'est-à-dire dans celui du serveur, qui tourne en UTC.
 *
 * Ce que cela coûtait, prouvé et non supposé : une commande passée à 00h30 à
 * N'Djamena est enregistrée à 23h30 UTC la veille. L'assistant répondait donc
 * « commande du 22/09 » à quelqu'un qui l'avait passée le 23. Un jour d'écart
 * sur une date de commande, c'est un litige de livraison qui commence mal.
 *
 * **Le stockage ne change pas.** Toutes les dates restent en UTC en base —
 * c'est la seule façon de comparer deux instants sans ambiguïté. Le fuseau
 * n'intervient qu'au rendu, ce qui est exactement ce que §18 demande.
 */

/** Cache en mémoire : le fuseau d'un pays ne change pas d'une requête à l'autre. */
const cache = new Map<string, { timezone: string; languages: string[] }>();

/**
 * Fuseau et langues d'un marché.
 *
 * Retombe sur `UTC` et le français si le pays est inconnu. Ce repli est un
 * pis-aller assumé : il vaut mieux une date en UTC clairement identifiée qu'une
 * erreur au milieu d'un affichage de commande.
 */
export async function reglagesPays(countryCode: string): Promise<{ timezone: string; languages: string[] }> {
  const code = countryCode.toUpperCase();
  const connu = cache.get(code);
  if (connu) return connu;

  const pays = await prisma.country.findUnique({
    where: { code },
    select: { timezone: true, tradeConfig: { select: { languages: true } } },
  });
  const reglages = {
    timezone: pays?.timezone || 'UTC',
    languages: pays?.tradeConfig?.languages?.length ? pays.tradeConfig.languages : ['fr'],
  };
  cache.set(code, reglages);
  return reglages;
}

/** Vide le cache. Appelé après une modification de configuration pays. */
export function oublierReglages(countryCode?: string): void {
  if (countryCode) cache.delete(countryCode.toUpperCase());
  else cache.clear();
}

/**
 * Étiquette de langue BCP-47 pour le formatage.
 *
 * `fr` seul suffit à `Intl`, mais `fr-TD` donne les conventions locales quand
 * elles existent, et retombe proprement sur `fr` quand elles n'existent pas.
 */
export function etiquetteLocale(langue: string, countryCode: string): string {
  return `${langue.toLowerCase()}-${countryCode.toUpperCase()}`;
}

/**
 * Formate un instant dans le fuseau d'un marché.
 *
 * L'instant reste celui qui est stocké ; seule sa lecture change. Passer le
 * fuseau explicitement plutôt que de compter sur celui du processus est tout
 * l'objet de cette fonction : le second est une propriété de la machine, pas
 * une donnée métier.
 */
export function formaterDate(
  instant: Date | string,
  options: { timezone: string; locale?: string; avecHeure?: boolean },
): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(options.locale ?? 'fr-FR', {
    timeZone: options.timezone,
    dateStyle: 'short',
    ...(options.avecHeure ? { timeStyle: 'short' } : {}),
  });
}

/** Le jour civil d'un instant, dans le fuseau d'un marché : `2026-09-23`. */
export function jourCivil(instant: Date | string, timezone: string): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return '';
  // `en-CA` rend `AAAA-MM-JJ`, le seul format qui se trie et se compare.
  return date.toLocaleDateString('en-CA', { timeZone: timezone });
}

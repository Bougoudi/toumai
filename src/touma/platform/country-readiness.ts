import type { CountryStatus } from '@prisma/client';

/**
 * Contrôle de préparation d'un marché (V26 §4, §5).
 *
 * **Pourquoi un quatrième état.** §4 demande `READY | WARNING | BLOCKED`. Il
 * en manque un, et son absence est un piège : que répondre pour la supervision
 * d'un pays, quand rien ne la mesure ? `READY` mentirait. `WARNING` sous-entend
 * qu'on a regardé et qu'on a un doute — alors qu'on n'a pas regardé du tout.
 * `NOT_MEASURED` dit la seule chose vraie, et c'est ce que V25 §89 exige :
 * aucun statut qui ne vienne d'une vérification réelle.
 *
 * La différence compte au moment d'activer : un `WARNING` est une décision à
 * prendre, un `NOT_MEASURED` est un angle mort. Les fondre rendrait le second
 * invisible.
 */
export type EtatControle = 'READY' | 'WARNING' | 'BLOCKED' | 'NOT_MEASURED';

/** Les domaines listés par §4, dans l'ordre où ils conditionnent une ouverture. */
export const DOMAINES = [
  'database',
  'geography',
  'currency',
  'payments',
  'shipping',
  'refunds',
  'payouts',
  'trust',
  'support',
  'notifications',
  'legal',
  'ai',
  'seo',
  'analytics',
] as const;

export type Domaine = (typeof DOMAINES)[number];

export interface Controle {
  domaine: Domaine;
  etat: EtatControle;
  /** Ce qui a été constaté, en toutes lettres. Jamais « OK ». */
  detail: string;
  /**
   * Statuts que ce contrôle empêche d'atteindre lorsqu'il est `BLOCKED`.
   *
   * Tous les domaines ne pèsent pas au même moment : une place de marché peut
   * entrer en `TESTING` sans versements configurés, jamais en `ACTIVE`.
   */
  bloque: readonly CountryStatus[];
}

export interface Preparation {
  countryCode: string;
  /** Le pire état rencontré, hors `NOT_MEASURED` qui est rapporté à part. */
  verdict: 'READY' | 'WARNING' | 'BLOCKED';
  controles: Controle[];
  /** Statuts atteignables aujourd'hui, compte tenu des blocages. */
  atteignables: CountryStatus[];
  /** Domaines qu'aucune instrumentation ne mesure. Ni verts ni rouges : aveugles. */
  nonMesures: Domaine[];
  /**
   * Le statut actuel du marché est-il encore justifié par les contrôles ?
   *
   * Un pays ne se dégrade pas tout seul : il reste `ACTIVE` pendant que son
   * transporteur disparaît. Sans ce champ, l'écart entre ce qu'un marché
   * affiche et ce qu'il peut réellement faire ne se voit nulle part — et c'est
   * exactement l'écart que §79 nomme. Le système ne rétrograde pas de lui-même :
   * fermer un marché est une décision, pas un effet de bord d'une sonde. Il le
   * signale, et le signale fort.
   */
  statutActuel: CountryStatus;
  statutJustifie: boolean;
  verifieLe: string;
}

/** Ce qui bloque une ouverture complète, mais pas une phase d'essai. */
export const AVANT_PILOTE: readonly CountryStatus[] = ['PILOT', 'ACTIVE', 'LIMITED'] as const;
/** Ce qui bloque dès la phase de vérification technique. */
export const AVANT_TEST: readonly CountryStatus[] = ['TESTING', 'PILOT', 'ACTIVE', 'LIMITED'] as const;
/** Ce qui ne bloque que l'ouverture pleine. */
export const AVANT_ACTIF: readonly CountryStatus[] = ['ACTIVE'] as const;

/**
 * Verdict d'ensemble.
 *
 * `NOT_MEASURED` ne dégrade pas le verdict : il serait faux de dire qu'un pays
 * va mal parce qu'on ne mesure pas sa supervision. Il est rapporté séparément,
 * où il ne peut pas être confondu avec un feu vert.
 */
export function verdictGlobal(controles: readonly Controle[]): 'READY' | 'WARNING' | 'BLOCKED' {
  if (controles.some((c) => c.etat === 'BLOCKED')) return 'BLOCKED';
  if (controles.some((c) => c.etat === 'WARNING')) return 'WARNING';
  return 'READY';
}

/** Statuts qu'aucun contrôle bloquant n'interdit. */
export function statutsAtteignables(controles: readonly Controle[]): CountryStatus[] {
  const interdits = new Set<CountryStatus>();
  for (const controle of controles) {
    if (controle.etat === 'BLOCKED') for (const statut of controle.bloque) interdits.add(statut);
  }
  const tous: CountryStatus[] = ['PLANNED', 'CONFIGURING', 'TESTING', 'PILOT', 'ACTIVE', 'LIMITED', 'SUSPENDED', 'DEPRECATED'];
  return tous.filter((s) => !interdits.has(s));
}

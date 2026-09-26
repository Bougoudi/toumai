/**
 * FRAÎCHEUR D'UN SIGNAL (V29 §41).
 *
 * **Le manque que cela comble.** Aucun signal produit par TOUMA ne disait son
 * âge. Un tableau de bord affichait « 126 commandes » sans que rien n'indique
 * si le chiffre datait de dix minutes ou de trois jours — et c'est une
 * différence qui change ce qu'on en fait. Un réapprovisionnement décidé sur un
 * stock d'avant-hier est un réapprovisionnement décidé à l'aveugle.
 *
 * §41 le dit sans détour : « ne jamais afficher *live* si les données ne sont
 * pas live ». Un chiffre sans âge est présenté comme actuel par défaut, parce
 * que c'est ainsi qu'un lecteur le lit. L'absence d'indication **est** une
 * affirmation.
 *
 * Quatre états, et le dernier n'est pas une panne :
 *
 * - `LIVE` — calculé à l'instant, sur la requête en cours ;
 * - `RECENT` — calculé il y a peu, encore utilisable pour décider ;
 * - `STALE` — trop vieux pour fonder une décision ; le chiffre est rendu
 *   quand même, avec son âge, parce que « périmé » vaut mieux que « rien » ;
 * - `NO_DATA` — il n'y a rien à dater. Aucune observation n'existe.
 */

export type EtatFraicheur = 'LIVE' | 'RECENT' | 'STALE' | 'NO_DATA';

/** Au-delà, un signal cesse d'être « récent ». */
export const SEUIL_RECENT_MS = 60 * 60 * 1000;
/** Au-delà, il est périmé. */
export const SEUIL_PERIME_MS = 24 * 60 * 60 * 1000;
/** En deçà, le calcul vient d'avoir lieu. */
const SEUIL_LIVE_MS = 60 * 1000;

export interface Fraicheur {
  state: EtatFraicheur;
  /** Instant de l'observation la plus récente. `null` s'il n'y en a aucune. */
  observedAt: string | null;
  /** Âge en secondes. `null` sans observation. */
  ageSeconds: number | null;
  /** Fenêtre d'observation, en jours, quand le signal en couvre une. */
  windowDays: number | null;
  /** Ce que cet âge autorise à conclure. Toujours renseigné. */
  statement: string;
}

/** Met en mots un âge, dans l'unité qui se lit. */
function ageLisible(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'moins d’une minute';
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `${heures} heure${heures > 1 ? 's' : ''}`;
  const jours = Math.floor(heures / 24);
  return `${jours} jour${jours > 1 ? 's' : ''}`;
}

/**
 * Qualifie la fraîcheur d'un signal depuis la date de son observation la plus
 * récente.
 *
 * `maintenant` est injectable : sans cela, un test de péremption devrait
 * attendre vingt-quatre heures.
 */
export function fraicheur(
  observationLaPlusRecente: Date | string | null | undefined,
  options: { windowDays?: number | null; maintenant?: Date } = {},
): Fraicheur {
  const fenetre = options.windowDays ?? null;

  if (!observationLaPlusRecente) {
    return {
      state: 'NO_DATA',
      observedAt: null,
      ageSeconds: null,
      windowDays: fenetre,
      // « Aucune donnée » n'est pas « zéro ». Un produit sans commande observée
      // n'a pas une demande nulle : il n'a pas de demande mesurée.
      statement: 'Aucune observation sur cette période : il n’y a rien à dater, et rien à en conclure.',
    };
  }

  const instant = observationLaPlusRecente instanceof Date ? observationLaPlusRecente : new Date(observationLaPlusRecente);
  if (Number.isNaN(instant.getTime())) {
    return { state: 'NO_DATA', observedAt: null, ageSeconds: null, windowDays: fenetre, statement: 'Horodatage illisible : observation écartée.' };
  }

  const maintenant = options.maintenant ?? new Date();
  const ageMs = Math.max(0, maintenant.getTime() - instant.getTime());
  const age = ageLisible(ageMs);
  const commun = { observedAt: instant.toISOString(), ageSeconds: Math.round(ageMs / 1000), windowDays: fenetre };

  if (ageMs <= SEUIL_LIVE_MS) {
    return { ...commun, state: 'LIVE', statement: `Calculé à l’instant${fenetre ? `, sur les ${fenetre} derniers jours` : ''}.` };
  }
  if (ageMs <= SEUIL_RECENT_MS) {
    return { ...commun, state: 'RECENT', statement: `Dernière observation il y a ${age}${fenetre ? `, sur une fenêtre de ${fenetre} jours` : ''}.` };
  }
  if (ageMs <= SEUIL_PERIME_MS) {
    return { ...commun, state: 'RECENT', statement: `Dernière observation il y a ${age}. Encore exploitable, mais ce n’est plus l’état du moment.` };
  }
  return {
    ...commun,
    state: 'STALE',
    // Le chiffre est rendu malgré tout : périmé et daté vaut mieux qu'absent.
    // C'est le masquer qui laisserait croire qu'il n'y a rien à savoir.
    statement: `Dernière observation il y a ${age}. Trop ancienne pour fonder une décision ; le chiffre est rendu avec son âge, pas comme un état actuel.`,
  };
}

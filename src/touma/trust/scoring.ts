/**
 * TOUMA TRUST — calcul du score, et rien d'autre.
 *
 * Ce fichier ne lit pas la base et n'écrit rien : il prend des mesures et rend
 * une ventilation. C'est ce qui le rend testable sans base de données, et c'est
 * là que se vérifient les propriétés qui comptent — un score borné, une
 * composante non mesurée qui ne pénalise pas, une pénalité qui pénalise
 * vraiment.
 */
import type { TrustLevel } from '@prisma/client';
import { LEVEL_THRESHOLDS, type TrustFactor } from './weights.js';
import type { TrustComponent } from './trust.types.js';

/** Mesure d'une composante : sa valeur normalisée et ce qui l'a produite. */
export interface Measure {
  value: number | null;
  detail: Record<string, unknown>;
}

export function levelFor(score: number | null): TrustLevel {
  if (score === null) return 'INSUFFICIENT_DATA';
  return LEVEL_THRESHOLDS.find((t) => score >= t.min)?.level ?? 'LOW';
}

/** Borne une valeur dans [0, 1] — une mesure aberrante ne doit pas fausser le score. */
export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Assemble la ventilation.
 *
 * Deux règles, et elles ne sont pas symétriques :
 *
 * 1. **Une composante positive non mesurée ne pénalise pas.** Les poids des
 *    composantes mesurables sont renormalisés sur ce qui a pu être mesuré. Un
 *    vendeur sans conversation ne perd pas les points de réactivité : il n'est
 *    simplement pas noté dessus.
 * 2. **Une pénalité non mesurée vaut zéro, pas une renormalisation.** La
 *    renormaliser reviendrait à augmenter le poids des autres pénalités parce
 *    qu'il en manque une — donc à punir plus fort pour moins de faits.
 */
export function assemble(factors: TrustFactor[], measures: Record<string, Measure>): {
  components: TrustComponent[];
  score: number;
} {
  const components: TrustComponent[] = [];

  const positives = factors.filter((f) => f.direction === 'POSITIVE');
  const mesurables = positives.filter((f) => measures[f.code]?.value !== null && measures[f.code] !== undefined);
  const poidsMesurable = mesurables.reduce((acc, f) => acc + f.weight, 0);
  const poidsTotal = positives.reduce((acc, f) => acc + f.weight, 0);
  // Sans aucune mesure positive, on ne renormalise rien : le score sera nul et
  // l'appelant décidera s'il doit seulement être publié.
  const renorm = poidsMesurable > 0 ? poidsTotal / poidsMesurable : 0;

  let score = 0;
  for (const factor of factors) {
    const measure = measures[factor.code] ?? { value: null, detail: {} };
    const value = measure.value === null ? null : clamp01(measure.value);

    let points = 0;
    if (value !== null) {
      points =
        factor.direction === 'POSITIVE'
          ? (factor.weight * renorm * value)
          : (factor.weight * value); // poids déjà négatif
    }
    points = Math.round(points * 100) / 100;
    score += points;
    components.push({
      code: factor.code,
      weight: factor.weight,
      value,
      points,
      direction: factor.direction,
      detail: measure.detail,
    });
  }

  return { components, score: Math.min(100, Math.max(0, Math.round(score))) };
}

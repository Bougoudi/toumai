/**
 * Calcule le score d'opportunité (0..100) d'un produit candidat.
 * Une bonne opportunité = forte demande + tendance haussière + faible concurrence.
 */
export function opportunityScore(input: {
  demandScore: number;
  competitionScore: number;
  trendScore: number;
}): number {
  const demand = clamp(input.demandScore);
  const trend = clamp(input.trendScore);
  // Concurrence : plus elle est faible, mieux c'est (on inverse).
  const lowCompetition = 100 - clamp(input.competitionScore);

  const score = demand * 0.4 + trend * 0.35 + lowCompetition * 0.25;
  return Math.round(score);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

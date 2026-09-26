/**
 * TOUMA TRUST — types partagés.
 *
 * Le type central est `TrustBreakdown` : il n'existe pas de chemin dans ce
 * module qui produise un score sans lui. C'est volontaire — « Score = 87 »
 * sans ventilation est exactement ce que V21 interdit, et le typage est
 * l'endroit le moins contournable pour l'empêcher.
 */
import type { TrustEntityType, TrustLevel } from '@prisma/client';

/** Une composante du score, telle qu'elle sera affichée. */
export interface TrustComponent {
  /** Code stable (`DELIVERY`), traduit à l'affichage. */
  code: string;
  /** Poids maximal de la composante, en points. */
  weight: number;
  /**
   * Valeur mesurée, entre 0 et 1, ou `null` si elle n'a pas pu être mesurée.
   * Une composante non mesurable ne compte pas — ni en bien, ni en mal.
   */
  value: number | null;
  /** Points effectivement accordés (ou retirés). */
  points: number;
  direction: 'POSITIVE' | 'NEGATIVE';
  /** Ce qui a servi au calcul : le chiffre brut, pour pouvoir le relire. */
  detail: Record<string, unknown>;
}

export interface TrustBreakdown {
  entityType: TrustEntityType;
  entityId: string;
  /** `null` tant que le volume minimal n'est pas atteint. */
  score: number | null;
  level: TrustLevel;
  /** Volume sur lequel porte le calcul. */
  sampleSize: number;
  /** Seuil de publication en vigueur, pour l'expliquer à l'intéressé. */
  minimumSample: number;
  components: TrustComponent[];
  computedAt: Date;
}

/** Signal remonté à un humain (§19 — TrustInsight). */
export interface TrustInsight {
  signal: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  /** Les faits, pas une interprétation. */
  evidence: Record<string, unknown>;
  recommendedAction: string;
}

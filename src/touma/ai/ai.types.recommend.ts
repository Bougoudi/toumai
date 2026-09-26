/**
 * Contrat des recommandations.
 *
 * Séparé du contrat des fournisseurs : une recommandation ne vient pas d'un
 * modèle, elle vient de la base. Les mélanger dans un même fichier laisserait
 * croire qu'un fournisseur d'IA pourrait en produire — et c'est exactement la
 * confusion que §71 interdit.
 */
export interface RecommendationItem {
  targetType: 'PRODUCT' | 'SUPPLIER' | 'PRICE' | 'CATEGORY';
  targetId: string | null;
  /** Force de la proposition, entre 0 et 1. Calculée, jamais devinée. */
  score: number;
  /** Raison affichable, en français : l'acheteur doit pouvoir la contester. */
  reason: string;
  payload?: Record<string, unknown>;
}

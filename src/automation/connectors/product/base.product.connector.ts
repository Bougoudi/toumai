/**
 * Résultat normalisé d'une recherche de produit (« Trouver des produits »).
 * Le même format est renvoyé quelle que soit la source (AliExpress, autre
 * fournisseur…) afin que l'interface reste identique.
 */
export interface ProductSearchResult {
  title: string;
  category: string;
  keywords: string;
  estimatedPrice: number;
  source: string;
  imageUrl?: string;
  url?: string;
}

/**
 * Connecteur de recherche de produits par mots-clés. Implémenté par une source
 * réelle (ex. AliExpress). Retourne une liste vide si aucun produit ne
 * correspond — jamais de résultat inventé.
 */
export interface ProductSearchConnector {
  readonly name: string;
  search(query: string, opts?: { limit?: number }): Promise<ProductSearchResult[]>;
}

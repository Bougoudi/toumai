/**
 * Contrat commun à toute base de données de codes-barres (EAN / UPC).
 *
 * Un connecteur code-barres reçoit un code numérique et renvoie le produit réel
 * correspondant (nom, marque, catégorie, image…). Ces informations alimentent
 * ensuite la recherche de fournisseurs.
 *
 * Pour brancher un vrai service (UPCitemdb, Barcode Lookup, Open Food Facts, une
 * base GS1…), fournissez `BARCODE_API_URL` + `BARCODE_API_KEY` et adaptez au
 * besoin `HttpBarcodeConnector.mapProduct`.
 */
export interface BarcodeProduct {
  title: string;
  brand?: string;
  category?: string;
  imageUrl?: string;
  /** Prix de référence si la source en fournit un. */
  price?: number;
}

export interface BarcodeConnector {
  /** Nom court, sert de trace (`source`) dans les résultats. */
  readonly name: string;
  /** Retrouve le produit associé à un code-barres, ou `null` si inconnu. */
  lookup(code: string): Promise<BarcodeProduct | null>;
}

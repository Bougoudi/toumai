/**
 * Contrat commun à tout connecteur de source de données fournisseurs.
 *
 * Un connecteur encapsule l'accès à une source externe (annuaire B2B,
 * marketplace, API partenaire, fichier CSV, scraping...) et renvoie des
 * fournisseurs normalisés que le job d'automatisation ira upsert en base.
 *
 * Pour ajouter une vraie source : créez `myapi.connector.ts`, implémentez
 * `fetchSuppliers()` et enregistrez le connecteur dans `refreshSuppliers.job.ts`.
 */
export interface NormalizedOffer {
  externalId?: string;
  title: string;
  category: string;
  keywords: string;
  unitPrice?: number;
  currency?: string;
  moq?: number;
  leadTimeDays?: number;
  inStock?: boolean;
}

export interface NormalizedSupplier {
  /** Identifiant stable côté source, utilisé pour la déduplication. */
  externalId: string;
  name: string;
  country?: string;
  region?: string;
  website?: string;
  email?: string;
  phone?: string;
  rating?: number;
  verified?: boolean;
  certifications?: string;
  leadTimeDays?: number;
  minOrderValue?: number;
  currency?: string;
  offers: NormalizedOffer[];
}

export interface SupplierConnector {
  /** Nom court, sert de valeur `source` en base (ex: "mock", "europages"). */
  readonly name: string;
  /** Récupère les fournisseurs depuis la source. */
  fetchSuppliers(params?: { category?: string; region?: string }): Promise<NormalizedSupplier[]>;
}

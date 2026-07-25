/**
 * Contrat commun à toute source d'analyse de marché.
 *
 * Un connecteur marché encapsule l'accès à une source de tendances / de
 * données produits (Google Trends, marketplaces, réseaux sociaux, API
 * d'analyse...) et renvoie des opportunités normalisées que le job
 * `marketScan` ira upsert en base.
 *
 * Pour brancher une vraie source : créez `myapi.market.connector.ts`,
 * implémentez `discover()` et enregistrez-le dans `marketScan.job.ts`.
 */
export interface NormalizedOpportunity {
  /** Identifiant stable côté source (déduplication). */
  externalId: string;
  title: string;
  category: string;
  keywords: string;
  niche?: string;
  region?: string;
  currency?: string;

  /** Signaux 0..100. */
  demandScore: number;
  competitionScore: number;
  trendScore: number;

  estimatedCostPrice?: number;
  estimatedSalePrice?: number;

  /** Métriques brutes additionnelles (recherches, ventes estimées...). */
  rawMetrics?: Record<string, unknown>;
}

export interface MarketConnector {
  /** Nom court, sert de valeur `source` en base (ex: "trends", "mock-market"). */
  readonly name: string;
  /** Analyse le marché et renvoie des opportunités. */
  discover(params?: { category?: string; region?: string; limit?: number }): Promise<NormalizedOpportunity[]>;
}

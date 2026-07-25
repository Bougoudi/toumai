import { logger } from '../../../utils/logger.js';
import type { MarketConnector, NormalizedOpportunity } from './base.market.connector.js';

/**
 * Connecteur d'analyse de marché HTTP (source réelle).
 *
 * Contrat attendu : GET {url}?category=&region=&limit= avec l'en-tête
 * `Authorization: Bearer {key}`, renvoyant un JSON `{ items: [...] }` (ou un
 * tableau) où chaque élément expose au moins un identifiant et un titre.
 * Adaptez la fonction `mapItem` au format exact de votre fournisseur de données.
 */
export class HttpMarketConnector implements MarketConnector {
  readonly name = 'http-market';

  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  async discover(params?: { category?: string; region?: string; limit?: number }): Promise<NormalizedOpportunity[]> {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.region) qs.set('region', params.region);
    if (params?.limit) qs.set('limit', String(params.limit));

    const res = await fetch(`${this.url}?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${this.key}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      logger.error('HttpMarketConnector: réponse non OK', { status: res.status });
      throw new Error(`Source marché: HTTP ${res.status}`);
    }
    const body = await res.json();
    const items: unknown[] = Array.isArray(body) ? body : (body.items ?? body.data ?? []);
    return items.map((it) => this.mapItem(it as Record<string, unknown>)).filter(Boolean) as NormalizedOpportunity[];
  }

  /** Mappe un élément de la source vers le format normalisé. À adapter. */
  private mapItem(it: Record<string, any>): NormalizedOpportunity | null {
    if (!it) return null;
    const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : Number(v) || d);
    return {
      externalId: String(it.id ?? it.externalId ?? it.sku ?? it.title),
      title: String(it.title ?? it.name ?? 'Sans titre'),
      category: String(it.category ?? 'divers'),
      keywords: String(it.keywords ?? ''),
      niche: it.niche ? String(it.niche) : undefined,
      region: it.region ? String(it.region) : undefined,
      currency: it.currency ? String(it.currency) : undefined,
      demandScore: num(it.demandScore ?? it.demand, 50),
      competitionScore: num(it.competitionScore ?? it.competition, 50),
      trendScore: num(it.trendScore ?? it.trend, 50),
      estimatedCostPrice: it.estimatedCostPrice != null ? num(it.estimatedCostPrice) : undefined,
      estimatedSalePrice: it.estimatedSalePrice != null ? num(it.estimatedSalePrice) : undefined,
      rawMetrics: typeof it.metrics === 'object' ? it.metrics : undefined,
    };
  }
}

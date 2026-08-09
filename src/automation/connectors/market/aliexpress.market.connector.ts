import { AliExpressProductConnector } from '../product/aliexpress.product.connector.js';
import type { MarketConnector, NormalizedOpportunity } from './base.market.connector.js';

/**
 * Analyse de marché basée sur AliExpress (API Dropshipping).
 *
 * Transforme les produits réels du flux AliExpress en « opportunités » :
 *   - demande = volume de ventes récent (`lastest_volume`) ;
 *   - tendance = volume + remise ;
 *   - concurrence = estimée (volume élevé → marché plus concurrentiel) ;
 *   - coût = prix AliExpress, prix de vente = coût × marge.
 * Aucune donnée inventée : tout provient des vrais produits AliExpress.
 */
export class AliexpressMarketConnector implements MarketConnector {
  readonly name = 'aliexpress';

  private readonly product: AliExpressProductConnector;
  private readonly currency: string;

  constructor(appKey: string, appSecret: string, opts: { currency?: string; feedName?: string } = {}) {
    this.product = new AliExpressProductConnector(appKey, appSecret, opts);
    this.currency = (opts.currency || 'EUR').toUpperCase();
  }

  async discover(params?: { category?: string; region?: string; limit?: number }): Promise<NormalizedOpportunity[]> {
    const raw = await this.product.fetchFeed(3);
    const opportunities = raw.map((p) => this.mapOpportunity(p));
    const limit = params?.limit ?? opportunities.length;
    return opportunities.slice(0, limit);
  }

  private mapOpportunity(p: Record<string, any>): NormalizedOpportunity {
    const volume = Number(p.lastest_volume ?? 0);
    const rate = parseFloat(String(p.evaluate_rate ?? '').replace('%', '')) || 0;
    const discount = parseFloat(String(p.discount ?? '').replace('%', '')) || 0;
    const cost = Number(p.target_sale_price ?? p.sale_price ?? p.original_price ?? 0) || 0;
    const title = String(p.product_title ?? 'Produit');

    // Signaux 0..100 dérivés des vraies métriques.
    const volSignal = Math.min(100, Math.round(Math.log10(volume + 1) * 28)); // 100 ventes ≈ 56
    const demandScore = Math.min(100, Math.max(10, volSignal));
    const trendScore = Math.min(100, Math.max(10, Math.round(volSignal * 0.7 + discount * 0.4)));
    const competitionScore = Math.min(90, Math.max(25, Math.round(30 + volSignal * 0.5)));

    return {
      externalId: String(p.product_id ?? title),
      title,
      category: String(p.second_level_category_name ?? p.first_level_category_name ?? 'divers'),
      keywords: title.toLowerCase().split(/\s+/).slice(0, 5).join(','),
      niche: p.first_level_category_name ? String(p.first_level_category_name) : undefined,
      region: 'AliExpress',
      currency: this.currency,
      demandScore,
      competitionScore,
      trendScore,
      estimatedCostPrice: cost || undefined,
      estimatedSalePrice: cost ? Number((cost * 2.5).toFixed(2)) : undefined,
      rawMetrics: {
        sales: volume,
        rating: rate,
        discount,
        imageUrl: p.product_main_image_url,
        productUrl: p.product_detail_url,
        shopUrl: p.shop_url,
        sellerId: p.seller_id,
      },
    };
  }
}

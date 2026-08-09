import type { NormalizedOffer, NormalizedSupplier, SupplierConnector } from './base.connector.js';
import { AliExpressProductConnector } from './product/aliexpress.product.connector.js';

/**
 * Source fournisseurs AliExpress (API Dropshipping).
 *
 * Chaque produit du flux appartient à une boutique (`shop_id`) : on regroupe
 * donc les produits par boutique → un fournisseur par boutique, avec ses
 * produits comme offres. Permet de comparer de nombreux vendeurs et leurs prix.
 */
export class AliexpressSupplierConnector implements SupplierConnector {
  readonly name = 'aliexpress';

  private readonly product: AliExpressProductConnector;
  private readonly currency: string;

  constructor(appKey: string, appSecret: string, opts: { currency?: string; feedName?: string } = {}) {
    this.product = new AliExpressProductConnector(appKey, appSecret, opts);
    this.currency = (opts.currency || 'EUR').toUpperCase();
  }

  async fetchSuppliers(): Promise<NormalizedSupplier[]> {
    const raw = await this.product.fetchFeed(3);

    const byShop = new Map<string, { info: Record<string, any>; offers: NormalizedOffer[] }>();
    for (const p of raw) {
      const shopId = String(p.shop_id ?? p.seller_id ?? '').trim();
      if (!shopId) continue;
      if (!byShop.has(shopId)) byShop.set(shopId, { info: p, offers: [] });
      byShop.get(shopId)!.offers.push(this.offer(p));
    }

    return [...byShop.entries()].map(([shopId, { info, offers }]) => {
      const rate = parseFloat(String(info.evaluate_rate ?? '').replace('%', '')) || 0;
      return {
        externalId: shopId,
        name: `Boutique AliExpress #${shopId}`,
        country: 'CN',
        region: 'Asia',
        website: info.shop_url ? String(info.shop_url) : `https://www.aliexpress.com/store/${shopId}`,
        rating: Number((rate / 20).toFixed(1)), // % → note /5
        verified: rate >= 90,
        currency: this.currency,
        leadTimeDays: 15,
        offers,
      };
    });
  }

  private offer(p: Record<string, any>): NormalizedOffer {
    const price = Number(p.target_sale_price ?? p.sale_price ?? p.original_price ?? 0) || undefined;
    const title = String(p.product_title ?? 'Produit');
    return {
      externalId: p.product_id ? String(p.product_id) : undefined,
      title,
      category: String(p.second_level_category_name ?? p.first_level_category_name ?? 'divers'),
      keywords: title.toLowerCase().split(/\s+/).slice(0, 5).join(','),
      unitPrice: price,
      currency: this.currency,
      inStock: true,
    };
  }
}

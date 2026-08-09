import { createHmac } from 'node:crypto';
import { logger } from '../../../utils/logger.js';
import type { ProductSearchConnector, ProductSearchResult } from './base.product.connector.js';

/**
 * Recherche de produits AliExpress (API Dropshipping « DS »).
 *
 * Passerelle système AliExpress (`/sync`) signée en HMAC-SHA256. Les
 * identifiants (App Key + App Secret) proviennent du portail AliExpress Open
 * Platform. L'`appSecret` NE quitte jamais le serveur (sert à signer).
 *
 * Deux méthodes selon ce que le compte autorise :
 *   1. `aliexpress.ds.text.search` — recherche par mot-clé (nécessite une app
 *      en production ; renvoie une exception tant que l'app est en « Test ») ;
 *   2. `aliexpress.ds.recommend.feed.get` — flux de produits réels (disponible
 *      dès le mode Test) ; on filtre alors par mot-clé côté serveur.
 * On tente d'abord (1), et on retombe sur (2) — l'expérience s'améliore
 * automatiquement dès que l'app passe en production.
 */

const GATEWAY = 'https://api-sg.aliexpress.com/sync';

export class AliExpressProductConnector implements ProductSearchConnector {
  readonly name = 'aliexpress';

  private readonly currency: string;
  private readonly feedName: string;

  constructor(
    private readonly appKey: string,
    private readonly appSecret: string,
    opts: { trackingId?: string; currency?: string; feedName?: string } = {},
  ) {
    this.currency = (opts.currency || 'EUR').toUpperCase();
    // Flux large par défaut (produits sélectionnés dropshipping).
    this.feedName = opts.feedName || 'AEB_BR_DropiSelectedItems_20241106';
  }

  async search(query: string, opts?: { limit?: number }): Promise<ProductSearchResult[]> {
    const q = (query ?? '').trim();
    const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 50);

    // 1) Recherche par mot-clé (si l'app le permet).
    if (q) {
      try {
        const res = await this.call('aliexpress.ds.text.search', {
          keyWord: q,
          local: 'en_US',
          countryCode: 'FR',
          currency: this.currency,
          pageSize: String(limit),
          pageIndex: '1',
          sortBy: 'orders,desc',
        });
        const products = findProducts(res);
        if (products.length) return products.slice(0, limit).map((p) => this.map(p));
      } catch (e) {
        logger.warn('AliExpress text.search indisponible, repli sur le flux', { err: String(e).slice(0, 120) });
      }
    }

    // 2) Repli : flux de produits réels, filtré par mot-clé côté serveur.
    const feed = await this.call('aliexpress.ds.recommend.feed.get', {
      feed_name: this.feedName,
      target_currency: this.currency,
      target_language: 'EN',
      country: 'FR',
      page_size: '50',
      page_no: '1',
    });
    let products = findProducts(feed);
    if (q) {
      const ql = q.toLowerCase();
      const matched = products.filter((p) => String(p.product_title ?? '').toLowerCase().includes(ql));
      if (matched.length) products = matched;
    }
    return products.slice(0, limit).map((p) => this.map(p));
  }

  /** Appel signé de la passerelle AliExpress. */
  private async call(method: string, biz: Record<string, string>): Promise<unknown> {
    const params: Record<string, string> = {
      app_key: this.appKey,
      timestamp: String(Date.now()),
      sign_method: 'sha256',
      method,
      ...biz,
    };
    const concat = Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join('');
    params.sign = createHmac('sha256', this.appSecret).update(concat, 'utf8').digest('hex').toUpperCase();

    const res = await fetch(GATEWAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    if (!res.ok) throw new Error(`AliExpress HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    if (body?.error_response) {
      const e = body.error_response;
      throw new Error(`AliExpress: ${e.msg || e.code || 'erreur API'}`);
    }
    return body;
  }

  private map(p: Record<string, any>): ProductSearchResult {
    const price = Number(
      p.target_sale_price ?? p.app_sale_price ?? p.sale_price ?? p.target_original_price ?? p.original_price ?? 0,
    );
    const title = String(p.product_title ?? p.subject ?? 'Produit');
    return {
      title,
      category: String(p.second_level_category_name ?? p.first_level_category_name ?? 'divers'),
      keywords: title.toLowerCase().split(/\s+/).slice(0, 5).join(','),
      estimatedPrice: Number.isFinite(price) ? price : 0,
      source: 'aliexpress',
      imageUrl: p.product_main_image_url ? String(p.product_main_image_url) : undefined,
      url: p.product_detail_url ? String(p.product_detail_url) : undefined,
    };
  }
}

/**
 * Extrait récursivement le tableau de produits d'une réponse AliExpress
 * (l'imbrication varie selon la méthode). Renvoie [] si rien trouvé.
 */
function findProducts(body: unknown): Record<string, any>[] {
  const seen = new Set<unknown>();
  const isProduct = (o: any) => o && typeof o === 'object' && ('product_title' in o || 'product_id' in o);
  const walk = (node: any): Record<string, any>[] | null => {
    if (!node || typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      if (node.length && isProduct(node[0])) return node as Record<string, any>[];
      for (const el of node) {
        const f = walk(el);
        if (f) return f;
      }
      return null;
    }
    for (const key of Object.keys(node)) {
      const f = walk(node[key]);
      if (f) return f;
    }
    return null;
  };
  return walk(body) ?? [];
}

import { createHash, createHmac } from 'node:crypto';
import { logger } from '../../../utils/logger.js';
import type { ProductSearchConnector, ProductSearchResult } from './base.product.connector.js';

/**
 * Recherche de produits AliExpress (API affiliée / dropshipping).
 *
 * Utilise la passerelle « TOP » d'AliExpress Open Platform. Les identifiants
 * (App Key + App Secret) proviennent du portail développeur AliExpress
 * (https://openservice.aliexpress.com). L'`appSecret` NE quitte JAMAIS le
 * serveur : il sert uniquement à signer les requêtes.
 *
 * Contrat de signature (documenté par AliExpress/Taobao) :
 *   1. rassembler tous les paramètres (système + métier), trier par clé ;
 *   2. concaténer `clé + valeur` ;
 *   3. md5    : MD5(secret + concat + secret) en MAJUSCULES ;
 *      sha256 : HMAC-SHA256(concat, secret) en MAJUSCULES.
 */
export class AliExpressProductConnector implements ProductSearchConnector {
  readonly name = 'aliexpress';

  private readonly gateway: string;
  private readonly signMethod: 'md5' | 'sha256';
  private readonly method: string;

  constructor(
    private readonly appKey: string,
    private readonly appSecret: string,
    private readonly opts: {
      trackingId?: string;
      currency?: string;
      language?: string;
      gateway?: string;
      signMethod?: 'md5' | 'sha256';
      method?: string;
    } = {},
  ) {
    this.gateway = opts.gateway || 'https://gw.api.taobao.com/router/rest';
    this.signMethod = opts.signMethod || 'md5';
    // Requête produit par mots-clés (API affiliée). Configurable au besoin.
    this.method = opts.method || 'aliexpress.affiliate.product.query';
  }

  async search(query: string, opts?: { limit?: number }): Promise<ProductSearchResult[]> {
    const q = (query ?? '').trim();
    if (!q) return [];

    const params: Record<string, string> = {
      // Paramètres système
      app_key: this.appKey,
      method: this.method,
      format: 'json',
      v: '2.0',
      sign_method: this.signMethod,
      timestamp: topTimestamp(),
      // Paramètres métier
      keywords: q,
      page_no: '1',
      page_size: String(Math.min(Math.max(opts?.limit ?? 20, 1), 50)),
      target_currency: this.opts.currency || 'EUR',
      target_language: this.opts.language || 'FR',
    };
    if (this.opts.trackingId) params.tracking_id = this.opts.trackingId;

    params.sign = this.sign(params);

    const res = await fetch(this.gateway, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
    });
    if (!res.ok) {
      logger.error('AliExpress: réponse HTTP non OK', { status: res.status });
      throw new Error(`AliExpress: HTTP ${res.status}`);
    }
    const body = await res.json().catch(() => ({}));

    // AliExpress renvoie une erreur métier dans `error_response`.
    if (body?.error_response) {
      const e = body.error_response;
      logger.error('AliExpress: erreur API', { code: e.code, msg: e.msg, sub: e.sub_msg });
      throw new Error(`AliExpress: ${e.sub_msg || e.msg || 'erreur API'}`);
    }

    const products = findProducts(body);
    return products.slice(0, opts?.limit ?? 20).map((p) => this.mapProduct(p));
  }

  private sign(params: Record<string, string>): string {
    const concat = Object.keys(params)
      .filter((k) => k !== 'sign')
      .sort()
      .map((k) => k + params[k])
      .join('');
    if (this.signMethod === 'sha256') {
      return createHmac('sha256', this.appSecret).update(concat, 'utf8').digest('hex').toUpperCase();
    }
    return createHash('md5').update(this.appSecret + concat + this.appSecret, 'utf8').digest('hex').toUpperCase();
  }

  private mapProduct(p: Record<string, any>): ProductSearchResult {
    const price = Number(
      p.target_sale_price ?? p.sale_price ?? p.target_original_price ?? p.original_price ?? 0,
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

/** Horodatage attendu par la passerelle TOP : `yyyy-MM-dd HH:mm:ss` en GMT+8. */
function topTimestamp(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000); // GMT+8
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/**
 * Extrait le tableau de produits de la réponse AliExpress, dont l'imbrication
 * varie selon la méthode. On descend récursivement jusqu'à trouver un tableau
 * `product` (ou `products` déjà tableau).
 */
function findProducts(body: unknown): Record<string, any>[] {
  const seen = new Set<unknown>();
  const walk = (node: any): Record<string, any>[] | null => {
    if (!node || typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      // Tableau de produits si les éléments ressemblent à des produits.
      if (node.length && typeof node[0] === 'object' && ('product_title' in node[0] || 'product_id' in node[0])) {
        return node as Record<string, any>[];
      }
      for (const el of node) {
        const found = walk(el);
        if (found) return found;
      }
      return null;
    }
    if (Array.isArray(node.product)) return node.product as Record<string, any>[];
    if (Array.isArray(node.products)) return node.products as Record<string, any>[];
    for (const key of Object.keys(node)) {
      const found = walk(node[key]);
      if (found) return found;
    }
    return null;
  };
  return walk(body) ?? [];
}

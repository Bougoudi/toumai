import { logger } from '../../../utils/logger.js';
import type { BarcodeConnector, BarcodeProduct } from './base.barcode.connector.js';

/**
 * Connecteur code-barres HTTP (base de données réelle).
 *
 * Contrat par défaut : GET {url}?code={code} (ou {url} contenant `{code}`) avec
 * l'en-tête `Authorization: Bearer {key}`. `mapProduct` reconnaît plusieurs
 * formats répandus :
 *   - générique      : { title, brand, category, image|imageUrl, price }
 *   - UPCitemdb      : { items: [{ title, brand, category, images:[...] }] }
 *   - Barcode Lookup : { products: [{ title/product_name, brand, category, images }] }
 *   - Open Food Facts: { product: { product_name, brands, image_url } }
 */
export class HttpBarcodeConnector implements BarcodeConnector {
  readonly name = 'http-barcode';

  constructor(
    private readonly url: string,
    /** Optionnelle : certaines bases (Open Food Facts) n'exigent pas de clé. */
    private readonly key = '',
  ) {}

  async lookup(code: string): Promise<BarcodeProduct | null> {
    const target = this.url.includes('{code}')
      ? this.url.replace('{code}', encodeURIComponent(code))
      : `${this.url}${this.url.includes('?') ? '&' : '?'}code=${encodeURIComponent(code)}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.key) headers.Authorization = `Bearer ${this.key}`;
    const res = await fetch(target, { headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      logger.error('HttpBarcodeConnector: réponse non OK', { status: res.status });
      throw new Error(`Base code-barres : HTTP ${res.status}`);
    }
    return this.mapProduct(await res.json());
  }

  private mapProduct(body: any): BarcodeProduct | null {
    const it =
      body?.items?.[0] ?? // UPCitemdb
      body?.products?.[0] ?? // Barcode Lookup
      body?.product ?? // Open Food Facts
      body; // générique
    if (!it) return null;
    const title = it.title ?? it.product_name ?? it.name;
    if (!title) return null;
    const image = it.imageUrl ?? it.image ?? it.image_url ?? (Array.isArray(it.images) ? it.images[0] : undefined);
    const price = it.price != null ? Number(it.price) : undefined;
    return {
      title: String(title),
      brand: it.brand ?? it.brands ?? undefined,
      category: it.category ?? undefined,
      imageUrl: image ? String(image) : undefined,
      price: Number.isFinite(price) ? price : undefined,
    };
  }
}

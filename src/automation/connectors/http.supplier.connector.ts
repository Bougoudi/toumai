import { logger } from '../../utils/logger.js';
import type { NormalizedSupplier, SupplierConnector } from './base.connector.js';

/**
 * Connecteur fournisseurs HTTP (source réelle : annuaire B2B, marketplace...).
 *
 * Contrat attendu : GET {url}?category=&region= avec `Authorization: Bearer {key}`,
 * renvoyant `{ items: [...] }` (ou un tableau) de fournisseurs. Adaptez `mapItem`
 * au format exact de votre source.
 */
export class HttpSupplierConnector implements SupplierConnector {
  readonly name = 'http-supplier';

  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  async fetchSuppliers(params?: { category?: string; region?: string }): Promise<NormalizedSupplier[]> {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.region) qs.set('region', params.region);

    const res = await fetch(`${this.url}?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${this.key}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      logger.error('HttpSupplierConnector: réponse non OK', { status: res.status });
      throw new Error(`Source fournisseurs: HTTP ${res.status}`);
    }
    const body = await res.json();
    const items: unknown[] = Array.isArray(body) ? body : (body.items ?? body.data ?? []);
    return items.map((it) => this.mapItem(it as Record<string, any>));
  }

  private mapItem(it: Record<string, any>): NormalizedSupplier {
    const num = (v: unknown) => (v == null ? undefined : Number(v));
    return {
      externalId: String(it.id ?? it.externalId ?? it.name),
      name: String(it.name ?? 'Fournisseur'),
      country: it.country ? String(it.country) : undefined,
      region: it.region ? String(it.region) : undefined,
      website: it.website ? String(it.website) : undefined,
      email: it.email ? String(it.email) : undefined,
      phone: it.phone ? String(it.phone) : undefined,
      rating: num(it.rating),
      verified: Boolean(it.verified),
      certifications: it.certifications ? String(it.certifications) : undefined,
      leadTimeDays: num(it.leadTimeDays),
      minOrderValue: num(it.minOrderValue),
      currency: it.currency ? String(it.currency) : undefined,
      offers: Array.isArray(it.offers)
        ? it.offers.map((o: Record<string, any>) => ({
            externalId: o.id ? String(o.id) : undefined,
            title: String(o.title ?? o.name ?? 'Offre'),
            category: String(o.category ?? it.category ?? 'divers'),
            keywords: String(o.keywords ?? ''),
            unitPrice: num(o.unitPrice ?? o.price),
            currency: o.currency ? String(o.currency) : undefined,
            moq: num(o.moq),
            leadTimeDays: num(o.leadTimeDays),
            inStock: o.inStock == null ? true : Boolean(o.inStock),
          }))
        : [],
    };
  }
}

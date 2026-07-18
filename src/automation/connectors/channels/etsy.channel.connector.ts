import { logger } from '../../../utils/logger.js';
import {
  requireConfig,
  type ChannelProduct,
  type ConnectionInfo,
  type NormalizedChannelOrder,
  type PublishResult,
  type SalesChannelConnector,
} from './base.channel.connector.js';

const API = 'https://openapi.etsy.com/v3/application';

/**
 * Canal Etsy — API Open v3.
 * Config attendue : apiKey (x-api-key), accessToken (OAuth2), shopId.
 * Doc : https://developers.etsy.com/documentation/
 */
export class EtsyChannelConnector implements SalesChannelConnector {
  readonly type = 'etsy';
  readonly label = 'Etsy';
  readonly configFields = [
    { key: 'apiKey', label: 'Keystring (x-api-key)', secret: true, help: 'App Etsy Developers' },
    { key: 'accessToken', label: 'Jeton OAuth2', secret: true, help: 'Token utilisateur (scopes listings_w, transactions_r)' },
    { key: 'shopId', label: 'Shop ID', help: 'Identifiant numérique de votre boutique' },
  ];

  private headers(config: Record<string, string>) {
    return {
      'x-api-key': config.apiKey,
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async testConnection(config: Record<string, string>): Promise<ConnectionInfo> {
    requireConfig(this.type, config, ['apiKey', 'accessToken', 'shopId']);
    const res = await fetch(`${API}/shops/${config.shopId}`, { headers: this.headers(config) });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const shop = await res.json();
    return { ok: true, account: shop.shop_name ?? `shop ${config.shopId}` };
  }

  async publishListing(config: Record<string, string>, product: ChannelProduct): Promise<PublishResult> {
    requireConfig(this.type, config, ['apiKey', 'accessToken', 'shopId']);
    const res = await fetch(`${API}/shops/${config.shopId}/listings`, {
      method: 'POST',
      headers: this.headers(config),
      body: JSON.stringify({
        quantity: product.quantity,
        title: product.name.slice(0, 140),
        description: product.description ?? product.name,
        price: product.price,
        who_made: 'someone_else',
        when_made: 'made_to_order',
        taxonomy_id: 1, // à affiner selon la catégorie Etsy
        should_auto_renew: true,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Etsy publish HTTP ${res.status}: ${t.slice(0, 140)}`);
    }
    const listing = await res.json();
    return { externalId: String(listing.listing_id), url: listing.url };
  }

  async fetchOrders(config: Record<string, string>, since?: Date): Promise<NormalizedChannelOrder[]> {
    requireConfig(this.type, config, ['apiKey', 'accessToken', 'shopId']);
    const qs = new URLSearchParams({ limit: '50', was_paid: 'true' });
    if (since) qs.set('min_created', String(Math.floor(since.getTime() / 1000)));
    const res = await fetch(`${API}/shops/${config.shopId}/receipts?${qs}`, { headers: this.headers(config) });
    if (!res.ok) {
      logger.error('Etsy fetchOrders non OK', { status: res.status });
      throw new Error(`Etsy commandes HTTP ${res.status}`);
    }
    const body = await res.json();
    return (body.results ?? []).map((r: any) => ({
      externalId: String(r.receipt_id),
      customer: {
        name: r.name ?? 'Client Etsy',
        email: r.buyer_email ?? `etsy-${r.receipt_id}@marketplace.local`,
        city: r.city,
        country: r.country_iso,
        zip: r.zip,
      },
      items: (r.transactions ?? []).map((t: any) => ({
        sku: t.sku,
        title: t.title ?? 'Article',
        quantity: t.quantity ?? 1,
        unitPrice: (t.price?.amount ?? 0) / (t.price?.divisor ?? 100),
      })),
      currency: r.grandtotal?.currency_code ?? 'EUR',
      total: (r.grandtotal?.amount ?? 0) / (r.grandtotal?.divisor ?? 100),
      placedAt: r.create_timestamp ? new Date(r.create_timestamp * 1000).toISOString() : undefined,
    }));
  }
}

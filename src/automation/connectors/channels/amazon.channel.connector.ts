import { logger } from '../../../utils/logger.js';
import {
  requireConfig,
  type ChannelProduct,
  type ConnectionInfo,
  type NormalizedChannelOrder,
  type PublishResult,
  type SalesChannelConnector,
} from './base.channel.connector.js';

const REGION_HOST: Record<string, string> = {
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  na: 'https://sellingpartnerapi-na.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
};

/**
 * Canal Amazon — Selling Partner API (SP-API).
 * Config : lwaClientId, lwaClientSecret, refreshToken, region (eu|na|fe),
 * marketplaceId, sellerId. L'accès se fait via un jeton LWA (Login With Amazon)
 * échangé à partir du refresh token.
 * Doc : https://developer-docs.amazon.com/sp-api/
 *
 * Note : l'inscription développeur SP-API doit être validée par Amazon, et le
 * compte vendeur doit être Professionnel. La publication d'annonces requiert un
 * productType Amazon adapté à la catégorie (à mapper selon votre catalogue).
 */
export class AmazonChannelConnector implements SalesChannelConnector {
  readonly type = 'amazon';
  readonly label = 'Amazon';
  readonly configFields = [
    { key: 'lwaClientId', label: 'LWA Client ID', secret: true, help: 'App SP-API (Login With Amazon)' },
    { key: 'lwaClientSecret', label: 'LWA Client Secret', secret: true },
    { key: 'refreshToken', label: 'Refresh token', secret: true, help: 'Autorisation du vendeur' },
    { key: 'region', label: 'Région (eu / na / fe)', help: 'eu pour l’Europe' },
    { key: 'marketplaceId', label: 'Marketplace ID', help: 'ex: A13V1IB3VIYZZH (Amazon.fr)' },
    { key: 'sellerId', label: 'Seller ID' },
  ];

  private host(config: Record<string, string>) {
    return REGION_HOST[(config.region || 'eu').toLowerCase()] ?? REGION_HOST.eu;
  }

  /** Échange le refresh token contre un access token LWA. */
  private async accessToken(config: Record<string, string>): Promise<string> {
    const res = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: config.refreshToken,
        client_id: config.lwaClientId,
        client_secret: config.lwaClientSecret,
      }),
    });
    if (!res.ok) throw new Error(`Amazon LWA HTTP ${res.status}`);
    const data = await res.json();
    return data.access_token as string;
  }

  private async headers(config: Record<string, string>) {
    return {
      'x-amz-access-token': await this.accessToken(config),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async testConnection(config: Record<string, string>): Promise<ConnectionInfo> {
    requireConfig(this.type, config, ['lwaClientId', 'lwaClientSecret', 'refreshToken']);
    try {
      const res = await fetch(`${this.host(config)}/sellers/v1/marketplaceParticipations`, {
        headers: await this.headers(config),
      });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      return { ok: true, account: config.sellerId || 'vendeur Amazon' };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : 'échec' };
    }
  }

  async publishListing(config: Record<string, string>, product: ChannelProduct): Promise<PublishResult> {
    requireConfig(this.type, config, ['lwaClientId', 'lwaClientSecret', 'refreshToken', 'marketplaceId', 'sellerId']);
    const sku = product.sku || `TM-${Date.now()}`;
    const res = await fetch(
      `${this.host(config)}/listings/2021-08-01/items/${config.sellerId}/${encodeURIComponent(sku)}?marketplaceIds=${config.marketplaceId}`,
      {
        method: 'PUT',
        headers: await this.headers(config),
        body: JSON.stringify({
          productType: 'PRODUCT', // à mapper vers un productType Amazon réel selon la catégorie
          requirements: 'LISTING',
          attributes: {
            item_name: [{ value: product.name, marketplace_id: config.marketplaceId }],
            list_price: [{ value: product.price, currency: product.currency, marketplace_id: config.marketplaceId }],
            fulfillment_availability: [{ fulfillment_channel_code: 'DEFAULT', quantity: product.quantity }],
          },
        }),
      },
    );
    if (!res.ok) throw new Error(`Amazon publish HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`);
    return { externalId: sku };
  }

  async fetchOrders(config: Record<string, string>, since?: Date): Promise<NormalizedChannelOrder[]> {
    requireConfig(this.type, config, ['lwaClientId', 'lwaClientSecret', 'refreshToken', 'marketplaceId']);
    const createdAfter = (since ?? new Date(Date.now() - 24 * 3600 * 1000)).toISOString();
    const qs = new URLSearchParams({ MarketplaceIds: config.marketplaceId, CreatedAfter: createdAfter });
    const res = await fetch(`${this.host(config)}/orders/v0/orders?${qs}`, { headers: await this.headers(config) });
    if (!res.ok) {
      logger.error('Amazon fetchOrders non OK', { status: res.status });
      throw new Error(`Amazon commandes HTTP ${res.status}`);
    }
    const body = await res.json();
    const orders = body.payload?.Orders ?? [];
    // Note : les articles nécessitent un appel /orders/v0/orders/{id}/orderItems par commande.
    return orders.map((o: any) => ({
      externalId: String(o.AmazonOrderId),
      customer: {
        name: o.BuyerInfo?.BuyerName ?? 'Client Amazon',
        email: o.BuyerInfo?.BuyerEmail ?? `amazon-${o.AmazonOrderId}@marketplace.local`,
        city: o.ShippingAddress?.City,
        country: o.ShippingAddress?.CountryCode,
        zip: o.ShippingAddress?.PostalCode,
      },
      items: [],
      currency: o.OrderTotal?.CurrencyCode ?? 'EUR',
      total: Number(o.OrderTotal?.Amount ?? 0),
      placedAt: o.PurchaseDate,
    }));
  }
}

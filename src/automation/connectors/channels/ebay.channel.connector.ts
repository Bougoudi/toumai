import { logger } from '../../../utils/logger.js';
import {
  requireConfig,
  type ChannelProduct,
  type ConnectionInfo,
  type NormalizedChannelOrder,
  type PublishResult,
  type SalesChannelConnector,
} from './base.channel.connector.js';

const API = 'https://api.ebay.com';

/**
 * Canal eBay — APIs Sell (Fulfillment + Inventory).
 * Config attendue : accessToken (OAuth2 user token), fulfillmentPolicyId,
 * paymentPolicyId, returnPolicyId, merchantLocationKey (pour publier).
 * Doc : https://developer.ebay.com/api-docs/sell/
 */
export class EbayChannelConnector implements SalesChannelConnector {
  readonly type = 'ebay';
  readonly label = 'eBay';
  readonly configFields = [
    { key: 'accessToken', label: 'Jeton OAuth2 utilisateur', secret: true, help: 'eBay Developers — scopes sell.inventory, sell.fulfillment' },
    { key: 'merchantLocationKey', label: 'Merchant location key', help: 'Requis pour publier des annonces' },
    { key: 'fulfillmentPolicyId', label: 'Fulfillment policy ID', help: 'Politique de livraison' },
    { key: 'paymentPolicyId', label: 'Payment policy ID' },
    { key: 'returnPolicyId', label: 'Return policy ID' },
  ];

  private headers(config: Record<string, string>) {
    return {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Content-Language': 'fr-FR',
    };
  }

  async testConnection(config: Record<string, string>): Promise<ConnectionInfo> {
    requireConfig(this.type, config, ['accessToken']);
    const res = await fetch(`${API}/sell/inventory/v1/inventory_item?limit=1`, { headers: this.headers(config) });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true, account: 'compte eBay' };
  }

  async publishListing(config: Record<string, string>, product: ChannelProduct): Promise<PublishResult> {
    requireConfig(this.type, config, ['accessToken', 'merchantLocationKey', 'fulfillmentPolicyId', 'paymentPolicyId', 'returnPolicyId']);
    const sku = product.sku || `TM-${Date.now()}`;

    // 1. Inventaire
    const inv = await fetch(`${API}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      method: 'PUT',
      headers: this.headers(config),
      body: JSON.stringify({
        availability: { shipToLocationAvailability: { quantity: product.quantity } },
        condition: 'NEW',
        product: { title: product.name.slice(0, 80), description: product.description ?? product.name, imageUrls: product.images.slice(0, 12) },
      }),
    });
    if (!inv.ok && inv.status !== 204) {
      throw new Error(`eBay inventaire HTTP ${inv.status}: ${(await inv.text()).slice(0, 140)}`);
    }

    // 2. Offre
    const offerRes = await fetch(`${API}/sell/inventory/v1/offer`, {
      method: 'POST',
      headers: this.headers(config),
      body: JSON.stringify({
        sku,
        marketplaceId: 'EBAY_FR',
        format: 'FIXED_PRICE',
        availableQuantity: product.quantity,
        pricingSummary: { price: { value: product.price, currency: product.currency } },
        listingPolicies: {
          fulfillmentPolicyId: config.fulfillmentPolicyId,
          paymentPolicyId: config.paymentPolicyId,
          returnPolicyId: config.returnPolicyId,
        },
        merchantLocationKey: config.merchantLocationKey,
      }),
    });
    if (!offerRes.ok) throw new Error(`eBay offre HTTP ${offerRes.status}: ${(await offerRes.text()).slice(0, 140)}`);
    const offer = await offerRes.json();

    // 3. Publication
    const pub = await fetch(`${API}/sell/inventory/v1/offer/${offer.offerId}/publish`, { method: 'POST', headers: this.headers(config) });
    if (!pub.ok) throw new Error(`eBay publication HTTP ${pub.status}`);
    const published = await pub.json();
    return { externalId: String(published.listingId ?? offer.offerId) };
  }

  async fetchOrders(config: Record<string, string>, since?: Date): Promise<NormalizedChannelOrder[]> {
    requireConfig(this.type, config, ['accessToken']);
    const qs = new URLSearchParams({ limit: '50' });
    if (since) qs.set('filter', `creationdate:[${since.toISOString()}..]`);
    const res = await fetch(`${API}/sell/fulfillment/v1/order?${qs}`, { headers: this.headers(config) });
    if (!res.ok) {
      logger.error('eBay fetchOrders non OK', { status: res.status });
      throw new Error(`eBay commandes HTTP ${res.status}`);
    }
    const body = await res.json();
    return (body.orders ?? []).map((o: any) => {
      const ship = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo ?? {};
      return {
        externalId: String(o.orderId),
        customer: {
          name: ship.fullName ?? o.buyer?.username ?? 'Client eBay',
          email: o.buyer?.email ?? `ebay-${o.orderId}@marketplace.local`,
          city: ship.contactAddress?.city,
          country: ship.contactAddress?.countryCode,
          zip: ship.contactAddress?.postalCode,
        },
        items: (o.lineItems ?? []).map((li: any) => ({
          sku: li.sku,
          title: li.title ?? 'Article',
          quantity: li.quantity ?? 1,
          unitPrice: Number(li.lineItemCost?.value ?? 0),
        })),
        currency: o.pricingSummary?.total?.currency ?? 'EUR',
        total: Number(o.pricingSummary?.total?.value ?? 0),
        placedAt: o.creationDate,
      };
    });
  }
}

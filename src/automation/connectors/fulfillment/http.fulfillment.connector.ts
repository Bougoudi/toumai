import { logger } from '../../../utils/logger.js';
import type {
  FulfillmentConnector,
  PlaceOrderRequest,
  PlaceOrderResult,
} from './base.fulfillment.connector.js';

/**
 * Connecteur d'exécution HTTP (source réelle : API du fournisseur / marketplace).
 *
 * Contrat attendu : POST {url}/orders avec `Authorization: Bearer {key}` et le
 * corps de la commande, renvoyant `{ accepted, trackingNumber, carrier, cost }`.
 * Adaptez le mapping au format exact de votre fournisseur.
 */
export class HttpFulfillmentConnector implements FulfillmentConnector {
  readonly name = 'http-fulfillment';

  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    try {
      const res = await fetch(`${this.url}/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          externalRef: req.purchaseOrderId,
          supplierId: req.supplierId,
          offerId: req.offerId,
          quantity: req.quantity,
          shipTo: req.shipTo,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { accepted: false, error: data.error || `HTTP ${res.status}` };
      }
      return {
        accepted: data.accepted ?? true,
        trackingNumber: data.trackingNumber ?? data.tracking,
        carrier: data.carrier,
        cost: data.cost != null ? Number(data.cost) : undefined,
        error: data.error,
      };
    } catch (err) {
      logger.error('HttpFulfillmentConnector: échec', {
        err: err instanceof Error ? err.message : String(err),
      });
      return { accepted: false, error: 'Erreur réseau fournisseur' };
    }
  }
}

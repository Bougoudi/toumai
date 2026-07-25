import type {
  FulfillmentConnector,
  PlaceOrderRequest,
  PlaceOrderResult,
} from './base.fulfillment.connector.js';

const CARRIERS = ['DHL', 'UPS', 'Colissimo', 'Chronopost'];

/**
 * Connecteur d'exécution de démonstration : simule le passage de commande
 * chez un fournisseur et génère un numéro de suivi. Remplacez-le par une
 * intégration réelle (API du fournisseur / marketplace).
 */
export class MockFulfillmentConnector implements FulfillmentConnector {
  readonly name = 'mock-fulfillment';

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    // Simule un échec ponctuel (ex: rupture de stock) dans ~5 % des cas.
    if (Math.random() < 0.05) {
      return { accepted: false, error: 'Rupture de stock chez le fournisseur' };
    }
    const carrier = CARRIERS[Math.floor(Math.random() * CARRIERS.length)];
    const trackingNumber = `${carrier.slice(0, 2).toUpperCase()}${Date.now()}${Math.floor(Math.random() * 1000)}`;
    return {
      accepted: true,
      trackingNumber,
      carrier,
      cost: Number((req.quantity * (5 + Math.random() * 20)).toFixed(2)),
    };
  }
}

/**
 * Contrat commun à tout connecteur d'exécution de commande fournisseur.
 *
 * Un connecteur fulfillment passe réellement la commande chez le fournisseur
 * (API partenaire, EDI, marketplace) et renvoie un numéro de suivi. Le job
 * `fulfillOrders` l'utilise pour honorer automatiquement les commandes payées.
 *
 * Pour brancher un vrai fournisseur : implémentez `placeOrder()` / `getStatus()`
 * et enregistrez le connecteur dans `fulfillOrders.job.ts`.
 */
export interface PlaceOrderRequest {
  purchaseOrderId: string;
  supplierId: string;
  offerId?: string | null;
  quantity: number;
  shipTo: {
    name: string;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    zip?: string | null;
  };
}

export interface PlaceOrderResult {
  accepted: boolean;
  trackingNumber?: string;
  carrier?: string;
  cost?: number;
  error?: string;
}

export interface FulfillmentConnector {
  readonly name: string;
  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult>;
}

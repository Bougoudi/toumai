import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import type { SupplierConnector } from './base.connector.js';
import type { FulfillmentConnector } from './fulfillment/base.fulfillment.connector.js';
import { HttpFulfillmentConnector } from './fulfillment/http.fulfillment.connector.js';
import { MockFulfillmentConnector } from './fulfillment/mock.fulfillment.connector.js';
import { HttpSupplierConnector } from './http.supplier.connector.js';
import type { MarketConnector } from './market/base.market.connector.js';
import { HttpMarketConnector } from './market/http.market.connector.js';
import { MockMarketConnector } from './market/mock.market.connector.js';
import { MockConnector } from './mock.connector.js';
import type { BarcodeConnector } from './barcode/base.barcode.connector.js';
import { HttpBarcodeConnector } from './barcode/http.barcode.connector.js';
import type { VisionConnector } from './vision/base.vision.connector.js';
import { HttpVisionConnector } from './vision/http.vision.connector.js';

/**
 * Sélectionne les connecteurs à utiliser : source HTTP réelle si `url`+`key`
 * sont configurés, sinon le connecteur de démonstration (mock). Cela permet de
 * passer en production en ajoutant simplement les variables d'environnement.
 */

export function getMarketConnectors(): MarketConnector[] {
  const { url, key } = env.connectors.market;
  if (url && key) {
    logger.info('Connecteur marché : HTTP (source réelle)');
    return [new HttpMarketConnector(url, key)];
  }
  return [new MockMarketConnector()];
}

export function getSupplierConnectors(): SupplierConnector[] {
  const { url, key } = env.connectors.supplier;
  if (url && key) {
    logger.info('Connecteur fournisseurs : HTTP (source réelle)');
    return [new HttpSupplierConnector(url, key)];
  }
  return [new MockConnector()];
}

export function getFulfillmentConnector(): FulfillmentConnector {
  const { url, key } = env.connectors.fulfillment;
  if (url && key) {
    logger.info('Connecteur exécution : HTTP (source réelle)');
    return new HttpFulfillmentConnector(url, key);
  }
  return new MockFulfillmentConnector();
}

/**
 * Connecteur de vision. Renvoie `null` s'il n'est pas configuré : la recherche
 * par photo retombe alors sur le mot-clé fourni (aucune reconnaissance fabriquée).
 */
export function getVisionConnector(): VisionConnector | null {
  const { url, key } = env.connectors.vision;
  if (url && key) {
    logger.info('Connecteur vision : HTTP (reconnaissance d’image réelle)');
    return new HttpVisionConnector(url, key);
  }
  return null;
}

/**
 * Connecteur code-barres. Renvoie `null` s'il n'est pas configuré : la recherche
 * par scan retombe alors sur un produit dérivé du code (démonstration).
 */
export function getBarcodeConnector(): BarcodeConnector | null {
  const { url, key } = env.connectors.barcode;
  if (url && key) {
    logger.info('Connecteur code-barres : HTTP (base de données réelle)');
    return new HttpBarcodeConnector(url, key);
  }
  return null;
}

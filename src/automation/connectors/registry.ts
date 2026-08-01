import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import type { SupplierConnector } from './base.connector.js';
import type { FulfillmentConnector, PlaceOrderResult } from './fulfillment/base.fulfillment.connector.js';
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
 * Sélectionne les connecteurs à utiliser :
 *   1. source HTTP réelle si `url`+`key` sont configurés ;
 *   2. sinon, en mode démo (`DEMO_MODE=true`), le connecteur de démonstration ;
 *   3. sinon (production réelle sans source configurée), aucun connecteur —
 *      l'appli ne fabrique alors aucune donnée factice.
 * Passer en production = ajouter les variables d'environnement et DEMO_MODE=false.
 */

export function getMarketConnectors(): MarketConnector[] {
  const { url, key } = env.connectors.market;
  if (url && key) {
    logger.info('Connecteur marché : HTTP (source réelle)');
    return [new HttpMarketConnector(url, key)];
  }
  if (env.demoMode) return [new MockMarketConnector()];
  logger.info('Connecteur marché : aucun (production sans source configurée)');
  return [];
}

export function getSupplierConnectors(): SupplierConnector[] {
  const { url, key } = env.connectors.supplier;
  if (url && key) {
    logger.info('Connecteur fournisseurs : HTTP (source réelle)');
    return [new HttpSupplierConnector(url, key)];
  }
  if (env.demoMode) return [new MockConnector()];
  logger.info('Connecteur fournisseurs : aucun (production sans source configurée)');
  return [];
}

/**
 * Connecteur d'exécution neutre : utilisé en production tant qu'aucun vrai
 * service d'expédition n'est branché. Il refuse proprement (sans « faux envoi »),
 * laissant la commande en attente d'un traitement réel.
 */
class DisabledFulfillmentConnector implements FulfillmentConnector {
  readonly name = 'disabled';
  async placeOrder(): Promise<PlaceOrderResult> {
    return { accepted: false, error: 'Aucun connecteur d’exécution réel configuré (mode production).' };
  }
}

export function getFulfillmentConnector(): FulfillmentConnector {
  const { url, key } = env.connectors.fulfillment;
  if (url && key) {
    logger.info('Connecteur exécution : HTTP (source réelle)');
    return new HttpFulfillmentConnector(url, key);
  }
  if (env.demoMode) return new MockFulfillmentConnector();
  logger.info('Connecteur exécution : neutre (production sans service configuré)');
  return new DisabledFulfillmentConnector();
}

/**
 * Connecteur de vision. Renvoie `null` s'il n'est pas configuré : la recherche
 * par photo retombe alors sur le mot-clé fourni (aucune reconnaissance fabriquée).
 */
export function getVisionConnector(): VisionConnector | null {
  const { url, key, provider } = env.connectors.vision;
  // Google : la clé suffit (l'URL a une valeur par défaut). Générique : url + clé.
  if ((provider === 'google' && key) || (url && key)) {
    logger.info('Connecteur vision : HTTP (reconnaissance d’image réelle)', { provider: provider || 'générique' });
    return new HttpVisionConnector(url, key, provider);
  }
  return null;
}

/**
 * Connecteur code-barres. Renvoie `null` s'il n'est pas configuré : la recherche
 * par scan retombe alors sur un produit dérivé du code (démonstration).
 * La clé est optionnelle (certaines bases, comme Open Food Facts, sont libres).
 */
export function getBarcodeConnector(): BarcodeConnector | null {
  const { url, key } = env.connectors.barcode;
  if (url) {
    logger.info('Connecteur code-barres : HTTP (base de données réelle)');
    return new HttpBarcodeConnector(url, key);
  }
  return null;
}

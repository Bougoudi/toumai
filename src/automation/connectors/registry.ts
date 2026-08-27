import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import type { SupplierConnector } from './base.connector.js';
import type { FulfillmentConnector, PlaceOrderResult } from './fulfillment/base.fulfillment.connector.js';
import { HttpFulfillmentConnector } from './fulfillment/http.fulfillment.connector.js';
import { MockFulfillmentConnector } from './fulfillment/mock.fulfillment.connector.js';
import { HttpSupplierConnector } from './http.supplier.connector.js';
import { AliexpressSupplierConnector } from './aliexpress.supplier.connector.js';
import type { MarketConnector } from './market/base.market.connector.js';
import { HttpMarketConnector } from './market/http.market.connector.js';
import { MockMarketConnector } from './market/mock.market.connector.js';
import { AliexpressMarketConnector } from './market/aliexpress.market.connector.js';
import { MockConnector } from './mock.connector.js';
import type { BarcodeConnector } from './barcode/base.barcode.connector.js';
import { HttpBarcodeConnector } from './barcode/http.barcode.connector.js';
import type { VisionConnector } from './vision/base.vision.connector.js';
import { HttpVisionConnector } from './vision/http.vision.connector.js';
import { GeminiVisionConnector } from './vision/gemini.vision.connector.js';
import type { ProductSearchConnector } from './product/base.product.connector.js';
import { AliExpressProductConnector } from './product/aliexpress.product.connector.js';
import { getAliexpressCreds, getAiCreds, getSettings } from '../../modules/settings/settings.service.js';
import { aliexpressOAuthService } from '../../modules/aliexpress/aliexpress.oauth.service.js';

/**
 * Sélectionne les connecteurs à utiliser :
 *   1. source HTTP réelle si `url`+`key` sont configurés ;
 *   2. sinon, en mode démo (`DEMO_MODE=true`), le connecteur de démonstration ;
 *   3. sinon (production réelle sans source configurée), aucun connecteur —
 *      l'appli ne fabrique alors aucune donnée factice.
 * Passer en production = ajouter les variables d'environnement et DEMO_MODE=false.
 */

export async function getMarketConnectors(): Promise<MarketConnector[]> {
  const list: MarketConnector[] = [];
  const { url, key } = env.connectors.market;
  if (url && key) {
    logger.info('Connecteur marché : HTTP (source réelle)');
    list.push(new HttpMarketConnector(url, key));
  }
  // AliExpress : les vrais produits du flux deviennent des opportunités.
  const ali = await getAliexpressCreds();
  if (ali.appKey && ali.appSecret) {
    logger.info('Connecteur marché : AliExpress (analyse réelle)');
    list.push(new AliexpressMarketConnector(ali.appKey, ali.appSecret, { currency: getSettings().currency, feedName: ali.feedName }));
  }
  if (!list.length && env.demoMode) list.push(new MockMarketConnector());
  if (!list.length) logger.info('Connecteur marché : aucun (production sans source configurée)');
  return list;
}

export async function getSupplierConnectors(): Promise<SupplierConnector[]> {
  const list: SupplierConnector[] = [];
  const { url, key } = env.connectors.supplier;
  if (url && key) {
    logger.info('Connecteur fournisseurs : HTTP (source réelle)');
    list.push(new HttpSupplierConnector(url, key));
  }
  // AliExpress : chaque boutique du flux devient un fournisseur.
  const ali = await getAliexpressCreds();
  if (ali.appKey && ali.appSecret) {
    logger.info('Connecteur fournisseurs : AliExpress');
    list.push(new AliexpressSupplierConnector(ali.appKey, ali.appSecret, { currency: getSettings().currency, feedName: ali.feedName }));
  }
  if (!list.length && env.demoMode) list.push(new MockConnector());
  if (!list.length) logger.info('Connecteur fournisseurs : aucun (production sans source configurée)');
  return list;
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
export async function getVisionConnector(): Promise<VisionConnector | null> {
  const { url, key, provider } = env.connectors.vision;
  // Google : la clé suffit (l'URL a une valeur par défaut). Générique : url + clé.
  if ((provider === 'google' && key) || (url && key)) {
    logger.info('Connecteur vision : HTTP (reconnaissance d’image réelle)', { provider: provider || 'générique' });
    return new HttpVisionConnector(url, key, provider);
  }
  // Repli : reconnaissance d'image via la clé IA (Gemini) déjà configurée.
  const ai = await getAiCreds();
  if (ai.apiKey && ai.provider === 'gemini') {
    logger.info('Connecteur vision : Gemini (reconnaissance d’image via clé IA)');
    return new GeminiVisionConnector(ai.apiKey, ai.model || undefined);
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

/**
 * Connecteur de recherche de produits (« Trouver des produits »). Renvoie
 * `null` s'il n'est pas configuré : la recherche par texte retombe alors sur
 * le catalogue de démonstration (aucun vrai produit inventé).
 */
export async function getProductConnector(): Promise<ProductSearchConnector | null> {
  const creds = await getAliexpressCreds();
  if (creds.appKey && creds.appSecret) {
    logger.info('Connecteur produits : AliExpress (recherche réelle)');
    // Jeton OAuth (si connecté) : débloque la recherche par mot-clé.
    const accessToken = await aliexpressOAuthService.getValidAccessToken().catch(() => undefined);
    return new AliExpressProductConnector(creds.appKey, creds.appSecret, {
      trackingId: creds.trackingId,
      currency: getSettings().currency,
      feedName: creds.feedName,
      accessToken,
    });
  }
  return null;
}

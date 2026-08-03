import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { apiLimiter, securityHeaders } from './middleware/security.js';
import { requireAuth } from './middleware/requireAuth.js';
import { asyncHandler } from './middleware/validate.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { adRouter } from './modules/ads/ad.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { channelController } from './modules/channels/channel.controller.js';
import { ebayDeletionController } from './modules/channels/ebayDeletion.controller.js';
import { channelRouter } from './modules/channels/channel.routes.js';
import { competitorRouter } from './modules/competitors/competitor.routes.js';
import { autopilotRouter, dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { discoveryRouter, favoriteRouter } from './modules/discovery/discovery.routes.js';
import { reportRouter } from './modules/reports/report.routes.js';
import { toolsRouter } from './modules/tools/tools.routes.js';
import { walletRouter } from './modules/wallet/wallet.routes.js';
import { marketRouter } from './modules/market/market.routes.js';
import { paymentController } from './modules/payments/payment.controller.js';
import { paymentRouter } from './modules/payments/payment.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { orderRouter } from './modules/orders/order.routes.js';
import { productRouter } from './modules/products/product.routes.js';
import { searchRouter } from './modules/search/search.routes.js';
import { supplierRouter } from './modules/suppliers/supplier.routes.js';

/**
 * Dossier des fichiers statiques (PWA). En développement (tsx) le module est
 * dans `src/`, une fois compilé il est dans `dist/src/` : on cherche donc
 * `../public` puis `../../public` et on retient le premier qui existe.
 */
function resolvePublicDir(): string {
  const candidates = [
    fileURLToPath(new URL('../public', import.meta.url)),
    fileURLToPath(new URL('../../public', import.meta.url)),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}
const publicDir = resolvePublicDir();

export function createApp() {
  const app = express();

  // Derrière un proxy (HTTPS, load balancer) : nécessaire pour un rate-limit correct par IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // En-têtes de sécurité + CSP (Helmet).
  app.use(securityHeaders);

  // Webhook Stripe : corps BRUT requis pour vérifier la signature.
  // Monté AVANT express.json() qui parserait (et casserait) la vérification.
  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), asyncHandler(paymentController.webhook));

  // Retour de la page de paiement iyzico : PUBLIC (iyzico redirige le navigateur
  // du client, qui n'a pas notre jeton) et corps urlencoded (formulaire iyzico).
  app.post(
    '/api/payments/iyzico/callback',
    express.urlencoded({ extended: false }),
    asyncHandler(paymentController.iyzicoCallback),
  );

  // Corps JSON limité (anti-abus).
  app.use(express.json({ limit: '1mb' }));

  // Limitation de débit sur toute l'API.
  app.use('/api', apiLimiter);

  // Application web (PWA) : fichiers statiques servis à la racine.
  app.use(express.static(publicDir));

  // Santé / disponibilité
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'toumai' }));

  // Android Digital Asset Links : lie l'app Play Store (TWA) au domaine, ce qui
  // supprime la barre d'adresse et permet l'installation « native ». Les empreintes
  // proviennent de la clé de signature (voir docs/stores.md).
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    const pkg = process.env.ANDROID_PACKAGE_NAME;
    const fingerprints = (process.env.ANDROID_SHA256_FINGERPRINTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!pkg || fingerprints.length === 0) {
      return res.json([]); // non configuré : réponse valide vide
    }
    res.json([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints },
      },
    ]);
  });

  // Index de l'API
  app.get('/api', (_req, res) =>
    res.json({
      name: 'Toumai API',
      version: '0.2.0',
      description: 'Plateforme d’automatisation e-commerce / dropshipping',
      pillars: {
        '1. Analyse marché': '/api/market',
        '2. Génération produits': '/api/products/generate',
        '3. Achat & expédition': '/api/orders',
        '4. Sourcing fournisseurs': '/api/search',
      },
      endpoints: {
        dashboard: '/api/dashboard',
        autopilot: '/api/autopilot/run',
        market: '/api/market',
        products: '/api/products',
        suppliers: '/api/suppliers',
        search: '/api/search',
        orders: '/api/orders',
        payments: '/api/payments',
        channels: '/api/channels',
        settings: '/api/settings',
        competitors: '/api/competitors',
        discovery: '/api/discovery',
        favorites: '/api/favorites',
        ads: '/api/ads',
        reports: '/api/reports',
        auth: '/api/auth',
      },
    }),
  );

  // Authentification (la limite stricte anti-force brute est appliquée aux seules
  // routes de vérification d'identifiants — voir auth.routes.ts).
  app.use('/api/auth', authRouter);

  // Callback OAuth des canaux de vente : public (la marketplace redirige le
  // navigateur sans notre jeton ; l'identité est portée par l'état signé).
  app.get('/api/oauth/callback', asyncHandler(channelController.oauthCallback));

  // Notification eBay « suppression de compte » (RGPD) : PUBLIC (eBay appelle
  // sans jeton). GET = défi de validation, POST = notification réelle.
  app.get('/api/ebay/account-deletion', ebayDeletionController.challenge);
  app.post('/api/ebay/account-deletion', ebayDeletionController.notify);

  // À partir d'ici, toutes les routes /api exigent un jeton valide.
  app.use('/api', requireAuth);

  app.use('/api/dashboard', dashboardRouter); // vue d'ensemble
  app.use('/api/autopilot', autopilotRouter); // pilote automatique
  app.use('/api/market', marketRouter); // pilier 1
  app.use('/api/products', productRouter); // pilier 2
  app.use('/api/orders', orderRouter); // pilier 3
  app.use('/api/suppliers', supplierRouter); // pilier 4
  app.use('/api/search', searchRouter); // pilier 4
  app.use('/api/payments', paymentRouter); // paiement (Stripe)
  app.use('/api/channels', channelRouter); // canaux de vente (Etsy/eBay/Amazon)
  app.use('/api/settings', settingsRouter); // réglages de l'application
  app.use('/api/competitors', competitorRouter); // veille concurrentielle
  app.use('/api/discovery', discoveryRouter); // recherche produits (texte/photo/code-barres)
  app.use('/api/favorites', favoriteRouter); // favoris → sourcing → publication
  app.use('/api/ads', adRouter); // publicités
  app.use('/api/tools', toolsRouter); // titres optimisés
  app.use('/api/reports', reportRouter); // tableur P&L
  app.use('/api/wallet', walletRouter); // portefeuille / retraits

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

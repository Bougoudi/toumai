import { fileURLToPath } from 'node:url';
import express from 'express';
import { requireAuth } from './middleware/requireAuth.js';
import { asyncHandler } from './middleware/validate.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { adRouter } from './modules/ads/ad.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { channelRouter } from './modules/channels/channel.routes.js';
import { competitorRouter } from './modules/competitors/competitor.routes.js';
import { autopilotRouter, dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { discoveryRouter, favoriteRouter } from './modules/discovery/discovery.routes.js';
import { reportRouter } from './modules/reports/report.routes.js';
import { toolsRouter } from './modules/tools/tools.routes.js';
import { marketRouter } from './modules/market/market.routes.js';
import { paymentController } from './modules/payments/payment.controller.js';
import { paymentRouter } from './modules/payments/payment.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { orderRouter } from './modules/orders/order.routes.js';
import { productRouter } from './modules/products/product.routes.js';
import { searchRouter } from './modules/search/search.routes.js';
import { supplierRouter } from './modules/suppliers/supplier.routes.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

export function createApp() {
  const app = express();

  // Webhook Stripe : corps BRUT requis pour vérifier la signature.
  // Monté AVANT express.json() qui parserait (et casserait) la vérification.
  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), asyncHandler(paymentController.webhook));

  app.use(express.json());

  // Application web (PWA) : fichiers statiques servis à la racine.
  app.use(express.static(publicDir));

  // Santé / disponibilité
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'toumai' }));

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

  // Authentification : routes publiques (inscription / connexion).
  app.use('/api/auth', authRouter);

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

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

import { fileURLToPath } from 'node:url';
import express from 'express';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { autopilotRouter, dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { marketRouter } from './modules/market/market.routes.js';
import { orderRouter } from './modules/orders/order.routes.js';
import { productRouter } from './modules/products/product.routes.js';
import { searchRouter } from './modules/search/search.routes.js';
import { supplierRouter } from './modules/suppliers/supplier.routes.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

export function createApp() {
  const app = express();

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
      },
    }),
  );

  app.use('/api/dashboard', dashboardRouter); // vue d'ensemble
  app.use('/api/autopilot', autopilotRouter); // pilote automatique
  app.use('/api/market', marketRouter); // pilier 1
  app.use('/api/products', productRouter); // pilier 2
  app.use('/api/orders', orderRouter); // pilier 3
  app.use('/api/suppliers', supplierRouter); // pilier 4
  app.use('/api/search', searchRouter); // pilier 4

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

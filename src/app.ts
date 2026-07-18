import express from 'express';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { productRouter } from './modules/products/product.routes.js';
import { searchRouter } from './modules/search/search.routes.js';
import { supplierRouter } from './modules/suppliers/supplier.routes.js';

export function createApp() {
  const app = express();

  app.use(express.json());

  // Santé / disponibilité
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'toumai' }));

  // Index de l'API
  app.get('/api', (_req, res) =>
    res.json({
      name: 'Toumai API',
      version: '0.1.0',
      endpoints: {
        products: '/api/products',
        suppliers: '/api/suppliers',
        search: '/api/search',
      },
    }),
  );

  app.use('/api/products', productRouter);
  app.use('/api/suppliers', supplierRouter);
  app.use('/api/search', searchRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

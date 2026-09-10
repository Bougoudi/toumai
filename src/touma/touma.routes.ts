import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../middleware/validate.js';
import { env } from '../config/env.js';
import { toumaAuthRouter } from './auth/auth.routes.js';
import { categoryRouter } from './catalog/category.routes.js';
import { countryRouter } from './catalog/country.routes.js';
import { productRouter } from './catalog/product.routes.js';
import { cartRouter } from './cart/cart.routes.js';
import { checkoutRouter, orderRouter } from './orders/order.routes.js';
import { paymentRouter } from './payments/payment.routes.js';
import { shippingRouter } from './logistics/logistics.routes.js';
import { storeRouter } from './stores/store.routes.js';
import { verificationRouter } from './verification/verification.routes.js';
import { reviewRouter } from './reviews/review.routes.js';
import { disputeRouter } from './disputes/dispute.routes.js';
import { notificationRouter } from './notifications/notification.routes.js';
import { aiRouter } from './ai/ai.routes.js';
import { adminRouter } from './admin/admin.routes.js';
import { sellerRouter } from './seller/seller.routes.js';
import { businessRouter, quoteRouter, rfqRouter } from './b2b/b2b.routes.js';
import { conversationRouter } from './messaging/messaging.routes.js';
import { pickupPointRouter } from './logistics/pickup.routes.js';

/**
 * API TOUMA v1 — place de marché.
 *
 * Monolithe **modulaire** : chaque domaine (catalogue, paiement, logistique,
 * confiance, IA) est isolé derrière son propre routeur et son propre service.
 * Le jour où le volume le justifie, un module peut être extrait sans réécriture.
 */
export const toumaV1Router = Router();

toumaV1Router.get('/', (_req, res) =>
  res.json({
    name: 'Touma API',
    version: 'v1',
    tagline: 'Connecter le commerce africain.',
    products: {
      marketplace: '/api/v1/products',
      pay: '/api/v1/payments',
      logistics: '/api/v1/shipping',
      verified: '/api/v1/verification',
      ai: '/api/v1/ai',
      business: '/api/v1/business',
      trade: '/api/v1/rfqs',
    },
    endpoints: {
      auth: '/api/v1/auth',
      countries: '/api/v1/countries',
      categories: '/api/v1/categories',
      stores: '/api/v1/stores',
      products: '/api/v1/products',
      cart: '/api/v1/cart',
      checkout: '/api/v1/checkout',
      orders: '/api/v1/orders',
      payments: '/api/v1/payments',
      shipping: '/api/v1/shipping',
      verification: '/api/v1/verification',
      reviews: '/api/v1/reviews',
      disputes: '/api/v1/disputes',
      notifications: '/api/v1/notifications',
      ai: '/api/v1/ai',
      seller: '/api/v1/seller',
      business: '/api/v1/business',
      rfqs: '/api/v1/rfqs',
      quotes: '/api/v1/quotes',
      conversations: '/api/v1/conversations',
      pickupPoints: '/api/v1/pickup-points',
      admin: '/api/v1/admin',
      openapi: '/api/v1/openapi.json',
    },
    commissionRate: env.touma.commissionRate,
  }),
);

toumaV1Router.use('/auth', toumaAuthRouter);
toumaV1Router.use('/countries', countryRouter);
toumaV1Router.use('/categories', categoryRouter);
toumaV1Router.use('/stores', storeRouter);
toumaV1Router.use('/products', productRouter);
toumaV1Router.use('/cart', cartRouter);
toumaV1Router.use('/checkout', checkoutRouter);
toumaV1Router.use('/orders', orderRouter);
toumaV1Router.use('/payments', paymentRouter);
toumaV1Router.use('/shipping', shippingRouter);
toumaV1Router.use('/verification', verificationRouter);
toumaV1Router.use('/reviews', reviewRouter);
toumaV1Router.use('/disputes', disputeRouter);
toumaV1Router.use('/notifications', notificationRouter);
toumaV1Router.use('/ai', aiRouter);
toumaV1Router.use('/seller', sellerRouter);
toumaV1Router.use('/business', businessRouter);
toumaV1Router.use('/rfqs', rfqRouter);
toumaV1Router.use('/quotes', quoteRouter);
toumaV1Router.use('/conversations', conversationRouter);
toumaV1Router.use('/pickup-points', pickupPointRouter);
toumaV1Router.use('/admin', adminRouter);

/** Recherche transverse (produits + boutiques) pour la barre de recherche. */
toumaV1Router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2) return res.json({ products: [], stores: [], categories: [] });
    const [products, stores, categories] = await Promise.all([
      prisma.toumaProduct.findMany({
        where: {
          status: 'ACTIVE',
          store: { status: 'ACTIVE' },
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { keywords: { contains: q, mode: 'insensitive' } },
            { brand: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 10,
        select: { id: true, title: true, slug: true, price: true, currency: true, images: { select: { url: true }, take: 1 } },
      }),
      prisma.toumaStore.findMany({
        where: { status: 'ACTIVE', name: { contains: q, mode: 'insensitive' } },
        take: 5,
        select: { id: true, name: true, slug: true, countryCode: true, verificationStatus: true },
      }),
      prisma.toumaCategory.findMany({ where: { active: true, name: { contains: q, mode: 'insensitive' } }, take: 5, select: { id: true, name: true, slug: true } }),
    ]);
    res.json({
      products: products.map((p) => ({ ...p, price: p.price.toString(), image: p.images[0]?.url ?? null, images: undefined })),
      stores,
      categories,
    });
  }),
);

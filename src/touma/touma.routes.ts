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
import { geoRouter } from './geo/geo.routes.js';
import { adminGeoRouter } from './geo/admin-geo.routes.js';
import { adminFinanceRouter, financeRouter } from './finance/finance.routes.js';
import { verificationRouter } from './verification/verification.routes.js';
import { reviewRouter } from './reviews/review.routes.js';
import { disputeRouter } from './disputes/dispute.routes.js';
import { notificationRouter } from './notifications/notification.routes.js';
import { aiRouter } from './ai/ai.routes.js';
import { adminRouter } from './admin/admin.routes.js';
import { sellerRouter } from './seller/seller.routes.js';
import { businessRouter, negotiationRouter, quoteRouter, rfqRouter } from './b2b/b2b.routes.js';
import { attachmentRouter, conversationRouter, messageRouter, messagingRouter } from './messaging/messaging.routes.js';
import { pickupPointRouter } from './logistics/pickup.routes.js';
import { returnRouter } from './returns/return.routes.js';
import { supportRouter } from './support/support.routes.js';
import { couponRouter } from './promotions/coupon.routes.js';
import { loyaltyRouter } from './loyalty/loyalty.routes.js';
import { documentRouter } from './documents/document.routes.js';
import { reputationRouter } from './reputation/reputation.routes.js';
import { sourcingRouter } from './sourcing/sourcing.routes.js';

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
      messages: '/api/v1/messages',
      messaging: '/api/v1/messaging',
      negotiations: '/api/v1/negotiations',
      pickupPoints: '/api/v1/pickup-points',
      returns: '/api/v1/returns',
      support: '/api/v1/support',
      coupons: '/api/v1/coupons',
      loyalty: '/api/v1/loyalty',
      documents: '/api/v1/documents',
      reputation: '/api/v1/reputation',
      sourcing: '/api/v1/sourcing',
      admin: '/api/v1/admin',
      openapi: '/api/v1/openapi.json',
    },
    /**
     * Taux de **repli**, appliqué quand aucune règle de commission ne couvre
     * une commande. Ce n'est plus « le » taux de la plateforme : il dépend de
     * la boutique, de la catégorie, du pays et de la période. Annoncer un
     * chiffre unique ici laisserait croire le contraire.
     */
    defaultCommissionRate: env.touma.commissionRate,
  }),
);

toumaV1Router.use('/auth', toumaAuthRouter);
toumaV1Router.use('/countries', countryRouter);
toumaV1Router.use('/categories', categoryRouter);
toumaV1Router.use('/geo', geoRouter);
toumaV1Router.use('/admin/geo', adminGeoRouter);
toumaV1Router.use('/seller/finance', financeRouter);
toumaV1Router.use('/admin/finance', adminFinanceRouter);
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
toumaV1Router.use('/messages', messageRouter);
toumaV1Router.use('/attachments', attachmentRouter);
toumaV1Router.use('/messaging', messagingRouter);
toumaV1Router.use('/negotiations', negotiationRouter);
toumaV1Router.use('/pickup-points', pickupPointRouter);
toumaV1Router.use('/returns', returnRouter);
toumaV1Router.use('/support', supportRouter);
toumaV1Router.use('/coupons', couponRouter);
toumaV1Router.use('/loyalty', loyaltyRouter);
toumaV1Router.use('/documents', documentRouter);
toumaV1Router.use('/reputation', reputationRouter);
toumaV1Router.use('/sourcing', sourcingRouter);
toumaV1Router.use('/admin', adminRouter);

/** Recherche transverse (produits + boutiques) pour la barre de recherche. */
toumaV1Router.get(
  '/search',
  asyncHandler(async (req, res) => {
    // Espaces multiples réduits : un copier-coller ne doit pas casser la recherche.
    const q = typeof req.query.q === 'string' ? req.query.q.trim().replace(/\s+/g, ' ') : '';
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

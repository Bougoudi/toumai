import { Router } from 'express';
import { featureFlagService } from './admin/feature-flags.service.js';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../middleware/validate.js';
import { env } from '../config/env.js';
import { readiness } from './health.js';
import { optionalAuth } from './middleware/toumaAuth.js';
import { toumaAuthRouter } from './auth/auth.routes.js';
import { categoryRouter } from './catalog/category.routes.js';
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
import { adminAiRouter, aiChatRouter, businessAiRouter, sellerAiRouter } from './ai/chat.routes.js';
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
import { adminTrustRouter, trustRouter } from './trust/trust.routes.js';
import { adminGrowthRouter, growthRouter, referralRouter, sellerGrowthRouter } from './growth/growth.routes.js';
import { sourcingRouter } from './sourcing/sourcing.routes.js';
import { adminTradeRouter, businessTradeRouter, sellerTradeRouter, tradeRouter } from './trade/trade.routes.js';
import { adminCountriesRouter, countriesRouter, marketsRouter } from './platform/country.routes.js';

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
      trade: '/api/v1/trade',
      admin: '/api/v1/admin',
      health: '/api/v1/health',
      ready: '/api/v1/ready',
      paymentMethods: '/api/v1/payments/methods',
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

/**
 * Sondes sous `/api/v1`.
 *
 * `/health` et `/ready` existaient à la racine du serveur. Un client de l'API
 * v1 — supervision, passerelle, client mobile — n'a pas à connaître la racine
 * du processus qui l'héberge : la sonde appartient à la version d'API qu'on
 * interroge.
 *
 * `/health` dit que le processus vit. `/ready` vérifie les dépendances et
 * répond 503 tant qu'une dépendance requise manque — c'est la différence entre
 * « je réponds » et « je peux servir ».
 */
/**
 * Drapeaux lisibles par le navigateur (V25 §28).
 *
 * Seuls ceux marqués comme exposables : un drapeau dit ce qui se prépare, et
 * tout ce qui se prépare n'a pas à être public. Le motif d'une décision n'est
 * pas rendu non plus — il décrirait le ciblage à qui n'y a pas droit.
 */
toumaV1Router.get(
  '/features',
  optionalAuth,
  asyncHandler(async (req, res) => {
    res.json({
      features: await featureFlagService.forClient({
        userId: req.toumaUser?.id ?? null,
        countryCode: typeof req.query.country === 'string' ? req.query.country.toUpperCase() : null,
      }),
    });
  }),
);

toumaV1Router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'touma', version: 'v1' }));

toumaV1Router.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const report = await readiness();
    res.status(report.ready ? 200 : 503).json(report);
  }),
);

toumaV1Router.use('/auth', toumaAuthRouter);
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
// L'assistant conversationnel, un routeur par espace : c'est l'espace qui
// décide des outils accessibles, et le laisser au choix de l'appelant
// reviendrait à laisser un acheteur demander la surface vendeur.
toumaV1Router.use('/ai', aiChatRouter);
toumaV1Router.use('/seller/ai', sellerAiRouter);
toumaV1Router.use('/business/ai', businessAiRouter);
toumaV1Router.use('/admin/ai', adminAiRouter);
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
toumaV1Router.use('/trust', trustRouter);
toumaV1Router.use('/admin/trust', adminTrustRouter);
toumaV1Router.use('/growth', growthRouter);
toumaV1Router.use('/seller/marketing', sellerGrowthRouter);
toumaV1Router.use('/admin/marketing', adminGrowthRouter);
toumaV1Router.use('/referrals', referralRouter);
toumaV1Router.use('/sourcing', sourcingRouter);
// Touma Trade (V24). La lecture des corridors est publique : un acheteur doit
// pouvoir savoir si Touma dessert son pays avant de créer un compte.
toumaV1Router.use('/trade', tradeRouter);
// Marchés : lecture publique, écriture réservée (V26 §75). Remplace l'ancien
// routeur pays, qui rendait la table telle quelle sans dire ce qu'un marché
// autorise réellement.
toumaV1Router.use('/countries', countriesRouter);
toumaV1Router.use('/markets', marketsRouter);
toumaV1Router.use('/seller/trade', sellerTradeRouter);
toumaV1Router.use('/business/trade', businessTradeRouter);
toumaV1Router.use('/admin/trade', adminTradeRouter);
toumaV1Router.use('/admin/countries', adminCountriesRouter);
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

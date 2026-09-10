import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { env } from '../../src/config/env.js';
import { promoteToAdmin, registerUser, signWebhook, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * SCÉNARIO DE BOUT EN BOUT — la première transaction Touma.
 *
 * Inscription → connexion → boutique → produit → catalogue → panier →
 * devis transport → checkout → commande → paiement (mock) → confirmation →
 * expédition → suivi → livraison → avis.
 *
 * Il s'agit du critère de réussite du MVP : ce parcours doit fonctionner
 * réellement, contre une vraie base de données.
 */
const api = new TestApi();

let seller: any;
let buyer: any;
let admin: any;
let storeId: string;
let productId: string;
let orderId: string;
let paymentId: string;
let shipmentId: string;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
});

after(async () => {
  await api.stop();
});

describe('Parcours complet Touma (Tchad → Cameroun)', () => {
  it('1. un vendeur camerounais et un acheteur tchadien créent leur compte', async () => {
    seller = await registerUser(api, { name: 'Blaise Ngoumou', email: uniqueEmail('vendeur'), role: 'SELLER', countryCode: 'CM' });
    buyer = await registerUser(api, { name: 'Fatimé Oumar', email: uniqueEmail('acheteur'), role: 'BUYER', countryCode: 'TD' });
    assert.equal(seller.user.role, 'SELLER');
    assert.equal(buyer.user.role, 'BUYER');
    assert.ok(seller.accessToken && seller.refreshToken);
  });

  it('2. la connexion renvoie un couple de jetons exploitables', async () => {
    const res = await api.post('/api/v1/auth/login', { email: buyer.user.email, password: buyer.password });
    assert.equal(res.status, 200);
    buyer.accessToken = res.body.accessToken;
    buyer.refreshToken = res.body.refreshToken;

    const me = await api.get('/api/v1/auth/me', buyer.accessToken);
    assert.equal(me.status, 200);
    assert.equal(me.body.email, buyer.user.email);
    // Aucune donnée sensible ne doit fuiter dans le profil.
    assert.equal(me.body.passwordHash, undefined);
    assert.equal(me.body.totpSecret, undefined);
  });

  it('3. le vendeur ouvre sa boutique à Douala', async () => {
    const res = await api.post('/api/v1/stores', { name: `Douala Trade ${Date.now()}`, countryCode: 'CM', city: 'Douala' }, seller.accessToken);
    assert.equal(res.status, 201);
    storeId = res.body.id;
    assert.equal(res.body.status, 'ACTIVE');
    assert.equal(res.body.verificationStatus, 'UNVERIFIED');
  });

  it('4. le vendeur publie un produit avec du stock', async () => {
    const category = await prisma.toumaCategory.findUnique({ where: { slug: 'test-agroalimentaire' } });
    const res = await api.post(
      '/api/v1/products',
      {
        storeId,
        title: `Cacao en fèves fermentées ${Date.now()}`,
        description: 'Fèves de cacao fermentées et séchées, sac de 50 kg.',
        price: '145000',
        currency: 'XAF',
        categoryId: category!.id,
        quantity: 10,
        minOrderQty: 1,
        weightGrams: 50000,
        status: 'ACTIVE',
        images: [{ url: 'https://images.touma.example/test/cacao.jpg' }],
      },
      seller.accessToken,
    );
    assert.equal(res.status, 201);
    productId = res.body.id;
    assert.equal(res.body.status, 'ACTIVE');
  });

  it('5. le produit est visible dans le catalogue public et filtrable', async () => {
    const list = await api.get(`/api/v1/products?store=${storeId}&availability=in_stock`);
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].id, productId);
    assert.equal(list.body.items[0].stock, 10);
    // Les montants sont des chaînes décimales, jamais des flottants JSON.
    assert.equal(typeof list.body.items[0].price, 'string');

    const detail = await api.get(`/api/v1/products/${productId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.price, '145000');
    assert.equal(detail.body.store.countryCode, 'CM');
  });

  it('6. l’acheteur ajoute au panier ; le stock disponible est contrôlé', async () => {
    const tooMuch = await api.post('/api/v1/cart/items', { productId, quantity: 999 }, buyer.accessToken);
    assert.equal(tooMuch.status, 409);

    const ok = await api.post('/api/v1/cart/items', { productId, quantity: 2 }, buyer.accessToken);
    assert.equal(ok.status, 201);
    assert.equal(ok.body.itemCount, 2);
    assert.equal(ok.body.subtotal, '290000');
    assert.equal(ok.body.checkoutReady, true);
  });

  it('7. l’acheteur enregistre son adresse de livraison au Tchad', async () => {
    const res = await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Fatimé Oumar', phone: '+23590000004', line1: 'Avenue Charles de Gaulle', city: "N'Djamena", countryCode: 'TD', isDefault: true },
      buyer.accessToken,
    );
    assert.equal(res.status, 201);
    buyer.addressId = res.body.id;
  });

  it('8. Touma Logistics tarife le corridor Cameroun → Tchad', async () => {
    const res = await api.post(
      '/api/v1/shipping/quote',
      { origin: { countryCode: 'CM', city: 'Douala' }, destination: { countryCode: 'TD', city: "N'Djamena" }, weightGrams: 100000, currency: 'XAF' },
      buyer.accessToken,
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length >= 2);
    buyer.quoteId = res.body.items[0].id;
    assert.ok(res.body.items[0].etaMaxDays >= 4, 'un envoi transfrontalier prend plus longtemps');
  });

  it('9. le checkout crée la commande, fige les prix et décrémente le stock', async () => {
    const res = await api.post(
      '/api/v1/checkout',
      { addressId: buyer.addressId, shippingQuotes: { [storeId]: buyer.quoteId }, idempotencyKey: `test-${Date.now()}` },
      buyer.accessToken,
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.orders.length, 1);
    const order = res.body.orders[0];
    orderId = order.id;
    buyer.checkoutKey = order.checkoutKey;

    assert.equal(order.status, 'PENDING');
    assert.equal(order.subtotal, '290000');
    assert.equal(order.crossBorder, true, 'commande transfrontalière TD ↔ CM');
    // Total = sous-total + livraison, à la précision décimale près.
    assert.equal(Number(order.total), Number(order.subtotal) + Number(order.shippingTotal));
    // Commission plateforme calculée depuis la configuration, jamais codée en dur.
    assert.equal(Number(order.commissionTotal), Number(order.subtotal) * env.touma.commissionRate);

    const inventory = await prisma.toumaInventory.findFirst({ where: { productId } });
    assert.equal(inventory!.quantity, 8, 'le stock est décrémenté de 2');
    assert.equal(inventory!.reserved, 2);

    const cart = await api.get('/api/v1/cart', buyer.accessToken);
    assert.equal(cart.body.items.length, 0, 'le panier est vidé');
  });

  it('10. rejouer le checkout avec la même clé ne crée pas de doublon', async () => {
    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const replay = await api.post(
      '/api/v1/checkout',
      { addressId: buyer.addressId, idempotencyKey: buyer.checkoutKey },
      buyer.accessToken,
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.body.idempotent, true);
    assert.equal(replay.body.orders[0].id, orderId);
    await api.delete('/api/v1/cart', buyer.accessToken);
  });

  it('11. Touma Pay crée un paiement (idempotent) pour la commande', async () => {
    const key = `pay-${Date.now()}`;
    const res = await api.post('/api/v1/payments/create', { orderId, method: 'MOBILE_MONEY', idempotencyKey: key }, buyer.accessToken);
    assert.equal(res.status, 201);
    paymentId = res.body.payment.id;
    assert.equal(res.body.payment.status, 'PENDING');
    assert.equal(res.body.payment.amount, (await prisma.toumaOrder.findUniqueOrThrow({ where: { id: orderId } })).total.toString());

    const again = await api.post('/api/v1/payments/create', { orderId, method: 'MOBILE_MONEY', idempotencyKey: key }, buyer.accessToken);
    assert.equal(again.body.idempotent, true);
    assert.equal(again.body.payment.id, paymentId);
  });

  it('12. la confirmation serveur fait passer la commande en PAID et enregistre la commission', async () => {
    const res = await api.post('/api/v1/payments/confirm', { paymentId }, buyer.accessToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'SUCCEEDED');

    const order = await api.get(`/api/v1/orders/${orderId}`, buyer.accessToken);
    assert.equal(order.body.status, 'PAID');
    assert.ok(order.body.paidAt);

    const commission = await prisma.toumaCommission.findFirst({ where: { orderId } });
    assert.ok(commission, 'la commission plateforme est enregistrée');
    assert.equal(commission!.amount.toString(), order.body.commissionTotal);

    // Un rejeu de la confirmation ne double ni la commande ni la commission.
    await api.post('/api/v1/payments/confirm', { paymentId }, buyer.accessToken);
    assert.equal(await prisma.toumaCommission.count({ where: { orderId } }), 1);
  });

  it('13. un webhook prestataire signé est accepté une seule fois (anti-rejeu)', async () => {
    const payment = await prisma.toumaPayment.findUniqueOrThrow({ where: { id: paymentId } });
    const payload = { id: `evt-${Date.now()}`, type: 'payment.succeeded', data: { providerRef: payment.providerRef, status: 'SUCCEEDED' } };
    const { raw, signature } = signWebhook(payload, env.touma.paymentWebhookSecret);

    const bad = await api.request('POST', '/api/v1/payments/webhook/mock', { raw, headers: { 'x-touma-signature': 'sha256=deadbeef' } });
    assert.equal(bad.status, 403, 'un webhook mal signé est refusé');

    const ok = await api.request('POST', '/api/v1/payments/webhook/mock', { raw, headers: { 'x-touma-signature': signature } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.duplicate, false);

    const replay = await api.request('POST', '/api/v1/payments/webhook/mock', { raw, headers: { 'x-touma-signature': signature } });
    assert.equal(replay.body.duplicate, true, 'le même événement n’est jamais appliqué deux fois');
  });

  it('14. le vendeur crée l’expédition et le suivi démarre', async () => {
    const res = await api.post('/api/v1/shipping/create', { orderId }, seller.accessToken);
    assert.equal(res.status, 201);
    shipmentId = res.body.id;
    assert.match(res.body.trackingNumber, /^TOUMA-CMTD-/);

    const tracking = await api.get(`/api/v1/shipping/${shipmentId}/tracking`, buyer.accessToken);
    assert.equal(tracking.status, 200);
    assert.equal(tracking.body.events.length, 1);
  });

  it('15. le colis progresse jusqu’à la livraison', async () => {
    for (const status of ['SHIPPED', 'IN_TRANSIT', 'DELIVERED'] as const) {
      const res = await api.patch(`/api/v1/shipping/${shipmentId}/status`, { status, location: 'Corridor Douala–N’Djamena' }, seller.accessToken);
      assert.equal(res.status, 200);
      assert.equal(res.body.status, status);
    }
    const order = await api.get(`/api/v1/orders/${orderId}`, buyer.accessToken);
    assert.equal(order.body.status, 'DELIVERED');

    const tracking = await api.get(`/api/v1/shipping/${shipmentId}/tracking`, buyer.accessToken);
    assert.equal(tracking.body.events.length, 4);
  });

  it('16. l’acheteur clôt la commande et dépose un avis', async () => {
    const done = await api.patch(`/api/v1/orders/${orderId}/status`, { status: 'COMPLETED' }, buyer.accessToken);
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'COMPLETED');

    const review = await api.post('/api/v1/reviews', { orderId, productId, rating: 5, comment: 'Marchandise conforme, livraison dans les délais.' }, buyer.accessToken);
    assert.equal(review.status, 201);

    const duplicate = await api.post('/api/v1/reviews', { orderId, productId, rating: 1 }, buyer.accessToken);
    assert.equal(duplicate.status, 409, 'un seul avis par commande et produit');

    const store = await prisma.toumaStore.findUniqueOrThrow({ where: { id: storeId } });
    assert.equal(store.ratingCount, 1);
    assert.equal(Number(store.ratingAverage), 5);
  });

  it('17. modifier le produit ne change JAMAIS la commande passée', async () => {
    const res = await api.patch(`/api/v1/products/${productId}`, { price: '999999', title: 'Titre changé après la vente' }, seller.accessToken);
    assert.equal(res.status, 200);

    const order = await api.get(`/api/v1/orders/${orderId}`, buyer.accessToken);
    assert.equal(order.body.subtotal, '290000');
    assert.equal(order.body.items[0].unitPrice, '145000');
    assert.match(order.body.items[0].titleSnapshot, /Cacao en fèves fermentées/);
  });

  it('18. le vendeur voit sa vente dans le Seller Center', async () => {
    const dashboard = await api.get('/api/v1/seller/dashboard', seller.accessToken);
    assert.equal(dashboard.status, 200);
    const store = dashboard.body.stores.find((s: any) => s.id === storeId);
    assert.equal(store.stats.paidOrders, 1);
    assert.ok(Number(store.stats.revenue.XAF) > 0);
    assert.equal(dashboard.body.recentOrders[0].orderNumber, (await prisma.toumaOrder.findUniqueOrThrow({ where: { id: orderId } })).orderNumber);
  });

  it('19. Touma Verified : dossier déposé puis approuvé par l’administration', async () => {
    const submit = await api.post(
      '/api/v1/verification/submit',
      {
        storeId,
        businessType: 'COMPANY',
        legalName: 'Douala Trade House SARL',
        registrationNo: 'RC/DLA/2019/B/1234',
        contactPhone: '+23790000003',
        contactEmail: 'vendeur@touma.test',
        documents: [{ kind: 'registre_commerce', url: 'https://private.touma.example/doc.pdf' }],
      },
      seller.accessToken,
    );
    assert.equal(submit.status, 201);
    assert.equal(submit.body.status, 'PENDING');
    // Les documents ne sont jamais renvoyés en clair au vendeur.
    assert.equal(submit.body.documents, undefined);
    assert.equal(submit.body.documentCount, 1);

    admin = await registerUser(api, { name: 'Administration', email: uniqueEmail('admin'), role: 'BUYER', countryCode: 'TD' });
    await promoteToAdmin(admin.user.id);
    const login = await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password });
    admin.accessToken = login.body.accessToken;

    const queue = await api.get('/api/v1/admin/verifications', admin.accessToken);
    assert.equal(queue.status, 200);
    const pending = queue.body.items.find((v: any) => v.storeId === storeId);
    assert.ok(pending);

    const approve = await api.post(`/api/v1/admin/verifications/${pending.id}/approve`, { comment: 'Registre de commerce vérifié.' }, admin.accessToken);
    assert.equal(approve.status, 200);
    assert.equal(approve.body.status, 'APPROVED');

    const store = await api.get(`/api/v1/stores/${storeId}`);
    assert.equal(store.body.verificationStatus, 'APPROVED');

    // La décision est tracée dans le journal d'audit.
    const audit = await api.get('/api/v1/admin/audit?action=verification.approve', admin.accessToken);
    assert.ok(audit.body.items.length >= 1);
  });

  it('20. le tableau de bord d’administration reflète la transaction réelle', async () => {
    const res = await api.get('/api/v1/admin/dashboard', admin.accessToken);
    assert.equal(res.status, 200);
    assert.ok(res.body.paidOrders >= 1);
    assert.ok(res.body.crossBorderOrders >= 1, 'la métrique clé de Touma : le transfrontalier');
    assert.ok(Number(res.body.gmvByCurrency.XAF) > 0);
  });
});

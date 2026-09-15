import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Ce que la vitrine doit pouvoir afficher : notes, ventes, estimation de
 * livraison avant connexion, courbes vendeur — et ce qu'un moteur de recherche
 * doit pouvoir lire (métadonnées, plan du site, robots).
 */
const api = new TestApi();

let seller: any;
let buyer: any;
let storeId: string;
let productId: string;
let productSlug: string;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  seller = await registerUser(api, { name: 'Vendeur Vitrine', email: uniqueEmail('vitrine'), role: 'SELLER', countryCode: 'CM' });
  storeId = (await api.post('/api/v1/stores', { name: `Vitrine ${Date.now()}`, countryCode: 'CM', city: 'Douala' }, seller.accessToken)).body.id;

  const product = await api.post(
    '/api/v1/products',
    { storeId, title: `Café arabica ${Date.now()}`, description: 'Café de montagne, sac de 60 kg.', price: '90000', quantity: 12, weightGrams: 60000, status: 'ACTIVE' },
    seller.accessToken,
  );
  productId = product.body.id;
  productSlug = product.body.slug;

  buyer = await registerUser(api, { name: 'Acheteur Vitrine', email: uniqueEmail('vitrine-b'), role: 'BUYER', countryCode: 'TD' });
  const address = await api.post(
    '/api/v1/auth/me/addresses',
    { fullName: 'Acheteur Vitrine', phone: '+23590001234', line1: 'Rue 5', city: "N'Djamena", countryCode: 'TD' },
    buyer.accessToken,
  );
  buyer.addressId = address.body.id;
});
after(async () => api.stop());

describe('Données nécessaires aux cartes produit', () => {
  it('expose la note et le nombre d’avis dans le catalogue', async () => {
    const list = await api.get(`/api/v1/products?store=${storeId}`);
    const card = list.body.items.find((p: any) => p.id === productId);
    assert.equal(card.rating, 0);
    assert.equal(card.ratingCount, 0);
    // Sans visuel fourni par le vendeur, l'API renvoie `null` : c'est
    // l'interface qui affiche un repli graphique (jamais « photo à venir »).
    assert.equal(card.image, null);
  });

  it('met à jour la note du produit ET de la boutique après un avis', async () => {
    // Parcours réel : commande, paiement, livraison, puis avis.
    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const order = (await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken)).body.orders[0];
    const payment = await api.post('/api/v1/payments/create', { orderId: order.id, method: 'MOBILE_MONEY' }, buyer.accessToken);
    await api.post('/api/v1/payments/confirm', { paymentId: payment.body.payment.id }, buyer.accessToken);
    const shipment = await api.post('/api/v1/shipping/create', { orderId: order.id }, seller.accessToken);
    for (const status of ['SHIPPED', 'DELIVERED'] as const) {
      await api.patch(`/api/v1/shipping/${shipment.body.id}/status`, { status }, seller.accessToken);
    }
    const review = await api.post('/api/v1/reviews', { orderId: order.id, productId, rating: 4, comment: 'Conforme.' }, buyer.accessToken);
    assert.equal(review.status, 201);

    const detail = await api.get(`/api/v1/products/${productSlug}`);
    assert.equal(detail.body.rating, 4);
    assert.equal(detail.body.ratingCount, 1);

    const store = await api.get(`/api/v1/stores/${storeId}`);
    assert.equal(Number(store.body.ratingAverage), 4);
    assert.equal(store.body.ratingCount, 1);
  });

  it('renvoie le visuel du vendeur quand il existe', async () => {
    const withImage = await api.post(
      '/api/v1/products',
      { storeId, title: `Produit illustré ${Date.now()}`, price: '1000', quantity: 3, status: 'ACTIVE', images: [{ url: 'https://images.touma.test/p.jpg' }] },
      seller.accessToken,
    );
    const list = await api.get(`/api/v1/products?store=${storeId}`);
    const card = list.body.items.find((p: any) => p.id === withImage.body.id);
    assert.equal(card.image, 'https://images.touma.test/p.jpg');
  });

  it('compte les ventes réalisées d’une boutique (jamais les paniers)', async () => {
    const store = await api.get(`/api/v1/stores/${storeId}`);
    assert.equal(store.body.salesCount, 1);
    assert.ok(store.body.productCount >= 1);
  });
});

describe('Estimation de livraison avant création de compte', () => {
  it('renvoie des tarifs sans authentification', async () => {
    const res = await api.post('/api/v1/shipping/quote', {
      origin: { countryCode: 'CM' },
      destination: { countryCode: 'TD' },
      weightGrams: 60000,
      currency: 'XAF',
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length >= 2);
    assert.ok(Number(res.body.items[0].amount) > 0);
  });
});

describe('Courbe des ventes du Seller Center', () => {
  it('renvoie un point par jour, même sans vente', async () => {
    const res = await api.get(`/api/v1/seller/stores/${storeId}/analytics?days=30`, seller.accessToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.series.length, 30, 'une courbe trouée serait illisible');
    assert.ok(res.body.series.some((d: any) => Number(d.revenue) > 0));
  });

  it('reste inaccessible au vendeur d’une autre boutique', async () => {
    const other = await registerUser(api, { name: 'Autre vendeur', email: uniqueEmail('autre-v'), role: 'SELLER', countryCode: 'TD' });
    const res = await api.get(`/api/v1/seller/stores/${storeId}/analytics`, other.accessToken);
    assert.equal(res.status, 403);
  });
});

describe('Référencement (SEO)', () => {
  it('sert la fiche produit à son URL réelle avec ses métadonnées', async () => {
    const res = await api.request('GET', `/touma/produits/${productSlug}`);
    assert.equal(res.status, 200);
    const html = String(res.body);
    assert.ok(html.includes('<title>'), 'titre absent');
    assert.ok(html.includes('Café arabica'), 'le titre ne reprend pas le produit');
    assert.ok(html.includes('og:title'), 'Open Graph absent');
    assert.ok(html.includes('"@type":"Product"'), 'données structurées absentes');
    assert.ok(html.includes('rel="canonical"'), 'URL canonique absente');
    assert.ok(html.includes('index, follow'));
  });

  it('interdit l’indexation des espaces privés', async () => {
    for (const path of ['/touma/panier', '/touma/commandes', '/touma/admin']) {
      const res = await api.request('GET', path);
      assert.equal(res.status, 200, `${path} doit servir l'application`);
      assert.ok(String(res.body).includes('noindex'), `${path} doit être en noindex`);
    }
  });

  it('publie un plan du site contenant les produits actifs', async () => {
    const res = await api.request('GET', '/sitemap.xml');
    assert.equal(res.status, 200);
    const xml = String(res.body);
    assert.ok(xml.startsWith('<?xml'));
    assert.ok(xml.includes(`/touma/produits/${productSlug}`), 'le produit doit figurer au plan du site');
    assert.ok(!xml.includes('/touma/panier'), 'les espaces privés ne sont jamais listés');
  });

  it('publie un robots.txt cohérent', async () => {
    const res = await api.request('GET', '/robots.txt');
    assert.equal(res.status, 200);
    const txt = String(res.body);
    assert.ok(txt.includes('Disallow: /touma/admin'));
    assert.ok(txt.includes('Sitemap:'));
  });

  it('renvoie l’application (et non une 404) pour une URL profonde inconnue', async () => {
    const res = await api.request('GET', '/touma/produits/slug-inexistant');
    assert.equal(res.status, 200, 'le routeurcôté client doit prendre la main');
  });
});

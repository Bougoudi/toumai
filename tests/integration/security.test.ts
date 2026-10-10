import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Contrôles d'accès : propriété des ressources (anti-IDOR), rôles (RBAC) et
 * refus des données envoyées par le client quand le serveur fait autorité.
 */
const api = new TestApi();

let sellerA: any;
let sellerB: any;
let buyer: any;
let storeA: string;
let productA: string;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  sellerA = await registerUser(api, { name: 'Vendeur A', email: uniqueEmail('vendeur-a'), role: 'SELLER', countryCode: 'TD' });
  sellerB = await registerUser(api, { name: 'Vendeur B', email: uniqueEmail('vendeur-b'), role: 'SELLER', countryCode: 'CM' });
  buyer = await registerUser(api, { name: 'Acheteur', email: uniqueEmail('acheteur'), role: 'BUYER', countryCode: 'TD' });

  const store = await api.post('/api/v1/stores', { name: `Boutique A ${Date.now()}`, countryCode: 'TD' }, sellerA.accessToken);
  storeA = store.body.id;
  const product = await api.post(
    '/api/v1/products',
    { storeId: storeA, title: `Produit A ${Date.now()}`, price: '10000', quantity: 5, status: 'ACTIVE' },
    sellerA.accessToken,
  );
  productA = product.body.id;
});
after(async () => api.stop());

describe('Propriété des ressources (anti-IDOR)', () => {
  it('un vendeur ne peut pas modifier la boutique d’un autre', async () => {
    const res = await api.patch(`/api/v1/stores/${storeA}`, { name: 'Boutique détournée' }, sellerB.accessToken);
    assert.equal(res.status, 403);
  });

  it('un vendeur ne peut pas modifier le produit d’un autre', async () => {
    const res = await api.patch(`/api/v1/products/${productA}`, { price: '1' }, sellerB.accessToken);
    assert.equal(res.status, 403);
  });

  it('un vendeur ne peut pas publier dans la boutique d’un autre', async () => {
    const res = await api.post('/api/v1/products', { storeId: storeA, title: 'Produit pirate', price: '1', quantity: 1 }, sellerB.accessToken);
    assert.equal(res.status, 403);
  });

  it('un acheteur ne voit pas la commande d’un autre acheteur', async () => {
    const other = await registerUser(api, { name: 'Autre', email: uniqueEmail('autre'), role: 'BUYER', countryCode: 'TD' });
    await api.post('/api/v1/cart/items', { productId: productA, quantity: 1 }, buyer.accessToken);
    const address = await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Acheteur', phone: '+23590000000', line1: 'Rue 1', city: "N'Djamena", countryCode: 'TD' },
      buyer.accessToken,
    );
    const checkout = await api.post('/api/v1/checkout', { addressId: address.body.id }, buyer.accessToken);
    const orderId = checkout.body.orders[0].id;

    const foreign = await api.get(`/api/v1/orders/${orderId}`, other.accessToken);
    assert.equal(foreign.status, 404, 'réponse identique à « inexistant » : aucune fuite d’information');

    const mine = await api.get(`/api/v1/orders/${orderId}`, buyer.accessToken);
    assert.equal(mine.status, 200);
  });

  it('une adresse ne peut pas servir au checkout d’un autre compte', async () => {
    const other = await registerUser(api, { name: 'Voisin', email: uniqueEmail('voisin'), role: 'BUYER', countryCode: 'TD' });
    const address = await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Voisin', phone: '+23590000009', line1: 'Rue 9', city: "N'Djamena", countryCode: 'TD' },
      other.accessToken,
    );
    await api.post('/api/v1/cart/items', { productId: productA, quantity: 1 }, buyer.accessToken);
    const res = await api.post('/api/v1/checkout', { addressId: address.body.id }, buyer.accessToken);
    assert.equal(res.status, 404);
    await api.delete('/api/v1/cart', buyer.accessToken);
  });

  it('un acheteur ne peut pas mettre à jour le suivi d’une expédition', async () => {
    const res = await api.post('/api/v1/shipping/create', { orderId: 'inexistant' }, buyer.accessToken);
    assert.equal(res.status, 403, 'le rôle acheteur n’a pas accès à l’expédition');
  });
});

describe('Contrôle des rôles (RBAC)', () => {
  it('les routes d’administration sont fermées aux non-administrateurs', async () => {
    for (const path of ['/api/v1/admin/dashboard', '/api/v1/admin/users', '/api/v1/admin/audit', '/api/v1/admin/risk']) {
      const anonymous = await api.get(path);
      assert.equal(anonymous.status, 401, `${path} doit exiger une authentification`);
      const asBuyer = await api.get(path, buyer.accessToken);
      assert.equal(asBuyer.status, 403, `${path} doit refuser un acheteur`);
    }
  });

  it('seul un administrateur rembourse un paiement', async () => {
    const res = await api.post('/api/v1/payments/refund', { paymentId: 'x' }, buyer.accessToken);
    assert.equal(res.status, 403);
  });

  it('un administrateur accède à la supervision', async () => {
    const admin = await registerUser(api, { name: 'Admin', email: uniqueEmail('admin'), role: 'BUYER', countryCode: 'TD' });
    await promoteToAdmin(admin.user.id);
    const login = await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password });
    const res = await api.get('/api/v1/admin/dashboard', login.body.accessToken);
    assert.equal(res.status, 200);
  });
});

describe('Le serveur fait autorité sur les prix et les stocks', () => {
  it('ignore un prix envoyé par le client', async () => {
    await api.delete('/api/v1/cart', buyer.accessToken);
    await api.post('/api/v1/cart/items', { productId: productA, quantity: 1, unitPrice: '1', price: '1' }, buyer.accessToken);
    const cart = await api.get('/api/v1/cart', buyer.accessToken);
    assert.equal(cart.body.items[0].unitPrice, '10000', 'le prix vient du catalogue, jamais du client');
    await api.delete('/api/v1/cart', buyer.accessToken);
  });

  it('refuse une quantité négative ou nulle à l’ajout', async () => {
    const res = await api.post('/api/v1/cart/items', { productId: productA, quantity: -3 }, buyer.accessToken);
    assert.equal(res.status, 400);
  });

  it('empêche un vendeur d’acheter ses propres produits', async () => {
    const res = await api.post('/api/v1/cart/items', { productId: productA, quantity: 1 }, sellerA.accessToken);
    assert.equal(res.status, 400);
  });

  it('n’expose jamais un produit en brouillon dans le catalogue public', async () => {
    const draft = await api.post(
      '/api/v1/products',
      { storeId: storeA, title: `Brouillon ${Date.now()}`, price: '5000', quantity: 1, status: 'DRAFT' },
      sellerA.accessToken,
    );
    const publicView = await api.get(`/api/v1/products/${draft.body.id}`);
    assert.equal(publicView.status, 404);
    const ownerView = await api.get(`/api/v1/products/${draft.body.id}`, sellerA.accessToken);
    assert.equal(ownerView.status, 200, 'le vendeur voit son propre brouillon');
  });

  it('journalise les actions sensibles sans jamais consigner de secret', async () => {
    const logs = await prisma.toumaAuditLog.findMany({ take: 50, orderBy: { createdAt: 'desc' } });
    assert.ok(logs.length > 0);
    const serialized = JSON.stringify(logs);
    for (const forbidden of ['password', 'passwordHash', 'refreshToken', 'accessToken', 'Bearer ']) {
      assert.ok(!serialized.includes(forbidden), `le journal d’audit ne doit pas contenir « ${forbidden} »`);
    }
  });
});

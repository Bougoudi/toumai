import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Contrôles de durcissement : ce que le serveur refuse de croire sur parole.
 */
const api = new TestApi();

let sellerCm: any;
let buyer: any;
let storeCm: string;
let productId: string;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  sellerCm = await registerUser(api, { name: 'Vendeur CM', email: uniqueEmail('durci-cm'), role: 'SELLER', countryCode: 'CM' });
  storeCm = (await api.post('/api/v1/stores', { name: `Boutique CM ${Date.now()}`, countryCode: 'CM' }, sellerCm.accessToken)).body.id;
  productId = (
    await api.post(
      '/api/v1/products',
      { storeId: storeCm, title: `Marchandise ${Date.now()}`, price: '50000', quantity: 20, weightGrams: 20000, status: 'ACTIVE' },
      sellerCm.accessToken,
    )
  ).body.id;

  buyer = await registerUser(api, { name: 'Acheteur TD', email: uniqueEmail('durci-td'), role: 'BUYER', countryCode: 'TD' });
  const address = await api.post(
    '/api/v1/auth/me/addresses',
    { fullName: 'Acheteur TD', phone: '+23590000123', line1: 'Rue 12', city: "N'Djamena", countryCode: 'TD' },
    buyer.accessToken,
  );
  buyer.addressId = address.body.id;
});
after(async () => api.stop());

describe('Devis de transport : impossible de sous-payer la livraison', () => {
  it('refuse un devis national présenté pour une expédition transfrontalière', async () => {
    // Devis pour un trajet interne au Cameroun : nettement moins cher.
    const national = await api.post(
      '/api/v1/shipping/quote',
      { origin: { countryCode: 'CM' }, destination: { countryCode: 'CM' }, weightGrams: 20000, currency: 'XAF' },
      buyer.accessToken,
    );
    const corridor = await api.post(
      '/api/v1/shipping/quote',
      { origin: { countryCode: 'CM' }, destination: { countryCode: 'TD' }, weightGrams: 20000, currency: 'XAF' },
      buyer.accessToken,
    );
    assert.ok(Number(national.body.items[0].amount) < Number(corridor.body.items[0].amount));

    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const fraud = await api.post(
      '/api/v1/checkout',
      { addressId: buyer.addressId, shippingQuotes: { [storeCm]: national.body.items[0].id } },
      buyer.accessToken,
    );
    assert.equal(fraud.status, 400);
    assert.match(fraud.body.error, /ne correspond pas/i);

    // Le devis du bon corridor est accepté.
    const ok = await api.post(
      '/api/v1/checkout',
      { addressId: buyer.addressId, shippingQuotes: { [storeCm]: corridor.body.items[0].id } },
      buyer.accessToken,
    );
    assert.equal(ok.status, 201);
    assert.equal(ok.body.orders[0].shippingTotal, corridor.body.items[0].amount);
  });

  it('refuse un devis établi pour un colis plus léger que la commande', async () => {
    const light = await api.post(
      '/api/v1/shipping/quote',
      { origin: { countryCode: 'CM' }, destination: { countryCode: 'TD' }, weightGrams: 500, currency: 'XAF' },
      buyer.accessToken,
    );
    await api.post('/api/v1/cart/items', { productId, quantity: 2 }, buyer.accessToken);
    const res = await api.post(
      '/api/v1/checkout',
      { addressId: buyer.addressId, shippingQuotes: { [storeCm]: light.body.items[0].id } },
      buyer.accessToken,
    );
    assert.equal(res.status, 400);
    await api.delete('/api/v1/cart', buyer.accessToken);
  });
});

describe('Paiement : le prestataire vient du serveur', () => {
  it('ignore un prestataire imposé par le client', async () => {
    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const order = (await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken)).body.orders[0];

    const payment = await api.post(
      '/api/v1/payments/create',
      { orderId: order.id, method: 'MOBILE_MONEY', provider: 'prestataire-fantoche' },
      buyer.accessToken,
    );
    assert.equal(payment.status, 201);
    // Le champ envoyé par le client est ignoré : c'est la configuration serveur
    // qui décide (« mock » dans cet environnement).
    assert.equal(payment.body.payment.provider, 'mock');
  });

  it('refuse une méthode que le prestataire configuré ne propose pas', async () => {
    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const order = (await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken)).body.orders[0];
    const res = await api.post('/api/v1/payments/create', { orderId: order.id, method: 'CHEQUE' }, buyer.accessToken);
    assert.equal(res.status, 400);
  });
});

describe('Entrées invalides : erreurs client, jamais 500', () => {
  it('renvoie 400 quand le panier mélangerait deux devises', async () => {
    await api.delete('/api/v1/cart', buyer.accessToken);
    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);

    // Un second produit libellé dans une autre devise.
    const other = await api.post(
      '/api/v1/products',
      { storeId: storeCm, title: `Devise autre ${Date.now()}`, price: '100', currency: 'EUR', quantity: 5, status: 'ACTIVE' },
      sellerCm.accessToken,
    );
    const res = await api.post('/api/v1/cart/items', { productId: other.body.id, quantity: 1 }, buyer.accessToken);
    assert.equal(res.status, 400, 'devises incompatibles = entrée invalide');
    assert.match(res.body.error, /Devises incompatibles/);
    await api.delete('/api/v1/cart', buyer.accessToken);
  });

  it('renvoie 400 pour une catégorie inconnue à la mise à jour', async () => {
    const res = await api.patch(`/api/v1/products/${productId}`, { categoryId: 'clzzzzzzzzzzzzzzzzzzzzzzz' }, sellerCm.accessToken);
    assert.equal(res.status, 400);
  });

  it('renvoie 400 pour un pays non desservi à la mise à jour', async () => {
    const res = await api.patch(`/api/v1/products/${productId}`, { countryCode: 'ZW' }, sellerCm.accessToken);
    assert.equal(res.status, 400);
  });

  it('ne divulgue jamais de trace technique dans une réponse d’erreur', async () => {
    const res = await api.get('/api/v1/products/inexistant-xyz');
    assert.equal(res.status, 404);
    assert.equal(Object.keys(res.body).join(','), 'error');
    assert.ok(!JSON.stringify(res.body).includes('prisma'));
  });
});

describe('Cohérence des données après durcissement', () => {
  it('n’a créé aucune commande orpheline pendant ces refus', async () => {
    const orders = await prisma.toumaOrder.findMany({ where: { buyerId: buyer.user.id }, include: { items: true } });
    for (const order of orders) {
      assert.ok(order.items.length > 0, 'toute commande créée possède au moins une ligne');
      assert.ok(Number(order.total) === Number(order.subtotal) + Number(order.shippingTotal));
    }
  });
});

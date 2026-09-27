import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Règles du checkout : concurrence sur le stock, transaction atomique,
 * multi-boutiques, transitions de statut et restitution du stock à l'annulation.
 */
const api = new TestApi();

let seller: any;
let sellerCm: any;
let storeTd: string;
let storeCm: string;

async function newBuyer() {
  const buyer = await registerUser(api, { name: 'Acheteur', email: uniqueEmail('buyer'), role: 'BUYER', countryCode: 'TD' });
  const address = await api.post(
    '/api/v1/auth/me/addresses',
    { fullName: 'Acheteur', phone: '+23590000000', line1: 'Rue 1', city: "N'Djamena", countryCode: 'TD' },
    buyer.accessToken,
  );
  return { ...buyer, addressId: address.body.id };
}

async function newProduct(storeId: string, token: string, quantity: number, price = '10000', extra: Record<string, unknown> = {}) {
  const res = await api.post(
    '/api/v1/products',
    { storeId, title: `Produit ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, price, quantity, status: 'ACTIVE', ...extra },
    token,
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id as string;
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
  seller = await registerUser(api, { name: 'Vendeur TD', email: uniqueEmail('vendeur-td'), role: 'SELLER', countryCode: 'TD' });
  sellerCm = await registerUser(api, { name: 'Vendeur CM', email: uniqueEmail('vendeur-cm'), role: 'SELLER', countryCode: 'CM' });
  storeTd = (await api.post('/api/v1/stores', { name: `Boutique TD ${Date.now()}`, countryCode: 'TD' }, seller.accessToken)).body.id;
  storeCm = (await api.post('/api/v1/stores', { name: `Boutique CM ${Date.now()}`, countryCode: 'CM' }, sellerCm.accessToken)).body.id;
});
after(async () => api.stop());

describe('Checkout — intégrité du stock', () => {
  it('deux acheteurs simultanés ne peuvent pas acheter le même dernier article', async () => {
    const productId = await newProduct(storeTd, seller.accessToken, 1);
    const [a, b] = await Promise.all([newBuyer(), newBuyer()]);
    await Promise.all([
      api.post('/api/v1/cart/items', { productId, quantity: 1 }, a.accessToken),
      api.post('/api/v1/cart/items', { productId, quantity: 1 }, b.accessToken),
    ]);

    const results = await Promise.all([
      api.post('/api/v1/checkout', { addressId: a.addressId }, a.accessToken),
      api.post('/api/v1/checkout', { addressId: b.addressId }, b.accessToken),
    ]);
    const created = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status !== 201);
    assert.equal(created.length, 1, 'une seule commande aboutit');
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].status, 409);

    const inventory = await prisma.toumaInventory.findFirstOrThrow({ where: { productId } });
    assert.equal(inventory.quantity, 0, 'le stock ne devient jamais négatif');
    assert.equal(inventory.reserved, 1);
  });

  it('annule toute la commande si une seule ligne manque de stock (transaction)', async () => {
    const ok = await newProduct(storeTd, seller.accessToken, 5);
    const scarce = await newProduct(storeTd, seller.accessToken, 5);
    const buyer = await newBuyer();
    await api.post('/api/v1/cart/items', { productId: ok, quantity: 2 }, buyer.accessToken);
    await api.post('/api/v1/cart/items', { productId: scarce, quantity: 5 }, buyer.accessToken);

    // Le stock disparaît entre l'ajout au panier et le paiement.
    await prisma.toumaInventory.updateMany({ where: { productId: scarce }, data: { quantity: 1 } });

    const res = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    assert.equal(res.status, 409);

    const untouched = await prisma.toumaInventory.findFirstOrThrow({ where: { productId: ok } });
    assert.equal(untouched.quantity, 5, 'aucune ligne n’est décrémentée si le checkout échoue');
    assert.equal(await prisma.toumaOrder.count({ where: { buyerId: buyer.user.id } }), 0);
  });

  it('restitue le stock quand la commande est annulée', async () => {
    const productId = await newProduct(storeTd, seller.accessToken, 4);
    const buyer = await newBuyer();
    await api.post('/api/v1/cart/items', { productId, quantity: 3 }, buyer.accessToken);
    const checkout = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    const orderId = checkout.body.orders[0].id;
    assert.equal((await prisma.toumaInventory.findFirstOrThrow({ where: { productId } })).quantity, 1);

    const cancel = await api.patch(`/api/v1/orders/${orderId}/status`, { status: 'CANCELLED', reason: 'Changement d’avis' }, buyer.accessToken);
    assert.equal(cancel.status, 200);
    const inventory = await prisma.toumaInventory.findFirstOrThrow({ where: { productId } });
    assert.equal(inventory.quantity, 4, 'le stock est restitué');
    assert.equal(inventory.reserved, 0);
  });
});

describe('Checkout — règles métier', () => {
  it('crée une commande par boutique quand le panier est multi-vendeurs', async () => {
    const td = await newProduct(storeTd, seller.accessToken, 10);
    const cm = await newProduct(storeCm, sellerCm.accessToken, 10);
    const buyer = await newBuyer();
    await api.post('/api/v1/cart/items', { productId: td, quantity: 1 }, buyer.accessToken);
    await api.post('/api/v1/cart/items', { productId: cm, quantity: 1 }, buyer.accessToken);

    const res = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    assert.equal(res.status, 201);
    assert.equal(res.body.orders.length, 2, 'un vendeur = une commande');
    const crossBorder = res.body.orders.filter((o: any) => o.crossBorder);
    assert.equal(crossBorder.length, 1, 'seule la commande camerounaise est transfrontalière');
  });

  it('respecte la quantité minimale de commande (vente en gros)', async () => {
    const productId = await newProduct(storeTd, seller.accessToken, 100, '5000', { minOrderQty: 10 });
    const buyer = await newBuyer();
    const tooFew = await api.post('/api/v1/cart/items', { productId, quantity: 3 }, buyer.accessToken);
    assert.equal(tooFew.status, 400);
    const ok = await api.post('/api/v1/cart/items', { productId, quantity: 10 }, buyer.accessToken);
    assert.equal(ok.status, 201);
  });

  it('refuse un panier vide', async () => {
    const buyer = await newBuyer();
    const res = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    assert.equal(res.status, 400);
  });

  it('refuse une transition de statut interdite', async () => {
    const productId = await newProduct(storeTd, seller.accessToken, 3);
    const buyer = await newBuyer();
    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const order = (await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken)).body.orders[0];

    // PENDING → DELIVERED est impossible : la commande n'est même pas payée.
    const res = await api.patch(`/api/v1/orders/${order.id}/status`, { status: 'DELIVERED' }, seller.accessToken);
    assert.equal(res.status, 409);
  });

  it('interdit à un acheteur de marquer une commande comme expédiée', async () => {
    const productId = await newProduct(storeTd, seller.accessToken, 3);
    const buyer = await newBuyer();
    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const order = (await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken)).body.orders[0];
    const res = await api.patch(`/api/v1/orders/${order.id}/status`, { status: 'SHIPPED' }, buyer.accessToken);
    assert.equal(res.status, 403);
  });

  it('empêche de payer une commande déjà annulée', async () => {
    const productId = await newProduct(storeTd, seller.accessToken, 3);
    const buyer = await newBuyer();
    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const order = (await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken)).body.orders[0];
    await api.patch(`/api/v1/orders/${order.id}/status`, { status: 'CANCELLED' }, buyer.accessToken);

    const res = await api.post('/api/v1/payments/create', { orderId: order.id, method: 'MOBILE_MONEY' }, buyer.accessToken);
    assert.equal(res.status, 409);
  });

  it('refuse un paiement échoué sans faire avancer la commande', async () => {
    const productId = await newProduct(storeTd, seller.accessToken, 3);
    const buyer = await newBuyer();
    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const order = (await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken)).body.orders[0];
    const payment = await api.post('/api/v1/payments/create', { orderId: order.id, method: 'CARD' }, buyer.accessToken);

    const failed = await api.post('/api/v1/payments/confirm', { paymentId: payment.body.payment.id, payload: { outcome: 'FAILED' } }, buyer.accessToken);
    assert.equal(failed.body.status, 'FAILED');

    const after = await api.get(`/api/v1/orders/${order.id}`, buyer.accessToken);
    assert.equal(after.body.status, 'PENDING', 'un paiement refusé ne fait jamais avancer la commande');
    assert.equal(await prisma.toumaCommission.count({ where: { orderId: order.id } }), 0);
  });
});

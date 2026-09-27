import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { env } from '../../src/config/env.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Fidélité : les points se gagnent à la livraison, se dépensent au checkout, et
 * sont repris quand la commande est remboursée. Le solde ne peut jamais partir
 * dans le décor.
 */
const api = new TestApi();

let buyer: any;
let seller: any;
let productId: string;
const PRICE = 100_000;

/** Déroule une commande complète et la mène jusqu'à la livraison. */
async function deliveredOrder(quantity = 1, extra: Record<string, unknown> = {}) {
  await api.post('/api/v1/cart/items', { productId, quantity }, buyer.accessToken);
  const checkout = await api.post('/api/v1/checkout', { addressId: buyer.addressId, ...extra }, buyer.accessToken);
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  const order = checkout.body.orders[0];

  const payment = await api.post('/api/v1/payments/create', { orderId: order.id, method: 'MOBILE_MONEY' }, buyer.accessToken);
  await api.post('/api/v1/payments/confirm', { paymentId: payment.body.payment.id }, buyer.accessToken);
  for (const status of ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']) {
    await api.patch(`/api/v1/orders/${order.id}/status`, { status }, seller.accessToken);
  }
  return order;
}

const balance = async () => (await api.get('/api/v1/loyalty', buyer.accessToken)).body;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  seller = await registerUser(api, { name: 'Vendeur fidélité', email: uniqueEmail('fi-seller'), role: 'SELLER', countryCode: 'CM' });
  const storeId = (await api.post('/api/v1/stores', { name: `Boutique fidélité ${Date.now()}`, countryCode: 'CM' }, seller.accessToken)).body.id;
  productId = (
    await api.post(
      '/api/v1/products',
      { storeId, title: `Cacao fidélité ${Date.now()}`, price: String(PRICE), quantity: 500, weightGrams: 1000, status: 'ACTIVE' },
      seller.accessToken,
    )
  ).body.id;

  buyer = await registerUser(api, { name: 'Acheteur fidélité', email: uniqueEmail('fi-buyer'), role: 'BUYER', countryCode: 'TD' });
  buyer.addressId = (
    await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Acheteur fidélité', phone: '+23590000822', line1: 'Rue 7', city: "N'Djamena", countryCode: 'TD' },
      buyer.accessToken,
    )
  ).body.id;
});
after(async () => api.stop());

describe('Fidélité', () => {
  it('démarre à zéro, au premier palier', async () => {
    const summary = await balance();
    assert.equal(summary.balance, 0);
    assert.equal(summary.lifetimePoints, 0);
    assert.equal(summary.tier, 'BRONZE');
    assert.ok(summary.nextTier, 'un palier suivant est annoncé');
  });

  it('ne crédite rien tant que la commande n’est pas livrée', async () => {
    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const checkout = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    const order = checkout.body.orders[0];
    const payment = await api.post('/api/v1/payments/create', { orderId: order.id, method: 'MOBILE_MONEY' }, buyer.accessToken);
    await api.post('/api/v1/payments/confirm', { paymentId: payment.body.payment.id }, buyer.accessToken);

    assert.equal((await balance()).balance, 0, 'payer ne rapporte rien : la commande peut encore être annulée');

    for (const status of ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']) {
      await api.patch(`/api/v1/orders/${order.id}/status`, { status }, seller.accessToken);
    }
    const expected = Math.floor(PRICE * env.touma.loyaltyEarnRate);
    const after = await balance();
    assert.equal(after.balance, expected);
    assert.equal(after.lifetimePoints, expected);
  });

  it('ne crédite pas deux fois la même commande', async () => {
    const before = (await balance()).balance;
    const order = await deliveredOrder(1);
    const afterDelivery = (await balance()).balance;

    // Rejouer la livraison (via COMPLETED) ne doit rien créditer de plus.
    await api.patch(`/api/v1/orders/${order.id}/status`, { status: 'COMPLETED' }, buyer.accessToken);
    assert.equal((await balance()).balance, afterDelivery);
    assert.equal(afterDelivery - before, Math.floor(PRICE * env.touma.loyaltyEarnRate));

    const events = await prisma.toumaLoyaltyEvent.count({ where: { orderId: order.id, type: 'EARNED' } });
    assert.equal(events, 1);
  });

  it('annonce les points utilisables et les plafonne à la part configurée', async () => {
    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const usable = await api.get('/api/v1/loyalty/usable', buyer.accessToken);
    assert.equal(usable.status, 200);

    const current = (await balance()).balance;
    const cap = Math.floor((PRICE * env.touma.loyaltyMaxShare) / env.touma.loyaltyPointValue);
    assert.equal(usable.body.usablePoints, Math.min(current, cap));
    await api.delete('/api/v1/cart', buyer.accessToken);
  });

  it('refuse de dépenser plus de points que permis', async () => {
    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const res = await api.post(
      '/api/v1/checkout',
      { addressId: buyer.addressId, loyaltyPoints: 10_000_000 },
      buyer.accessToken,
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /point/i);
    await api.delete('/api/v1/cart', buyer.accessToken);
  });

  it('déduit les points du total et ne les fait pas payer par le vendeur', async () => {
    const before = await balance();
    const spend = Math.min(before.balance, 500);
    assert.ok(spend > 0, 'le test a besoin d’un solde');

    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const checkout = await api.post('/api/v1/checkout', { addressId: buyer.addressId, loyaltyPoints: spend }, buyer.accessToken);
    assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
    const order = checkout.body.orders[0];

    const value = spend * env.touma.loyaltyPointValue;
    assert.equal(order.discountTotal, String(value));
    // La fidélité est une campagne TOUMA : le vendeur n'en finance rien.
    assert.equal(order.sellerFundedDiscount, '0');
    const stored = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(stored.commissionTotal.toString(), stored.subtotal.times('0.05').toString());

    const after = await balance();
    assert.equal(after.balance, before.balance - spend);
    assert.equal(after.lifetimePoints, before.lifetimePoints, 'dépenser ne fait pas reculer le cumul de vie');
  });

  it('reprend les points quand la commande est remboursée', async () => {
    const order = await deliveredOrder(1);
    const earned = Math.floor(PRICE * env.touma.loyaltyEarnRate);
    const afterDelivery = (await balance()).balance;

    const item = await prisma.toumaOrderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const created = await api.post(
      '/api/v1/returns',
      { orderId: order.id, reason: 'DAMAGED', items: [{ orderItemId: item.id, quantity: 1 }] },
      buyer.accessToken,
    );
    await api.post(`/api/v1/returns/${created.body.id}/approve`, {}, seller.accessToken);
    const refunded = await api.post(`/api/v1/returns/${created.body.id}/refund`, {}, seller.accessToken);
    assert.equal(refunded.status, 200, JSON.stringify(refunded.body));

    const after = (await balance()).balance;
    assert.equal(afterDelivery - after, earned, 'les points gagnés sur la commande sont repris');

    // Rejouer la reprise ne double pas la sanction.
    const reversed = await prisma.toumaLoyaltyEvent.aggregate({ where: { orderId: order.id, type: 'REVERSED' }, _sum: { points: true } });
    assert.equal(Math.abs(reversed._sum.points ?? 0), earned);
  });

  it('garde l’historique des mouvements', async () => {
    const summary = await balance();
    assert.ok(summary.events.length > 0);
    assert.ok(summary.events.some((e: any) => e.type === 'EARNED'));
    assert.ok(summary.events.some((e: any) => e.type === 'REDEEMED'));
    assert.ok(summary.events.some((e: any) => e.type === 'REVERSED'));
  });

  it('réserve l’ajustement manuel à l’administration', async () => {
    const res = await api.post(
      '/api/v1/loyalty/adjust',
      { userId: buyer.user.id, points: 10_000, reason: 'tentative' },
      buyer.accessToken,
    );
    assert.equal(res.status, 403);
  });
});

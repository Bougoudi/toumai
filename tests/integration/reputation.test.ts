import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { env } from '../../src/config/env.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Réputation vendeur.
 *
 * Le test le plus important n'est pas qu'un score soit calculé, mais qu'il ne
 * le soit **pas** quand l'échantillon est trop faible : un « 100 % de
 * livraisons à l'heure » sur deux ventes tromperait l'acheteur.
 */
const api = new TestApi();

let buyer: any;
let seller: any;
let storeId: string;
let storeSlug: string;
let productId: string;

/** Déroule une commande complète et la mène jusqu'à la livraison. */
async function deliveredOrder() {
  await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
  const checkout = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  const order = checkout.body.orders[0];
  const payment = await api.post('/api/v1/payments/create', { orderId: order.id, method: 'MOBILE_MONEY' }, buyer.accessToken);
  await api.post('/api/v1/payments/confirm', { paymentId: payment.body.payment.id }, buyer.accessToken);
  for (const status of ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']) {
    const res = await api.patch(`/api/v1/orders/${order.id}/status`, { status }, seller.accessToken);
    assert.equal(res.status, 200, `transition ${status} : ${JSON.stringify(res.body)}`);
  }
  return order;
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  seller = await registerUser(api, { name: 'Vendeur réputation', email: uniqueEmail('rp-seller'), role: 'SELLER', countryCode: 'CM' });
  const store = await api.post('/api/v1/stores', { name: `Boutique réputation ${Date.now()}`, countryCode: 'CM' }, seller.accessToken);
  storeId = store.body.id;
  storeSlug = store.body.slug;
  await api.patch(`/api/v1/stores/${storeId}`, { status: 'ACTIVE' }, seller.accessToken);
  productId = (
    await api.post(
      '/api/v1/products',
      { storeId, title: `Gingembre réputation ${Date.now()}`, price: '12000', quantity: 500, weightGrams: 1000, status: 'ACTIVE' },
      seller.accessToken,
    )
  ).body.id;

  buyer = await registerUser(api, { name: 'Acheteur réputation', email: uniqueEmail('rp-buyer'), role: 'BUYER', countryCode: 'TD' });
  buyer.addressId = (
    await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Acheteur réputation', phone: '+23590000844', line1: 'Rue 11', city: "N'Djamena", countryCode: 'TD' },
      buyer.accessToken,
    )
  ).body.id;
});
after(async () => api.stop());

describe('Réputation vendeur', () => {
  it('ne publie aucun indicateur tant que le volume est insuffisant', async () => {
    const res = await api.get(`/api/v1/reputation/store/${storeSlug}`);
    assert.equal(res.status, 200, 'la fiche est consultable sans compte');
    assert.equal(res.body.published, false);
    assert.equal(res.body.score, null);
    assert.equal(res.body.level, 'NOUVEAU');
    assert.equal(res.body.minimumOrders, env.touma.reputationMinOrders);
    // Tous les taux restent nuls : rien n'est extrapolé sur un échantillon vide.
    for (const value of [res.body.metrics.onTimeRate, res.body.metrics.disputeRate, res.body.metrics.returnRate]) {
      assert.equal(value, null);
    }
  });

  it('publie un score une fois le volume minimal atteint', async () => {
    for (let i = 0; i < env.touma.reputationMinOrders; i += 1) await deliveredOrder();

    const res = await api.get(`/api/v1/reputation/store/${storeSlug}`);
    assert.equal(res.body.published, true);
    assert.equal(res.body.ordersDelivered >= env.touma.reputationMinOrders, true);
    assert.ok(res.body.score >= 0 && res.body.score <= 100);
    assert.notEqual(res.body.level, 'NOUVEAU');
    // Les pondérations sont publiées : un vendeur doit pouvoir comprendre son score.
    assert.ok(res.body.weights.onTime > 0);
    assert.equal(
      Number(Object.values(res.body.weights).reduce((a: any, b: any) => a + b, 0).toFixed(4)),
      1,
      'la somme des pondérations vaut 1',
    );
  });

  it('mesure des délais réels, pas des estimations', async () => {
    const res = await api.get(`/api/v1/reputation/store/${storeSlug}`);
    const m = res.body.metrics;
    assert.ok(m.avgPreparationHours !== null, 'le délai de préparation est mesuré');
    assert.ok(m.avgPreparationHours >= 0);
    assert.ok(m.avgDeliveryDays !== null);

    // Les commandes du test sont livrées immédiatement : les délais sont donc
    // quasi nuls, et le taux de ponctualité vaut 1 là où il est mesurable.
    if (m.onTimeRate !== null) assert.equal(m.onTimeRate, 1);
  });

  it('fait redescendre le score quand un litige est ouvert', async () => {
    const before = (await api.get(`/api/v1/reputation/store/${storeSlug}`)).body;

    const order = await deliveredOrder();
    const dispute = await api.post(
      '/api/v1/disputes',
      { orderId: order.id, reason: 'NOT_AS_DESCRIBED', details: 'Produit non conforme.' },
      buyer.accessToken,
    );
    assert.equal(dispute.status, 201);

    const after = (await api.get(`/api/v1/reputation/store/${storeSlug}`)).body;
    assert.ok(after.metrics.disputeRate > 0, 'le litige apparaît dans les indicateurs');
    assert.ok(after.score <= before.score, 'un litige ne fait jamais monter le score');
  });

  it('recalcule à la demande pour le vendeur, et refuse la boutique d’autrui', async () => {
    const mine = await api.get(`/api/v1/reputation/mine/${storeId}`, seller.accessToken);
    assert.equal(mine.status, 200);
    assert.ok(mine.body.ordersDelivered > 0);

    assert.equal((await api.get(`/api/v1/reputation/mine/${storeId}`, buyer.accessToken)).status, 404);
  });

  it('réserve le classement à l’administration', async () => {
    assert.equal((await api.get('/api/v1/reputation/leaderboard', seller.accessToken)).status, 403);
  });

  it('conserve un instantané daté, recalculé quand il est périmé', async () => {
    const snapshot = await prisma.toumaStoreReputation.findUniqueOrThrow({ where: { storeId } });
    assert.ok(snapshot.computedAt instanceof Date);

    // On force la péremption : la lecture suivante doit recalculer.
    await prisma.toumaStoreReputation.update({ where: { storeId }, data: { computedAt: new Date(0) } });
    await api.get(`/api/v1/reputation/store/${storeSlug}`);
    const refreshed = await prisma.toumaStoreReputation.findUniqueOrThrow({ where: { storeId } });
    assert.ok(refreshed.computedAt.getTime() > 0, 'l’instantané périmé a été recalculé');
  });
});

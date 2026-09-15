import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Panier multi-vendeurs : l'acheteur paie **une fois**, chaque boutique reçoit
 * sa propre commande, et le point relais est une option de remise à part entière.
 */
const api = new TestApi();

let buyer: any;
let sellerTd: any;
let sellerCm: any;
let productTd: string;
let productCm: string;
let pickupPointId: string;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  sellerTd = await registerUser(api, { name: 'Vendeur TD', email: uniqueEmail('mv-td'), role: 'SELLER', countryCode: 'TD' });
  sellerCm = await registerUser(api, { name: 'Vendeur CM', email: uniqueEmail('mv-cm'), role: 'SELLER', countryCode: 'CM' });

  const storeTd = (await api.post('/api/v1/stores', { name: `Boutique TD ${Date.now()}`, countryCode: 'TD' }, sellerTd.accessToken)).body.id;
  const storeCm = (await api.post('/api/v1/stores', { name: `Boutique CM ${Date.now()}`, countryCode: 'CM' }, sellerCm.accessToken)).body.id;

  productTd = (
    await api.post('/api/v1/products', { storeId: storeTd, title: `Sésame ${Date.now()}`, price: '38000', quantity: 20, weightGrams: 25000, status: 'ACTIVE' }, sellerTd.accessToken)
  ).body.id;
  productCm = (
    await api.post('/api/v1/products', { storeId: storeCm, title: `Cacao ${Date.now()}`, price: '145000', quantity: 20, weightGrams: 50000, status: 'ACTIVE' }, sellerCm.accessToken)
  ).body.id;

  const point = await prisma.toumaPickupPoint.upsert({
    where: { code: 'TEST-TD-01' },
    update: { active: true },
    create: { code: 'TEST-TD-01', name: 'Relais de test', countryCode: 'TD', city: "N'Djamena", district: 'Dembé', addressLine: 'Avenue de test', active: true },
  });
  pickupPointId = point.id;

  buyer = await registerUser(api, { name: 'Acheteur MV', email: uniqueEmail('mv-buyer'), role: 'BUYER', countryCode: 'TD' });
  const address = await api.post(
    '/api/v1/auth/me/addresses',
    { fullName: 'Acheteur MV', phone: '+23590000777', line1: 'Rue 12', district: 'Klemat', landmark: 'Face à la pharmacie', city: "N'Djamena", countryCode: 'TD' },
    buyer.accessToken,
  );
  buyer.addressId = address.body.id;
});
after(async () => api.stop());

describe('Panier multi-vendeurs : un paiement, plusieurs commandes', () => {
  it('crée un groupe et une sous-commande par boutique', async () => {
    await api.post('/api/v1/cart/items', { productId: productTd, quantity: 1 }, buyer.accessToken);
    await api.post('/api/v1/cart/items', { productId: productCm, quantity: 1 }, buyer.accessToken);

    const res = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    assert.equal(res.status, 201);
    assert.equal(res.body.orders.length, 2, 'une commande par vendeur');
    assert.ok(res.body.group.reference.startsWith('TMG-'));
    assert.equal(res.body.group.orderCount, 2);
    buyer.groupId = res.body.group.id;

    // Le total du groupe est exactement la somme des sous-commandes.
    const sum = res.body.orders.reduce((acc: number, o: any) => acc + Number(o.total), 0);
    assert.equal(Number(res.body.group.total), sum);
    assert.equal(res.body.group.crossBorder, true, 'au moins une commande franchit une frontière');
  });

  it('règle tout le panier en un seul paiement', async () => {
    const payment = await api.post('/api/v1/payments/create', { orderGroupId: buyer.groupId, method: 'MOBILE_MONEY' }, buyer.accessToken);
    assert.equal(payment.status, 201);
    const group = await prisma.toumaOrderGroup.findUniqueOrThrow({ where: { id: buyer.groupId } });
    assert.equal(payment.body.payment.amount, group.total.toString(), 'un seul montant pour tout le panier');

    const confirmed = await api.post('/api/v1/payments/confirm', { paymentId: payment.body.payment.id }, buyer.accessToken);
    assert.equal(confirmed.body.status, 'SUCCEEDED');

    // Les DEUX commandes passent à PAID, chacune avec sa commission.
    const orders = await prisma.toumaOrder.findMany({ where: { groupId: buyer.groupId } });
    assert.equal(orders.length, 2);
    assert.ok(orders.every((o) => o.status === 'PAID'));
    assert.equal(await prisma.toumaCommission.count({ where: { orderId: { in: orders.map((o) => o.id) } } }), 2);

    const updated = await prisma.toumaOrderGroup.findUniqueOrThrow({ where: { id: buyer.groupId } });
    assert.equal(updated.status, 'PAID');
  });

  it('expose le groupe à l’acheteur, avec ses sous-commandes', async () => {
    const res = await api.get(`/api/v1/orders/groups/${buyer.groupId}`, buyer.accessToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.orders.length, 2);
    assert.equal(res.body.payment.status, 'SUCCEEDED');
    assert.ok(res.body.orders.every((o: any) => o.store.name));
  });

  it('ne montre le groupe ni à un tiers ni en clair à un inconnu', async () => {
    const other = await registerUser(api, { name: 'Tiers', email: uniqueEmail('mv-tiers'), role: 'BUYER', countryCode: 'TD' });
    const res = await api.get(`/api/v1/orders/groups/${buyer.groupId}`, other.accessToken);
    assert.equal(res.status, 404);
  });

  it('ne facture pas deux fois un checkout rejoué', async () => {
    await api.post('/api/v1/cart/items', { productId: productTd, quantity: 1 }, buyer.accessToken);
    const key = `mv-${Date.now()}`;
    const first = await api.post('/api/v1/checkout', { addressId: buyer.addressId, idempotencyKey: key }, buyer.accessToken);
    assert.equal(first.status, 201);
    const replay = await api.post('/api/v1/checkout', { addressId: buyer.addressId, idempotencyKey: key }, buyer.accessToken);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.idempotent, true);
    assert.equal(replay.body.group.id, first.body.group.id);
    await api.delete('/api/v1/cart', buyer.accessToken);
  });
});

describe('Remise en point relais', () => {
  it('accepte un point relais du bon pays et le fige dans la commande', async () => {
    await api.post('/api/v1/cart/items', { productId: productTd, quantity: 1 }, buyer.accessToken);
    const res = await api.post(
      '/api/v1/checkout',
      { addressId: buyer.addressId, deliveryMethod: 'PICKUP_POINT', pickupPointId },
      buyer.accessToken,
    );
    assert.equal(res.status, 201);
    const order = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: res.body.orders[0].id } });
    assert.equal(order.deliveryMethod, 'PICKUP_POINT');
    assert.equal(order.pickupPointId, pickupPointId);
    const snapshot = order.shippingSnapshot as { pickupPoint?: { code?: string }; district?: string; landmark?: string };
    assert.equal(snapshot.pickupPoint?.code, 'TEST-TD-01');
    // L'adresse africaine est figée telle que saisie : quartier et point de repère.
    assert.equal(snapshot.district, 'Klemat');
    assert.equal(snapshot.landmark, 'Face à la pharmacie');
  });

  it('refuse un point relais d’un autre pays que la livraison', async () => {
    const foreign = await prisma.toumaPickupPoint.upsert({
      where: { code: 'TEST-CM-01' },
      update: { active: true },
      create: { code: 'TEST-CM-01', name: 'Relais Douala test', countryCode: 'CM', city: 'Douala', addressLine: 'Akwa', active: true },
    });
    await api.post('/api/v1/cart/items', { productId: productTd, quantity: 1 }, buyer.accessToken);
    const res = await api.post(
      '/api/v1/checkout',
      { addressId: buyer.addressId, deliveryMethod: 'PICKUP_POINT', pickupPointId: foreign.id },
      buyer.accessToken,
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /ne dessert pas/i);
    await api.delete('/api/v1/cart', buyer.accessToken);
  });

  it('exige un point relais quand ce mode est choisi', async () => {
    await api.post('/api/v1/cart/items', { productId: productTd, quantity: 1 }, buyer.accessToken);
    const res = await api.post('/api/v1/checkout', { addressId: buyer.addressId, deliveryMethod: 'PICKUP_POINT' }, buyer.accessToken);
    assert.equal(res.status, 400);
    await api.delete('/api/v1/cart', buyer.accessToken);
  });

  it('publie la liste des points relais sans authentification', async () => {
    const res = await api.get('/api/v1/pickup-points?country=TD');
    assert.equal(res.status, 200);
    assert.ok(res.body.items.some((p: any) => p.code === 'TEST-TD-01'));
  });
});

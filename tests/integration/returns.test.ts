import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Après-vente : cycle complet d'un retour (demande → acceptation → renvoi →
 * réception → remboursement) et garde-fous financiers.
 *
 * Les montants ne sont jamais fournis par le client : on vérifie qu'ils sont
 * recalculés, plafonnés, et qu'un remboursement ne peut pas dépasser ce qui a
 * réellement été encaissé.
 */
const api = new TestApi();

let buyer: any;
let seller: any;
let other: any;
let productId: string;

/** Déroule une commande jusqu'à l'état livré, prête pour un retour. */
async function deliveredOrder(quantity = 2) {
  await api.post('/api/v1/cart/items', { productId, quantity }, buyer.accessToken);
  const checkout = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
  assert.equal(checkout.status, 201);
  const order = checkout.body.orders[0];

  const payment = await api.post('/api/v1/payments/create', { orderId: order.id, method: 'MOBILE_MONEY' }, buyer.accessToken);
  await api.post('/api/v1/payments/confirm', { paymentId: payment.body.payment.id }, buyer.accessToken);

  for (const status of ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']) {
    const res = await api.patch(`/api/v1/orders/${order.id}/status`, { status }, seller.accessToken);
    assert.equal(res.status, 200, `transition ${status} refusée : ${JSON.stringify(res.body)}`);
  }
  return prisma.toumaOrder.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  seller = await registerUser(api, { name: 'Vendeur retours', email: uniqueEmail('rt-seller'), role: 'SELLER', countryCode: 'CM' });
  const store = await api.post('/api/v1/stores', { name: `Boutique retours ${Date.now()}`, countryCode: 'CM' }, seller.accessToken);
  productId = (
    await api.post(
      '/api/v1/products',
      { storeId: store.body.id, title: `Cacao retour ${Date.now()}`, price: '10000', quantity: 50, weightGrams: 1000, status: 'ACTIVE' },
      seller.accessToken,
    )
  ).body.id;

  buyer = await registerUser(api, { name: 'Acheteur retours', email: uniqueEmail('rt-buyer'), role: 'BUYER', countryCode: 'TD' });
  const address = await api.post(
    '/api/v1/auth/me/addresses',
    { fullName: 'Acheteur retours', phone: '+23590000901', line1: 'Rue 8', city: "N'Djamena", countryCode: 'TD' },
    buyer.accessToken,
  );
  buyer.addressId = address.body.id;

  other = await registerUser(api, { name: 'Tiers curieux', email: uniqueEmail('rt-other'), role: 'BUYER', countryCode: 'TD' });
});
after(async () => api.stop());

describe('Retour : cycle complet jusqu’au remboursement', () => {
  let order: any;
  let returnId: string;

  it('n’autorise un retour qu’après livraison', async () => {
    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const checkout = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    const pending = checkout.body.orders[0];
    const item = await prisma.toumaOrderItem.findFirstOrThrow({ where: { orderId: pending.id } });

    const res = await api.post(
      '/api/v1/returns',
      { orderId: pending.id, reason: 'DAMAGED', items: [{ orderItemId: item.id, quantity: 1 }] },
      buyer.accessToken,
    );
    assert.equal(res.status, 409);
    assert.match(res.body.error, /livrée/i);
  });

  it('calcule lui-même le montant à partir des prix payés', async () => {
    order = await deliveredOrder(2);
    const eligibility = await api.get(`/api/v1/returns/eligibility/${order.id}`, buyer.accessToken);
    assert.equal(eligibility.status, 200);
    assert.equal(eligibility.body.eligible, true);
    assert.equal(eligibility.body.items[0].returnable, 2);

    const created = await api.post(
      '/api/v1/returns',
      {
        orderId: order.id,
        reason: 'DAMAGED',
        comment: 'Deux sacs éventrés à l’arrivée.',
        items: [{ orderItemId: order.items[0].id, quantity: 2 }],
      },
      buyer.accessToken,
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    returnId = created.body.id;

    // 2 × 10 000 + frais de livraison (motif imputable au vendeur, commande entière).
    const expected = order.items[0].unitPrice.times(2).plus(order.shippingTotal);
    assert.equal(created.body.requestedAmount, expected.toString());
    assert.equal(created.body.refundShipping, true);
    assert.equal(created.body.status, 'REQUESTED');
  });

  it('cache la demande aux tiers (404, jamais 403)', async () => {
    const res = await api.get(`/api/v1/returns/${returnId}`, other.accessToken);
    assert.equal(res.status, 404);
  });

  it('refuse un montant accepté supérieur au montant demandé', async () => {
    const res = await api.post(`/api/v1/returns/${returnId}/approve`, { approvedAmount: '999999' }, seller.accessToken);
    assert.equal(res.status, 400);
  });

  it('laisse le vendeur accepter, l’acheteur renvoyer, le vendeur recevoir', async () => {
    const approved = await api.post(`/api/v1/returns/${returnId}/approve`, { note: 'Désolé pour la casse.' }, seller.accessToken);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'APPROVED');

    // Le vendeur ne peut pas déclarer le colis renvoyé à la place de l'acheteur.
    const usurped = await api.post(`/api/v1/returns/${returnId}/ship`, { trackingNumber: 'FAUX-123' }, seller.accessToken);
    assert.equal(usurped.status, 404);

    const shipped = await api.post(`/api/v1/returns/${returnId}/ship`, { trackingNumber: 'CM-TD-99001' }, buyer.accessToken);
    assert.equal(shipped.body.status, 'IN_TRANSIT');

    const stockBefore = await prisma.toumaInventory.findFirstOrThrow({ where: { productId } });
    const received = await api.post(`/api/v1/returns/${returnId}/receive`, { condition: 'emballage ouvert', restock: true }, seller.accessToken);
    assert.equal(received.body.status, 'RECEIVED');

    const stockAfter = await prisma.toumaInventory.findFirstOrThrow({ where: { productId } });
    assert.equal(stockAfter.quantity - stockBefore.quantity, 2, 'les articles reçus reviennent en stock');
  });

  it('rembourse réellement, contre-passe la commission et clôt la commande', async () => {
    const commissionBefore = await prisma.toumaCommission.aggregate({ where: { orderId: order.id }, _sum: { amount: true } });

    const refunded = await api.post(`/api/v1/returns/${returnId}/refund`, {}, seller.accessToken);
    assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
    assert.equal(refunded.body.status, 'REFUNDED');
    assert.equal(refunded.body.refund.status, 'COMPLETED');

    const refund = await prisma.toumaRefund.findFirstOrThrow({ where: { returnRequestId: returnId } });
    assert.equal(refund.amount.toString(), order.total.toString(), 'la commande entière est remboursée');
    assert.ok(refund.providerRef, 'le prestataire a renvoyé une référence');

    // Le paiement est porté par le groupe de commande (un panier = un paiement).
    const payment = await prisma.toumaPayment.findUniqueOrThrow({ where: { id: refund.paymentId! } });
    assert.equal(payment.status, 'REFUNDED');
    assert.equal(payment.refundedAmount.toString(), order.total.toString());

    const updatedOrder = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(updatedOrder.status, 'REFUNDED');

    const commissionAfter = await prisma.toumaCommission.aggregate({ where: { orderId: order.id }, _sum: { amount: true } });
    assert.ok(
      (commissionBefore._sum.amount ?? 0) > (commissionAfter._sum.amount ?? 0),
      'la commission plateforme est contre-passée',
    );
    assert.equal(commissionAfter._sum.amount?.toString(), '0', 'un remboursement intégral annule toute la commission');
  });

  it('refuse un second remboursement du même retour', async () => {
    const res = await api.post(`/api/v1/returns/${returnId}/refund`, {}, seller.accessToken);
    assert.equal(res.status, 409);
  });
});

describe('Retour : garde-fous', () => {
  it('refuse de retourner plus d’unités que la commande n’en contient', async () => {
    const order = await deliveredOrder(1);
    const res = await api.post(
      '/api/v1/returns',
      { orderId: order.id, reason: 'WRONG_ITEM', items: [{ orderItemId: order.items[0].id, quantity: 5 }] },
      buyer.accessToken,
    );
    assert.equal(res.status, 409);
    assert.match(res.body.error, /retournable/i);
  });

  it('refuse une ligne appartenant à une autre commande', async () => {
    const first = await deliveredOrder(1);
    const second = await deliveredOrder(1);
    const res = await api.post(
      '/api/v1/returns',
      { orderId: first.id, reason: 'OTHER', items: [{ orderItemId: second.items[0].id, quantity: 1 }] },
      buyer.accessToken,
    );
    assert.equal(res.status, 400);
  });

  it('ne rembourse jamais plus que le montant accepté', async () => {
    const order = await deliveredOrder(1);
    const created = await api.post(
      '/api/v1/returns',
      { orderId: order.id, reason: 'CHANGED_MIND', items: [{ orderItemId: order.items[0].id, quantity: 1 }] },
      buyer.accessToken,
    );
    // Motif imputable à l'acheteur : les frais de livraison ne sont pas remboursés.
    assert.equal(created.body.refundShipping, false);
    assert.equal(created.body.requestedAmount, order.items[0].lineTotal.toString());

    await api.post(`/api/v1/returns/${created.body.id}/approve`, { approvedAmount: '5000' }, seller.accessToken);
    const tooMuch = await api.post(`/api/v1/returns/${created.body.id}/refund`, { amount: '9000' }, seller.accessToken);
    assert.equal(tooMuch.status, 400);

    const ok = await api.post(`/api/v1/returns/${created.body.id}/refund`, {}, seller.accessToken);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.refund.amount, '5000');

    // Remboursement partiel : la commande reste livrée, le paiement partiellement remboursé.
    const refund = await prisma.toumaRefund.findFirstOrThrow({ where: { orderId: order.id } });
    const payment = await prisma.toumaPayment.findUniqueOrThrow({ where: { id: refund.paymentId! } });
    assert.equal(payment.status, 'PARTIALLY_REFUNDED');
    const updated = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.notEqual(updated.status, 'REFUNDED');
  });

  it('empêche un tiers d’approuver ou de rembourser un retour', async () => {
    const order = await deliveredOrder(1);
    const created = await api.post(
      '/api/v1/returns',
      { orderId: order.id, reason: 'MISSING_PARTS', items: [{ orderItemId: order.items[0].id, quantity: 1 }] },
      buyer.accessToken,
    );
    assert.equal((await api.post(`/api/v1/returns/${created.body.id}/approve`, {}, other.accessToken)).status, 404);
    assert.equal((await api.post(`/api/v1/returns/${created.body.id}/refund`, {}, other.accessToken)).status, 404);
    // L'acheteur non plus : il ne se rembourse pas lui-même.
    assert.equal((await api.post(`/api/v1/returns/${created.body.id}/refund`, {}, buyer.accessToken)).status, 404);
  });

  it('laisse l’acheteur retirer sa demande', async () => {
    const order = await deliveredOrder(1);
    const created = await api.post(
      '/api/v1/returns',
      { orderId: order.id, reason: 'OTHER', items: [{ orderItemId: order.items[0].id, quantity: 1 }] },
      buyer.accessToken,
    );
    const cancelled = await api.post(`/api/v1/returns/${created.body.id}/cancel`, {}, buyer.accessToken);
    assert.equal(cancelled.body.status, 'CANCELLED');

    // Une demande retirée libère de nouveau les articles.
    const eligibility = await api.get(`/api/v1/returns/eligibility/${order.id}`, buyer.accessToken);
    assert.equal(eligibility.body.items[0].returnable, 1);
  });

  it('accepte « jamais reçu » sur une commande expédiée, pas sur une commande payée', async () => {
    // Commande payée mais pas encore expédiée : le retour n'a pas de sens.
    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const checkout = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    const order = checkout.body.orders[0];
    const payment = await api.post('/api/v1/payments/create', { orderId: order.id, method: 'MOBILE_MONEY' }, buyer.accessToken);
    await api.post('/api/v1/payments/confirm', { paymentId: payment.body.payment.id }, buyer.accessToken);
    const item = await prisma.toumaOrderItem.findFirstOrThrow({ where: { orderId: order.id } });

    const tooEarly = await api.post(
      '/api/v1/returns',
      { orderId: order.id, reason: 'NOT_DELIVERED', items: [{ orderItemId: item.id, quantity: 1 }] },
      buyer.accessToken,
    );
    assert.equal(tooEarly.status, 409);

    // Une fois le colis parti, « jamais reçu » devient recevable.
    await api.patch(`/api/v1/orders/${order.id}/status`, { status: 'PROCESSING' }, seller.accessToken);
    await api.patch(`/api/v1/orders/${order.id}/status`, { status: 'SHIPPED' }, seller.accessToken);
    const opened = await api.post(
      '/api/v1/returns',
      { orderId: order.id, reason: 'NOT_DELIVERED', items: [{ orderItemId: item.id, quantity: 1 }] },
      buyer.accessToken,
    );
    assert.equal(opened.status, 201);
    assert.equal(opened.body.refundShipping, true, 'un colis jamais reçu rembourse aussi le transport');
  });

  it('sépare la vue acheteur de la vue vendeur', async () => {
    const mine = await api.get('/api/v1/returns?scope=buyer', buyer.accessToken);
    assert.ok(mine.body.items.length > 0);
    assert.ok(mine.body.items.every((r: any) => r.buyer.id === buyer.user.id));

    const received = await api.get('/api/v1/returns?scope=seller', seller.accessToken);
    assert.ok(received.body.items.length > 0);

    const empty = await api.get('/api/v1/returns?scope=seller', other.accessToken);
    assert.equal(empty.body.items.length, 0, 'un tiers ne voit aucun retour');
  });
});

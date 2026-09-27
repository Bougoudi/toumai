import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Documents commerciaux.
 *
 * Deux points font tout l'intérêt du module, et sont vérifiés ici :
 *   • **l'émetteur est celui qui vend** — la facture vient de la boutique, le
 *     reçu de TOUMA qui a encaissé ; les confondre ferait de la place de marché
 *     le vendeur ;
 *   • **un document est figé** — rejouer un paiement ne crée pas de doublon, et
 *     un remboursement produit un avoir qui référence la facture, sans la
 *     réécrire.
 */
const api = new TestApi();

let buyer: any;
let seller: any;
let other: any;
let storeId: string;
let productId: string;
const PRICE = 25_000;

async function paidOrder(quantity = 1) {
  await api.post('/api/v1/cart/items', { productId, quantity }, buyer.accessToken);
  const checkout = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  const order = checkout.body.orders[0];
  const payment = await api.post('/api/v1/payments/create', { orderId: order.id, method: 'MOBILE_MONEY' }, buyer.accessToken);
  const confirmed = await api.post('/api/v1/payments/confirm', { paymentId: payment.body.payment.id }, buyer.accessToken);
  assert.equal(confirmed.body.status, 'SUCCEEDED');
  return { order, paymentId: payment.body.payment.id };
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  seller = await registerUser(api, { name: 'Vendeur docs', email: uniqueEmail('doc-seller'), role: 'SELLER', countryCode: 'CM' });
  storeId = (await api.post('/api/v1/stores', { name: `Boutique docs ${Date.now()}`, countryCode: 'CM', city: 'Douala' }, seller.accessToken)).body.id;
  productId = (
    await api.post(
      '/api/v1/products',
      { storeId, title: `Miel docs ${Date.now()}`, price: String(PRICE), quantity: 200, weightGrams: 1000, status: 'ACTIVE' },
      seller.accessToken,
    )
  ).body.id;

  buyer = await registerUser(api, { name: 'Acheteur docs', email: uniqueEmail('doc-buyer'), role: 'BUYER', countryCode: 'TD' });
  buyer.addressId = (
    await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Acheteur docs', phone: '+23590000833', line1: 'Rue 9', district: 'Moursal', city: "N'Djamena", countryCode: 'TD' },
      buyer.accessToken,
    )
  ).body.id;

  other = await registerUser(api, { name: 'Tiers docs', email: uniqueEmail('doc-other'), role: 'BUYER', countryCode: 'TD' });
});
after(async () => api.stop());

describe('Émission des documents', () => {
  let orderId: string;
  let paymentId: string;
  let invoiceNumber: string;

  it('émet une facture de la boutique et un reçu de TOUMA au paiement', async () => {
    const result = await paidOrder(2);
    orderId = result.order.id;
    paymentId = result.paymentId;

    const docs = await api.get(`/api/v1/documents/order/${orderId}`, buyer.accessToken);
    assert.equal(docs.status, 200);

    const invoice = docs.body.items.find((d: any) => d.type === 'INVOICE');
    const receipt = docs.body.items.find((d: any) => d.type === 'PAYMENT_RECEIPT');
    assert.ok(invoice, 'une facture est émise');
    assert.ok(receipt, 'un reçu de paiement est émis');
    invoiceNumber = invoice.number;

    // La facture émane de la boutique ; le reçu, de la plateforme.
    const stored = await prisma.toumaDocument.findUniqueOrThrow({ where: { id: invoice.id } });
    assert.equal(stored.issuerKind, 'STORE');
    assert.equal(stored.storeId, storeId);
    const storedReceipt = await prisma.toumaDocument.findUniqueOrThrow({ where: { id: receipt.id } });
    assert.equal(storedReceipt.issuerKind, 'PLATFORM');
    assert.equal(storedReceipt.storeId, null);

    // Le montant facturé est exactement celui de la commande.
    const order = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: orderId } });
    assert.equal(invoice.totalAmount, order.total.toString());
  });

  it('numérote les documents par série, sans collision', async () => {
    assert.match(invoiceNumber, /^FAC-\d{4}-[A-Z0-9]{4}-\d{5}$/);
    const second = await paidOrder(1);
    const docs = await api.get(`/api/v1/documents/order/${second.order.id}`, buyer.accessToken);
    const invoice = docs.body.items.find((d: any) => d.type === 'INVOICE');
    assert.notEqual(invoice.number, invoiceNumber);

    const numbers = await prisma.toumaDocument.findMany({ where: { storeId, type: 'INVOICE' }, select: { number: true } });
    assert.equal(new Set(numbers.map((n) => n.number)).size, numbers.length, 'aucun numéro en double');
  });

  it('n’émet jamais deux fois le même document', async () => {
    // Rejouer la confirmation du paiement ne doit pas produire de seconde facture.
    await api.post('/api/v1/payments/confirm', { paymentId }, buyer.accessToken);
    const count = await prisma.toumaDocument.count({ where: { orderId, type: 'INVOICE' } });
    assert.equal(count, 1);
  });

  it('fige le contenu : parties, lignes et totaux', async () => {
    const docs = await api.get(`/api/v1/documents/order/${orderId}`, buyer.accessToken);
    const invoiceId = docs.body.items.find((d: any) => d.type === 'INVOICE').id;
    const doc = await api.get(`/api/v1/documents/${invoiceId}`, buyer.accessToken);

    const payload = doc.body.payload;
    assert.equal(payload.issuer.countryCode, 'CM');
    assert.equal(payload.recipient.countryCode, 'TD');
    assert.ok(payload.lines.length > 0);
    assert.equal(payload.lines[0].quantity, 2);
    assert.equal(payload.totals.subtotal, String(PRICE * 2));
    assert.ok(payload.taxNotice.includes('TVA'), 'la mention fiscale est explicite');

    // Changer le prix du produit ne doit rien changer au document déjà émis.
    await api.patch(`/api/v1/products/${productId}`, { price: '99000' }, seller.accessToken);
    const again = await api.get(`/api/v1/documents/${invoiceId}`, buyer.accessToken);
    assert.equal(again.body.payload.totals.subtotal, String(PRICE * 2));
    await api.patch(`/api/v1/products/${productId}`, { price: String(PRICE) }, seller.accessToken);
  });

  it('ne reprend une raison sociale que si elle a été vérifiée', async () => {
    const docs = await api.get(`/api/v1/documents/order/${orderId}`, buyer.accessToken);
    const invoiceId = docs.body.items.find((d: any) => d.type === 'INVOICE').id;
    const doc = await api.get(`/api/v1/documents/${invoiceId}`, buyer.accessToken);
    // Boutique non vérifiée : aucune identité légale n'est inventée.
    assert.equal(doc.body.payload.issuer.verified, false);
    assert.equal(doc.body.payload.issuer.legalName, null);
    assert.equal(doc.body.payload.issuer.name, (await prisma.toumaStore.findUniqueOrThrow({ where: { id: storeId } })).name);
  });

  it('émet un bon de livraison à la création de l’expédition', async () => {
    const created = await api.post('/api/v1/shipping/create', { orderId }, seller.accessToken);
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const docs = await api.get(`/api/v1/documents/order/${orderId}`, seller.accessToken);
    const note = docs.body.items.find((d: any) => d.type === 'DELIVERY_NOTE');
    assert.ok(note, 'un bon de livraison est émis');
    // Un bon de livraison liste des quantités, pas des prix.
    assert.equal(note.totalAmount, '0');
    const doc = await api.get(`/api/v1/documents/${note.id}`, seller.accessToken);
    assert.ok(doc.body.payload.lines.every((l: any) => l.unitPrice === undefined));
  });

  it('émet un avoir qui référence la facture, sans la réécrire', async () => {
    // Livraison puis retour complet, jusqu'au remboursement. L'expédition a
    // déjà fait passer la commande en préparation au test précédent.
    for (const status of ['SHIPPED', 'DELIVERED'] as const) {
      const res = await api.patch(`/api/v1/orders/${orderId}/status`, { status }, seller.accessToken);
      assert.equal(res.status, 200, `transition ${status} : ${JSON.stringify(res.body)}`);
    }
    const item = await prisma.toumaOrderItem.findFirstOrThrow({ where: { orderId } });
    const rma = await api.post(
      '/api/v1/returns',
      { orderId, reason: 'DAMAGED', items: [{ orderItemId: item.id, quantity: item.quantity }] },
      buyer.accessToken,
    );
    await api.post(`/api/v1/returns/${rma.body.id}/approve`, {}, seller.accessToken);
    const refunded = await api.post(`/api/v1/returns/${rma.body.id}/refund`, {}, seller.accessToken);
    assert.equal(refunded.status, 200, JSON.stringify(refunded.body));

    const docs = await api.get(`/api/v1/documents/order/${orderId}`, buyer.accessToken);
    const credit = docs.body.items.find((d: any) => d.type === 'CREDIT_NOTE');
    assert.ok(credit, 'un avoir est émis');
    assert.match(credit.number, /^AVO-/);

    const doc = await api.get(`/api/v1/documents/${credit.id}`, buyer.accessToken);
    assert.equal(doc.body.payload.correctsInvoice, invoiceNumber);

    // La facture d'origine est inchangée : on corrige, on ne réécrit pas.
    const invoice = await prisma.toumaDocument.findUniqueOrThrow({ where: { number: invoiceNumber } });
    const order = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: orderId } });
    assert.equal(invoice.totalAmount.toString(), order.total.toString());
  });
});

describe('Accès aux documents', () => {
  it('sépare la vue acheteur de la vue vendeur', async () => {
    const mine = await api.get('/api/v1/documents?scope=buyer', buyer.accessToken);
    assert.ok(mine.body.items.length > 0);
    assert.ok(mine.body.items.some((d: any) => d.type === 'INVOICE'));

    const issued = await api.get('/api/v1/documents?scope=seller', seller.accessToken);
    assert.ok(issued.body.items.length > 0);
    // Le reçu est émis par TOUMA : il n'apparaît pas dans les documents du vendeur.
    assert.ok(!issued.body.items.some((d: any) => d.type === 'PAYMENT_RECEIPT'));
  });

  it('cache les documents d’autrui (404, jamais 403)', async () => {
    const mine = await api.get('/api/v1/documents?scope=buyer', buyer.accessToken);
    const id = mine.body.items[0].id;
    assert.equal((await api.get(`/api/v1/documents/${id}`, other.accessToken)).status, 404);
    assert.equal((await api.get('/api/v1/documents?scope=buyer', other.accessToken)).body.items.length, 0);
  });

  it('totalise ce que la boutique a facturé et avoiré', async () => {
    const totals = await api.get(`/api/v1/documents/store/${storeId}/totals`, seller.accessToken);
    assert.equal(totals.status, 200);
    assert.ok(totals.body.invoiceCount >= 2);
    assert.ok(totals.body.creditNoteCount >= 1);
    assert.ok(Number(totals.body.invoiced.XAF) > 0);

    // Un tiers ne voit rien de cette boutique.
    assert.equal((await api.get(`/api/v1/documents/store/${storeId}/totals`, other.accessToken)).status, 404);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * PARCOURS B2B DE BOUT EN BOUT — le cœur de TOUMA Business.
 *
 * profil entreprise → appel d'offres → offres de deux fournisseurs →
 * comparaison → négociation → acceptation → commande → paiement.
 *
 * C'est le scénario du commerce transfrontalier réel : un distributeur
 * tchadien cherche 500 kg de cacao au Cameroun.
 */
const api = new TestApi();

let buyer: any;
let sellerCm: any;
let sellerTd: any;
let storeCm: string;
let storeTd: string;
let rfqId: string;
let quoteCm: any;
let quoteTd: any;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  buyer = await registerUser(api, { name: 'Distributeur Sahel', email: uniqueEmail('b2b-acheteur'), role: 'BUYER', countryCode: 'TD' });
  sellerCm = await registerUser(api, { name: 'Coopérative Douala', email: uniqueEmail('b2b-cm'), role: 'SELLER', countryCode: 'CM' });
  sellerTd = await registerUser(api, { name: 'Négoce Sahel', email: uniqueEmail('b2b-td'), role: 'SELLER', countryCode: 'TD' });

  storeCm = (await api.post('/api/v1/stores', { name: `Coopérative CM ${Date.now()}`, countryCode: 'CM', city: 'Douala' }, sellerCm.accessToken)).body.id;
  storeTd = (await api.post('/api/v1/stores', { name: `Négoce TD ${Date.now()}`, countryCode: 'TD', city: "N'Djamena" }, sellerTd.accessToken)).body.id;

  const address = await api.post(
    '/api/v1/auth/me/addresses',
    {
      fullName: 'Distributeur Sahel',
      phone: '+23590000900',
      line1: 'Avenue Charles de Gaulle',
      district: 'Klemat',
      landmark: 'Face à la station Total',
      city: "N'Djamena",
      countryCode: 'TD',
    },
    buyer.accessToken,
  );
  buyer.addressId = address.body.id;
});
after(async () => api.stop());

describe('TOUMA Business — de l’appel d’offres à la commande', () => {
  it('1. l’acheteur enregistre son profil entreprise', async () => {
    const res = await api.put(
      '/api/v1/business/profile',
      { legalName: 'Sahel Distribution SARL', registrationNo: 'RCCM/TD/2021/B/0421', sector: 'Agroalimentaire', countryCode: 'TD', city: "N'Djamena" },
      buyer.accessToken,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.legalName, 'Sahel Distribution SARL');
  });

  it('2. il publie un appel d’offres : 500 kg de cacao livrés à N’Djamena', async () => {
    const res = await api.post(
      '/api/v1/rfqs',
      {
        title: 'Recherche 500 kg de cacao en fèves',
        description: 'Qualité export, échantillon souhaité avant commande.',
        countryCode: 'TD',
        city: "N'Djamena",
        sourceCountry: 'CM',
        currency: 'XAF',
        deadline: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(),
        items: [{ name: 'Cacao en fèves fermentées', quantity: 500, unit: 'kg', targetUnitPrice: '2800' }],
      },
      buyer.accessToken,
    );
    assert.equal(res.status, 201);
    rfqId = res.body.id;
    assert.equal(res.body.status, 'OPEN');
    assert.equal(res.body.items[0].quantity, 500);
    assert.match(res.body.reference, /^RFQ-/);
  });

  it('3. l’appel d’offres est visible des fournisseurs, sans révéler l’acheteur', async () => {
    const list = await api.get('/api/v1/rfqs?scope=open&country=TD', sellerCm.accessToken);
    assert.equal(list.status, 200);
    const found = list.body.items.find((r: any) => r.id === rfqId);
    assert.ok(found, 'l’appel d’offres doit apparaître aux fournisseurs');
    assert.equal(found.buyer.email, undefined, 'l’e-mail de l’acheteur n’est jamais exposé');
  });

  it('4. deux fournisseurs répondent avec des prix et délais différents', async () => {
    const cm = await api.post(
      `/api/v1/rfqs/${rfqId}/quotes`,
      {
        storeId: storeCm,
        shippingTotal: '85000',
        leadTimeDays: 12,
        validityDays: 15,
        message: 'Cacao de la région du Centre, échantillon offert.',
        items: [{ name: 'Cacao en fèves fermentées', quantity: 500, unit: 'kg', unitPrice: '2750' }],
      },
      sellerCm.accessToken,
    );
    assert.equal(cm.status, 201);
    quoteCm = cm.body;
    assert.equal(quoteCm.itemsTotal, '1375000');
    assert.equal(quoteCm.total, '1460000');

    const td = await api.post(
      `/api/v1/rfqs/${rfqId}/quotes`,
      { storeId: storeTd, shippingTotal: '20000', leadTimeDays: 5, items: [{ name: 'Cacao en fèves', quantity: 500, unit: 'kg', unitPrice: '3100' }] },
      sellerTd.accessToken,
    );
    assert.equal(td.status, 201);
    quoteTd = td.body;

    const rfq = await prisma.toumaRfq.findUniqueOrThrow({ where: { id: rfqId } });
    assert.equal(rfq.status, 'QUOTED');
  });

  it('5. une boutique ne peut pas répondre deux fois', async () => {
    const res = await api.post(
      `/api/v1/rfqs/${rfqId}/quotes`,
      { storeId: storeCm, items: [{ name: 'Cacao', quantity: 500, unit: 'kg', unitPrice: '2600' }] },
      sellerCm.accessToken,
    );
    assert.equal(res.status, 409);
  });

  it('6. un fournisseur ne voit jamais l’offre de son concurrent', async () => {
    const asSeller = await api.get(`/api/v1/rfqs/${rfqId}`, sellerCm.accessToken);
    assert.equal(asSeller.status, 200);
    assert.equal(asSeller.body.quotes.length, 1, 'un fournisseur ne voit que sa propre offre');
    assert.equal(asSeller.body.quotes[0].id, quoteCm.id);
    assert.equal(asSeller.body.isOwner, false);

    const asBuyer = await api.get(`/api/v1/rfqs/${rfqId}`, buyer.accessToken);
    assert.equal(asBuyer.body.quotes.length, 2, 'l’acheteur compare toutes les offres');
    assert.equal(asBuyer.body.isOwner, true);
    // Les offres sont triées du moins cher au plus cher.
    assert.ok(Number(asBuyer.body.quotes[0].total) <= Number(asBuyer.body.quotes[1].total));
  });

  it('7. l’acheteur négocie et le fournisseur révise son offre, lignes comprises', async () => {
    // L'acheteur demande : sa contre-proposition ne modifie pas l'offre.
    const ask = await api.post(
      `/api/v1/negotiations/${quoteCm.id}/counter`,
      {
        items: [{ name: 'Fèves de cacao', quantity: 500, unit: 'kg', unitPrice: '2700' }],
        shippingTotal: '50000',
        leadTimeDays: 21,
        note: 'Pouvez-vous descendre à 2 700 XAF le kilo ?',
      },
      buyer.accessToken,
    );
    assert.equal(ask.status, 201);
    assert.equal(ask.body.total, '1400000', 'le serveur calcule le total : 500 × 2 700 + 50 000');
    assert.equal(ask.body.appliedToQuote, false, 'une demande de l’acheteur ne réécrit pas l’offre');

    const untouched = await prisma.toumaQuote.findUniqueOrThrow({ where: { id: quoteCm.id } });
    assert.equal(untouched.total.toString(), quoteCm.total, 'l’offre du fournisseur est intacte');

    // Le fournisseur révise : lignes, sous-total et total bougent ensemble.
    const answer = await api.post(
      `/api/v1/negotiations/${quoteCm.id}/counter`,
      {
        items: [{ name: 'Fèves de cacao', quantity: 500, unit: 'kg', unitPrice: '2740' }],
        shippingTotal: '50000',
        leadTimeDays: 21,
        note: 'Accord pour 2 740 XAF le kilo, livré.',
      },
      sellerCm.accessToken,
    );
    assert.equal(answer.status, 201);
    assert.equal(answer.body.total, '1420000');
    assert.equal(answer.body.appliedToQuote, true);

    const quote = await prisma.toumaQuote.findUniqueOrThrow({ where: { id: quoteCm.id }, include: { items: true } });
    assert.equal(quote.status, 'COUNTERED');
    assert.equal(quote.total.toString(), '1420000', 'la révision du vendeur ajuste le prix');
    // L'invariant que la V13 violait : la somme des lignes vaut le sous-total.
    const linesTotal = quote.items.reduce((acc, i) => acc + Number(i.lineTotal), 0);
    assert.equal(linesTotal, Number(quote.itemsTotal), 'la somme des lignes vaut le sous-total');
    assert.equal(Number(quote.itemsTotal) + Number(quote.shippingTotal), Number(quote.total));
  });

  it('7 bis. la négociation vit dans une conversation, avec sa chronologie', async () => {
    const view = await api.get(`/api/v1/negotiations/${quoteCm.id}`, buyer.accessToken);
    assert.equal(view.status, 200);
    assert.ok(view.body.conversationId, 'l’offre a son fil de discussion');
    assert.ok(view.body.timeline.length >= 2, 'chaque proposition laisse une trace');
    assert.equal(view.body.permissions.canAccept, true);

    const thread = await api.get(`/api/v1/conversations/${view.body.conversationId}/messages`, sellerCm.accessToken);
    assert.equal(thread.status, 200);
    const offerCards = thread.body.items.filter((m: any) => m.offer);
    assert.ok(offerCards.length >= 2, 'les propositions apparaissent comme des cartes d’offre');
    assert.equal(offerCards.at(-1).offer.total, '1420000');
  });

  it('8. un tiers ne peut ni lire ni écrire dans la négociation', async () => {
    const intruder = await registerUser(api, { name: 'Curieux', email: uniqueEmail('curieux'), role: 'BUYER', countryCode: 'TD' });
    const res = await api.post(`/api/v1/quotes/${quoteCm.id}/messages`, { body: 'Bonjour' }, intruder.accessToken);
    assert.equal(res.status, 404, 'réponse identique à « inexistant » : aucune fuite');
    const view = await api.get(`/api/v1/negotiations/${quoteCm.id}`, intruder.accessToken);
    assert.equal(view.status, 404);
    const counter = await api.post(
      `/api/v1/negotiations/${quoteCm.id}/counter`,
      { items: [{ name: 'Cacao', quantity: 10, unit: 'kg', unitPrice: '1' }], shippingTotal: '0', leadTimeDays: 5 },
      intruder.accessToken,
    );
    assert.equal(counter.status, 404);
  });

  it('9. l’acceptation crée une vraie commande payable', async () => {
    const res = await api.post(`/api/v1/quotes/${quoteCm.id}/accept`, { addressId: buyer.addressId }, buyer.accessToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.total, '1420000', 'la commande reprend le prix négocié');
    buyer.orderGroupId = res.body.orderGroupId;
    buyer.orderId = res.body.orderId;

    const rfq = await prisma.toumaRfq.findUniqueOrThrow({ where: { id: rfqId } });
    assert.equal(rfq.status, 'AWARDED');

    const rejected = await prisma.toumaQuote.findUniqueOrThrow({ where: { id: quoteTd.id } });
    assert.equal(rejected.status, 'REJECTED', 'les offres concurrentes sont automatiquement écartées');

    const order = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: res.body.orderId }, include: { items: true } });
    assert.equal(order.status, 'PENDING');
    assert.equal(order.crossBorder, true, 'commande transfrontalière CM → TD');
    assert.equal(order.items.length, 1);
    assert.match(order.items[0].titleSnapshot, /500 kg/);
  });

  it('10. la commande issue de l’offre se paie comme une autre', async () => {
    const payment = await api.post(
      '/api/v1/payments/create',
      { orderGroupId: buyer.orderGroupId, method: 'BANK_TRANSFER' },
      buyer.accessToken,
    );
    assert.equal(payment.status, 201);
    assert.equal(payment.body.payment.amount, '1420000');

    const confirmed = await api.post('/api/v1/payments/confirm', { paymentId: payment.body.payment.id }, buyer.accessToken);
    assert.equal(confirmed.body.status, 'SUCCEEDED');

    const order = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: buyer.orderId } });
    assert.equal(order.status, 'PAID');
    const group = await prisma.toumaOrderGroup.findUniqueOrThrow({ where: { id: buyer.orderGroupId } });
    assert.equal(group.status, 'PAID');
    assert.equal(await prisma.toumaCommission.count({ where: { orderId: buyer.orderId } }), 1);
  });

  it('11. une offre acceptée ne peut plus être renégociée', async () => {
    const res = await api.post(`/api/v1/quotes/${quoteCm.id}/messages`, { body: 'Encore une remise ?' }, buyer.accessToken);
    assert.equal(res.status, 409);

    // La machine d'état refuse la transition, quel que soit le chemin emprunté.
    const counter = await api.post(
      `/api/v1/negotiations/${quoteCm.id}/counter`,
      { items: [{ name: 'Fèves de cacao', quantity: 500, unit: 'kg', unitPrice: '2600' }], shippingTotal: '50000', leadTimeDays: 21 },
      buyer.accessToken,
    );
    assert.equal(counter.status, 409);

    const reAccept = await api.post(`/api/v1/quotes/${quoteCm.id}/accept`, { addressId: buyer.addressId }, buyer.accessToken);
    assert.equal(reAccept.status, 409, 'une offre acceptée ne se réaccepte pas');
  });

  it('12. le fournisseur retrouve son offre et la commande gagnée', async () => {
    const mine = await api.get('/api/v1/quotes/mine', sellerCm.accessToken);
    assert.equal(mine.status, 200);
    const accepted = mine.body.items.find((q: any) => q.id === quoteCm.id);
    assert.equal(accepted.status, 'ACCEPTED');
    assert.ok(accepted.orderGroupId);

    const orders = await api.get('/api/v1/orders?scope=seller', sellerCm.accessToken);
    assert.ok(orders.body.items.some((o: any) => o.id === buyer.orderId));
  });
});

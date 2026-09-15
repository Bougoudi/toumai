import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Moteur de négociation V14.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *  1. la cohérence financière — la somme des lignes vaut toujours le sous-total ;
 *  2. le calcul côté serveur — un client qui annonce un total n'est pas écouté ;
 *  3. la machine d'état — une offre close ne repart jamais ;
 *  4. l'étanchéité — une négociation d'autrui est « introuvable ».
 */
const api = new TestApi();

let buyer: any;
let seller: any;
let intruder: any;
let storeId: string;
let rfqId: string;
let quoteId: string;

async function newRfq(title: string): Promise<string> {
  const res = await api.post(
    '/api/v1/rfqs',
    {
      title,
      description: 'Négociation de test.',
      countryCode: 'TD',
      city: "N'Djamena",
      sourceCountry: 'CM',
      currency: 'XAF',
      items: [{ name: 'Cacao en fèves', quantity: 500, unit: 'kg', targetUnitPrice: '2800' }],
    },
    buyer.accessToken,
  );
  assert.equal(res.status, 201);
  return res.body.id;
}

async function newQuote(rfq: string, unitPrice = '2900', validityDays = 20): Promise<any> {
  const res = await api.post(
    `/api/v1/rfqs/${rfq}/quotes`,
    {
      storeId,
      shippingTotal: '50000',
      leadTimeDays: 18,
      validityDays,
      message: 'Offre initiale.',
      items: [{ name: 'Cacao en fèves', quantity: 500, unit: 'kg', unitPrice }],
    },
    seller.accessToken,
  );
  assert.equal(res.status, 201);
  return res.body;
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  buyer = await registerUser(api, { name: 'Acheteur Négo', email: uniqueEmail('nego-a'), role: 'BUYER', countryCode: 'TD' });
  seller = await registerUser(api, { name: 'Vendeur Négo', email: uniqueEmail('nego-v'), role: 'SELLER', countryCode: 'CM' });
  intruder = await registerUser(api, { name: 'Tiers Négo', email: uniqueEmail('nego-t'), role: 'BUYER', countryCode: 'TD' });

  storeId = (await api.post('/api/v1/stores', { name: `Boutique Négo ${Date.now()}`, countryCode: 'CM' }, seller.accessToken)).body.id;
  const address = await api.post(
    '/api/v1/auth/me/addresses',
    { fullName: 'Acheteur Négo', phone: '+23590000901', line1: 'Avenue Mobutu', city: "N'Djamena", countryCode: 'TD' },
    buyer.accessToken,
  );
  buyer.addressId = address.body.id;

  rfqId = await newRfq('Négociation — 500 kg de cacao');
  const quote = await newQuote(rfqId);
  quoteId = quote.id;
});
after(async () => api.stop());

describe('Négociation — cohérence financière', () => {
  it('ouvre une conversation dédiée dès la première offre', async () => {
    const view = await api.get(`/api/v1/negotiations/${quoteId}`, buyer.accessToken);
    assert.equal(view.status, 200);
    assert.ok(view.body.conversationId, 'l’offre a son fil');
    assert.equal(view.body.total, '1500000');

    const thread = await api.get(`/api/v1/conversations/${view.body.conversationId}/messages`, buyer.accessToken);
    const card = thread.body.items.find((m: any) => m.type === 'QUOTE');
    assert.ok(card, 'la carte d’offre figure dans le fil');
    assert.equal(card.metadata.total, '1500000');
  });

  it('calcule le total côté serveur : un total envoyé par le client est ignoré', async () => {
    const res = await api.post(
      `/api/v1/negotiations/${quoteId}/counter`,
      {
        items: [{ name: 'Cacao en fèves', quantity: 500, unit: 'kg', unitPrice: '2800' }],
        shippingTotal: '50000',
        leadTimeDays: 18,
        // Champ hostile : un client qui s'invente un total ne doit pas être cru.
        total: '1',
        note: 'Pouvez-vous descendre à 2 800 le kilo ?',
      },
      buyer.accessToken,
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.total, '1450000', '500 × 2 800 + 50 000');
    assert.equal(res.body.appliedToQuote, false, 'la demande de l’acheteur ne réécrit pas l’offre');
  });

  it('laisse l’offre du fournisseur intacte tant qu’il n’a rien entériné', async () => {
    const quote = await prisma.toumaQuote.findUniqueOrThrow({ where: { id: quoteId }, include: { items: true } });
    assert.equal(quote.total.toString(), '1500000');
    assert.equal(quote.items[0].unitPrice.toString(), '2900');
  });

  it('une révision du vendeur déplace les lignes ET les totaux ensemble', async () => {
    const res = await api.post(
      `/api/v1/negotiations/${quoteId}/counter`,
      {
        items: [{ name: 'Cacao en fèves', quantity: 500, unit: 'kg', unitPrice: '2850' }],
        shippingTotal: '50000',
        leadTimeDays: 18,
        note: 'Je peux faire 2 850.',
      },
      seller.accessToken,
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.appliedToQuote, true);

    const quote = await prisma.toumaQuote.findUniqueOrThrow({ where: { id: quoteId }, include: { items: true } });
    assert.equal(quote.status, 'COUNTERED');
    assert.equal(quote.total.toString(), '1475000');
    // L'invariant que la V13 cassait.
    const lines = quote.items.reduce((acc, i) => acc + Number(i.lineTotal), 0);
    assert.equal(lines, Number(quote.itemsTotal), 'la somme des lignes vaut le sous-total');
    assert.equal(Number(quote.itemsTotal) + Number(quote.shippingTotal), Number(quote.total));
  });

  it('le fournisseur peut entériner la contre-proposition de l’acheteur', async () => {
    const otherRfq = await newRfq('Négociation — entérinement');
    const quote = await newQuote(otherRfq);

    await api.post(
      `/api/v1/negotiations/${quote.id}/counter`,
      { items: [{ name: 'Cacao en fèves', quantity: 400, unit: 'kg', unitPrice: '2750' }], shippingTotal: '40000', leadTimeDays: 15 },
      buyer.accessToken,
    );

    const applied = await api.post(`/api/v1/negotiations/${quote.id}/apply`, {}, seller.accessToken);
    assert.equal(applied.status, 200);
    assert.equal(applied.body.total, '1140000', '400 × 2 750 + 40 000');

    const stored = await prisma.toumaQuote.findUniqueOrThrow({ where: { id: quote.id }, include: { items: true } });
    assert.equal(stored.items[0].quantity, 400);
    assert.equal(stored.total.toString(), '1140000');
    assert.equal(Number(stored.items[0].lineTotal), Number(stored.itemsTotal));
  });

  it('l’acheteur ne peut pas entériner sa propre proposition', async () => {
    const res = await api.post(`/api/v1/negotiations/${quoteId}/apply`, {}, buyer.accessToken);
    assert.equal(res.status, 403);
  });
});

describe('Négociation — étanchéité et machine d’état', () => {
  it('une négociation d’autrui est introuvable, jamais « interdite »', async () => {
    assert.equal((await api.get(`/api/v1/negotiations/${quoteId}`, intruder.accessToken)).status, 404);
    assert.equal(
      (
        await api.post(
          `/api/v1/negotiations/${quoteId}/counter`,
          // Charge utile valide : on teste l'étanchéité, pas la validation.
          { items: [{ name: 'Cacao en fèves', quantity: 1, unit: 'kg', unitPrice: '1' }], shippingTotal: '0', leadTimeDays: 3 },
          intruder.accessToken,
        )
      ).status,
      404,
    );
    assert.equal((await api.post(`/api/v1/negotiations/${quoteId}/reject`, {}, intruder.accessToken)).status, 404);
  });

  it('refuse une ligne qui ne correspond à aucune ligne demandée', async () => {
    const res = await api.post(
      `/api/v1/negotiations/${quoteId}/counter`,
      {
        items: [{ rfqItemId: 'cm00000000000000000000000', name: 'Autre', quantity: 1, unit: 'kg', unitPrice: '10' }],
        shippingTotal: '0',
        leadTimeDays: 5,
      },
      buyer.accessToken,
    );
    assert.equal(res.status, 400);
  });

  it('une offre expirée ne peut plus être négociée ni acceptée', async () => {
    const otherRfq = await newRfq('Négociation — expiration');
    const quote = await newQuote(otherRfq, '2900', 1);
    // On avance la validité dans le passé : l'expiration est un fait de base,
    // pas une décision du navigateur.
    await prisma.toumaQuote.update({ where: { id: quote.id }, data: { validUntil: new Date(Date.now() - 1000) } });

    const view = await api.get(`/api/v1/negotiations/${quote.id}`, buyer.accessToken);
    assert.equal(view.body.status, 'EXPIRED', 'le balayage applique l’expiration à la lecture');
    assert.equal(view.body.expired, true);
    assert.equal(view.body.permissions.canAccept, false);

    const counter = await api.post(
      `/api/v1/negotiations/${quote.id}/counter`,
      { items: [{ name: 'Cacao en fèves', quantity: 10, unit: 'kg', unitPrice: '100' }], shippingTotal: '0', leadTimeDays: 5 },
      buyer.accessToken,
    );
    assert.equal(counter.status, 409);
    assert.equal((await api.post(`/api/v1/quotes/${quote.id}/accept`, { addressId: buyer.addressId }, buyer.accessToken)).status, 409);
  });

  it('le fournisseur peut retirer son offre, une seule fois', async () => {
    const otherRfq = await newRfq('Négociation — retrait');
    const quote = await newQuote(otherRfq);

    const first = await api.post(`/api/v1/negotiations/${quote.id}/withdraw`, { reason: 'Rupture de stock.' }, seller.accessToken);
    assert.equal(first.status, 200);
    assert.equal(first.body.status, 'WITHDRAWN');

    const again = await api.post(`/api/v1/negotiations/${quote.id}/withdraw`, {}, seller.accessToken);
    assert.equal(again.status, 409);
    assert.equal((await api.post(`/api/v1/quotes/${quote.id}/accept`, { addressId: buyer.addressId }, buyer.accessToken)).status, 409);
  });

  it('l’acceptation crée une commande cohérente, et une seule', async () => {
    const accept = await api.post(`/api/v1/quotes/${quoteId}/accept`, { addressId: buyer.addressId }, buyer.accessToken);
    assert.equal(accept.status, 200);
    assert.equal(accept.body.total, '1475000');
    assert.ok(accept.body.conversationId, 'la commande ouvre son propre fil de suivi');

    const order = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: accept.body.orderId }, include: { items: true } });
    const lines = order.items.reduce((acc, i) => acc + Number(i.lineTotal), 0);
    assert.equal(lines, Number(order.subtotal), 'la commande hérite d’un sous-total cohérent');
    assert.equal(Number(order.subtotal) + Number(order.shippingTotal), Number(order.total));

    // Deuxième acceptation : refusée, et aucune seconde commande.
    const again = await api.post(`/api/v1/quotes/${quoteId}/accept`, { addressId: buyer.addressId }, buyer.accessToken);
    assert.equal(again.status, 409);
    assert.equal(await prisma.toumaOrder.count({ where: { note: { contains: (await prisma.toumaQuote.findUniqueOrThrow({ where: { id: quoteId } })).reference } } }), 1);
  });

  it('deux acceptations simultanées ne créent jamais deux commandes', async () => {
    const otherRfq = await newRfq('Négociation — course à l’acceptation');
    const quote = await newQuote(otherRfq);

    const [a, b] = await Promise.all([
      api.post(`/api/v1/quotes/${quote.id}/accept`, { addressId: buyer.addressId }, buyer.accessToken),
      api.post(`/api/v1/quotes/${quote.id}/accept`, { addressId: buyer.addressId }, buyer.accessToken),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409], 'une seule acceptation aboutit');

    const reference = (await prisma.toumaQuote.findUniqueOrThrow({ where: { id: quote.id } })).reference;
    assert.equal(await prisma.toumaOrder.count({ where: { note: { contains: reference } } }), 1);
  });

  it('une offre acceptée est figée : plus de contre-proposition, plus de refus', async () => {
    const counter = await api.post(
      `/api/v1/negotiations/${quoteId}/counter`,
      { items: [{ name: 'Cacao en fèves', quantity: 500, unit: 'kg', unitPrice: '2000' }], shippingTotal: '0', leadTimeDays: 5 },
      buyer.accessToken,
    );
    assert.equal(counter.status, 409);
    assert.equal((await api.post(`/api/v1/negotiations/${quoteId}/reject`, {}, buyer.accessToken)).status, 409);
  });

  it('conserve une chronologie complète et immuable', async () => {
    const view = await api.get(`/api/v1/negotiations/${quoteId}`, seller.accessToken);
    assert.equal(view.status, 200);
    const kinds = view.body.timeline.map((t: any) => t.kind);
    assert.ok(kinds.includes('COUNTER_OFFER'), 'les propositions restent tracées');
    assert.ok(kinds.includes('ACCEPT'), 'l’acceptation est un événement de la chronologie');
    assert.ok(
      view.body.timeline.every((t: any) => t.createdAt && ['BUYER', 'SELLER', 'ADMIN'].includes(t.side)),
      'chaque événement garde sa date et son camp',
    );
  });
});

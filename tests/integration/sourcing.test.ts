import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Sourcing fournisseurs.
 *
 * Un acheteur en gros ne cherche pas un article, il cherche **qui peut le
 * fournir**. Tout ce qui est affiché doit être observé : capacité réelle en
 * stock, pays réellement desservis, délais réellement annoncés. Ces tests
 * vérifient qu'un fournisseur ne peut pas se prétendre capable de ce qu'il n'a
 * pas.
 */
const api = new TestApi();

let buyer: any;
let sellerCm: any;
let sellerTd: any;
let storeCm: string;
let storeTd: string;
let keyword: string;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
  keyword = `sourcingkw${Date.now()}`;

  sellerCm = await registerUser(api, { name: 'Fournisseur CM', email: uniqueEmail('so-cm'), role: 'SELLER', countryCode: 'CM' });
  storeCm = (await api.post('/api/v1/stores', { name: `Cacao Douala ${Date.now()}`, countryCode: 'CM', city: 'Douala' }, sellerCm.accessToken)).body.id;
  await api.patch(`/api/v1/stores/${storeCm}`, { status: 'ACTIVE' }, sellerCm.accessToken);
  // Gros volume disponible.
  await api.post(
    '/api/v1/products',
    { storeId: storeCm, title: `Cacao en fèves ${keyword}`, price: '2500', quantity: 5000, minOrderQty: 50, weightGrams: 1000, status: 'ACTIVE' },
    sellerCm.accessToken,
  );

  sellerTd = await registerUser(api, { name: 'Fournisseur TD', email: uniqueEmail('so-td'), role: 'SELLER', countryCode: 'TD' });
  storeTd = (await api.post('/api/v1/stores', { name: `Sésame N'Djamena ${Date.now()}`, countryCode: 'TD' }, sellerTd.accessToken)).body.id;
  await api.patch(`/api/v1/stores/${storeTd}`, { status: 'ACTIVE' }, sellerTd.accessToken);
  // Petit stock : incapable de servir un gros volume.
  await api.post(
    '/api/v1/products',
    { storeId: storeTd, title: `Cacao torréfié ${keyword}`, price: '1800', quantity: 20, minOrderQty: 5, weightGrams: 1000, status: 'ACTIVE' },
    sellerTd.accessToken,
  );

  buyer = await registerUser(api, { name: 'Acheteur gros', email: uniqueEmail('so-buyer'), role: 'BUYER', countryCode: 'TD' });
});
after(async () => api.stop());

describe('Recherche de fournisseurs', () => {
  it('trouve les fournisseurs d’un produit, sans compte', async () => {
    const res = await api.get(`/api/v1/sourcing/suppliers?q=${keyword}`);
    assert.equal(res.status, 200, 'le sourcing est consultable sans compte');
    const ids = res.body.items.map((i: any) => i.store.id);
    assert.ok(ids.includes(storeCm));
    assert.ok(ids.includes(storeTd));
  });

  it('annonce la capacité réellement en stock, pas une capacité déclarée', async () => {
    const res = await api.get(`/api/v1/sourcing/suppliers?q=${keyword}`);
    const cm = res.body.items.find((i: any) => i.store.id === storeCm);
    const td = res.body.items.find((i: any) => i.store.id === storeTd);
    assert.equal(cm.capacity, 5000);
    assert.equal(td.capacity, 20);
    assert.equal(cm.minOrderQty, 50);
  });

  it('écarte du volume demandé le fournisseur qui ne peut pas le servir', async () => {
    const res = await api.get(`/api/v1/sourcing/suppliers?q=${keyword}&minQuantity=1000`);
    const cm = res.body.items.find((i: any) => i.store.id === storeCm);
    const td = res.body.items.find((i: any) => i.store.id === storeTd);
    assert.equal(cm.servesRequestedQuantity, true);
    assert.equal(td.servesRequestedQuantity, false, '20 unités ne couvrent pas une demande de 1000');
    // Le fournisseur reste listé — l'acheteur décide, on ne le cache pas.
    assert.ok(td);
  });

  it('filtre par pays du fournisseur', async () => {
    const res = await api.get(`/api/v1/sourcing/suppliers?q=${keyword}&country=CM`);
    const ids = res.body.items.map((i: any) => i.store.id);
    assert.ok(ids.includes(storeCm));
    assert.ok(!ids.includes(storeTd));
  });

  it('ne prétend pas desservir un pays sans expédition réelle', async () => {
    const res = await api.get(`/api/v1/sourcing/suppliers?q=${keyword}&destination=TD`);
    const cm = res.body.items.find((i: any) => i.store.id === storeCm);
    // Aucune expédition réalisée : le pays n'est pas annoncé comme desservi.
    assert.equal(cm.servesDestination, false);
    assert.deepEqual(cm.servedCountries, []);
  });

  it('trie par capacité et par prix', async () => {
    const byCapacity = await api.get(`/api/v1/sourcing/suppliers?q=${keyword}&sort=capacity`);
    assert.equal(byCapacity.body.items[0].store.id, storeCm);

    const byPrice = await api.get(`/api/v1/sourcing/suppliers?q=${keyword}&sort=price`);
    assert.equal(byPrice.body.items[0].store.id, storeTd, 'le moins cher d’abord');
  });

  it('compte une expédition même si la commande a été remboursée ensuite', async () => {
    // Le fait qu'une boutique ait su livrer un corridor ne s'efface pas parce
    // que l'acheteur a été remboursé après coup.
    const order = await prisma.toumaOrder.findFirst({ where: { storeId: storeCm } });
    if (!order) {
      // Aucune commande dans ce jeu de données : on en fabrique une expédiée puis remboursée.
      await prisma.toumaOrder.create({
        data: {
          orderNumber: `TEST-${Date.now()}`,
          buyerId: buyer.user.id,
          storeId: storeCm,
          status: 'REFUNDED',
          currency: 'XAF',
          subtotal: '1000',
          total: '1000',
          shippingSnapshot: {},
          buyerCountry: 'TD',
          shippedAt: new Date(),
          deliveredAt: new Date(),
        },
      });
    }
    const res = await api.get(`/api/v1/sourcing/suppliers/${storeCm}`);
    const expected = await prisma.toumaOrder.count({
      where: { storeId: storeCm, OR: [{ shippedAt: { not: null } }, { deliveredAt: { not: null } }] },
    });
    assert.equal(res.body.shippedOrders, expected);
    if (expected > 0) assert.ok(res.body.servedCountries.includes('TD'));
  });

  it('présente une fiche fournisseur fondée sur des faits', async () => {
    const res = await api.get(`/api/v1/sourcing/suppliers/${storeCm}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.store.countryCode, 'CM');
    assert.equal(res.body.totalCapacity, 5000);
    assert.equal(res.body.quotesSent, 0);
    // La réputation est celle du module dédié, avec sa règle de volume minimal.
    assert.equal(res.body.reputation.published, false);
  });
});

describe('Sollicitation de fournisseurs', () => {
  let rfqId: string;

  it('invite des fournisseurs repérés et les prévient', async () => {
    const rfq = await api.post(
      '/api/v1/rfqs',
      {
        title: 'Besoin de 2 tonnes de cacao',
        countryCode: 'TD',
        currency: 'XAF',
        items: [{ name: 'Cacao en fèves', quantity: 2000, unit: 'kg' }],
      },
      buyer.accessToken,
    );
    assert.equal(rfq.status, 201);
    rfqId = rfq.body.id;

    const invited = await api.post(
      `/api/v1/rfqs/${rfqId}/invitations`,
      { storeIds: [storeCm, storeTd], message: 'Pouvez-vous nous servir ?' },
      buyer.accessToken,
    );
    assert.equal(invited.status, 201);
    assert.equal(invited.body.invited, 2);
    assert.equal(invited.body.items.length, 2);

    // Le fournisseur est réellement notifié.
    const notifications = await api.get('/api/v1/notifications', sellerCm.accessToken);
    assert.ok(notifications.body.items.some((n: any) => n.body.includes('2 tonnes de cacao')));
  });

  it('n’invite pas deux fois le même fournisseur', async () => {
    const again = await api.post(`/api/v1/rfqs/${rfqId}/invitations`, { storeIds: [storeCm] }, buyer.accessToken);
    assert.equal(again.body.invited, 0);
    assert.equal(again.body.alreadyInvited, 1);
    assert.equal(await prisma.toumaRfqInvitation.count({ where: { rfqId, storeId: storeCm } }), 1);
  });

  it('réserve l’invitation à l’auteur de l’appel d’offres', async () => {
    const res = await api.post(`/api/v1/rfqs/${rfqId}/invitations`, { storeIds: [storeCm] }, sellerCm.accessToken);
    assert.equal(res.status, 404);
  });

  it('permet au fournisseur de retrouver les demandes où il est sollicité', async () => {
    const invited = await api.get('/api/v1/rfqs?scope=invited', sellerCm.accessToken);
    assert.equal(invited.status, 200);
    assert.ok(invited.body.items.some((r: any) => r.id === rfqId));

    // Un vendeur non sollicité ne voit rien dans cette portée.
    const stranger = await registerUser(api, { name: 'Vendeur tiers', email: uniqueEmail('so-x'), role: 'SELLER', countryCode: 'TD' });
    assert.equal((await api.get('/api/v1/rfqs?scope=invited', stranger.accessToken)).body.items.length, 0);

    // Et la portée exige un compte.
    assert.equal((await api.get('/api/v1/rfqs?scope=invited')).status, 401);
  });

  it('montre à l’acheteur qui il a sollicité', async () => {
    const rfq = await api.get(`/api/v1/rfqs/${rfqId}`, buyer.accessToken);
    assert.equal(rfq.body.invitedSuppliers.length, 2);
  });
});

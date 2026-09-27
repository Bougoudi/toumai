import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Moyens de paiement et sondes (V20).
 *
 * Le §80 gouverne ce fichier : **ne jamais déclarer « paiement disponible » si
 * aucun prestataire réel n'est connecté**. Un adaptateur présent dans le code
 * n'est pas un moyen de paiement ouvert.
 */
const api = new TestApi();

let buyer: any;
let autre: any;
let seller: any;
let storeId: string;
let orderId: string;
const reglesPosees: string[] = [];

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  seller = await registerUser(api, { name: 'Vendeur moyens', email: uniqueEmail('mm-seller'), role: 'SELLER', countryCode: 'TD' });
  storeId = (await api.post('/api/v1/stores', { name: `Boutique moyens ${Date.now()}`, countryCode: 'TD' }, seller.accessToken)).body.id;
  await prisma.toumaStore.update({ where: { id: storeId }, data: { status: 'ACTIVE' } });

  buyer = await registerUser(api, { name: 'Acheteur moyens', email: uniqueEmail('mm-buyer'), role: 'BUYER', countryCode: 'TD' });
  buyer.addressId = (
    await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Acheteur moyens', phone: '+23566000999', line1: 'Rue du Lac', city: "N'Djamena", countryCode: 'TD' },
      buyer.accessToken,
    )
  ).body.id;

  autre = await registerUser(api, { name: 'Tiers moyens', email: uniqueEmail('mm-tiers'), role: 'BUYER', countryCode: 'TD' });

  const produit = (
    await api.post(
      '/api/v1/products',
      { storeId, title: `Article moyens ${Date.now()}`, price: '8000', quantity: 10, weightGrams: 600, status: 'ACTIVE' },
      seller.accessToken,
    )
  ).body.id;
  await api.post('/api/v1/cart/items', { productId: produit, quantity: 1 }, buyer.accessToken);
  const checkout = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  orderId = checkout.body.orders[0].id;
});

after(async () => {
  await prisma.toumaCodRule.deleteMany({ where: { id: { in: reglesPosees } } });
  await api.stop();
});

describe('GET /payments/methods', () => {
  it('dit toujours si le prestataire est réel, et le nomme', async () => {
    const res = await api.get('/api/v1/payments/methods?country=TD&currency=XAF', buyer.accessToken);
    assert.equal(res.status, 200);
    // En développement et en test, l'adaptateur est une simulation. Le dire est
    // le contraire de « paiement disponible ».
    assert.equal(res.body.provider.real, false);
    assert.match(res.body.provider.message, /simulation/i);
  });

  it('marque comme simulées les méthodes portées par un adaptateur de démonstration', async () => {
    const res = await api.get('/api/v1/payments/methods?country=TD&currency=XAF', buyer.accessToken);
    const mm = res.body.methods.find((m: any) => m.method === 'MOBILE_MONEY');
    assert.ok(mm);
    assert.equal(mm.simulated, true, 'aucun mouvement d’argent réel ne se produit');
  });

  it('rend chaque méthode fermée avec son motif, jamais en la taisant', async () => {
    // Pays volontairement non configuré : les règles d'encaissement du Tchad
    // appartiennent à `chad-payments.test.ts`, et se les disputer ici rendrait
    // les deux suites dépendantes de leur ordre d'exécution.
    const res = await api.get('/api/v1/payments/methods?country=NE&currency=XAF', buyer.accessToken);
    const fermees = res.body.methods.filter((m: any) => !m.available);
    assert.ok(fermees.length > 0, 'le paiement à la livraison est fermé là où aucune règle ne l’ouvre');
    for (const m of fermees) {
      assert.ok(m.reason && m.reason.length > 0, `${m.method} est fermée sans motif`);
    }
  });

  it('ferme le paiement à la livraison tant qu’aucune règle ne l’ouvre, puis l’ouvre', async () => {
    const cod = (body: any) => body.methods.find((m: any) => m.method === 'CASH_ON_DELIVERY');

    const avant = await api.get('/api/v1/payments/methods?country=NE&currency=XAF', buyer.accessToken);
    assert.equal(cod(avant.body).available, false);

    const regle = await prisma.toumaCodRule.create({ data: { countryCode: 'NE', allowed: true, maxAmount: new Prisma.Decimal('100000') } });
    reglesPosees.push(regle.id);

    const apres = await api.get('/api/v1/payments/methods?country=NE&currency=XAF', buyer.accessToken);
    assert.equal(cod(apres.body).available, true);
    assert.equal(cod(apres.body).maxAmount, '100000', 'le plafond vient de la règle, pas d’un défaut');
  });

  it('refuse de statuer sur le paiement à la livraison sans destination', async () => {
    // Ne pas deviner : il dépend du pays, de la province, de la boutique.
    const res = await api.get('/api/v1/payments/methods', buyer.accessToken);
    const cod = res.body.methods.find((m: any) => m.method === 'CASH_ON_DELIVERY');
    assert.equal(cod.available, false);
    assert.match(cod.reason, /pays de livraison/i);
  });

  it('déduit le contexte de la commande, montant compris', async () => {
    const res = await api.get(`/api/v1/payments/methods?order=${orderId}`, buyer.accessToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.countryCode, 'TD');
    assert.equal(res.body.currency, 'XAF');
    assert.ok(res.body.amount && Number(res.body.amount) > 0);
  });

  it('répond « introuvable » sur la commande d’autrui, jamais « interdit »', async () => {
    const res = await api.get(`/api/v1/payments/methods?order=${orderId}`, autre.accessToken);
    assert.equal(res.status, 404);
  });

  it('exige une session', async () => {
    const res = await api.get('/api/v1/payments/methods?country=TD');
    assert.equal(res.status, 401);
  });
});

describe('Sondes sous /api/v1', () => {
  it('/health dit que le processus vit', async () => {
    const res = await api.get('/api/v1/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.version, 'v1');
  });

  it('/ready vérifie les dépendances et ne masque pas l’état du prestataire', async () => {
    const res = await api.get('/api/v1/ready');
    assert.equal(res.status, 200, 'PostgreSQL est joignable pendant les tests');
    assert.equal(res.body.ready, true);
    assert.ok(res.body.dependencies.some((d: any) => d.name === 'postgres' && d.status === 'ok'));
    // Une sonde qui laisserait croire qu'un prestataire agréé est raccordé
    // tromperait la personne d'astreinte au pire moment.
    assert.equal(res.body.adapters.paymentsReal, false);
    assert.ok(res.body.adapters.paymentsMessage);
  });

  it('l’index de l’API annonce un taux de repli, pas « le » taux', async () => {
    const res = await api.get('/api/v1');
    assert.equal(res.status, 200);
    assert.ok(res.body.defaultCommissionRate !== undefined);
    assert.equal(res.body.commissionRate, undefined, 'un chiffre unique laisserait croire qu’il n’en existe qu’un');
    assert.equal(res.body.endpoints.paymentMethods, '/api/v1/payments/methods');
  });
});

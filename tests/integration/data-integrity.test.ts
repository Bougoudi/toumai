import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { integrityService } from '../../src/touma/admin/integrity.service.js';
import { libererReservation } from '../../src/touma/orders/reservation-counter.js';

/**
 * INTÉGRITÉ DES DONNÉES (V25 §83).
 *
 * Un contrôle d'intégrité qui ne trouve jamais rien est indiscernable d'un
 * contrôle cassé. Ces tests fabriquent donc de vraies incohérences et
 * vérifient qu'elles sont bien vues — puis que le compteur de réservation ne
 * peut plus repasser sous zéro.
 */
const api = new TestApi();

let admin: any;
let vendeur: any;
let storeId: string;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  vendeur = await registerUser(api, { name: 'Vendeur intégrité', email: uniqueEmail('int-v'), role: 'SELLER' });
  storeId = (await api.post('/api/v1/stores', { name: `Boutique intégrité ${Date.now()}`, countryCode: 'TD' }, vendeur.accessToken)).body.id;

  admin = await registerUser(api, { name: 'Admin intégrité', email: uniqueEmail('int-a'), role: 'BUYER' });
  await promoteToAdmin(admin.user.id);
  admin.accessToken = (await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password })).body.accessToken;
});
after(async () => api.stop());

describe('Le contrôle voit réellement les incohérences', () => {
  it('repère un stock négatif fabriqué pour l’occasion', async () => {
    const produit = (
      await api.post('/api/v1/products', { storeId, title: `Sonde stock ${Date.now()}`, price: '1000', quantity: 3, status: 'ACTIVE' }, vendeur.accessToken)
    ).body.id;
    // Incohérence posée à la main : un contrôle qui ne trouve jamais rien est
    // indiscernable d'un contrôle cassé.
    await prisma.toumaInventory.updateMany({ where: { productId: produit }, data: { quantity: -4 } });

    const rapport = await integrityService.run();
    const stock = rapport.issues.find((i) => i.code === 'INVENTORY_NEGATIVE');
    assert.ok(stock, 'le stock négatif doit être signalé');
    assert.equal(stock.severity, 'CRITIQUE');
    assert.ok(stock.count > 0);
    assert.equal(rapport.status, 'CRITICAL');

    await prisma.toumaInventory.updateMany({ where: { productId: produit }, data: { quantity: 3 } });
  });

  it('dit combien d’invariants il a contrôlés, même sans rien trouver', async () => {
    const rapport = await integrityService.run();
    // « Rien à signaler » ne vaut que rapporté à ce qui a été vérifié (§89).
    assert.ok(rapport.checked >= 10);
    assert.equal(rapport.checked, integrityService.catalogue().length);
    for (const invariant of integrityService.catalogue()) {
      assert.ok(invariant.invariant.length > 0, `${invariant.code} doit énoncer son invariant`);
    }
  });

  it('ne déclare jamais « sain » quand une requête de contrôle a échoué', async () => {
    const rapport = await integrityService.run();
    if (rapport.failures.length > 0) assert.notEqual(rapport.status, 'HEALTHY');
    // Et en exploitation courante, aucune requête ne doit échouer : un nom de
    // table erroné passerait pour un contrôle effectué.
    assert.deepEqual(rapport.failures, [], `requêtes en échec : ${JSON.stringify(rapport.failures)}`);
  });
});

describe('Le compteur de réservation ne repasse plus sous zéro', () => {
  it('une libération excédentaire ne creuse pas le compteur', async () => {
    const produit = (
      await api.post('/api/v1/products', { storeId, title: `Sonde réservation ${Date.now()}`, price: '1000', quantity: 5, status: 'ACTIVE' }, vendeur.accessToken)
    ).body.id;

    // Deux libérations pour une seule prise : c'est la forme exacte des 101
    // lignes à `reserved = -1` trouvées en base de test.
    await prisma.$transaction(async (tx) => {
      await libererReservation(tx, { productId: produit, variantId: null, quantity: 1, restock: false });
      await libererReservation(tx, { productId: produit, variantId: null, quantity: 1, restock: false });
    });

    const ligne = await prisma.toumaInventory.findFirstOrThrow({ where: { productId: produit, variantId: null } });
    assert.equal(ligne.reserved, 0, 'la libération excédentaire est sans effet au-delà de zéro');
    assert.equal(ligne.quantity, 5, 'sans remise en stock, la quantité ne bouge pas');
  });

  it('libère bien ce qui était réservé, et remet en stock quand on le demande', async () => {
    const produit = (
      await api.post('/api/v1/products', { storeId, title: `Sonde libération ${Date.now()}`, price: '1000', quantity: 5, status: 'ACTIVE' }, vendeur.accessToken)
    ).body.id;
    await prisma.toumaInventory.updateMany({ where: { productId: produit }, data: { quantity: 3, reserved: 2 } });

    await prisma.$transaction(async (tx) => {
      await libererReservation(tx, { productId: produit, variantId: null, quantity: 2, restock: true });
    });

    const ligne = await prisma.toumaInventory.findFirstOrThrow({ where: { productId: produit, variantId: null } });
    assert.equal(ligne.reserved, 0);
    assert.equal(ligne.quantity, 5, 'les deux unités réservées sont revenues en stock');
  });
});

describe('Accès', () => {
  it('l’écran d’intégrité demande ADMIN_SYSTEM', async () => {
    assert.equal((await api.request('GET', '/api/v1/admin/data-integrity')).status, 401);
    assert.equal((await api.request('GET', '/api/v1/admin/data-integrity', { token: vendeur.accessToken })).status, 403);

    const res = await api.request('GET', '/api/v1/admin/data-integrity', { token: admin.accessToken });
    assert.equal(res.status, 200);
    assert.ok(['HEALTHY', 'WARNING', 'CRITICAL'].includes(res.body.status));
    assert.ok(Array.isArray(res.body.issues));
  });
});

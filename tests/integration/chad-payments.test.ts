import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { entriesFor } from '../../src/touma/finance/ledger.js';
import { loadGeography } from '../../src/touma/geo/geography.loader.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Paiement à la livraison et retrait en point relais (V17).
 *
 * Deux promesses qui n'étaient pas tenues : une commande « payée » sans qu'un
 * franc ait changé de mains, et un colis remis à qui connaissait le numéro de
 * commande.
 */
const api = new TestApi();

let buyer: any;
let seller: any;
let admin: any;
let storeId: string;
let provinceId: string;
let pickupPointId: string;

/** Prépare un panier prêt à payer, et rend la commande créée. */
async function panierPret(deliveryMethod: 'HOME' | 'PICKUP_POINT' = 'HOME') {
  const produit = (
    await api.post(
      '/api/v1/products',
      { storeId, title: `Article ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, price: '15000', quantity: 20, weightGrams: 800, status: 'ACTIVE' },
      seller.accessToken,
    )
  ).body.id;
  await api.post('/api/v1/cart/items', { productId: produit, quantity: 1 }, buyer.accessToken);

  const body: Record<string, unknown> = { addressId: buyer.addressId, deliveryMethod };
  if (deliveryMethod === 'PICKUP_POINT') body.pickupPointId = pickupPointId;
  return api.post('/api/v1/checkout', body, buyer.accessToken);
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
  await loadGeography('TD');

  seller = await registerUser(api, { name: 'Vendeur COD', email: uniqueEmail('cod-seller'), role: 'SELLER', countryCode: 'TD' });
  buyer = await registerUser(api, { name: 'Acheteur COD', email: uniqueEmail('cod-buyer'), role: 'BUYER', countryCode: 'TD' });
  admin = await registerUser(api, { name: 'Admin COD', email: uniqueEmail('cod-admin'), role: 'BUYER', countryCode: 'TD' });
  await promoteToAdmin(admin.user.id);
  admin.accessToken = (await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password })).body.accessToken;

  buyer.addressId = (
    await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Acheteur COD', phone: '+23566000111', line1: 'Rue du marché', district: 'Dembé', city: "N'Djamena", countryCode: 'TD' },
      buyer.accessToken,
    )
  ).body.id;

  storeId = (
    await api.post('/api/v1/stores', { name: `Boutique COD ${Date.now()}`, countryCode: 'TD' }, seller.accessToken)
  ).body.id;
  await prisma.toumaStore.update({ where: { id: storeId }, data: { status: 'ACTIVE' } });

  const province = await prisma.toumaProvince.findFirst({ where: { countryCode: 'TD' }, select: { id: true } });
  provinceId = province!.id;
  await prisma.toumaAddress.update({ where: { id: buyer.addressId }, data: { provinceId } });

  const point = await prisma.toumaPickupPoint.create({
    data: {
      code: `TEST-${Date.now()}`,
      name: 'Relais de test',
      countryCode: 'TD',
      city: "N'Djamena",
      addressLine: 'Avenue de test',
      provinceId,
      active: true,
    },
  });
  pickupPointId = point.id;

  // La base n'est pas remise à zéro entre deux passages : une règle laissée par
  // un passage précédent ferait mentir le test « fermé tant que rien n'ouvre ».
  await prisma.toumaCodRule.deleteMany({});
});

after(async () => {
  await api.stop();
});

describe('Paiement à la livraison', () => {
  it('est fermé tant qu’aucune règle ne l’ouvre', async () => {
    // Encaisser du liquide engage un vendeur et un livreur : cela ne s'active
    // pas par oubli de configuration.
    const checkout = await panierPret();
    const res = await api.post(
      '/api/v1/payments/create',
      { orderGroupId: checkout.body.group.id, method: 'CASH_ON_DELIVERY' },
      buyer.accessToken,
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /pas ouvert/i);
  });

  it('ne rend jamais la commande « payée » avant que l’argent ait changé de mains', async () => {
    await prisma.toumaCodRule.create({ data: { countryCode: 'TD', allowed: true, active: true } });

    const checkout = await panierPret();
    const orderId = checkout.body.orders[0].id;
    const paiement = await api.post(
      '/api/v1/payments/create',
      { orderGroupId: checkout.body.group.id, method: 'CASH_ON_DELIVERY' },
      buyer.accessToken,
    );
    assert.equal(paiement.status, 201);

    // Le défaut corrigé : la commande passait à PAID, la facture était émise et
    // la vente entrait au registre — avant tout encaissement.
    const commande = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: orderId } });
    assert.equal(commande.status, 'PENDING', 'la commande n’est pas dite payée');
    assert.equal(commande.paidAt, null, 'aucune date de paiement');

    const registre = await entriesFor('ToumaOrder', orderId);
    assert.deepEqual(registre, [], 'aucune ligne au registre tant que rien n’est encaissé');

    // Et le montant à collecter est suivi : sans lui, personne ne sait combien
    // le livreur doit rapporter.
    const suivi = await api.get(`/api/v1/payments/${paiement.body.payment.id}/cash`, seller.accessToken);
    assert.equal(suivi.status, 200);
    assert.equal(suivi.body.status, 'COD_PENDING');
    assert.equal(suivi.body.amountDue, checkout.body.group.total);
  });

  it('refuse que l’acheteur confirme lui-même son paiement', async () => {
    const checkout = await panierPret();
    const paiement = await api.post(
      '/api/v1/payments/create',
      { orderGroupId: checkout.body.group.id, method: 'CASH_ON_DELIVERY' },
      buyer.accessToken,
    );

    // C'était exactement le chemin du mensonge : l'adaptateur répondait
    // SUCCEEDED comme pour n'importe quelle méthode.
    const confirme = await api.post('/api/v1/payments/confirm', { paymentId: paiement.body.payment.id }, buyer.accessToken);
    assert.equal(confirme.status, 409);
    assert.match(confirme.body.error, /remise de l’argent/i);

    // Et il ne constate pas non plus l'encaissement : déclarer soi-même avoir
    // payé n'est pas une preuve de paiement.
    const collecte = await api.post(`/api/v1/payments/${paiement.body.payment.id}/cash/collect`, {}, buyer.accessToken);
    assert.equal(collecte.status, 403);
  });

  it('fait entrer l’argent au registre au moment où le vendeur le constate, et pas avant', async () => {
    const checkout = await panierPret();
    const orderId = checkout.body.orders[0].id;
    const paymentId = (
      await api.post('/api/v1/payments/create', { orderGroupId: checkout.body.group.id, method: 'CASH_ON_DELIVERY' }, buyer.accessToken)
    ).body.payment.id;

    assert.deepEqual(await entriesFor('ToumaOrder', orderId), [], 'rien avant');

    const collecte = await api.post(`/api/v1/payments/${paymentId}/cash/collect`, {}, seller.accessToken);
    assert.equal(collecte.status, 200);
    assert.equal(collecte.body.status, 'COD_COLLECTED');
    assert.ok(collecte.body.amountCollected, 'le montant collecté est consigné');

    const registre = await entriesFor('ToumaOrder', orderId);
    assert.ok(registre.length > 0, 'la vente entre au registre une fois l’argent remis');
    assert.ok(registre.some((e: any) => e.type === 'SALE'), 'la vente y figure');

    const commande = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: orderId } });
    assert.equal(commande.status, 'PAID', 'la commande devient payée, maintenant que c’est vrai');
  });

  it('refuse un encaissement supérieur au montant dû', async () => {
    const checkout = await panierPret();
    const paymentId = (
      await api.post('/api/v1/payments/create', { orderGroupId: checkout.body.group.id, method: 'CASH_ON_DELIVERY' }, buyer.accessToken)
    ).body.payment.id;

    // Encaisser plus que la commande n'est pas une bonne nouvelle : c'est une
    // erreur de saisie, ou pire.
    const res = await api.post(`/api/v1/payments/${paymentId}/cash/collect`, { amount: '9999999' }, seller.accessToken);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /dépasse le montant dû/i);
  });

  it('respecte le plafond d’une règle, et l’interdiction d’une province', async () => {
    await prisma.toumaCodRule.deleteMany({});
    await prisma.toumaCodRule.create({ data: { countryCode: 'TD', allowed: true, active: true, maxAmount: '1000' } });

    const checkout = await panierPret();
    const res = await api.post(
      '/api/v1/payments/create',
      { orderGroupId: checkout.body.group.id, method: 'CASH_ON_DELIVERY' },
      buyer.accessToken,
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /limité à/i);

    // Une interdiction ferme une province sans défaire le reste.
    await prisma.toumaCodRule.deleteMany({});
    await prisma.toumaCodRule.create({ data: { countryCode: 'TD', allowed: true, active: true } });
    await prisma.toumaCodRule.create({ data: { countryCode: 'TD', provinceId, allowed: false, active: true, note: 'Province fermée pour essai.' } });

    const checkout2 = await panierPret();
    const res2 = await api.post(
      '/api/v1/payments/create',
      { orderGroupId: checkout2.body.group.id, method: 'CASH_ON_DELIVERY' },
      buyer.accessToken,
    );
    assert.equal(res2.status, 400);
    assert.match(res2.body.error, /Province fermée/i);

    await prisma.toumaCodRule.deleteMany({});
    await prisma.toumaCodRule.create({ data: { countryCode: 'TD', allowed: true, active: true } });
  });
});

describe('Retrait en point relais', () => {
  it('rend un code à l’acheteur, une seule fois, et n’écrit que son empreinte', async () => {
    const checkout = await panierPret('PICKUP_POINT');
    assert.equal(checkout.status, 201);
    assert.equal(checkout.body.pickupCodes.length, 1, 'un code par commande à retirer');
    const code = checkout.body.pickupCodes[0].code;
    assert.match(code, /^[0-9]{6}$/, 'six chiffres : cela se dicte au téléphone');

    const orderId = checkout.body.pickupCodes[0].orderId;
    const commande = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: orderId } });
    assert.ok(commande.pickupCodeHash, 'une empreinte est stockée');
    assert.notEqual(commande.pickupCodeHash, code, 'le code en clair n’est jamais en base');
    assert.equal(/^[0-9]{6}$/.test(commande.pickupCodeHash!), false, 'ce n’est pas le code déguisé');

    // Et il ne ressort jamais d'une lecture de commande.
    const lecture = await api.get(`/api/v1/orders/${orderId}`, buyer.accessToken);
    assert.equal(/pickupCodeHash/.test(JSON.stringify(lecture.body)), false, 'l’empreinte ne sort pas non plus');
  });

  it('ne remet le colis que contre le bon code', async () => {
    const checkout = await panierPret('PICKUP_POINT');
    const { orderId, code } = checkout.body.pickupCodes[0];

    const faux = await api.post(`/api/v1/pickup-points/orders/${orderId}/release`, { code: '000000' }, seller.accessToken);
    assert.equal(faux.status, 400, 'un code faux ne remet rien');

    const vide = await api.post(`/api/v1/pickup-points/orders/${orderId}/release`, {}, seller.accessToken);
    assert.equal(vide.status, 400, 'connaître le numéro de commande ne suffit plus');

    const bon = await api.post(`/api/v1/pickup-points/orders/${orderId}/release`, { code }, seller.accessToken);
    assert.equal(bon.status, 200);
    assert.equal(bon.body.status, 'DELIVERED');

    // Un colis ne se remet pas deux fois.
    const rejoue = await api.post(`/api/v1/pickup-points/orders/${orderId}/release`, { code }, seller.accessToken);
    assert.equal(rejoue.status, 409);
  });

  it('lie le code à sa commande : un code juste ailleurs ne vaut rien ici', async () => {
    const a = await panierPret('PICKUP_POINT');
    const b = await panierPret('PICKUP_POINT');

    const res = await api.post(
      `/api/v1/pickup-points/orders/${b.body.pickupCodes[0].orderId}/release`,
      { code: a.body.pickupCodes[0].code },
      seller.accessToken,
    );
    assert.equal(res.status, 400, 'le code d’une autre commande est refusé');
  });

  it('reste introuvable pour un vendeur étranger au dossier', async () => {
    const autre = await registerUser(api, { name: 'Autre vendeur', email: uniqueEmail('cod-seller2'), role: 'SELLER', countryCode: 'TD' });
    const checkout = await panierPret('PICKUP_POINT');
    const { orderId, code } = checkout.body.pickupCodes[0];

    const res = await api.post(`/api/v1/pickup-points/orders/${orderId}/release`, { code }, autre.accessToken);
    // Anti-IDOR : « introuvable », jamais « interdit ».
    assert.equal(res.status, 404);
  });
});

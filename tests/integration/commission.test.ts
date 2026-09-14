import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '../../src/db/prisma.js';
import { env } from '../../src/config/env.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { commissionFor, resolveCommission } from '../../src/touma/payments/commission.service.js';

/**
 * Commission paramétrable (V20).
 *
 * Le taux était une variable d'environnement unique : impossible d'accorder un
 * taux négocié à un vendeur, d'abaisser celui d'une catégorie à faible marge ou
 * d'ouvrir un pays avec un taux d'appel — sinon en changeant le taux de **tout
 * le monde à la fois**, y compris pour des factures pas encore émises.
 */
const api = new TestApi();

let admin: any;
let seller: any;
let buyer: any;
let storeId: string;
let categoryId: string;

/** Supprime les règles posées par un test : elles fausseraient les suivants. */
const posees: string[] = [];
async function poser(data: Prisma.ToumaCommissionRuleUncheckedCreateInput) {
  const rule = await prisma.toumaCommissionRule.create({ data });
  posees.push(rule.id);
  return rule;
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  seller = await registerUser(api, { name: 'Vendeur commission', email: uniqueEmail('com-seller'), role: 'SELLER', countryCode: 'TD' });
  storeId = (await api.post('/api/v1/stores', { name: `Boutique commission ${Date.now()}`, countryCode: 'TD' }, seller.accessToken)).body.id;
  await prisma.toumaStore.update({ where: { id: storeId }, data: { status: 'ACTIVE' } });

  buyer = await registerUser(api, { name: 'Acheteur commission', email: uniqueEmail('com-buyer'), role: 'BUYER', countryCode: 'TD' });
  buyer.addressId = (
    await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Acheteur commission', phone: '+23566000888', line1: 'Rue de la paix', city: "N'Djamena", countryCode: 'TD' },
      buyer.accessToken,
    )
  ).body.id;

  admin = await registerUser(api, { name: 'Admin commission', email: uniqueEmail('com-admin'), role: 'BUYER', countryCode: 'TD' });
  await promoteToAdmin(admin.user.id);
  admin.accessToken = (await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password })).body.accessToken;

  categoryId = (await prisma.toumaCategory.findFirstOrThrow({ select: { id: true } })).id;
});

after(async () => {
  await prisma.toumaCommissionRule.deleteMany({ where: { id: { in: posees } } });
  await api.stop();
});

describe('La résolution du taux', () => {
  it('retombe sur la configuration quand aucune règle ne couvre la commande', async () => {
    // L'absence de règle ne doit pas faire tomber la commission à zéro :
    // ce serait offrir la plateforme par oubli de configuration.
    const d = await resolveCommission({ countryCode: 'TD', storeId, currency: 'XAF' });
    assert.equal(d.ruleId, null);
    assert.equal(d.scope, 'GLOBAL');
    assert.equal(d.rate.toString(), new Prisma.Decimal(env.touma.commissionRate.toString()).toString());
  });

  it('fait primer la règle la plus précise : boutique > catégorie > pays > globale', async () => {
    await poser({ rate: new Prisma.Decimal('0.09') });
    await poser({ countryCode: 'TD', rate: new Prisma.Decimal('0.07') });
    await poser({ categoryId, rate: new Prisma.Decimal('0.06') });
    await poser({ storeId, rate: new Prisma.Decimal('0.03'), note: 'Taux négocié 2026.' });

    assert.equal((await resolveCommission({ currency: 'XAF' })).rate.toString(), '0.09');
    assert.equal((await resolveCommission({ countryCode: 'TD', currency: 'XAF' })).rate.toString(), '0.07');
    assert.equal((await resolveCommission({ countryCode: 'TD', categoryIds: [categoryId], currency: 'XAF' })).rate.toString(), '0.06');

    const boutique = await resolveCommission({ countryCode: 'TD', categoryIds: [categoryId], storeId, currency: 'XAF' });
    assert.equal(boutique.rate.toString(), '0.03');
    assert.equal(boutique.scope, 'STORE');
    assert.equal(boutique.explanation, 'Taux négocié 2026.', 'le motif posé par l’exploitant est rendu tel quel');
  });

  it('ignore une règle hors de sa période de validité', async () => {
    const hier = new Date(Date.now() - 48 * 3600 * 1000);
    await poser({ storeId, rate: new Prisma.Decimal('0.02'), effectiveFrom: hier, effectiveUntil: new Date(Date.now() - 3600 * 1000) });
    await poser({ storeId, rate: new Prisma.Decimal('0.04'), effectiveFrom: new Date(Date.now() + 7 * 24 * 3600 * 1000) });

    // Ni la règle close ni celle qui n'a pas commencé.
    const maintenant = await resolveCommission({ storeId, currency: 'XAF' });
    assert.ok(!['0.02', '0.04'].includes(maintenant.rate.toString()), `taux inattendu : ${maintenant.rate}`);

    // Mais la règle close reste consultable à sa date : une commande passée
    // doit rester explicable par la règle qui l'a produite.
    const alors = await resolveCommission({ storeId, currency: 'XAF', at: new Date(Date.now() - 24 * 3600 * 1000) });
    assert.equal(alors.rate.toString(), '0.02');
  });

  it('écarte une règle dont les bornes sont dans une autre devise', async () => {
    // Convertir sans taux officiel produirait un plafond inventé — et un
    // plafond inventé sur une commission est une erreur sur de l'argent réel.
    await poser({ storeId, rate: new Prisma.Decimal('0.01'), maxFee: new Prisma.Decimal('5'), feeCurrency: 'EUR' });

    const enFrancs = await resolveCommission({ storeId, currency: 'XAF' });
    assert.notEqual(enFrancs.rate.toString(), '0.01', 'la règle en euros ne s’applique pas à une commande en francs');

    const enEuros = await resolveCommission({ storeId, currency: 'EUR' });
    assert.equal(enEuros.rate.toString(), '0.01');
  });
});

describe('Le montant de commission', () => {
  it('applique le plancher et le plafond de la règle', async () => {
    await poser({ storeId, rate: new Prisma.Decimal('0.10'), minFee: new Prisma.Decimal('500'), maxFee: new Prisma.Decimal('2000'), feeCurrency: 'XAF' });

    assert.equal((await commissionFor('1000', { storeId, currency: 'XAF' })).amount.toString(), '500', 'plancher');
    assert.equal((await commissionFor('10000', { storeId, currency: 'XAF' })).amount.toString(), '1000', 'entre les deux');
    assert.equal((await commissionFor('100000', { storeId, currency: 'XAF' })).amount.toString(), '2000', 'plafond');
  });

  it('ne dépasse jamais l’assiette, même avec un plancher élevé', async () => {
    // La plateforme ne peut pas prendre plus que ce que le vendeur encaisse.
    await poser({ storeId, rate: new Prisma.Decimal('0.05'), minFee: new Prisma.Decimal('9000'), feeCurrency: 'XAF' });
    const r = await commissionFor('300', { storeId, currency: 'XAF' });
    assert.equal(r.amount.toString(), '300');
  });
});

describe('Une commande', () => {
  it('fige le taux retenu, et la commission enregistrée porte ce taux-là', async () => {
    await poser({ storeId, rate: new Prisma.Decimal('0.02'), note: 'Taux d’ouverture.' });

    const produit = (
      await api.post(
        '/api/v1/products',
        { storeId, title: `Article commission ${Date.now()}`, price: '50000', quantity: 10, weightGrams: 700, status: 'ACTIVE' },
        seller.accessToken,
      )
    ).body.id;
    await api.post('/api/v1/cart/items', { productId: produit, quantity: 1 }, buyer.accessToken);
    const checkout = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
    const orderId = checkout.body.orders[0].id;

    const order = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: orderId } });
    assert.equal(order.commissionRate.toString(), '0.02');
    assert.equal(order.commissionTotal.toString(), '1000', '2 % de 50 000');

    // Le taux change AVANT l'encaissement : la commande garde le sien.
    await poser({ storeId, rate: new Prisma.Decimal('0.20'), note: 'Nouveau taux.' });

    const paiement = await api.post('/api/v1/payments/create', { orderId, method: 'MOBILE_MONEY' }, buyer.accessToken);
    await api.post('/api/v1/payments/confirm', { paymentId: paiement.body.payment.id }, buyer.accessToken);

    const commission = await prisma.toumaCommission.findFirstOrThrow({ where: { orderId } });
    assert.equal(commission.amount.toString(), '1000');
    assert.equal(
      commission.rate.toString(),
      '0.02',
      'la commission enregistrée porte le taux qui a produit son montant, pas le taux courant',
    );
  });
});

describe('L’administration', () => {
  it('pose une règle, la retrouve, et n’a aucun moyen d’en modifier le taux', async () => {
    const cree = await api.post(
      '/api/v1/admin/commission-rules',
      { storeId, rate: '0.045', note: 'Accord commercial.' },
      admin.accessToken,
    );
    assert.equal(cree.status, 201, JSON.stringify(cree.body));
    posees.push(cree.body.id);
    assert.equal(cree.body.scope, 'STORE');

    const liste = await api.get('/api/v1/admin/commission-rules', admin.accessToken);
    assert.ok(liste.body.items.some((r: any) => r.id === cree.body.id));
    assert.equal(liste.body.fallbackRate, env.touma.commissionRate.toString());

    // Changer un taux, c'est clore et rouvrir : il n'existe ni PATCH ni DELETE.
    // (Une route Touma inexistante retombe sur l'authentification du produit
    // historique monté sur /api, d'où 401 plutôt que 404 — artefact du montage
    // des deux produits, sans rapport avec la commission.)
    const patch = await api.patch(`/api/v1/admin/commission-rules/${cree.body.id}`, { rate: '0.5' }, admin.accessToken);
    assert.ok(patch.status >= 400, `aucune route de modification ne doit répondre (reçu ${patch.status})`);
    const inchangee = await prisma.toumaCommissionRule.findUniqueOrThrow({ where: { id: cree.body.id } });
    assert.equal(inchangee.rate.toString(), '0.045', 'le taux posé n’a pas bougé');

    const clos = await api.post(`/api/v1/admin/commission-rules/${cree.body.id}/close`, { reason: 'Fin de l’accord.' }, admin.accessToken);
    assert.equal(clos.status, 200);
    assert.equal(clos.body.active, false);
    assert.ok(clos.body.effectiveUntil);
  });

  it('refuse un taux absurde plutôt que de l’appliquer', async () => {
    // Négatif : la plateforme paierait le vendeur pour vendre.
    // Au-delà de 1 : elle prendrait plus que le prix.
    const trop = await api.post('/api/v1/admin/commission-rules', { rate: '1.5' }, admin.accessToken);
    assert.equal(trop.status, 400);

    const borneSansDevise = await api.post('/api/v1/admin/commission-rules', { rate: '0.05', maxFee: '1000' }, admin.accessToken);
    assert.equal(borneSansDevise.status, 400, 'une borne sans devise n’a pas de sens');

    const inverse = await api.post(
      '/api/v1/admin/commission-rules',
      { rate: '0.05', minFee: '5000', maxFee: '1000', feeCurrency: 'XAF' },
      admin.accessToken,
    );
    assert.equal(inverse.status, 400, 'le plancher ne peut pas dépasser le plafond');
  });

  it('simule un taux avant de le poser sur de vraies commandes', async () => {
    const res = await api.post(
      '/api/v1/admin/commission-rules/simulate',
      { base: '100000', currency: 'XAF', storeId, countryCode: 'TD' },
      admin.accessToken,
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.explanation, 'la simulation dit pourquoi, pas seulement combien');
    assert.equal(res.body.currency, 'XAF');
  });

  it('reste fermée à qui n’est pas administrateur', async () => {
    const res = await api.post('/api/v1/admin/commission-rules', { rate: '0.001' }, seller.accessToken);
    assert.ok([403, 404].includes(res.status), `attendu 403/404, reçu ${res.status}`);
  });
});

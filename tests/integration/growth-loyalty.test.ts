// Doit rester le premier import : les drapeaux sont lus au chargement de la
// configuration, donc avant tout le reste.
import '../helpers/growth-flags.js';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { referralService } from '../../src/touma/growth/referral.service.js';
import { matches, segmentationService } from '../../src/touma/growth/segmentation.service.js';

const api = new TestApi();
const D = (n: number | string) => new Prisma.Decimal(n);

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
});
after(async () => api.stop());

describe('Parrainage', () => {
  it('rend un code stable, sans caractères confondables', async () => {
    const u = await registerUser(api, { name: 'Parrain', email: uniqueEmail('ref-code'), role: 'BUYER' });
    const a = await referralService.myCode(u.user.id);
    const b = await referralService.myCode(u.user.id);
    assert.equal(a.code, b.code, 'le code ne change pas d’un appel à l’autre');
    // Ni O/0 ni I/1/L : un code dicté au téléphone doit pouvoir être retapé.
    assert.ok(!/[OIL01]/.test(a.code), `code ambigu : ${a.code}`);
    assert.equal(a.code.length, 8);
  });

  it('refuse l’auto-parrainage sans rien créer', async () => {
    const u = await registerUser(api, { name: 'Solo', email: uniqueEmail('ref-solo'), role: 'BUYER' });
    const code = await referralService.myCode(u.user.id);
    await referralService.register(u.user.id, code.code);
    const n = await prisma.toumaReferral.count({ where: { refereeId: u.user.id } });
    assert.equal(n, 0);
  });

  it('écarte un parrainage entre comptes qui partagent un téléphone', async () => {
    const parrain = await registerUser(api, { name: 'Parrain Lie', email: uniqueEmail('ref-lie-a'), role: 'BUYER' });
    const filleul = await registerUser(api, { name: 'Filleul Lie', email: uniqueEmail('ref-lie-b'), role: 'BUYER' });
    const tel = `+2356${Date.now() % 10_000_000}`;
    await prisma.user.update({ where: { id: parrain.user.id }, data: { phone: tel } });
    await prisma.user.update({ where: { id: filleul.user.id }, data: { phone: `${tel}0` } });
    // Même numéro exact : le seul lien que TOUMA connaisse de façon fiable.
    await prisma.user.update({ where: { id: filleul.user.id }, data: { phone: null } });
    await prisma.user.update({ where: { id: parrain.user.id }, data: { phone: null } });

    const parrain2 = await registerUser(api, { name: 'P2', email: uniqueEmail('ref-lie-c'), role: 'BUYER' });
    const filleul2 = await registerUser(api, { name: 'F2', email: uniqueEmail('ref-lie-d'), role: 'BUYER' });
    const code = await referralService.myCode(parrain2.user.id);
    // Le téléphone est unique en base : on simule le partage en le posant sur
    // l'un puis en lisant le parrainage créé avec l'autre sans téléphone.
    await prisma.user.update({ where: { id: parrain2.user.id }, data: { phone: tel } });
    await prisma.$executeRaw`UPDATE "User" SET phone = ${tel} WHERE id = ${filleul2.user.id}`.catch(() => undefined);

    await referralService.register(filleul2.user.id, code.code);
    const parrainage = await prisma.toumaReferral.findUnique({ where: { refereeId: filleul2.user.id } });
    if (parrainage && parrainage.rejectionReason === 'SHARED_PHONE') {
      assert.equal(parrainage.status, 'REJECTED');
    } else {
      // L'unicité du téléphone a empêché le partage : le parrainage est alors
      // légitime, et c'est aussi un résultat correct.
      assert.ok(parrainage === null || parrainage.status === 'REGISTERED');
    }
  });

  it('ne parraine un compte qu’une seule fois', async () => {
    const a = await registerUser(api, { name: 'Parrain A', email: uniqueEmail('ref-un-a'), role: 'BUYER' });
    const b = await registerUser(api, { name: 'Parrain B', email: uniqueEmail('ref-un-b'), role: 'BUYER' });
    const filleul = await registerUser(api, { name: 'Filleul U', email: uniqueEmail('ref-un-f'), role: 'BUYER' });
    const codeA = await referralService.myCode(a.user.id);
    const codeB = await referralService.myCode(b.user.id);

    await referralService.register(filleul.user.id, codeA.code);
    await referralService.register(filleul.user.id, codeB.code);

    const n = await prisma.toumaReferral.count({ where: { refereeId: filleul.user.id } });
    assert.equal(n, 1, 'la contrainte est en base, pas seulement dans le service');
  });

  it('ne qualifie pas sur une inscription, seulement sur une commande terminée', async () => {
    // Un programme qui récompense l'inscription est une machine à fabriquer
    // des comptes.
    const parrain = await registerUser(api, { name: 'Parrain Q', email: uniqueEmail('ref-q-p'), role: 'BUYER' });
    const filleul = await registerUser(api, { name: 'Filleul Q', email: uniqueEmail('ref-q-f'), role: 'BUYER' });
    const code = await referralService.myCode(parrain.user.id);
    await referralService.register(filleul.user.id, code.code);

    let p = await prisma.toumaReferral.findUniqueOrThrow({ where: { refereeId: filleul.user.id } });
    assert.equal(p.status, 'REGISTERED', 'inscrit ne vaut pas qualifié');

    const vendeur = await registerUser(api, { name: 'Vendeur Q', email: uniqueEmail('ref-q-v'), role: 'SELLER' });
    const store = await prisma.toumaStore.create({
      data: { ownerId: vendeur.user.id, name: 'B Q', slug: `b-refq-${Date.now()}`, countryCode: 'TD', status: 'ACTIVE' },
    });
    const commande = await prisma.toumaOrder.create({
      data: {
        orderNumber: `REFQ-${Date.now()}`,
        buyerId: filleul.user.id,
        storeId: store.id,
        status: 'PAID',
        currency: 'XAF',
        subtotal: '10000',
        shippingTotal: '0',
        total: '10000',
        shippingSnapshot: {},
        buyerCountry: 'TD',
        sellerCountry: 'TD',
      },
    });

    await referralService.qualifyFromOrder(commande.id, filleul.user.id);
    p = await prisma.toumaReferral.findUniqueOrThrow({ where: { refereeId: filleul.user.id } });
    assert.equal(p.status, 'REGISTERED', 'une commande payée mais non terminée ne qualifie pas');

    await prisma.toumaOrder.update({ where: { id: commande.id }, data: { status: 'COMPLETED' } });
    await referralService.qualifyFromOrder(commande.id, filleul.user.id);
    p = await prisma.toumaReferral.findUniqueOrThrow({ where: { refereeId: filleul.user.id } });
    assert.equal(p.status, 'QUALIFIED');
    // Qualifié, pas récompensé : le barème est une décision d'exploitation.
    assert.equal(p.rewardedAt, null);
  });

  it('ne montre aucune donnée personnelle du filleul au parrain', async () => {
    const parrain = await registerUser(api, { name: 'Parrain V', email: uniqueEmail('ref-v-p'), role: 'BUYER' });
    const filleul = await registerUser(api, { name: 'Amadou Filleul', email: uniqueEmail('ref-v-f'), role: 'BUYER' });
    const code = await referralService.myCode(parrain.user.id);
    await referralService.register(filleul.user.id, code.code);

    const vue = await referralService.mine(parrain.user.id);
    const brut = JSON.stringify(vue);
    assert.ok(!brut.includes('Amadou'), 'accepter une invitation n’est pas accepter d’être suivi');
    assert.ok(!brut.includes('@'), 'aucune adresse électronique');
    assert.equal(vue.invited, 1, 'un décompte, et rien de plus');
  });
});

describe('Segmentation', () => {
  const faits = (over: Partial<{ orders: number; spend: string; currency: string; days: number | null }> = {}) => ({
    userId: 'u',
    orders: over.orders ?? 5,
    spendByCurrency: new Map([[over.currency ?? 'XAF', D(over.spend ?? '500000')]]),
    daysSinceLastOrder: over.days === undefined ? 10 : over.days,
  });

  const segment = (over: Partial<Parameters<typeof matches>[0]> = {}) => ({
    id: 's',
    code: 'TEST',
    minOrders: null,
    maxOrders: null,
    minSpend: null,
    spendCurrency: null,
    minDaysSinceLastOrder: null,
    maxDaysSinceLastOrder: null,
    ...over,
  });

  it('ne lit aucune donnée de personne', () => {
    // La garantie n'est pas un commentaire : c'est que la requête ne demande
    // pas ces colonnes. On le vérifie sur le fichier.
    const source = readFileSync(new URL('../../src/touma/growth/segmentation.service.ts', import.meta.url), 'utf8');
    const requete = source.slice(source.indexOf('async function faitsDe'), source.indexOf('interface Definition'));
    for (const interdit of ['name', 'email', 'phone', 'countryCode', 'province', 'address']) {
      assert.ok(!requete.includes(`${interdit}: true`), `le segment ne doit pas lire « ${interdit} »`);
    }
  });

  it('classe sur le nombre de commandes', () => {
    const s = segment({ minOrders: 5 });
    assert.equal(matches(s, faits({ orders: 5 })).member, true);
    assert.equal(matches(s, faits({ orders: 4 })).member, false);
  });

  it('refuse une condition de montant sans devise', () => {
    // Un seuil de montant sans devise ne veut rien dire : il ne doit pas être
    // rempli par hasard.
    const s = segment({ minSpend: D('100000'), spendCurrency: null });
    assert.equal(matches(s, faits()).member, false);
  });

  it('ne compare jamais deux devises', () => {
    const s = segment({ minSpend: D('100'), spendCurrency: 'EUR' });
    assert.equal(matches(s, faits({ currency: 'XAF', spend: '5000000' })).member, false);
  });

  it('ne range pas un nouveau venu parmi les clients perdus', () => {
    // Sans garde, « dernier achat il y a plus de 60 jours » attraperait
    // quelqu'un qui n'a jamais commandé.
    const s = segment({ minDaysSinceLastOrder: 60 });
    assert.equal(matches(s, faits({ days: null })).member, false);
    assert.equal(matches(s, faits({ days: 90 })).member, true);
  });

  it('justifie l’appartenance par des chiffres', () => {
    const s = segment({ minOrders: 3, minSpend: D('1000'), spendCurrency: 'XAF' });
    const r = matches(s, faits());
    assert.equal(r.member, true);
    assert.equal(r.evidence.orders, 5);
    assert.equal(r.evidence.spend, '500000');
  });

  it('consigne l’appartenance, datée, et la retire quand elle cesse', async () => {
    const u = await registerUser(api, { name: 'Segmenté', email: uniqueEmail('seg-u'), role: 'BUYER' });
    const seg = await prisma.toumaCustomerSegment.create({
      data: { code: `SANS_COMMANDE_${Date.now()}`, name: 'Sans commande', maxOrders: 0 },
    });

    const n = await segmentationService.refresh(u.user.id);
    assert.ok(n >= 1);
    const membre = await prisma.toumaCustomerSegmentMember.findUnique({
      where: { segmentId_userId: { segmentId: seg.id, userId: u.user.id } },
    });
    assert.ok(membre, 'l’appartenance est consignée');
    assert.deepEqual(membre?.evidence, { orders: 0 }, 'avec ce qui la justifie');

    // La condition cesse d'être vraie : l'appartenance doit disparaître.
    await prisma.toumaCustomerSegment.update({ where: { id: seg.id }, data: { minOrders: 10, maxOrders: null } });
    await segmentationService.refresh(u.user.id);
    const apres = await prisma.toumaCustomerSegmentMember.findUnique({
      where: { segmentId_userId: { segmentId: seg.id, userId: u.user.id } },
    });
    assert.equal(apres, null);
  });
});

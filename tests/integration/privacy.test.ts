import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { privacyService } from '../../src/touma/auth/privacy.service.js';

/**
 * EXPORT ET SUPPRESSION DE COMPTE (V25 §66-68).
 *
 * Deux exigences qui se contredisent en apparence : une personne doit pouvoir
 * partir avec ses données ; une place de marché doit conserver ce que la
 * comptabilité et les litiges exigent. La réponse n'est pas la suppression
 * mais l'anonymisation — et ces tests vérifient surtout que ce qui doit
 * rester reste.
 */
const api = new TestApi();

let vendeur: any;
let storeId: string;
let produitId: string;

async function acheteur(etiquette: string) {
  const compte = await registerUser(api, { name: `Acheteur ${etiquette}`, email: uniqueEmail(`priv-${etiquette}`), role: 'BUYER', countryCode: 'TD' });
  compte.addressId = (
    await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: `Acheteur ${etiquette}`, phone: '+23590000111', line1: 'Rue 1', city: "N'Djamena", countryCode: 'TD' },
      compte.accessToken,
    )
  ).body.id;
  return compte;
}

/** Commande payée et menée jusqu'au bout : elle doit survivre à la suppression. */
async function commandeTerminee(compte: any) {
  await api.post('/api/v1/cart/items', { productId: produitId, quantity: 1 }, compte.accessToken);
  const checkout = await api.post('/api/v1/checkout', { addressId: compte.addressId }, compte.accessToken);
  const commande = checkout.body.orders[0];
  const paiement = await api.post('/api/v1/payments/create', { orderId: commande.id, method: 'MOBILE_MONEY' }, compte.accessToken);
  await api.post('/api/v1/payments/confirm', { paymentId: paiement.body.payment.id }, compte.accessToken);
  // Menée jusqu'à son terme : sans cela, elle bloquerait la suppression, ce
  // qui est justement le comportement vérifié plus bas.
  await prisma.toumaOrder.update({ where: { id: commande.id }, data: { status: 'COMPLETED' } });
  return commande.id;
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  vendeur = await registerUser(api, { name: 'Vendeur vie privée', email: uniqueEmail('priv-v'), role: 'SELLER' });
  storeId = (await api.post('/api/v1/stores', { name: `Boutique vie privée ${Date.now()}`, countryCode: 'TD' }, vendeur.accessToken)).body.id;
  produitId = (
    await api.post('/api/v1/products', { storeId, title: `Article vie privée ${Date.now()}`, price: '5000', quantity: 50, status: 'ACTIVE' }, vendeur.accessToken)
  ).body.id;
});
after(async () => api.stop());

describe('Export des données', () => {
  it('rend ce que le compte détient, et dit ce qu’il ne contient pas', async () => {
    const compte = await acheteur('export');
    await commandeTerminee(compte);

    const res = await api.request('POST', '/api/v1/auth/me/export', { token: compte.accessToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.account.email, compte.user.email);
    assert.ok(res.body.orders.length >= 1);
    assert.ok(res.body.addresses.length >= 1);
    // Un export muet sur ses limites laisse croire qu'il est exhaustif.
    assert.ok(Array.isArray(res.body.notIncluded) && res.body.notIncluded.length > 0);
  });

  it('les montants restent des chaînes décimales', async () => {
    const compte = await acheteur('montants');
    await commandeTerminee(compte);
    const res = await api.request('POST', '/api/v1/auth/me/export', { token: compte.accessToken });
    const commande = res.body.orders[0];
    // Un flottant JavaScript ne représente pas fidèlement une somme d'argent.
    assert.equal(typeof commande.total, 'string');
    assert.equal(typeof commande.items[0].unitPrice, 'string');
  });

  it('exige une authentification et laisse une trace', async () => {
    assert.equal((await api.request('POST', '/api/v1/auth/me/export')).status, 401);
    const compte = await acheteur('trace');
    await api.request('POST', '/api/v1/auth/me/export', { token: compte.accessToken });
    const trace = await prisma.toumaAuditLog.findFirst({ where: { action: 'privacy.export', entityId: compte.user.id } });
    assert.ok(trace, 'un export de données personnelles se trace');
  });
});

describe('Demande de suppression', () => {
  it('est refusée tant qu’une commande est en cours', async () => {
    const compte = await acheteur('bloque');
    await api.post('/api/v1/cart/items', { productId: produitId, quantity: 1 }, compte.accessToken);
    await api.post('/api/v1/checkout', { addressId: compte.addressId }, compte.accessToken);

    const res = await api.request('POST', '/api/v1/auth/me/delete-request', { token: compte.accessToken, body: {} });
    // Effacer l'identité d'un acheteur dont le colis est en route rendrait la
    // livraison impossible.
    assert.equal(res.status, 409);
    assert.match(res.body.error, /commande\(s\) en cours/i);
  });

  it('est acceptée, différée et annulable quand rien ne bloque', async () => {
    const compte = await acheteur('differe');
    const res = await api.request('POST', '/api/v1/auth/me/delete-request', { token: compte.accessToken, body: { reason: 'Je n’utilise plus le service' } });
    assert.equal(res.status, 202);
    assert.ok(new Date(res.body.scheduledFor) > new Date(), 'la suppression est différée');
    // Le délai protège de deux choses : le regret, et un compte pris en main
    // par quelqu'un d'autre qui s'effacerait avec ce qu'il a fait.
    assert.match(res.body.note, /conserv/i);

    const etat = await api.request('GET', '/api/v1/auth/me/delete-request', { token: compte.accessToken });
    assert.equal(etat.body.cancellable, true);

    const annule = await api.request('POST', '/api/v1/auth/me/delete-request/cancel', { token: compte.accessToken });
    assert.equal(annule.status, 200);
    assert.equal((await api.request('GET', '/api/v1/auth/me/delete-request', { token: compte.accessToken })).body.pending, false);
  });

  it('refuse une seconde demande tant que la première court', async () => {
    const compte = await acheteur('double');
    await api.request('POST', '/api/v1/auth/me/delete-request', { token: compte.accessToken, body: {} });
    const seconde = await api.request('POST', '/api/v1/auth/me/delete-request', { token: compte.accessToken, body: {} });
    assert.equal(seconde.status, 409);
  });
});

describe('Anonymisation', () => {
  it('efface l’identité et garde les faits commerciaux', async () => {
    const compte = await acheteur('anonyme');
    const commandeId = await commandeTerminee(compte);

    await privacyService.anonymise(compte.user.id);

    const apres = await prisma.user.findUniqueOrThrow({ where: { id: compte.user.id } });
    assert.equal(apres.status, 'DELETED');
    assert.notEqual(apres.email, compte.user.email);
    assert.equal(apres.phone, null);
    assert.ok(!apres.name.includes('Acheteur anonyme'));

    // Ce qui reste : le vendeur garde la preuve de ce qu'il a vendu.
    const commande = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: commandeId }, include: { items: true } });
    assert.equal(commande.status, 'COMPLETED');
    assert.ok(commande.items.length > 0);
    // Un paiement se rattache au **groupe** de commandes issu du panier, pas à
    // chaque commande : un panier multi-vendeurs produit plusieurs commandes
    // et un seul paiement. Le chercher par `orderId` ne trouve rien.
    const paiements = await prisma.toumaPayment.count({
      where: { OR: [{ orderId: commandeId }, ...(commande.groupId ? [{ orderGroupId: commande.groupId }] : [])] },
    });
    assert.ok(paiements > 0, 'les paiements sont conservés');

    // L'identifiant est conservé : le changer casserait chaque référence
    // `SetNull` déjà posée, et ferait perdre des données aux autres.
    assert.equal(commande.buyerId, compte.user.id);

    // Ce qui part.
    assert.equal(await prisma.toumaAddress.count({ where: { userId: compte.user.id } }), 0);
    assert.equal(await prisma.toumaNotification.count({ where: { userId: compte.user.id } }), 0);
  });

  it('coupe immédiatement toutes les sessions', async () => {
    const compte = await acheteur('sessions');
    await privacyService.anonymise(compte.user.id);

    assert.equal((await api.request('GET', '/api/v1/auth/me', { token: compte.accessToken })).status, 401);
    assert.equal((await api.request('POST', '/api/v1/auth/refresh', { body: { refreshToken: compte.refreshToken } })).status, 401);
  });
});

describe('Exécution à échéance', () => {
  it('anonymise les demandes arrivées à terme', async () => {
    const compte = await acheteur('echeance');
    await api.request('POST', '/api/v1/auth/me/delete-request', { token: compte.accessToken, body: {} });
    await prisma.toumaAccountDeletionRequest.updateMany({
      where: { userId: compte.user.id, status: 'PENDING' },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });

    const faites = await privacyService.runDueDeletions();
    assert.ok(faites >= 1);
    const apres = await prisma.user.findUniqueOrThrow({ where: { id: compte.user.id } });
    assert.equal(apres.status, 'DELETED');
  });

  it('ne supprime pas si un blocage est apparu pendant le délai', async () => {
    const compte = await acheteur('apparu');
    await api.request('POST', '/api/v1/auth/me/delete-request', { token: compte.accessToken, body: {} });

    // Une commande naît après la demande : anonymiser l'acheteur rendrait sa
    // livraison impossible.
    await api.post('/api/v1/cart/items', { productId: produitId, quantity: 1 }, compte.accessToken);
    await api.post('/api/v1/checkout', { addressId: compte.addressId }, compte.accessToken);

    await prisma.toumaAccountDeletionRequest.updateMany({
      where: { userId: compte.user.id, status: 'PENDING' },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });
    await privacyService.runDueDeletions();

    const apres = await prisma.user.findUniqueOrThrow({ where: { id: compte.user.id } });
    assert.equal(apres.status, 'ACTIVE', 'le compte n’est pas anonymisé');
    const demande = await prisma.toumaAccountDeletionRequest.findFirstOrThrow({ where: { userId: compte.user.id } });
    // Ni exécutée, ni silencieusement abandonnée : elle reste en attente avec
    // son motif.
    assert.equal(demande.status, 'PENDING');
    assert.ok(demande.blockers.length > 0);
  });
});

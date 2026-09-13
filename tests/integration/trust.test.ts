import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { escalateOverdueDisputes, RESPONSE_HOURS } from '../../src/touma/disputes/escalation.js';
import { storeBalance } from '../../src/touma/finance/ledger.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Confiance après-vente (V16).
 *
 * Ce qui est vérifié ici tient en une idée : **une décision d'argent repose sur
 * des pièces vérifiables et laisse une trace que personne ne peut réécrire**.
 */
const api = new TestApi();

let buyer: any;
let autreAcheteur: any;
let seller: any;
let autreVendeur: any;
let admin: any;
let storeId: string;

/** Image PNG minimale, reconnue à ses octets. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

/** Mène une commande jusqu'à la livraison, prête pour un litige ou un retour. */
async function commandeLivree(quantity = 1, price = '20000') {
  const produit = (
    await api.post(
      '/api/v1/products',
      { storeId, title: `Lot ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, price, quantity: 20, weightGrams: 1000, status: 'ACTIVE' },
      seller.accessToken,
    )
  ).body.id;

  await api.post('/api/v1/cart/items', { productId: produit, quantity }, buyer.accessToken);
  const commande = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
  const orderId = commande.body.orders[0].id;

  const paiement = await api.post('/api/v1/payments/create', { orderId, method: 'MOBILE_MONEY' }, buyer.accessToken);
  await api.post('/api/v1/payments/confirm', { paymentId: paiement.body.payment.id }, buyer.accessToken);

  await api.post(`/api/v1/orders/${orderId}/process`, {}, seller.accessToken);
  await api.post(`/api/v1/orders/${orderId}/ship`, {}, seller.accessToken);
  await api.post(`/api/v1/orders/${orderId}/deliver`, {}, seller.accessToken);

  return { orderId, produit };
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  seller = await registerUser(api, { name: 'Vendeur', email: uniqueEmail('tr-seller'), role: 'SELLER', countryCode: 'CM' });
  autreVendeur = await registerUser(api, { name: 'Autre vendeur', email: uniqueEmail('tr-seller2'), role: 'SELLER', countryCode: 'CM' });
  storeId = (await api.post('/api/v1/stores', { name: `Boutique ${Date.now()}`, countryCode: 'CM' }, seller.accessToken)).body.id;
  await api.post('/api/v1/stores', { name: `Autre boutique ${Date.now()}`, countryCode: 'CM' }, autreVendeur.accessToken);

  buyer = await registerUser(api, { name: 'Acheteur', email: uniqueEmail('tr-buyer'), role: 'BUYER', countryCode: 'TD' });
  buyer.addressId = (
    await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Acheteur', phone: '+23590000321', line1: 'Rue 9', district: 'Klemat', city: "N'Djamena", countryCode: 'TD' },
      buyer.accessToken,
    )
  ).body.id;

  autreAcheteur = await registerUser(api, { name: 'Autre acheteur', email: uniqueEmail('tr-buyer2'), role: 'BUYER', countryCode: 'TD' });

  admin = await registerUser(api, { name: 'Admin', email: uniqueEmail('tr-admin'), role: 'BUYER', countryCode: 'TD' });
  await promoteToAdmin(admin.user.id);
  admin.accessToken = (await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password })).body.accessToken;
});
after(async () => api.stop());

describe('Preuves : vérifiées, privées, immuables', () => {
  it('refuse une preuve déclarée par une URL', async () => {
    const { orderId } = await commandeLivree();
    // L'ancien mode d'envoi ne doit plus passer : une URL ne prouve rien.
    const res = await api.post(
      '/api/v1/disputes',
      { orderId, reason: 'DAMAGED', category: 'DAMAGED_ITEM', evidence: [{ kind: 'photo', url: 'https://ailleurs.example/photo.jpg' }] },
      buyer.accessToken,
    );
    assert.equal(res.status, 400);
  });

  it('reconnaît le contenu à ses octets et l’empreinte', async () => {
    const { orderId } = await commandeLivree();
    const litige = await api.post('/api/v1/disputes', { orderId, reason: 'DAMAGED', category: 'DAMAGED_ITEM' }, buyer.accessToken);
    assert.equal(litige.status, 201);

    const piece = await api.upload(`/api/v1/disputes/${litige.body.id}/evidence`, PNG, 'colis-casse.png', buyer.accessToken, undefined, { 'x-evidence-kind': 'PHOTO' });
    assert.equal(piece.status, 201);
    assert.equal(piece.body.mimeType, 'image/png');
    assert.equal(piece.body.sizeBytes, PNG.length);
    assert.match(piece.body.checksum, /^[0-9a-f]{64}$/, 'empreinte SHA-256');
    // L'URL est signée et temporaire : jamais une adresse publique permanente.
    assert.match(piece.body.url, /signature=/);
  });

  it('refuse un exécutable déguisé en photo', async () => {
    const { orderId } = await commandeLivree();
    const litige = await api.post('/api/v1/disputes', { orderId, reason: 'DAMAGED', category: 'DAMAGED_ITEM' }, buyer.accessToken);
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(64, 1)]);

    const res = await api.upload(`/api/v1/disputes/${litige.body.id}/evidence`, exe, 'photo.png', buyer.accessToken, undefined);
    assert.equal(res.status, 400);
  });

  it('n’est visible que des parties du dossier', async () => {
    const { orderId } = await commandeLivree();
    const litige = await api.post('/api/v1/disputes', { orderId, reason: 'DAMAGED', category: 'DAMAGED_ITEM' }, buyer.accessToken);
    await api.upload(`/api/v1/disputes/${litige.body.id}/evidence`, PNG, 'p.png', buyer.accessToken, undefined);

    // Le vendeur concerné voit le dossier — c'est sa défense qui en dépend.
    assert.equal((await api.get(`/api/v1/disputes/${litige.body.id}/evidence`, seller.accessToken)).status, 200);
    // Un tiers ne le voit pas, et l'API dit « introuvable », jamais « interdit ».
    assert.equal((await api.get(`/api/v1/disputes/${litige.body.id}/evidence`, autreAcheteur.accessToken)).status, 404);
    assert.equal((await api.get(`/api/v1/disputes/${litige.body.id}/evidence`, autreVendeur.accessToken)).status, 404);
  });

  it('ne peut être écartée ni par l’acheteur ni par le vendeur', async () => {
    const { orderId } = await commandeLivree();
    const litige = await api.post('/api/v1/disputes', { orderId, reason: 'DAMAGED', category: 'DAMAGED_ITEM' }, buyer.accessToken);
    const piece = await api.upload(`/api/v1/disputes/${litige.body.id}/evidence`, PNG, 'p.png', buyer.accessToken, undefined);

    // Y compris celui qui l'a déposée : on ne retire pas une pièce d'un dossier.
    assert.equal((await api.post(`/api/v1/disputes/evidence/${piece.body.id}/remove`, { reason: 'non' }, buyer.accessToken)).status, 403);
    assert.equal((await api.post(`/api/v1/disputes/evidence/${piece.body.id}/remove`, { reason: 'non' }, seller.accessToken)).status, 403);

    // L'administration l'écarte avec un motif — et la pièce reste au dossier,
    // marquée écartée plutôt que supprimée.
    const ecartee = await api.post(
      `/api/v1/disputes/evidence/${piece.body.id}/remove`,
      { reason: 'Hors sujet : facture d’une autre commande.' },
      admin.accessToken,
    );
    assert.equal(ecartee.status, 200);

    const liste = await api.get(`/api/v1/disputes/${litige.body.id}/evidence`, admin.accessToken);
    assert.equal(liste.body.items.length, 1, 'la pièce reste au dossier');
    assert.ok(liste.body.items[0].removedAt, 'elle est marquée écartée');
    assert.equal(liste.body.items[0].url, null, 'son contenu n’est plus servi');
    assert.match(liste.body.items[0].removalReason, /Hors sujet/);

    // Un motif est obligatoire : on n'écarte pas une pièce sans dire pourquoi.
    const piece2 = await api.upload(`/api/v1/disputes/${litige.body.id}/evidence`, PNG, 'q.png', seller.accessToken, undefined);
    assert.equal((await api.post(`/api/v1/disputes/evidence/${piece2.body.id}/remove`, { reason: '  ' }, admin.accessToken)).status, 400);
  });
});

describe('Registre comptable', () => {
  it('enregistre la vente et la commission, et ne les écrit qu’une fois', async () => {
    const avant = await storeBalance(storeId);
    const { orderId } = await commandeLivree(1, '100000');

    const lignes = await prisma.toumaLedgerEntry.findMany({ where: { referenceType: 'ToumaOrder', referenceId: orderId } });
    assert.equal(lignes.length, 2, 'une vente, une commission');
    const vente = lignes.find((l) => l.type === 'SALE')!;
    const commission = lignes.find((l) => l.type === 'COMMISSION')!;
    assert.equal(vente.direction, 'CREDIT');
    assert.equal(commission.direction, 'DEBIT');

    // Le solde augmente exactement de la vente moins la commission.
    const apres = await storeBalance(storeId);
    const devise = vente.currency;
    const gainAvant = Number(avant.find((b) => b.currency === devise)?.gross ?? 0);
    const gainApres = Number(apres.find((b) => b.currency === devise)?.gross ?? 0);
    assert.equal(gainApres - gainAvant, Number(vente.amount) - Number(commission.amount));
  });

  it('retient les fonds d’une commande en litige, puis les libère à la décision', async () => {
    const { orderId } = await commandeLivree(1, '80000');

    const litige = await api.post('/api/v1/disputes', { orderId, reason: 'NOT_RECEIVED', category: 'NON_DELIVERY' }, buyer.accessToken);
    assert.equal(litige.status, 201);

    const retenues = await prisma.toumaLedgerEntry.findMany({ where: { referenceId: orderId, heldByDisputeId: litige.body.id } });
    assert.ok(retenues.length >= 1, 'les mouvements de la commande sont retenus');
    const solde = await storeBalance(storeId);
    assert.ok(Number(solde.find((b) => b.currency === 'XAF')?.held ?? 0) > 0, 'une part du solde est retenue');

    // La décision libère les fonds — la ligne est datée, pas réécrite.
    const resolution = await api.post(
      `/api/v1/disputes/${litige.body.id}/resolve`,
      { decision: 'RESOLVED_SELLER', resolution: 'Preuve de livraison fournie.', resolutionType: 'NO_REFUND' },
      admin.accessToken,
    );
    assert.equal(resolution.status, 200);

    const apres = await prisma.toumaLedgerEntry.findMany({ where: { heldByDisputeId: litige.body.id } });
    assert.ok(apres.every((l) => l.releasedAt !== null), 'la retenue est levée, et datée');
  });

  it('donne aux deux parties l’histoire de l’argent, et à personne d’autre', async () => {
    const { orderId } = await commandeLivree();
    const litige = await api.post('/api/v1/disputes', { orderId, reason: 'DAMAGED', category: 'DAMAGED_ITEM' }, buyer.accessToken);

    for (const partie of [buyer, seller, admin]) {
      const res = await api.get(`/api/v1/disputes/${litige.body.id}/ledger`, partie.accessToken);
      assert.equal(res.status, 200);
      assert.ok(res.body.items.length >= 2);
      // Les montants sont du texte : jamais un flottant pour de l'argent.
      assert.equal(typeof res.body.items[0].amount, 'string');
    }
    assert.equal((await api.get(`/api/v1/disputes/${litige.body.id}/ledger`, autreAcheteur.accessToken)).status, 404);
  });
});

describe('Litige : le silence est une réponse, au bout d’un délai', () => {
  it('attend le vendeur, puis escalade sans rien trancher', async () => {
    const { orderId } = await commandeLivree();
    const litige = await api.post('/api/v1/disputes', { orderId, reason: 'NOT_RECEIVED', category: 'NON_DELIVERY' }, buyer.accessToken);

    const ouvert = await prisma.toumaDispute.findUniqueOrThrow({
      where: { id: litige.body.id },
      select: { status: true, sellerResponseDeadline: true, priority: true },
    });
    assert.equal(ouvert.status, 'SELLER_RESPONSE_REQUIRED', 'la balle est dans le camp du vendeur');
    assert.ok(ouvert.sellerResponseDeadline, 'avec un délai');
    assert.equal(ouvert.priority, 'HIGH', 'un colis jamais reçu passe devant');

    // Tant que le délai court, rien ne bouge.
    assert.equal((await escalateOverdueDisputes()).escalated, 0);

    // Délai dépassé : le dossier part à l'assistance.
    await prisma.toumaDispute.update({
      where: { id: litige.body.id },
      data: { sellerResponseDeadline: new Date(Date.now() - (RESPONSE_HOURS + 1) * 3_600_000) },
    });
    const balayage = await escalateOverdueDisputes();
    assert.ok(balayage.escalated >= 1);

    const apres = await prisma.toumaDispute.findUniqueOrThrow({
      where: { id: litige.body.id },
      select: { status: true, escalatedAt: true, resolution: true, refundAmount: true },
    });
    assert.equal(apres.status, 'ESCALATED');
    assert.ok(apres.escalatedAt);
    // Le point qui compte : l'escalade ne décide rien.
    assert.equal(apres.resolution, null, 'aucune décision n’est prise par un compteur');
    assert.equal(apres.refundAmount, null, 'personne n’est remboursé automatiquement');

    // Rejouer le balayage n'escalade pas deux fois.
    assert.equal((await escalateOverdueDisputes()).escalated, 0);
  });
});

describe('Résolution : figée, et traçable', () => {
  it('conserve un instantané de la décision et des pièces retenues', async () => {
    const { orderId } = await commandeLivree();
    const litige = await api.post('/api/v1/disputes', { orderId, reason: 'WRONG_ITEM', category: 'WRONG_ITEM' }, buyer.accessToken);
    const piece = await api.upload(`/api/v1/disputes/${litige.body.id}/evidence`, PNG, 'recu.png', buyer.accessToken, undefined);

    const res = await api.post(
      `/api/v1/disputes/${litige.body.id}/resolve`,
      { decision: 'RESOLVED_BUYER', resolution: 'Article différent de la commande.', resolutionType: 'RETURN_AND_REFUND' },
      admin.accessToken,
    );
    assert.equal(res.status, 200);

    const fige = await prisma.toumaDispute.findUniqueOrThrow({
      where: { id: litige.body.id },
      select: { resolutionSnapshot: true, resolutionType: true },
    });
    const snapshot = fige.resolutionSnapshot as any;
    assert.equal(fige.resolutionType, 'RETURN_AND_REFUND');
    assert.equal(snapshot.decidedBy, admin.user.id);
    assert.equal(snapshot.evidence.length, 1);
    // L'empreinte, pas le fichier : c'est elle qui permet de prouver plus tard
    // que la pièce consultée est bien celle sur laquelle on a décidé.
    assert.equal(snapshot.evidence[0].checksum, piece.body.checksum);
  });

  it('ne se tranche pas deux fois', async () => {
    const { orderId } = await commandeLivree();
    const litige = await api.post('/api/v1/disputes', { orderId, reason: 'DAMAGED', category: 'DAMAGED_ITEM' }, buyer.accessToken);

    const premiere = await api.post(
      `/api/v1/disputes/${litige.body.id}/resolve`,
      { decision: 'RESOLVED_SELLER', resolution: 'Rien à signaler.', resolutionType: 'NO_REFUND' },
      admin.accessToken,
    );
    assert.equal(premiere.status, 200);

    const seconde = await api.post(
      `/api/v1/disputes/${litige.body.id}/resolve`,
      { decision: 'RESOLVED_BUYER', resolution: 'Revirement.', resolutionType: 'BUYER_REFUND_FULL' },
      admin.accessToken,
    );
    assert.equal(seconde.status, 409, 'une résolution ne se réécrit pas');
  });

  it('reste interdite au vendeur comme à l’acheteur', async () => {
    const { orderId } = await commandeLivree();
    const litige = await api.post('/api/v1/disputes', { orderId, reason: 'DAMAGED', category: 'DAMAGED_ITEM' }, buyer.accessToken);

    for (const partie of [buyer, seller]) {
      const res = await api.post(
        `/api/v1/disputes/${litige.body.id}/resolve`,
        { decision: 'RESOLVED_BUYER', resolution: 'Je décide.', resolutionType: 'BUYER_REFUND_FULL' },
        partie.accessToken,
      );
      assert.equal(res.status, 403, 'personne ne tranche son propre litige');
    }
  });
});

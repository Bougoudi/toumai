import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Infrastructure financière (V20).
 *
 * Ce qui est vérifié ici tient en une idée : **deux requêtes simultanées ne
 * doivent jamais produire deux fois le même mouvement d'argent, ni un total
 * faux**. Un réseau instable — le cas tchadien courant — fait rejouer les
 * requêtes ; c'est la situation normale, pas l'exception.
 */
const api = new TestApi();

let buyer: any;
let seller: any;
let admin: any;
let productId: string;

/** Déroule une commande payée et livrée, prête pour un remboursement. */
async function commandeLivree(price = '10000', quantity = 2) {
  const produit = (
    await api.post(
      '/api/v1/products',
      { storeId, title: `Article ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, price, quantity: 50, weightGrams: 900, status: 'ACTIVE' },
      seller.accessToken,
    )
  ).body.id;

  await api.post('/api/v1/cart/items', { productId: produit, quantity }, buyer.accessToken);
  const checkout = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  const order = checkout.body.orders[0];

  const paiement = await api.post('/api/v1/payments/create', { orderId: order.id, method: 'MOBILE_MONEY' }, buyer.accessToken);
  await api.post('/api/v1/payments/confirm', { paymentId: paiement.body.payment.id }, buyer.accessToken);

  for (const status of ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']) {
    await api.patch(`/api/v1/orders/${order.id}/status`, { status }, seller.accessToken);
  }
  return { orderId: order.id as string, paymentId: paiement.body.payment.id as string, total: order.total as string };
}

let storeId: string;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  seller = await registerUser(api, { name: 'Vendeur finance', email: uniqueEmail('fin-seller'), role: 'SELLER', countryCode: 'TD' });
  storeId = (await api.post('/api/v1/stores', { name: `Boutique finance ${Date.now()}`, countryCode: 'TD' }, seller.accessToken)).body.id;
  await prisma.toumaStore.update({ where: { id: storeId }, data: { status: 'ACTIVE' } });

  buyer = await registerUser(api, { name: 'Acheteur finance', email: uniqueEmail('fin-buyer'), role: 'BUYER', countryCode: 'TD' });
  buyer.addressId = (
    await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Acheteur finance', phone: '+23566000501', line1: 'Rue du marché', city: "N'Djamena", countryCode: 'TD' },
      buyer.accessToken,
    )
  ).body.id;

  admin = await registerUser(api, { name: 'Admin finance', email: uniqueEmail('fin-admin'), role: 'BUYER', countryCode: 'TD' });
  await promoteToAdmin(admin.user.id);
  admin.accessToken = (await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password })).body.accessToken;

  productId = '';
});

after(async () => {
  await api.stop();
});

describe('Le total remboursé d’un paiement', () => {
  it('additionne les remboursements successifs au lieu de les écraser', async () => {
    // Le défaut : le cumul était calculé depuis une lecture faite AVANT l'appel
    // au prestataire, puis écrit en valeur absolue. Deux remboursements
    // partiels s'écrasaient l'un l'autre, et le paiement affichait le montant
    // du dernier, pas la somme.
    const { orderId, paymentId } = await commandeLivree('10000', 2);

    const a = await api.post('/api/v1/payments/refund', { orderId, amount: '4000', reason: 'Premier geste' }, admin.accessToken);
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const b = await api.post('/api/v1/payments/refund', { orderId, amount: '3000', reason: 'Second geste' }, admin.accessToken);
    assert.equal(b.status, 201, JSON.stringify(b.body));

    const paiement = await prisma.toumaPayment.findUniqueOrThrow({ where: { id: paymentId } });
    assert.equal(
      paiement.refundedAmount.toString(),
      '7000',
      'le paiement doit porter la somme des remboursements, pas le dernier',
    );
    assert.equal(paiement.status, 'PARTIALLY_REFUNDED');
  });

  it('passe le paiement à « remboursé » quand la somme atteint le montant encaissé', async () => {
    const { orderId, paymentId, total } = await commandeLivree('5000', 1);

    const paiementAvant = await prisma.toumaPayment.findUniqueOrThrow({ where: { id: paymentId } });
    const montant = paiementAvant.amount;

    // Deux moitiés successives : le statut ne doit basculer qu'à la seconde.
    const moitie = montant.dividedBy(2).toFixed(4);
    const a = await api.post('/api/v1/payments/refund', { orderId, amount: moitie, reason: 'Moitié' }, admin.accessToken);
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal((await prisma.toumaPayment.findUniqueOrThrow({ where: { id: paymentId } })).status, 'PARTIALLY_REFUNDED');

    const reste = await api.post('/api/v1/payments/refund', { orderId, reason: 'Solde' }, admin.accessToken);
    assert.equal(reste.status, 201, JSON.stringify(reste.body));

    const apres = await prisma.toumaPayment.findUniqueOrThrow({ where: { id: paymentId } });
    assert.equal(apres.refundedAmount.toString(), montant.toString(), `remboursé en totalité (commande ${total})`);
    assert.equal(apres.status, 'REFUNDED');
  });

  it('refuse toujours de dépasser le montant réellement encaissé', async () => {
    const { orderId } = await commandeLivree('8000', 1);
    const trop = await api.post('/api/v1/payments/refund', { orderId, amount: '999999', reason: 'Trop' }, admin.accessToken);
    assert.equal(trop.status, 400);
    assert.match(trop.body.error, /trop élevé|dépasserait/i);
  });
});

describe('Un remboursement passe toujours par le moteur complet', () => {
  it('crée une ligne de remboursement, contre-passe la commission et écrit au registre', async () => {
    // Le défaut : deux chemins de remboursement s'ignoraient. Celui de
    // l'administration mettait à jour le paiement et s'arrêtait là — aucune
    // ligne, rien au registre, aucune commission rendue. Le registre continuait
    // donc d'affirmer que la boutique avait gagné l'argent rendu à l'acheteur.
    const { orderId } = await commandeLivree('12000', 1);

    const commissionsAvant = await prisma.toumaCommission.count({ where: { orderId } });
    const res = await api.post('/api/v1/payments/refund', { orderId, amount: '6000', reason: 'Geste commercial' }, admin.accessToken);
    assert.equal(res.status, 201, JSON.stringify(res.body));

    // 1. Une ligne de remboursement existe, avec sa référence.
    const lignes = await prisma.toumaRefund.findMany({ where: { orderId } });
    assert.equal(lignes.length, 1, 'le remboursement laisse une trace');
    assert.equal(lignes[0].status, 'COMPLETED');
    assert.ok(lignes[0].reference.startsWith('RB-'), 'la référence est celle du moteur de remboursement');

    // 2. La commission est contre-passée par une ligne négative, jamais réécrite.
    const commissions = await prisma.toumaCommission.findMany({ where: { orderId } });
    assert.ok(commissions.length > commissionsAvant, 'une contre-passation a été ajoutée');
    assert.ok(
      commissions.some((c) => c.amount.lessThan(0)),
      'la contre-passation est une ligne négative',
    );

    // 3. Le registre porte le mouvement.
    const registre = await prisma.toumaLedgerEntry.findMany({ where: { referenceType: 'ToumaRefund' } });
    assert.ok(
      registre.some((e) => e.referenceId === lignes[0].id),
      'le remboursement entre au registre comptable',
    );
  });

  it('refuse qu’on désigne à la fois le paiement et la commande', async () => {
    const { orderId, paymentId } = await commandeLivree('7000', 1);
    const res = await api.post('/api/v1/payments/refund', { orderId, paymentId, amount: '100' }, admin.accessToken);
    assert.equal(res.status, 400);
  });

  it('reste réservé à l’administration', async () => {
    const { orderId } = await commandeLivree('7000', 1);
    const res = await api.post('/api/v1/payments/refund', { orderId, amount: '100' }, seller.accessToken);
    assert.equal(res.status, 403);
  });
});

describe('La fidélité distingue le gain de la reprise', () => {
  it('ne crédite qu’une fois par commande, mais reprend autant de fois qu’il y a de remboursements', async () => {
    // L'unicité (commande, type) visait le gain — « rejouer une livraison ne
    // crédite pas deux fois ». Appliquée à tous les types, elle faisait échouer
    // le deuxième remboursement partiel d'une commande, et le serveur
    // répondait 500.
    const { orderId } = await commandeLivree('20000', 1);

    const a = await api.post('/api/v1/payments/refund', { orderId, amount: '5000', reason: 'Premier' }, admin.accessToken);
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const b = await api.post('/api/v1/payments/refund', { orderId, amount: '5000', reason: 'Second' }, admin.accessToken);
    assert.equal(b.status, 201, 'un second remboursement partiel ne doit pas faire tomber le serveur');

    const gains = await prisma.toumaLoyaltyEvent.count({ where: { orderId, type: 'EARNED' } });
    assert.ok(gains <= 1, 'un seul gain par commande, quoi qu’il arrive');
  });
});

describe('Idempotence des opérations financières', () => {
  it('rejoue la réponse d’origine au lieu de rembourser deux fois', async () => {
    // Le cas réel : le réseau coupe entre l'envoi et la réponse, le client
    // renvoie. Sans clé, c'est un second remboursement.
    const { orderId } = await commandeLivree('15000', 1);
    const cle = `remb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const a = await api.post('/api/v1/payments/refund', { orderId, amount: '3000', reason: 'Geste' }, admin.accessToken, {
      'idempotency-key': cle,
    });
    assert.equal(a.status, 201, JSON.stringify(a.body));

    const b = await api.post('/api/v1/payments/refund', { orderId, amount: '3000', reason: 'Geste' }, admin.accessToken, {
      'idempotency-key': cle,
    });
    assert.equal(b.status, 201, 'la requête rejouée reçoit la réponse d’origine, pas une erreur');
    assert.equal(b.headers.get('idempotent-replay'), 'true', 'et elle est signalée comme rejeu');
    assert.deepEqual(b.body, a.body, 'la réponse est identique, au caractère près');

    // Un seul mouvement d'argent.
    const lignes = await prisma.toumaRefund.findMany({ where: { orderId } });
    assert.equal(lignes.length, 1, 'un seul remboursement, malgré deux requêtes');

    const paiement = await prisma.toumaRefund.aggregate({ where: { orderId }, _sum: { amount: true } });
    assert.equal(paiement._sum.amount?.toString(), '3000');
  });

  it('refuse une clé déjà employée pour une requête différente', async () => {
    // Le client s'est trompé de clé. Lui servir la réponse d'une autre
    // opération serait pire que de le lui dire.
    const { orderId } = await commandeLivree('15000', 1);
    const cle = `melange-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const a = await api.post('/api/v1/payments/refund', { orderId, amount: '2000', reason: 'A' }, admin.accessToken, {
      'idempotency-key': cle,
    });
    assert.equal(a.status, 201);

    const b = await api.post('/api/v1/payments/refund', { orderId, amount: '5000', reason: 'B' }, admin.accessToken, {
      'idempotency-key': cle,
    });
    assert.equal(b.status, 409);
    assert.match(b.body.error, /requête différente/i);

    const lignes = await prisma.toumaRefund.count({ where: { orderId } });
    assert.equal(lignes, 1, 'la seconde requête n’a rien créé');
  });

  it('laisse passer une requête sans clé : l’idempotence est une ceinture, pas la seule', async () => {
    const { orderId } = await commandeLivree('9000', 1);
    const res = await api.post('/api/v1/payments/refund', { orderId, amount: '1000', reason: 'Sans clé' }, admin.accessToken);
    assert.equal(res.status, 201);
  });

  it('ne confond pas deux opérations différentes portant la même clé', async () => {
    // La clé est portée par (demandeur, opération) : la même chaîne employée
    // sur deux routes n'est pas la même clé.
    const { orderId } = await commandeLivree('9000', 1);
    const cle = `partagee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const remboursement = await api.post('/api/v1/payments/refund', { orderId, amount: '1000' }, admin.accessToken, {
      'idempotency-key': cle,
    });
    assert.equal(remboursement.status, 201);

    // Même clé, autre opération : elle doit être acceptée, pas rejouée.
    const paiement = await api.post(
      '/api/v1/payments/create',
      { orderId, method: 'MOBILE_MONEY' },
      buyer.accessToken,
      { 'idempotency-key': cle },
    );
    assert.notEqual(paiement.headers.get('idempotent-replay'), 'true', 'aucun rejeu entre deux opérations distinctes');
  });
});

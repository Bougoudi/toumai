import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { refreshEligibility, settlementService } from '../../src/touma/finance/settlement.service.js';

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

describe('Le balayage d’éligibilité', () => {
  it('examine toutes les parts, pas seulement les 500 premières', async () => {
    // Le défaut : un seul `take: 500`, sans ordre ni suite. Au-delà de 500
    // parts en attente — une situation ordinaire pour une place de marché —
    // les suivantes n'étaient jamais examinées. Aucune erreur, aucun journal :
    // des vendeurs cessaient d'être réglés et le balayage semblait fonctionner.
    //
    // On fabrique le volume directement en base : dérouler 500 commandes par
    // l'API prendrait des minutes sans rien prouver de plus.
    const { orderId, paymentId } = await commandeLivree('10000', 1);
    await prisma.toumaOrder.update({
      where: { id: orderId },
      data: { deliveredAt: new Date(Date.now() - 60 * 86_400_000) },
    });

    // Parts rattachées à des commandes NON livrées : elles restent en attente et
    // occupent la file, exactement comme en exploitation.
    let total = await prisma.toumaSettlementAllocation.count({ where: { status: 'PENDING' } });
    const gabarit = await prisma.toumaSettlementAllocation.findFirstOrThrow({ where: { orderId } });
    const factices: string[] = [];
    while (total < 520) {
      const commande = await prisma.toumaOrder.create({
        data: {
          orderNumber: `TM-BOURRAGE-${Date.now()}-${total}`,
          buyerId: buyer.user.id,
          storeId,
          currency: 'XAF',
          subtotal: '1000',
          shippingTotal: '0',
          commissionTotal: '50',
          commissionRate: '0.05',
          total: '1000',
          status: 'PAID',
          shippingSnapshot: {},
          buyerCountry: 'TD',
          sellerCountry: 'TD',
        },
      });
      await prisma.toumaSettlementAllocation.create({
        data: {
          paymentId: gabarit.paymentId,
          orderId: commande.id,
          storeId,
          currency: 'XAF',
          grossAmount: '1000',
          shippingAmount: '0',
          commissionAmount: '50',
          refundedAmount: '0',
          status: 'PENDING',
        },
      });
      factices.push(commande.id);
      total += 1;
    }

    const resultat = await refreshEligibility();
    assert.ok(resultat.examined >= 520, `seulement ${resultat.examined} parts examinées sur ${total}`);
    assert.equal(resultat.truncated, false, 'le balayage ne doit pas s’interrompre à ce volume');

    // Et la part qui nous intéresse, livrée et hors fenêtre, a bien basculé —
    // qu'elle soit la 3e ou la 517e de la file.
    assert.equal((await prisma.toumaSettlementAllocation.findUniqueOrThrow({ where: { orderId } })).status, 'ELIGIBLE');

    await prisma.toumaSettlementAllocation.deleteMany({ where: { orderId: { in: factices } } });
    await prisma.toumaOrder.deleteMany({ where: { id: { in: factices } } });
    assert.ok(paymentId);
  });
});

describe('Règlement des vendeurs', () => {
  it('crée une part à l’encaissement, et elle attend la fenêtre de protection', async () => {
    // Le défaut : aucun objet ne disait quelle boutique attendait quoi sur quel
    // paiement. Le versement était un modèle mort.
    const { orderId } = await commandeLivree('20000', 1);

    const part = await prisma.toumaSettlementAllocation.findUnique({ where: { orderId } });
    assert.ok(part, 'la part naît de l’encaissement');
    assert.equal(part!.status, 'PENDING', 'elle attend : livrer ne suffit pas, la fenêtre court');
    assert.ok(part!.commissionAmount.greaterThan(0), 'la commission y figure');

    // Le net est calculé, jamais stocké.
    const net = settlementService.netOf(part!);
    assert.equal(
      net.toString(),
      part!.grossAmount.plus(part!.shippingAmount).minus(part!.commissionAmount).toString(),
    );
  });

  it('ne devient réglable qu’après la fenêtre, et jamais avec un litige ouvert', async () => {
    const { orderId } = await commandeLivree('20000', 1);

    // Fenêtre non écoulée : rien ne bouge.
    assert.equal((await refreshEligibility()).promoted, 0, 'la fenêtre de protection est respectée');

    // On recule la livraison au-delà de la fenêtre.
    await prisma.toumaOrder.update({
      where: { id: orderId },
      data: { deliveredAt: new Date(Date.now() - 60 * 86_400_000) },
    });

    // Un litige ouvert retient l'argent, même la fenêtre passée.
    const litige = await api.post('/api/v1/disputes', { orderId, reason: 'DAMAGED', category: 'DAMAGED_ITEM' }, buyer.accessToken);
    assert.equal(litige.status, 201, JSON.stringify(litige.body));
    await refreshEligibility();
    assert.equal(
      (await prisma.toumaSettlementAllocation.findUniqueOrThrow({ where: { orderId } })).status,
      'PENDING',
      'un litige ouvert retient la part',
    );

    // Litige tranché : la part devient réglable.
    await api.post(
      `/api/v1/disputes/${litige.body.id}/resolve`,
      { decision: 'RESOLVED_SELLER', resolution: 'Réclamation non fondée.', resolutionType: 'NO_REFUND' },
      admin.accessToken,
    );
    await refreshEligibility();
    assert.equal(
      (await prisma.toumaSettlementAllocation.findUniqueOrThrow({ where: { orderId } })).status,
      'ELIGIBLE',
    );
  });

  it('annule une part intégralement remboursée au lieu de la régler à zéro', async () => {
    const { orderId } = await commandeLivree('10000', 1);
    await api.post('/api/v1/payments/refund', { orderId }, admin.accessToken);

    await prisma.toumaOrder.update({ where: { id: orderId }, data: { deliveredAt: new Date(Date.now() - 60 * 86_400_000) } });
    await refreshEligibility();

    const part = await prisma.toumaSettlementAllocation.findUniqueOrThrow({ where: { orderId } });
    assert.equal(part.status, 'CANCELLED', 'payer zéro franc est une écriture inutile qui brouille l’histoire');
  });

  it('regroupe les parts réglables en un versement, retenu et libéré avec motif', async () => {
    const { orderId } = await commandeLivree('30000', 1);
    await prisma.toumaOrder.update({ where: { id: orderId }, data: { deliveredAt: new Date(Date.now() - 60 * 86_400_000) } });
    await refreshEligibility();

    const creation = await api.post('/api/v1/admin/finance/payouts', { storeId, currency: 'XAF' }, admin.accessToken);
    assert.equal(creation.status, 201, JSON.stringify(creation.body));
    assert.equal(creation.body.status, 'ELIGIBLE');
    const payoutId = creation.body.id;

    // Les parts sont rattachées : on ne les règle pas deux fois.
    const secondeFois = await api.post('/api/v1/admin/finance/payouts', { storeId, currency: 'XAF' }, admin.accessToken);
    assert.equal(secondeFois.status, 409, 'plus rien de réglable une fois rattaché');

    // Retenue : motif obligatoire.
    const sansMotif = await api.post(`/api/v1/admin/finance/payouts/${payoutId}/hold`, {}, admin.accessToken);
    assert.equal(sansMotif.status, 400, 'un versement retenu sans raison est un vol silencieux du point de vue du vendeur');

    const retenu = await api.post(`/api/v1/admin/finance/payouts/${payoutId}/hold`, { reason: 'Vérification en cours' }, admin.accessToken);
    assert.equal(retenu.status, 200);
    assert.equal(retenu.body.status, 'ON_HOLD');
    assert.equal(retenu.body.holdReason, 'Vérification en cours');

    const libere = await api.post(`/api/v1/admin/finance/payouts/${payoutId}/release`, {}, admin.accessToken);
    assert.equal(libere.body.status, 'ELIGIBLE');

    const execute = await api.post(`/api/v1/admin/finance/payouts/${payoutId}/process`, { providerRef: 'VIR-TEST-1' }, admin.accessToken);
    assert.equal(execute.body.status, 'PAID');
    assert.ok(execute.body.paidAt, 'la date d’exécution est consignée');
  });

  it('annuler un versement rend ses parts au vendeur', async () => {
    const { orderId } = await commandeLivree('25000', 1);
    await prisma.toumaOrder.update({ where: { id: orderId }, data: { deliveredAt: new Date(Date.now() - 60 * 86_400_000) } });
    await refreshEligibility();

    const creation = await api.post('/api/v1/admin/finance/payouts', { storeId, currency: 'XAF' }, admin.accessToken);
    assert.equal(creation.status, 201);

    const annule = await api.post(
      `/api/v1/admin/finance/payouts/${creation.body.id}/cancel`,
      { reason: 'Créé par erreur' },
      admin.accessToken,
    );
    assert.equal(annule.body.status, 'CANCELLED');

    // Sans cela, annuler un versement ferait disparaître ce qui est dû.
    const part = await prisma.toumaSettlementAllocation.findUniqueOrThrow({ where: { orderId } });
    assert.equal(part.status, 'ELIGIBLE');
    assert.equal(part.payoutId, null);
  });

  it('ne montre à un vendeur que ses propres boutiques', async () => {
    const autre = await registerUser(api, { name: 'Autre vendeur', email: uniqueEmail('fin-seller2'), role: 'SELLER', countryCode: 'TD' });
    const res = await api.get(`/api/v1/seller/finance?store=${storeId}`, autre.accessToken);
    // Anti-IDOR : « introuvable », jamais « interdit ».
    assert.equal(res.status, 404);
  });

  it('rend les soldes par devise, jamais additionnés', async () => {
    const res = await api.get('/api/v1/seller/finance', seller.accessToken);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.balances), 'un solde par devise');
    assert.equal(res.body.protectionDays > 0, true, 'la fenêtre de protection est annoncée');
  });
});

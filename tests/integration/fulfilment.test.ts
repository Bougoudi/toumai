import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { expireStaleReservations, RESERVATION_MINUTES, resetSweepThrottle } from '../../src/touma/orders/reservation.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Exécution des commandes (V15).
 *
 * Trois défauts réels étaient en jeu, et ces tests existent pour qu'ils ne
 * reviennent pas : le stock réservé pour toujours, le statut de commande
 * globale figé à « payée », et l'absence d'étape « prêt à expédier ».
 */
const api = new TestApi();

let buyer: any;
let sellerTd: any;
let sellerCm: any;
let storeTd: string;
let productTd: string;
let productCm: string;

/** Crée un produit neuf : chaque test a son propre stock, sans interférence. */
async function nouveauProduit(seller: any, storeId: string, quantity: number, price = '10000') {
  const res = await api.post(
    '/api/v1/products',
    { storeId, title: `Lot ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, price, quantity, weightGrams: 1000, status: 'ACTIVE' },
    seller.accessToken,
  );
  return res.body.id as string;
}

/** Stock réellement disponible à la vente. */
async function stock(productId: string) {
  const inv = await prisma.toumaInventory.findFirst({ where: { productId }, select: { quantity: true, reserved: true } });
  return { quantity: inv?.quantity ?? 0, reserved: inv?.reserved ?? 0 };
}

/** Vieillit une commande pour la faire tomber hors du délai de réservation. */
async function vieillir(orderId: string, minutes = RESERVATION_MINUTES + 5) {
  await prisma.toumaOrder.update({
    where: { id: orderId },
    data: { placedAt: new Date(Date.now() - minutes * 60_000) },
  });
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  sellerTd = await registerUser(api, { name: 'Vendeur TD', email: uniqueEmail('fu-td'), role: 'SELLER', countryCode: 'TD' });
  sellerCm = await registerUser(api, { name: 'Vendeur CM', email: uniqueEmail('fu-cm'), role: 'SELLER', countryCode: 'CM' });

  storeTd = (await api.post('/api/v1/stores', { name: `Boutique TD ${Date.now()}`, countryCode: 'TD' }, sellerTd.accessToken)).body.id;
  const storeCm = (await api.post('/api/v1/stores', { name: `Boutique CM ${Date.now()}`, countryCode: 'CM' }, sellerCm.accessToken)).body.id;

  productTd = await nouveauProduit(sellerTd, storeTd, 50);
  productCm = await nouveauProduit(sellerCm, storeCm, 50);

  buyer = await registerUser(api, { name: 'Acheteur', email: uniqueEmail('fu-buyer'), role: 'BUYER', countryCode: 'TD' });
  buyer.addressId = (
    await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Acheteur', phone: '+23590000123', line1: 'Rue 5', district: 'Klemat', city: "N'Djamena", countryCode: 'TD' },
      buyer.accessToken,
    )
  ).body.id;
});
after(async () => api.stop());

describe('Réservation de stock : elle finit par expirer', () => {
  it('libère le stock d’une commande restée impayée, et n’en libère pas deux fois', async () => {
    const produit = await nouveauProduit(sellerTd, storeTd, 10);
    await api.post('/api/v1/cart/items', { productId: produit, quantity: 4 }, buyer.accessToken);
    const commande = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    assert.equal(commande.status, 201);
    const orderId = commande.body.orders[0].id;

    // Le stock est sorti du catalogue : c'est voulu, c'est ce qui empêche la survente.
    assert.deepEqual(await stock(produit), { quantity: 6, reserved: 4 });

    // Tant que le délai n'est pas écoulé, on ne touche à rien.
    //
    // Le balayage est **global** par nature : il annule les réservations
    // périmées de toute la base. Compter ses annulations totales ferait donc
    // dépendre ce test des commandes que les autres suites laissent vieillir
    // au même moment. C'est notre commande qu'on observe, et notre stock.
    resetSweepThrottle();
    await expireStaleReservations();
    assert.equal(
      (await prisma.toumaOrder.findUnique({ where: { id: orderId }, select: { status: true } }))?.status,
      'PENDING',
      'avant le délai, la commande n’est pas touchée',
    );
    assert.deepEqual(await stock(produit), { quantity: 6, reserved: 4 });

    // Passé le délai, le stock revient exactement comme il est parti.
    await vieillir(orderId);
    const premier = await expireStaleReservations();
    assert.ok(premier.cancelled >= 1);
    assert.deepEqual(await stock(produit), { quantity: 10, reserved: 0 }, 'quantity remonte ET reserved redescend');

    const apres = await prisma.toumaOrder.findUnique({ where: { id: orderId }, select: { status: true, cancelReason: true } });
    assert.equal(apres?.status, 'CANCELLED');
    assert.match(apres?.cancelReason ?? '', /expirée/i);

    // Rejouer le balayage ne libère pas une seconde fois — sinon le stock
    // enflerait à chaque exécution. C'est le stock qui le prouve, pas le
    // compteur global du balayage.
    await expireStaleReservations();
    assert.deepEqual(await stock(produit), { quantity: 10, reserved: 0 });
  });

  it('ne touche JAMAIS une commande dont le paiement est engagé', async () => {
    // Le cas dangereux : l'acheteur est chez son opérateur Mobile Money, la
    // commande est encore « en attente ». L'annuler ici, c'est encaisser une
    // commande annulée.
    const produit = await nouveauProduit(sellerTd, storeTd, 8);
    await api.post('/api/v1/cart/items', { productId: produit, quantity: 3 }, buyer.accessToken);
    const commande = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    const orderId = commande.body.orders[0].id;

    await api.post('/api/v1/payments/create', { orderId, method: 'MOBILE_MONEY' }, buyer.accessToken);
    await vieillir(orderId);

    await expireStaleReservations();
    const apres = await prisma.toumaOrder.findUnique({ where: { id: orderId }, select: { status: true } });
    assert.notEqual(apres?.status, 'CANCELLED', 'une commande en cours de paiement reste intouchée');
    assert.deepEqual(await stock(produit), { quantity: 5, reserved: 3 }, 'le stock reste réservé');
  });

  it('annule le groupe quand plus aucune sous-commande ne survit', async () => {
    const a = await nouveauProduit(sellerTd, storeTd, 5);
    const b = await nouveauProduit(sellerCm, (await prisma.toumaStore.findFirstOrThrow({ where: { ownerId: sellerCm.user.id } })).id, 5);
    await api.post('/api/v1/cart/items', { productId: a, quantity: 1 }, buyer.accessToken);
    await api.post('/api/v1/cart/items', { productId: b, quantity: 1 }, buyer.accessToken);
    const commande = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    assert.equal(commande.body.orders.length, 2);

    for (const o of commande.body.orders) await vieillir(o.id);
    await expireStaleReservations();

    const groupe = await prisma.toumaOrderGroup.findUnique({ where: { id: commande.body.group.id }, select: { status: true } });
    assert.equal(groupe?.status, 'CANCELLED');
  });
});

describe('Statut de la commande globale : il suit vraiment les vendeurs', () => {
  it('passe par « partiellement expédiée » puis « partiellement livrée »', async () => {
    const a = await nouveauProduit(sellerTd, storeTd, 5);
    const storeCmId = (await prisma.toumaStore.findFirstOrThrow({ where: { ownerId: sellerCm.user.id } })).id;
    const b = await nouveauProduit(sellerCm, storeCmId, 5);
    await api.post('/api/v1/cart/items', { productId: a, quantity: 1 }, buyer.accessToken);
    await api.post('/api/v1/cart/items', { productId: b, quantity: 1 }, buyer.accessToken);

    const commande = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    const groupId = commande.body.group.id;
    const [ordreA, ordreB] = commande.body.orders;

    const paiement = await api.post('/api/v1/payments/create', { orderGroupId: groupId, method: 'MOBILE_MONEY' }, buyer.accessToken);
    await api.post('/api/v1/payments/confirm', { paymentId: paiement.body.payment.id }, buyer.accessToken);

    const lire = async () => (await prisma.toumaOrderGroup.findUnique({ where: { id: groupId }, select: { status: true } }))?.status;
    assert.equal(await lire(), 'PAID');

    const vendeurA = ordreA.store.id === storeTd ? sellerTd : sellerCm;
    const vendeurB = ordreB.store.id === storeTd ? sellerTd : sellerCm;

    // Un seul vendeur avance : la commande globale ne peut plus dire « payée ».
    await api.post(`/api/v1/orders/${ordreA.id}/confirm`, {}, vendeurA.accessToken);
    await api.post(`/api/v1/orders/${ordreA.id}/process`, {}, vendeurA.accessToken);
    assert.equal(await lire(), 'PROCESSING');

    await api.post(`/api/v1/orders/${ordreA.id}/ready-to-ship`, {}, vendeurA.accessToken);
    await api.post(`/api/v1/orders/${ordreA.id}/ship`, {}, vendeurA.accessToken);
    assert.equal(await lire(), 'PARTIALLY_SHIPPED', 'un colis parti, l’autre non');

    await api.post(`/api/v1/orders/${ordreA.id}/deliver`, {}, vendeurA.accessToken);
    assert.equal(await lire(), 'PARTIALLY_DELIVERED', 'un colis reçu, l’autre non');

    // Le second rattrape : la commande devient enfin livrée.
    await api.post(`/api/v1/orders/${ordreB.id}/confirm`, {}, vendeurB.accessToken);
    await api.post(`/api/v1/orders/${ordreB.id}/process`, {}, vendeurB.accessToken);
    await api.post(`/api/v1/orders/${ordreB.id}/ship`, {}, vendeurB.accessToken);
    await api.post(`/api/v1/orders/${ordreB.id}/deliver`, {}, vendeurB.accessToken);
    assert.equal(await lire(), 'DELIVERED');
  });
});

describe('Étape « prêt à expédier »', () => {
  it('s’intercale entre la préparation et l’expédition', async () => {
    const produit = await nouveauProduit(sellerTd, storeTd, 5);
    await api.post('/api/v1/cart/items', { productId: produit, quantity: 1 }, buyer.accessToken);
    const commande = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    const orderId = commande.body.orders[0].id;
    const paiement = await api.post('/api/v1/payments/create', { orderId, method: 'MOBILE_MONEY' }, buyer.accessToken);
    await api.post('/api/v1/payments/confirm', { paymentId: paiement.body.payment.id }, buyer.accessToken);

    await api.post(`/api/v1/orders/${orderId}/process`, {}, sellerTd.accessToken);
    const pret = await api.post(`/api/v1/orders/${orderId}/ready-to-ship`, {}, sellerTd.accessToken);
    assert.equal(pret.status, 200);
    assert.equal(pret.body.status, 'READY_TO_SHIP');

    // Une transition en arrière reste refusée.
    const retour = await api.post(`/api/v1/orders/${orderId}/process`, {}, sellerTd.accessToken);
    assert.equal(retour.status, 409);
  });

  it('reste interdite à l’acheteur', async () => {
    const produit = await nouveauProduit(sellerTd, storeTd, 5);
    await api.post('/api/v1/cart/items', { productId: produit, quantity: 1 }, buyer.accessToken);
    const commande = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    const refus = await api.post(`/api/v1/orders/${commande.body.orders[0].id}/ready-to-ship`, {}, buyer.accessToken);
    assert.equal(refus.status, 403);
  });
});

describe('Paliers de prix B2B', () => {
  it('le serveur applique le palier, et la ligne garde la trace du prix', async () => {
    const produit = await nouveauProduit(sellerTd, storeTd, 500, '3000');

    const grille = await api.put(
      `/api/v1/products/${produit}/paliers`,
      { tiers: [{ minQuantity: 10, unitPrice: '2800' }, { minQuantity: 100, unitPrice: '2600' }] },
      sellerTd.accessToken,
    );
    assert.equal(grille.status, 200);
    assert.equal(grille.body.tiers.length, 2);

    // 120 unités : le palier à 100 s'applique, sans que personne ne le demande.
    await api.post('/api/v1/cart/items', { productId: produit, quantity: 120 }, buyer.accessToken);
    const commande = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    assert.equal(commande.status, 201);

    const ligne = await prisma.toumaOrderItem.findFirstOrThrow({
      where: { orderId: commande.body.orders[0].id },
      select: { unitPrice: true, lineTotal: true, metadata: true },
    });
    assert.equal(ligne.unitPrice.toString(), '2600');
    assert.equal(ligne.lineTotal.toString(), '312000', '120 × 2 600');
    assert.deepEqual((ligne.metadata as any).appliedTier, { minQuantity: 100, unitPrice: '2600' });
    assert.equal((ligne.metadata as any).listPrice, '3000');
  });

  it('la grille est visible sans compte : un acheteur de gros doit pouvoir la lire', async () => {
    const produit = await nouveauProduit(sellerTd, storeTd, 100, '5000');
    await api.put(`/api/v1/products/${produit}/paliers`, { tiers: [{ minQuantity: 20, unitPrice: '4500' }] }, sellerTd.accessToken);

    const publique = await api.get(`/api/v1/products/${produit}/paliers`);
    assert.equal(publique.status, 200);
    assert.equal(publique.body.listPrice, '5000');
    assert.equal(publique.body.tiers[0].minQuantity, 20);
  });

  it('un autre vendeur ne peut pas fixer les prix de la boutique d’à côté', async () => {
    const produit = await nouveauProduit(sellerTd, storeTd, 10);
    const intrus = await api.put(
      `/api/v1/products/${produit}/paliers`,
      { tiers: [{ minQuantity: 2, unitPrice: '1' }] },
      sellerCm.accessToken,
    );
    // Anti-IDOR : « introuvable », jamais « interdit ».
    assert.equal(intrus.status, 404);
  });

  it('refuse une grille incohérente', async () => {
    const produit = await nouveauProduit(sellerTd, storeTd, 10);
    const doublon = await api.put(
      `/api/v1/products/${produit}/paliers`,
      { tiers: [{ minQuantity: 10, unitPrice: '900' }, { minQuantity: 10, unitPrice: '800' }] },
      sellerTd.accessToken,
    );
    assert.equal(doublon.status, 400);

    const palierUnitaire = await api.put(`/api/v1/products/${produit}/paliers`, { tiers: [{ minQuantity: 1, unitPrice: '900' }] }, sellerTd.accessToken);
    assert.equal(palierUnitaire.status, 400, 'un palier commence au-dessus de l’unité');
  });
});

describe('Suivi d’une commande', () => {
  it('rend une liste d’expéditions, jamais un colis unique', async () => {
    const produit = await nouveauProduit(sellerTd, storeTd, 5);
    await api.post('/api/v1/cart/items', { productId: produit, quantity: 1 }, buyer.accessToken);
    const commande = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);

    const suivi = await api.get(`/api/v1/orders/${commande.body.orders[0].id}/tracking`, buyer.accessToken);
    assert.equal(suivi.status, 200);
    assert.ok(Array.isArray(suivi.body.shipments), 'une commande peut avoir plusieurs colis');
    assert.equal(suivi.body.orderNumber, commande.body.orders[0].orderNumber);
  });

  it('reste introuvable pour un tiers', async () => {
    const produit = await nouveauProduit(sellerTd, storeTd, 5);
    await api.post('/api/v1/cart/items', { productId: produit, quantity: 1 }, buyer.accessToken);
    const commande = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);

    const intrus = await api.get(`/api/v1/orders/${commande.body.orders[0].id}/tracking`, sellerCm.accessToken);
    assert.equal(intrus.status, 404);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { loadGeography } from '../../src/touma/geo/geography.loader.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Commerce entre provinces (§63, §64).
 *
 * Le scénario que le cahier des charges demande de tenir : un acheteur de
 * N'Djamena achète à un vendeur de Moundou, un acheteur d'Abéché à un vendeur de
 * N'Djamena, un acheteur de Faya-Largeau à un vendeur de Sarh. Ce qui est
 * vérifié ici n'est pas que « ça marche » — c'est que **la géographie reste
 * cohérente de bout en bout**, et qu'un instantané de commande ne bouge plus
 * quand l'adresse qui l'a produit change.
 */
const api = new TestApi();

let acheteurs: Record<string, any> = {};
let vendeur: any;
let storeId: string;
const provinces: Record<string, any> = {};

/** Trouve une province par un fragment de son nom, tel que la source l'écrit. */
async function province(fragment: string) {
  return prisma.toumaProvince.findFirstOrThrow({
    where: { countryCode: 'TD', name: { contains: fragment, mode: 'insensitive' } },
  });
}

/** Adresse d'un acheteur, rattachée à une province réelle. */
async function adresseDans(user: any, provinceId: string, ville: string) {
  const res = await api.post(
    '/api/v1/auth/me/addresses',
    { fullName: 'Destinataire', phone: '+23566000010', line1: 'Quartier central', city: ville, countryCode: 'TD', provinceId },
    user.accessToken,
  );
  assert.equal(res.status, 201, `adresse à ${ville} : ${JSON.stringify(res.body)}`);
  return res.body.id;
}

/** Mène une commande du panier à l'expédition, et rend ce qu'il faut vérifier. */
async function commandeVers(acheteur: any, addressId: string) {
  const produit = (
    await api.post(
      '/api/v1/products',
      { storeId, title: `Marchandise ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, price: '25000', quantity: 10, weightGrams: 1500, status: 'ACTIVE' },
      vendeur.accessToken,
    )
  ).body.id;

  await api.post('/api/v1/cart/items', { productId: produit, quantity: 1 }, acheteur.accessToken);
  const checkout = await api.post('/api/v1/checkout', { addressId }, acheteur.accessToken);
  assert.equal(checkout.status, 201, `checkout : ${JSON.stringify(checkout.body)}`);

  const orderId = checkout.body.orders[0].id;
  const paiement = await api.post('/api/v1/payments/create', { orderGroupId: checkout.body.group.id, method: 'MOBILE_MONEY' }, acheteur.accessToken);
  await api.post('/api/v1/payments/confirm', { paymentId: paiement.body.payment.id }, acheteur.accessToken);
  return orderId;
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
  await loadGeography('TD');

  provinces.ndjamena = await province('Djam');
  provinces.logoneOccidental = await province('Logone Occidental'); // Moundou
  provinces.ouaddai = await province('Ouada'); // Abéché
  provinces.moyenChari = await province('Moyen-Chari'); // Sarh
  provinces.tibesti = await province('Tibesti'); // Faya est au Borkou, le Tibesti est voisin
  provinces.borkou = await province('Borkou'); // Faya-Largeau

  vendeur = await registerUser(api, { name: 'Vendeur Moundou', email: uniqueEmail('xp-seller'), role: 'SELLER', countryCode: 'TD' });
  storeId = (await api.post('/api/v1/stores', { name: `Boutique Moundou ${Date.now()}`, countryCode: 'TD' }, vendeur.accessToken)).body.id;
  await prisma.toumaStore.update({
    where: { id: storeId },
    data: { status: 'ACTIVE', provinceId: provinces.logoneOccidental.id, city: 'Moundou' },
  });

  for (const [clef, nom] of [
    ['ndjamena', "N'Djamena"],
    ['abeche', 'Abéché'],
    ['faya', 'Faya-Largeau'],
  ] as const) {
    acheteurs[clef] = await registerUser(api, { name: `Acheteur ${nom}`, email: uniqueEmail(`xp-${clef}`), role: 'BUYER', countryCode: 'TD' });
  }
});

after(async () => {
  await api.stop();
});

describe('Une commande traverse le pays sans perdre sa géographie', () => {
  it('N’Djamena → Moundou : la commande garde la province de destination', async () => {
    const addressId = await adresseDans(acheteurs.ndjamena, provinces.ndjamena.id, "N'Djamena");
    const orderId = await commandeVers(acheteurs.ndjamena, addressId);

    const commande = await prisma.toumaOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { shippingAddress: { select: { provinceId: true } }, store: { select: { provinceId: true } } },
    });
    assert.equal(commande.shippingAddress?.provinceId, provinces.ndjamena.id, 'la destination est bien N’Djamena');
    assert.equal(commande.store.provinceId, provinces.logoneOccidental.id, 'le vendeur est bien au Logone Occidental');
    assert.equal(commande.buyerCountry, 'TD');
    assert.equal(commande.sellerCountry, 'TD');
    assert.equal(commande.crossBorder, false, 'une commande entre provinces n’est pas transfrontalière');
  });

  it('Abéché → Moundou, puis Faya-Largeau → Moundou : chaque destination reste la sienne', async () => {
    const abeche = await adresseDans(acheteurs.abeche, provinces.ouaddai.id, 'Abéché');
    const faya = await adresseDans(acheteurs.faya, provinces.borkou.id, 'Faya-Largeau');

    const commandeAbeche = await commandeVers(acheteurs.abeche, abeche);
    const commandeFaya = await commandeVers(acheteurs.faya, faya);

    const [a, f] = await Promise.all([
      prisma.toumaOrder.findUniqueOrThrow({ where: { id: commandeAbeche }, include: { shippingAddress: { select: { provinceId: true } } } }),
      prisma.toumaOrder.findUniqueOrThrow({ where: { id: commandeFaya }, include: { shippingAddress: { select: { provinceId: true } } } }),
    ]);

    assert.equal(a.shippingAddress?.provinceId, provinces.ouaddai.id);
    assert.equal(f.shippingAddress?.provinceId, provinces.borkou.id);
    assert.notEqual(a.shippingAddress?.provinceId, f.shippingAddress?.provinceId, 'deux destinations distinctes ne se confondent pas');
  });

  it('fige l’instantané de livraison : modifier son adresse ne réécrit pas une commande passée', async () => {
    // C'est l'exigence du §55, et elle n'est pas théorique : quelqu'un qui
    // déménage ne doit pas voir ses commandes de l'an dernier changer de ville.
    const addressId = await adresseDans(acheteurs.ndjamena, provinces.ndjamena.id, "N'Djamena");
    const orderId = await commandeVers(acheteurs.ndjamena, addressId);

    const avant = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: orderId }, select: { shippingSnapshot: true } });
    const villeAvant = (avant.shippingSnapshot as Record<string, unknown>).city;
    assert.equal(villeAvant, "N'Djamena");

    // L'acheteur déménage.
    await prisma.toumaAddress.update({
      where: { id: addressId },
      data: { city: 'Sarh', provinceId: provinces.moyenChari.id },
    });

    const apres = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: orderId }, select: { shippingSnapshot: true } });
    assert.equal(
      (apres.shippingSnapshot as Record<string, unknown>).city,
      "N'Djamena",
      'la commande passée garde la ville où elle devait être livrée',
    );
  });
});

describe('Découverte entre provinces', () => {
  it('un acheteur d’une province voit les vendeurs d’une autre', async () => {
    // Le §14 est explicite : la proximité est un ordre de présentation, pas un
    // mur. Un vendeur de Moundou reste visible d'Abéché.
    const partout = await api.get('/api/v1/stores?country=TD&limit=100');
    assert.ok(partout.body.items.some((s: any) => s.id === storeId), 'le vendeur de Moundou est visible de tout le pays');

    const filtre = await api.get(`/api/v1/stores?country=TD&province=${provinces.logoneOccidental.id}`);
    assert.ok(filtre.body.items.some((s: any) => s.id === storeId), 'et il se trouve par sa province');

    const ailleurs = await api.get(`/api/v1/stores?country=TD&province=${provinces.ouaddai.id}`);
    assert.equal(ailleurs.body.items.some((s: any) => s.id === storeId), false, 'sans apparaître là où il n’est pas');
  });

  it('rend la province du vendeur dans sa fiche, pour que l’acheteur sache d’où part le colis', async () => {
    const fiche = await api.get(`/api/v1/stores/${storeId}`);
    assert.equal(fiche.status, 200);
    assert.equal(fiche.body.province?.id, provinces.logoneOccidental.id);
    assert.ok(fiche.body.province?.name, 'la province est nommée, pas seulement identifiée');
  });
});

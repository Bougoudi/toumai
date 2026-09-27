// Doit rester le premier import : les drapeaux sont lus au chargement de la
// configuration, donc avant tout le reste.
import '../helpers/growth-flags.js';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { flashSaleService } from '../../src/touma/growth/flash-sale.service.js';

const api = new TestApi();

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
});
after(async () => api.stop());

async function venteFlash(suffixe: string, options: { limite?: number; parAcheteur?: number; prix?: string } = {}) {
  const vendeur = await registerUser(api, {
    name: `Vendeur ${suffixe}`,
    email: uniqueEmail(`flash-${suffixe}`),
    role: 'SELLER',
  });
  const store = await prisma.toumaStore.create({
    data: {
      ownerId: vendeur.user.id,
      name: `B ${suffixe}`,
      slug: `b-flash-${suffixe}-${Date.now()}`,
      countryCode: 'TD',
      status: 'ACTIVE',
    },
  });
  const categorie = await prisma.toumaCategory.findFirstOrThrow();
  const produit = await prisma.toumaProduct.create({
    data: {
      storeId: store.id,
      categoryId: categorie.id,
      title: `Produit ${suffixe}`,
      slug: `p-flash-${suffixe}-${Date.now()}`,
      description: 'Test',
      price: '25000',
      currency: 'XAF',
      countryCode: 'TD',
      status: 'ACTIVE',
    },
  });
  const sale = await prisma.toumaFlashSale.create({
    data: {
      storeId: store.id,
      productId: produit.id,
      name: `Flash ${suffixe}`,
      price: options.prix ?? '15000',
      currency: 'XAF',
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - 3600_000),
      endsAt: new Date(Date.now() + 3600_000),
      quantityLimit: options.limite ?? 10,
      perUserLimit: options.parAcheteur ?? 1,
    },
  });
  return { vendeur, store, produit, sale };
}

async function acheteurs(n: number, suffixe: string) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(await registerUser(api, {
      name: `Acheteur ${suffixe}${i}`,
      email: uniqueEmail(`flash-a-${suffixe}-${i}`),
      role: 'BUYER',
    }));
  }
  return out;
}

describe('Vente flash — survente', () => {
  it('ne vend jamais plus que la limite, sous concurrence', async () => {
    // Le cas qui coûte des clients : vingt acheteurs simultanés sur cinq
    // unités. Une lecture-puis-écriture les laisserait tous passer, et il
    // faudrait annuler quinze commandes déjà payées.
    const { sale } = await venteFlash('concurrent', { limite: 5 });
    const gens = await acheteurs(20, 'c');

    const resultats = await Promise.all(
      gens.map((g) => flashSaleService.reserve(sale.id, g.user.id, 1)),
    );
    const acceptes = resultats.filter((r) => r !== null).length;
    assert.equal(acceptes, 5, `5 réservations attendues, ${acceptes} accordées`);

    const apres = await prisma.toumaFlashSale.findUniqueOrThrow({ where: { id: sale.id } });
    assert.equal(apres.reserved, 5, 'le compteur ne dépasse jamais la limite');

    const claims = await prisma.toumaFlashSaleClaim.count({ where: { flashSaleId: sale.id } });
    assert.equal(claims, 5, 'autant de réservations consignées que d’unités accordées');
  });

  it('rend le prix réduit à qui réserve, et rien à qui arrive trop tard', async () => {
    const { sale } = await venteFlash('tardif', { limite: 1 });
    const [tot, tard] = await acheteurs(2, 't');

    const premier = await flashSaleService.reserve(sale.id, tot.user.id, 1);
    assert.equal(premier?.price.toString(), '15000');

    const second = await flashSaleService.reserve(sale.id, tard.user.id, 1);
    // `null`, pas une erreur : l'acheteur doit pouvoir acheter au prix normal.
    assert.equal(second, null);
  });

  it('tient la limite par acheteur même entre deux onglets', async () => {
    // L'unicité est en base : deux appels simultanés du même compte ne
    // peuvent pas en obtenir deux.
    const { sale } = await venteFlash('onglets', { limite: 10, parAcheteur: 1 });
    const [gourmand] = await acheteurs(1, 'o');

    const [a, b] = await Promise.all([
      flashSaleService.reserve(sale.id, gourmand.user.id, 1),
      flashSaleService.reserve(sale.id, gourmand.user.id, 1),
    ]);
    const obtenues = [a, b].filter((r) => r !== null).length;
    assert.equal(obtenues, 1, `une seule réservation attendue, ${obtenues} obtenues`);

    const apres = await prisma.toumaFlashSale.findUniqueOrThrow({ where: { id: sale.id } });
    // La seconde transaction est annulée en entier : son incrément aussi.
    assert.equal(apres.reserved, 1, 'la réservation refusée ne doit pas consommer une unité');
  });

  it('refuse une quantité supérieure à la limite par acheteur', async () => {
    const { sale } = await venteFlash('quantite', { limite: 10, parAcheteur: 2 });
    const [g] = await acheteurs(1, 'q');
    assert.equal(await flashSaleService.reserve(sale.id, g.user.id, 3), null);
    assert.notEqual(await flashSaleService.reserve(sale.id, g.user.id, 2), null);
  });

  it('libère une réservation abandonnée, sans jamais passer sous zéro', async () => {
    // Sans libération, un panier abandonné retirerait des unités pour
    // toujours et la vente afficherait « épuisée » avec du stock en réserve.
    const { sale } = await venteFlash('abandon', { limite: 3, parAcheteur: 2 });
    const [g] = await acheteurs(1, 'ab');

    await flashSaleService.reserve(sale.id, g.user.id, 2);
    assert.equal((await prisma.toumaFlashSale.findUniqueOrThrow({ where: { id: sale.id } })).reserved, 2);

    await flashSaleService.release(sale.id, g.user.id);
    assert.equal((await prisma.toumaFlashSale.findUniqueOrThrow({ where: { id: sale.id } })).reserved, 0);

    // Rejouer la libération ne doit pas rendre le compteur négatif.
    await flashSaleService.release(sale.id, g.user.id);
    assert.equal((await prisma.toumaFlashSale.findUniqueOrThrow({ where: { id: sale.id } })).reserved, 0);
  });

  it('ne libère pas une réservation déjà consommée par une commande', async () => {
    const { sale } = await venteFlash('consommee', { limite: 3 });
    const [g] = await acheteurs(1, 'co');
    await flashSaleService.reserve(sale.id, g.user.id, 1);
    await flashSaleService.attachOrder(sale.id, g.user.id, 'commande-x');

    await flashSaleService.release(sale.id, g.user.id);
    const apres = await prisma.toumaFlashSale.findUniqueOrThrow({ where: { id: sale.id } });
    assert.equal(apres.reserved, 1, 'une vente réellement faite ne se libère pas');
  });
});

describe('Vente flash — fenêtre et offre', () => {
  it('n’offre rien avant le début ni après la fin', async () => {
    const { sale, produit } = await venteFlash('fenetre', { limite: 5 });
    await prisma.toumaFlashSale.update({
      where: { id: sale.id },
      data: { startsAt: new Date(Date.now() + 3600_000), endsAt: new Date(Date.now() + 7200_000) },
    });
    assert.equal(await flashSaleService.activeFor(produit.id), null);
    assert.equal(await flashSaleService.reserve(sale.id, 'peu-importe', 1), null);

    await prisma.toumaFlashSale.update({
      where: { id: sale.id },
      data: { startsAt: new Date(Date.now() - 7200_000), endsAt: new Date(Date.now() - 3600_000) },
    });
    assert.equal(await flashSaleService.activeFor(produit.id), null);
  });

  it('cesse d’afficher une vente épuisée', async () => {
    // Afficher un prix qu'on ne peut plus obtenir est pire que ne rien
    // afficher : l'acheteur clique, puis découvre autre chose.
    const { sale, produit } = await venteFlash('epuisee', { limite: 1 });
    const [g] = await acheteurs(1, 'ep');
    assert.notEqual(await flashSaleService.activeFor(produit.id), null);
    await flashSaleService.reserve(sale.id, g.user.id, 1);
    assert.equal(await flashSaleService.activeFor(produit.id), null);
  });

  it('annonce ce qui reste, jamais un nombre négatif', async () => {
    const { sale, produit } = await venteFlash('restant', { limite: 4 });
    const gens = await acheteurs(2, 'r');
    for (const g of gens) await flashSaleService.reserve(sale.id, g.user.id, 1);
    const vue = await flashSaleService.activeFor(produit.id);
    assert.equal(vue?.remaining, 2);
  });

  it('clôt les ventes dont la fenêtre est passée', async () => {
    const { sale } = await venteFlash('close', { limite: 2 });
    await prisma.toumaFlashSale.update({
      where: { id: sale.id },
      data: { endsAt: new Date(Date.now() - 1000) },
    });
    await flashSaleService.closeExpired();
    const apres = await prisma.toumaFlashSale.findUniqueOrThrow({ where: { id: sale.id } });
    assert.equal(apres.status, 'ENDED');
  });
});

describe('Vente flash — création', () => {
  it('refuse un prix qui n’est pas une remise', async () => {
    // Une « vente flash » au prix normal est une annonce trompeuse.
    const { vendeur, store, produit } = await venteFlash('prix');
    await assert.rejects(
      () =>
        flashSaleService.create(vendeur.user.id, 'SELLER', {
          storeId: store.id,
          productId: produit.id,
          name: 'Fausse remise',
          price: '25000',
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 172_800_000),
          quantityLimit: 5,
          perUserLimit: 1,
        }),
      /inférieur au prix courant/,
    );
  });

  it('refuse deux ventes qui se chevauchent sur le même produit', async () => {
    // Elles donneraient deux prix différents au même instant.
    const { vendeur, store, produit } = await venteFlash('chevauche');
    await assert.rejects(
      () =>
        flashSaleService.create(vendeur.user.id, 'SELLER', {
          storeId: store.id,
          productId: produit.id,
          name: 'Concurrente',
          price: '12000',
          startsAt: new Date(Date.now() - 1800_000),
          endsAt: new Date(Date.now() + 1800_000),
          quantityLimit: 5,
          perUserLimit: 1,
        }),
      /couvre déjà cette période/,
    );
  });

  it('refuse un vendeur sur la boutique d’un autre', async () => {
    const a = await venteFlash('proprio-a');
    const b = await venteFlash('proprio-b');
    await assert.rejects(
      () =>
        flashSaleService.create(b.vendeur.user.id, 'SELLER', {
          storeId: a.store.id,
          productId: a.produit.id,
          name: 'Intrusion',
          price: '10000',
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 172_800_000),
          quantityLimit: 5,
          perUserLimit: 1,
        }),
      /introuvable/,
    );
  });

  it('crée en brouillon, jamais active d’emblée', async () => {
    const { vendeur, store, produit } = await venteFlash('brouillon');
    const cree = await flashSaleService.create(vendeur.user.id, 'SELLER', {
      storeId: store.id,
      productId: produit.id,
      name: 'À relire',
      price: '11000',
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 172_800_000),
      quantityLimit: 5,
      perUserLimit: 1,
    });
    const enBase = await prisma.toumaFlashSale.findUniqueOrThrow({ where: { id: cree.id } });
    assert.equal(enBase.status, 'DRAFT');
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { ruptures } from '../../src/touma/market/stockout.js';

/**
 * RUPTURES AVEC DEMANDE OBSERVÉE (V29 §8).
 *
 * **Ce que le journal de V27 a rendu possible.** On savait qu'un produit était
 * à zéro ; jamais depuis quand. Or la durée est toute l'information : une
 * rupture de deux heures est un réassort en cours, une rupture de douze jours
 * sur un produit commandé est une vente perdue tous les jours depuis douze
 * jours.
 *
 * Et la limite que ces tests fixent tout autant : le journal n'existe que
 * depuis V27. Une rupture antérieure a une durée **inconnue** — ni zéro, ni
 * « depuis toujours ». Le second ferait paniquer un vendeur sur un article
 * qu'il a arrêté il y a six mois.
 */
const api = new TestApi();

let vendeur: any;
let autre: any;
let boutique: string;

const MAINTENANT = new Date('2026-09-26T12:00:00Z');
const ilYaJours = (n: number) => new Date(MAINTENANT.getTime() - n * 86_400_000);

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  vendeur = await registerUser(api, { name: 'Vendeur rupture', email: uniqueEmail(`sr-${s}`), role: 'SELLER' });
  autre = await registerUser(api, { name: 'Autre vendeur', email: uniqueEmail(`sa-${s}`), role: 'SELLER' });
  boutique = (await api.post('/api/v1/stores', { name: `Boutique rupture ${s}`, countryCode: 'TD' }, vendeur.accessToken)).body.id;
});

after(async () => api.stop());

/** Un produit à zéro, avec ou sans passage journalisé à zéro. */
async function produitEnRupture(options: { journalise: Date | null }) {
  const produit = (
    await api.post(
      '/api/v1/products',
      { storeId: boutique, title: `Article rupture ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, price: '1000', quantity: 0, status: 'ACTIVE' },
      vendeur.accessToken,
    )
  ).body.id;

  // La création a journalisé un INITIAL à `quantityAfter: 0`. On le retire pour
  // maîtriser précisément ce que le journal contient dans chaque scénario.
  await prisma.toumaStockMovement.deleteMany({ where: { productId: produit } });

  if (options.journalise) {
    await prisma.toumaStockMovement.create({
      data: {
        productId: produit,
        variantId: null,
        type: 'SALE',
        quantityDelta: -3,
        reservedDelta: 3,
        quantityAfter: 0,
        reservedAfter: 3,
        reason: 'Dernière unité vendue (essai).',
        createdAt: options.journalise,
      },
    });
  }
  return produit;
}

describe('Ruptures — la durée vient du journal', () => {
  it('donne la durée exacte quand le journal la couvre', async () => {
    const produit = await produitEnRupture({ journalise: ilYaJours(12) });
    const r = await ruptures({ days: 30, storeId: boutique, maintenant: MAINTENANT });
    const ligne = r.items.find((i) => i.product.id === produit);

    assert.ok(ligne, 'le produit en rupture doit apparaître');
    assert.equal(ligne.durationStatus, 'KNOWN');
    assert.equal(ligne.outOfStockDays, 12);
    assert.ok(ligne.outOfStockSince);
  });

  it('dit « inconnue » plutôt que zéro pour une rupture antérieure au journal', async () => {
    // Ni zéro, ni « depuis toujours ». Les deux seraient faux, et le second
    // ferait paniquer un vendeur sur un article arrêté depuis six mois.
    const produit = await produitEnRupture({ journalise: null });
    const r = await ruptures({ days: 30, storeId: boutique, maintenant: MAINTENANT });
    const ligne = r.items.find((i) => i.product.id === produit);

    assert.ok(ligne);
    assert.equal(ligne.durationStatus, 'UNKNOWN');
    assert.equal(ligne.outOfStockDays, null);
    assert.equal(ligne.outOfStockSince, null);
    assert.equal(ligne.signal, 'STOCKOUT_DURATION_UNKNOWN');
    assert.match(ligne.statement, /précède le journal/);
  });

  it('n’annonce une rupture à forte demande que si les deux faits sont établis', async () => {
    // §8 : « seulement si les données le justifient ». Sans demande observée,
    // une rupture est une rupture — pas une alerte.
    const produit = await produitEnRupture({ journalise: ilYaJours(5) });
    const r = await ruptures({ days: 30, storeId: boutique, maintenant: MAINTENANT });
    const ligne = r.items.find((i) => i.product.id === produit);

    assert.ok(ligne);
    assert.equal(ligne.unitsOrdered, 0, 'aucune commande sur cet article d’essai');
    assert.equal(ligne.signal, 'STOCKOUT', 'sans demande observée, pas d’alerte');
    assert.match(ligne.statement, /ne justifie pas une alerte/);
  });

  it('chaque ligne porte le statut du marché de son vendeur', async () => {
    const produit = await produitEnRupture({ journalise: ilYaJours(3) });
    const r = await ruptures({ days: 30, storeId: boutique, maintenant: MAINTENANT });
    const ligne = r.items.find((i) => i.product.id === produit);
    assert.ok(ligne);
    assert.equal(ligne.market.countryCode, 'TD');
    assert.equal(typeof ligne.market.operating, 'boolean');
  });

  it('classe les ruptures à forte demande d’abord', async () => {
    const r = await ruptures({ days: 30, storeId: boutique, maintenant: MAINTENANT });
    const rang = { HIGH_DEMAND_STOCKOUT: 0, STOCKOUT_WITH_DEMAND: 1, STOCKOUT_DURATION_UNKNOWN: 2, STOCKOUT: 3 } as const;
    const rangs = r.items.map((i) => rang[i.signal]);
    assert.deepEqual([...rangs].sort((a, b) => a - b), rangs, 'un vendeur lit les trois premières lignes');
  });

  it('dit explicitement quand aucun produit n’est en rupture', async () => {
    // « Aucune rupture » n'est pas « aucune donnée » : la vérification a eu lieu.
    const vide = (await api.post('/api/v1/stores', { name: `Boutique saine ${Date.now()}`, countryCode: 'TD' }, vendeur.accessToken)).body.id;
    const r = await ruptures({ days: 30, storeId: vide, maintenant: MAINTENANT });
    assert.deepEqual(r.items, []);
    assert.match(r.note, /la vérification a eu lieu/);
  });
});

describe('Ruptures — qui peut les lire', () => {
  it('le vendeur voit les siennes', async () => {
    const res = await api.request('GET', '/api/v1/seller/stockouts?days=30', { token: vendeur.accessToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.items));
    assert.match(res.body.note, /journal des mouvements/);
  });

  it('un autre vendeur ne voit pas celles-ci', async () => {
    // Les ruptures d'un concurrent disent ce qu'il n'arrive pas à fournir.
    const res = await api.request('GET', `/api/v1/seller/stockouts?storeId=${boutique}`, { token: autre.accessToken });
    assert.equal(res.status, 404, JSON.stringify(res.body));
  });

  it('sans compte, rien', async () => {
    assert.equal((await api.request('GET', '/api/v1/seller/stockouts')).status, 401);
  });
});

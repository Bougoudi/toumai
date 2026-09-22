import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * CLOISONNEMENT DU RÉSEAU D'APPROVISIONNEMENT (V28 §6, §47).
 *
 * **Pourquoi ces tests existent.** L'audit V28 a montré que le cloisonnement
 * était déjà correct dans le code : `b2b.service.ts` restreint la lecture des
 * offres à `sellerId: user.id` pour qui n'est pas l'acheteur, et
 * `loadNegotiation` rend « introuvable » la négociation d'autrui. Rien ne le
 * testait.
 *
 * Une propriété de sécurité que personne ne vérifie est à une réécriture de se
 * perdre — et celle-ci est la condition même d'un appel d'offres : un
 * fournisseur qui verrait le prix de son concurrent n'aurait plus aucune raison
 * de faire une offre honnête, et l'acheteur n'obtiendrait plus jamais le
 * meilleur prix. Ce n'est pas une fuite de données parmi d'autres, c'est ce qui
 * fait tenir le mécanisme.
 *
 * Les tests sont écrits du point de vue de l'attaquant : un fournisseur légitime
 * de l'appel d'offres, invité comme les autres, qui essaie de voir ce que ses
 * concurrents ont proposé.
 */
const api = new TestApi();

let acheteur: any;
let fournisseurA: any;
let fournisseurB: any;
let boutiqueA: string;
let boutiqueB: string;
let rfqId: string;
let offreA: any;
let offreB: any;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  acheteur = await registerUser(api, { name: 'Acheteur', email: uniqueEmail(`ach-${s}`), role: 'BUYER' });
  fournisseurA = await registerUser(api, { name: 'Fournisseur A', email: uniqueEmail(`fa-${s}`), role: 'SELLER' });
  fournisseurB = await registerUser(api, { name: 'Fournisseur B', email: uniqueEmail(`fb-${s}`), role: 'SELLER' });

  boutiqueA = (await api.post('/api/v1/stores', { name: `Boutique A ${s}`, countryCode: 'TD' }, fournisseurA.accessToken)).body.id;
  boutiqueB = (await api.post('/api/v1/stores', { name: `Boutique B ${s}`, countryCode: 'TD' }, fournisseurB.accessToken)).body.id;

  // Un appel d'offres, deux fournisseurs qui répondent chacun de leur côté.
  rfqId = (
    await api.post(
      '/api/v1/rfqs',
      {
        title: `Sacs de jute ${s}`,
        description: 'Cloisonnement du réseau d’approvisionnement.',
        countryCode: 'TD',
        city: 'N’Djamena',
        currency: 'XAF',
        items: [{ name: 'Sac de jute 50 kg', quantity: 1000, unit: 'pièce', targetUnitPrice: '900' }],
      },
      acheteur.accessToken,
    )
  ).body.id;

  const offre = (boutique: string, jeton: string, prix: string) =>
    api.post(
      `/api/v1/rfqs/${rfqId}/quotes`,
      {
        storeId: boutique,
        shippingTotal: '25000',
        leadTimeDays: 14,
        validityDays: 30,
        message: 'Offre.',
        items: [{ name: 'Sac de jute 50 kg', quantity: 1000, unit: 'pièce', unitPrice: prix }],
      },
      jeton,
    );

  // Deux prix nettement différents : si l'un fuite, il se reconnaît.
  offreA = (await offre(boutiqueA, fournisseurA.accessToken, '880')).body;
  offreB = (await offre(boutiqueB, fournisseurB.accessToken, '790')).body;
});

after(async () => api.stop());

describe('Un fournisseur ne voit jamais l’offre d’un concurrent (TEST 1, TEST 2)', () => {
  it('la fiche de l’appel d’offres ne lui montre que la sienne', async () => {
    const vu = await api.request('GET', `/api/v1/rfqs/${rfqId}`, { token: fournisseurA.accessToken });
    assert.equal(vu.status, 200);

    const references = (vu.body.quotes ?? []).map((q: any) => q.reference);
    assert.deepEqual(references, [offreA.reference], `A ne doit voir que son offre — vu : ${references.join(', ')}`);

    // Et surtout : le montant de B n'apparaît nulle part dans la réponse, sous
    // aucune forme — ni dans une offre, ni dans un agrégat, ni dans un
    // « meilleur prix » qui trahirait le concurrent en une ligne.
    //
    // La comparaison porte sur la **valeur JSON entière**, guillemets compris.
    // Chercher une suite de chiffres nue donnait un faux positif : la réponse
    // contient des horodatages et des identifiants où n'importe quel nombre à
    // trois chiffres finit par apparaître.
    const brut = JSON.stringify(vu.body);
    assert.ok(!brut.includes(`"${offreB.total}"`), `le total de B (${offreB.total}) ne doit apparaître nulle part`);
    assert.ok(!brut.includes(offreB.reference), 'la référence de l’offre de B ne doit pas fuiter');
    assert.ok(!brut.includes(fournisseurB.user.id), 'l’identifiant du fournisseur concurrent ne doit pas fuiter');
  });

  it('l’acheteur, lui, voit les deux — c’est à cela que sert un appel d’offres', async () => {
    const vu = await api.request('GET', `/api/v1/rfqs/${rfqId}`, { token: acheteur.accessToken });
    assert.equal(vu.status, 200);
    const references = (vu.body.quotes ?? []).map((q: any) => q.reference).sort();
    assert.deepEqual(references, [offreA.reference, offreB.reference].sort());
  });

  it('la négociation d’un concurrent est « introuvable », jamais « interdite »', async () => {
    // 403 confirmerait l'existence de l'offre et son identifiant : sur un
    // appel d'offres, c'est déjà une information commerciale.
    const vu = await api.request('GET', `/api/v1/negotiations/${offreB.id}`, { token: fournisseurA.accessToken });
    assert.equal(vu.status, 404, JSON.stringify(vu.body));
  });

  it('un fournisseur ne peut pas écrire dans la négociation d’un concurrent', async () => {
    const res = await api.post(
      `/api/v1/quotes/${offreB.id}/messages`,
      { kind: 'MESSAGE', body: 'Bonjour, quel est votre prix ?' },
      fournisseurA.accessToken,
    );
    assert.equal(res.status, 404, JSON.stringify(res.body));

    // Rien n'a été écrit : un refus ne laisse pas de message à demi.
    const messages = await prisma.toumaNegotiationMessage.count({ where: { quoteId: offreB.id, authorId: fournisseurA.user.id } });
    assert.equal(messages, 0);
  });

  it('un fournisseur ne peut pas contre-proposer sur l’offre d’un concurrent', async () => {
    const res = await api.post(
      `/api/v1/negotiations/${offreB.id}/counter`,
      { items: [{ name: 'Sac de jute 50 kg', quantity: 1000, unit: 'pièce', unitPrice: '700' }], shippingTotal: '25000', leadTimeDays: 14 },
      fournisseurA.accessToken,
    );
    assert.equal(res.status, 404, JSON.stringify(res.body));

    // L'offre de B est intacte : ni son total ni son statut n'ont bougé.
    const apres = await prisma.toumaQuote.findUniqueOrThrow({ where: { id: offreB.id } });
    assert.equal(apres.status, 'SUBMITTED');
    assert.equal(apres.total.toString(), String(offreB.total));
  });

  it('« mes offres » ne rend que les siennes', async () => {
    const mienne = await api.request('GET', '/api/v1/quotes/mine', { token: fournisseurA.accessToken });
    assert.equal(mienne.status, 200);
    const ids = (mienne.body.items ?? []).map((q: any) => q.id);
    assert.ok(ids.includes(offreA.id), 'A doit voir son offre');
    assert.ok(!ids.includes(offreB.id), 'A ne doit pas voir celle de B');
  });

  it('un visiteur sans compte ne voit aucune offre', async () => {
    // La fiche d'un appel d'offres peut être publique — les offres, jamais.
    const vu = await api.request('GET', `/api/v1/rfqs/${rfqId}`);
    if (vu.status === 200) {
      assert.deepEqual(vu.body.quotes ?? [], [], 'aucune offre ne doit sortir sans authentification');
      const brut = JSON.stringify(vu.body);
      for (const offre of [offreA, offreB]) {
        assert.ok(!brut.includes(`"${offre.total}"`), `le total de ${offre.reference} ne doit pas fuiter`);
        assert.ok(!brut.includes(offre.reference), `la référence ${offre.reference} ne doit pas fuiter`);
      }
    } else {
      assert.equal(vu.status, 401);
    }
  });
});

describe('Comparaison d’offres (V28 §7)', () => {
  it('pose les offres côte à côte sans désigner de gagnant', async () => {
    const res = await api.request('GET', `/api/v1/rfqs/${rfqId}/comparison`, { token: acheteur.accessToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.quotes.length, 2);

    // Aucun champ ne classe, ne note, ni ne recommande. C'est le cœur de §7 :
    // l'arbitrage entre prix, délai et confiance appartient à l'acheteur.
    const brut = JSON.stringify(res.body);
    for (const interdit of ['rank', 'winner', 'best', 'recommended', 'score_global']) {
      assert.ok(!brut.includes(`"${interdit}"`), `la comparaison ne doit pas produire « ${interdit} »`);
    }
  });

  it('nomme factuellement l’offre la plus basse et la plus rapide, sans en tirer de conclusion', async () => {
    const res = await api.request('GET', `/api/v1/rfqs/${rfqId}/comparison`, { token: acheteur.accessToken });
    const moinsChere = res.body.quotes.filter((q: any) => q.lowest.includes('total'));
    assert.equal(moinsChere.length, 1, 'une seule offre est la moins chère');
    assert.equal(moinsChere[0].reference, offreB.reference, 'B a proposé 790 contre 880');

    // Le prix unitaire est **calculé**, jamais recopié du fournisseur.
    const b = res.body.quotes.find((q: any) => q.reference === offreB.reference);
    assert.equal(b.quantity, 1000);
    assert.equal(Number(b.unitPrice), 790);
  });

  it('dit pourquoi aucun classement global n’est produit', async () => {
    const res = await api.request('GET', `/api/v1/rfqs/${rfqId}/comparison`, { token: acheteur.accessToken });
    // Les droits de douane sont UNKNOWN faute de source : un total incomplet
    // ne peut pas fonder un classement, et la réponse le dit.
    assert.ok(Array.isArray(res.body.noRankingBecause));
    assert.ok(res.body.noRankingBecause.includes('COUT_INCOMPLET'), JSON.stringify(res.body.noRankingBecause));
    assert.match(res.body.note, /appartient à l’acheteur/);
  });

  it('un fournisseur ne peut pas lire la comparaison — il y verrait les prix de ses concurrents', async () => {
    const res = await api.request('GET', `/api/v1/rfqs/${rfqId}/comparison`, { token: fournisseurA.accessToken });
    assert.equal(res.status, 404, JSON.stringify(res.body));
  });

  it('un coût rendu incomplet n’est jamais présenté comme un total', async () => {
    const res = await api.request('GET', `/api/v1/rfqs/${rfqId}/comparison`, { token: acheteur.accessToken });
    for (const q of res.body.quotes) {
      if (!q.landedCost) continue;
      if (!q.landedCost.complete) {
        assert.equal(q.landedCost.total, null, 'un total partiel ne doit pas être rendu comme un total');
        assert.ok(q.landedCost.unknownComponents.length > 0, 'ce qui manque doit être nommé');
      }
    }
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * PROFIL FOURNISSEUR DÉCLARÉ (V28 §1, §2).
 *
 * **Ce que ces tests protègent.** TOUMA affiche partout ailleurs ce qu'elle
 * constate : la capacité vient du stock saisi, les pays desservis des
 * expéditions réellement faites. Le profil déclaré est d'une autre nature —
 * personne ne l'a vérifié.
 *
 * Le risque n'est pas qu'un fournisseur mente. C'est qu'un acheteur ne puisse
 * pas faire la différence entre « a déjà expédié vers le Cameroun » et « dit
 * qu'il pourrait ». Sur une commande de mille sacs, cette différence est toute
 * la décision.
 */
const api = new TestApi();

let fournisseur: any;
let intrus: any;
let boutique: string;
let motCle: string;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  fournisseur = await registerUser(api, { name: 'Fournisseur déclaré', email: uniqueEmail(`sd-${s}`), role: 'SELLER' });
  intrus = await registerUser(api, { name: 'Autre vendeur', email: uniqueEmail(`si-${s}`), role: 'SELLER' });
  boutique = (await api.post('/api/v1/stores', { name: `Boutique déclarée ${s}`, countryCode: 'TD' }, fournisseur.accessToken)).body.id;
  await prisma.toumaStore.update({ where: { id: boutique }, data: { status: 'ACTIVE' } });

  // Un produit, sans quoi la boutique ne remonte pas dans la recherche — et le
  // test qui vérifie qu'une déclaration ne satisfait aucun critère se dérobait
  // en silence, ce qui est pire que pas de test du tout.
  motCle = `jutecrible${s.replace(/[^a-z0-9]/gi, '')}`;
  await api.post(
    '/api/v1/products',
    { storeId: boutique, title: `Sac ${motCle}`, price: '900', quantity: 2000, status: 'ACTIVE' },
    fournisseur.accessToken,
  );
});

after(async () => api.stop());

describe('Ce qu’un fournisseur déclare', () => {
  it('accepte plusieurs types : un fabricant peut aussi distribuer', async () => {
    // L'obliger à choisir produirait une donnée fausse.
    const res = await api.request('PUT', `/api/v1/sourcing/suppliers/${boutique}/profile`, {
      token: fournisseur.accessToken,
      body: {
        types: ['MANUFACTURER', 'DISTRIBUTOR'],
        countries: ['td', 'cm'],
        currencies: ['xaf'],
        leadTimeDays: 21,
        minOrderQty: 500,
        paymentTerms: '50 % à la commande, solde à l’expédition.',
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.types, ['MANUFACTURER', 'DISTRIBUTOR']);
    // Les codes sont normalisés en majuscules : « td » et « TD » sont le même pays.
    assert.deepEqual(res.body.countries, ['TD', 'CM']);
    assert.deepEqual(res.body.currencies, ['XAF']);
  });

  it('est toujours marqué DECLARED, et jamais autre chose', async () => {
    // Constante par construction : il n'existe aucun chemin de code par lequel
    // ce profil rendrait VERIFIED. Un fournisseur ne se vérifie pas lui-même
    // en remplissant un formulaire.
    const res = await api.request('GET', `/api/v1/sourcing/suppliers/${boutique}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.declared.status, 'DECLARED');
    assert.match(res.body.declared.disclaimer, /TOUMA ne les a pas vérifiées/);
    assert.ok(res.body.declared.declaredAt, 'une déclaration sans date ne vaut rien');
  });

  it('sépare ce qui est déclaré de ce qui est observé', async () => {
    const res = await api.request('GET', `/api/v1/sourcing/suppliers/${boutique}`);

    // Le fournisseur dit desservir TD et CM…
    assert.deepEqual(res.body.declared.countries, ['TD', 'CM']);
    // …et n'a réellement expédié nulle part. Les deux coexistent sans se mêler.
    assert.deepEqual(res.body.servedCountries, []);

    // Aucun champ déclaré ne remonte à la racine de la fiche : mêlé aux données
    // observées, il serait lu comme elles.
    for (const cle of ['types', 'paymentTerms', 'shippingNotes', 'minOrderQty', 'leadTimeDays']) {
      assert.ok(!(cle in res.body), `« ${cle} » ne doit exister que sous « declared »`);
    }
  });

  /**
   * Le test qui compte le plus.
   *
   * La correspondance (§4) est bâtie sur l'observation. Si une déclaration
   * pouvait satisfaire un critère, il suffirait à un fournisseur de cocher
   * « je livre partout » pour remonter en tête des résultats — et tout le
   * travail de V28 §4 serait annulé par un formulaire.
   */
  it('une déclaration ne transforme jamais un critère non mesuré en critère satisfait', async () => {
    const res = await api.request('GET', `/api/v1/sourcing/suppliers?destination=CM&q=${motCle}&limit=50`);
    assert.equal(res.status, 200);

    const lui = res.body.items.find((i: any) => i.store.id === boutique);
    // Pas de `return` silencieux : un test qui se dérobe passe toujours, et ne
    // protège donc rien. S'il ne trouve pas la boutique, c'est un échec.
    assert.ok(lui, `la boutique doit remonter sur « ${motCle} » — sinon ce test ne vérifie rien`);

    const destination = lui.matchReasons.find((r: any) => r.code === 'DESTINATION');
    assert.ok(destination, 'le critère destination doit être énoncé');
    // Il a **déclaré** desservir CM. Il n'y a jamais expédié.
    assert.notEqual(destination.state, 'MET', 'une déclaration ne satisfait pas un critère observé');
    assert.equal(destination.state, 'NOT_MEASURED');
    assert.deepEqual(lui.servedCountries, []);
  });
});

describe('Qui peut déclarer', () => {
  it('un autre vendeur ne peut pas déclarer à la place du fournisseur', async () => {
    const res = await api.request('PUT', `/api/v1/sourcing/suppliers/${boutique}/profile`, {
      token: intrus.accessToken,
      body: { types: ['MANUFACTURER'] },
    });
    // Introuvable plutôt qu'interdit : 403 confirmerait l'existence de la boutique.
    assert.equal(res.status, 404, JSON.stringify(res.body));

    const inchange = await prisma.toumaSupplierProfile.findUniqueOrThrow({ where: { storeId: boutique } });
    assert.deepEqual(inchange.types, ['MANUFACTURER', 'DISTRIBUTOR'], 'le profil ne doit pas avoir bougé');
  });

  it('sans compte, on ne déclare rien', async () => {
    const res = await api.request('PUT', `/api/v1/sourcing/suppliers/${boutique}/profile`, { body: { types: ['TRADER'] } });
    assert.equal(res.status, 401);
  });

  it('la date de déclaration est repoussée à chaque mise à jour', async () => {
    // Une condition commerciale d'il y a deux ans n'est pas une condition
    // commerciale. L'acheteur doit pouvoir en juger lui-même.
    const avant = (await prisma.toumaSupplierProfile.findUniqueOrThrow({ where: { storeId: boutique } })).declaredAt;
    await new Promise((r) => setTimeout(r, 10));
    await api.request('PUT', `/api/v1/sourcing/suppliers/${boutique}/profile`, {
      token: fournisseur.accessToken,
      body: { leadTimeDays: 14 },
    });
    const apres = (await prisma.toumaSupplierProfile.findUniqueOrThrow({ where: { storeId: boutique } })).declaredAt;
    assert.ok(apres.getTime() > avant.getTime(), 'declaredAt doit suivre la dernière confirmation');
  });
});

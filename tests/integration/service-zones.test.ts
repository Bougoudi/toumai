import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { productAvailability, sellerServes } from '../../src/touma/logistics/service-zones.js';

/**
 * Zones de service des vendeurs (V17).
 *
 * « Est-ce que ça peut arriver chez moi ? » est la première question d'un
 * acheteur d'Abéché, et rien n'y répondait. Deux conditions s'y rencontrent, et
 * les confondre produirait une promesse fausse : **le vendeur accepte
 * d'envoyer là-bas, et un transporteur y va**. Les deux doivent dire oui.
 */
const api = new TestApi();

let seller: any;
let autre: any;
let buyer: any;
let storeId: string;
let productId: string;
let ndjamena: any;
let tibesti: any;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  ndjamena = await prisma.toumaProvince.findFirstOrThrow({ where: { countryCode: 'TD', name: { contains: 'Djam' } } });
  tibesti = await prisma.toumaProvince.findFirstOrThrow({ where: { countryCode: 'TD', name: { contains: 'Tibesti' } } });

  seller = await registerUser(api, { name: 'Vendeur zones', email: uniqueEmail('sz-seller'), role: 'SELLER', countryCode: 'TD' });
  storeId = (await api.post('/api/v1/stores', { name: `Boutique zones ${Date.now()}`, countryCode: 'TD' }, seller.accessToken)).body.id;
  await prisma.toumaStore.update({ where: { id: storeId }, data: { status: 'ACTIVE', provinceId: ndjamena.id } });

  productId = (
    await api.post(
      '/api/v1/products',
      { storeId, title: `Article zones ${Date.now()}`, price: '15000', quantity: 30, weightGrams: 900, status: 'ACTIVE' },
      seller.accessToken,
    )
  ).body.id;

  autre = await registerUser(api, { name: 'Autre vendeur', email: uniqueEmail('sz-autre'), role: 'SELLER', countryCode: 'TD' });
  buyer = await registerUser(api, { name: 'Acheteur zones', email: uniqueEmail('sz-buyer'), role: 'BUYER', countryCode: 'TD' });
});

after(async () => {
  await prisma.toumaStoreServiceZone.deleteMany({ where: { storeId } });
  await api.stop();
});

/** Remet la boutique à l'état « aucune déclaration ». */
async function sansDeclaration() {
  await prisma.toumaStoreServiceZone.deleteMany({ where: { storeId } });
}

describe('Sans déclaration', () => {
  it('un vendeur ne restreint rien', async () => {
    // L'inverse du paiement à la livraison, et c'est voulu : encaisser du
    // liquide est un engagement qu'on prend, refuser de livrer une province est
    // une limitation qu'on choisit. Fermer par défaut couperait toutes les
    // boutiques existantes du jour au lendemain.
    await sansDeclaration();
    const v = await sellerServes(storeId, { countryCode: 'TD', provinceId: tibesti.id });
    assert.equal(v.served, true);
    assert.equal(v.declared, false);
  });

  it('le dit explicitement dans la lecture publique', async () => {
    await sansDeclaration();
    const res = await api.get(`/api/v1/stores/${storeId}/zones-service`);
    assert.equal(res.status, 200);
    assert.equal(res.body.unrestricted, true);
    assert.equal(res.body.items.length, 0);
  });
});

describe('Une déclaration', () => {
  it('fait primer la règle la plus précise, et une exclusion ferme', async () => {
    // « Tout le Tchad sauf le Tibesti », sans énumérer vingt-deux provinces.
    const res = await api.put(
      `/api/v1/stores/${storeId}/zones-service`,
      {
        zones: [
          { countryCode: 'TD', served: true, handlingDays: 2 },
          { countryCode: 'TD', provinceId: tibesti.id, served: false, note: 'Nous ne montons pas jusqu’au Tibesti.' },
        ],
      },
      seller.accessToken,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.unrestricted, false);

    const partout = await sellerServes(storeId, { countryCode: 'TD', provinceId: ndjamena.id });
    assert.equal(partout.served, true);
    assert.equal(partout.handlingDays, 2);

    const exclu = await sellerServes(storeId, { countryCode: 'TD', provinceId: tibesti.id });
    assert.equal(exclu.served, false);
    assert.match(exclu.note ?? '', /Tibesti/);
  });

  it('vaut « je n’y vais pas » pour un pays non déclaré', async () => {
    // Un vendeur qui a pris la peine de déclarer ses zones ne dessert pas
    // implicitement les pays qu'il n'a pas nommés — sinon déclarer ne servirait
    // à rien.
    const ailleurs = await sellerServes(storeId, { countryCode: 'CM' });
    assert.equal(ailleurs.served, false);
    assert.equal(ailleurs.declared, true);
  });

  it('se retire aussi simplement qu’elle se pose', async () => {
    const res = await api.put(`/api/v1/stores/${storeId}/zones-service`, { zones: [] }, seller.accessToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.unrestricted, true);
  });

  it('refuse une province qui n’appartient pas au pays indiqué', async () => {
    // Une zone impossible à satisfaire rendrait la boutique invisible sans que
    // personne comprenne pourquoi.
    const res = await api.put(
      `/api/v1/stores/${storeId}/zones-service`,
      { zones: [{ countryCode: 'CM', provinceId: ndjamena.id, served: true }] },
      seller.accessToken,
    );
    assert.equal(res.status, 400);
  });

  it('reste fermée à la boutique d’autrui — « introuvable », jamais « interdit »', async () => {
    const res = await api.put(
      `/api/v1/stores/${storeId}/zones-service`,
      { zones: [{ countryCode: 'TD', served: true }] },
      autre.accessToken,
    );
    assert.equal(res.status, 404);
  });
});

describe('La disponibilité d’un produit', () => {
  it('ne dit jamais « probablement » : quatre réponses, et pas une de plus', async () => {
    await sansDeclaration();
    const d = await productAvailability(productId, ndjamena.id);
    assert.ok(['SERVED', 'SELLER_EXCLUDED', 'NO_CARRIER', 'UNKNOWN_DESTINATION'].includes(d.verdict));
    // Livrable seulement si les deux côtés confirment.
    assert.equal(d.deliverable, d.verdict === 'SERVED');
  });

  it('distingue le refus du vendeur de l’absence de transporteur', async () => {
    // Les deux empêchent la livraison et n'ont rien à voir : l'un se règle avec
    // le vendeur, l'autre avec un transporteur. Les confondre enverrait
    // l'acheteur se plaindre au mauvais endroit.
    await prisma.toumaStoreServiceZone.deleteMany({ where: { storeId } });
    await prisma.toumaStoreServiceZone.create({
      data: { storeId, countryCode: 'TD', served: true },
    });
    await prisma.toumaStoreServiceZone.create({
      data: { storeId, countryCode: 'TD', provinceId: tibesti.id, served: false, note: 'Hors de notre tournée.' },
    });

    const refus = await productAvailability(productId, tibesti.id);
    assert.equal(refus.verdict, 'SELLER_EXCLUDED');
    assert.equal(refus.deliverable, false);
    assert.match(refus.message, /tournée/);
    assert.equal(refus.transitDays, null, 'aucun délai n’est annoncé sur un refus');
  });

  it('n’annonce aucun délai quand aucun transporteur ne dessert', async () => {
    const d = await productAvailability(productId, ndjamena.id);
    if (d.verdict === 'NO_CARRIER') {
      assert.equal(d.transitDays, null);
      assert.match(d.message, /indisponible/i);
    } else {
      // Un transporteur dessert : la fourchette vient de la zone déclarée,
      // jamais d'une moyenne calculée.
      assert.ok(d.transitDays && d.transitDays.max >= d.transitDays.min);
    }
  });

  it('refuse de statuer sur une destination inconnue', async () => {
    const d = await productAvailability(productId, 'province-inexistante');
    assert.equal(d.verdict, 'UNKNOWN_DESTINATION');
    assert.equal(d.deliverable, false);
  });

  it('s’interroge par l’API, et exige une province', async () => {
    const sans = await api.get(`/api/v1/products/${productId}/disponibilite`);
    assert.equal(sans.status, 400, 'deviner la destination produirait une promesse inventée');

    const avec = await api.get(`/api/v1/products/${productId}/disponibilite?province=${ndjamena.id}`);
    assert.equal(avec.status, 200);
    assert.ok(avec.body.message);
  });
});

describe('Les références de commande', () => {
  it('ne se marchent pas dessus quand deux acheteurs valident en même temps', async () => {
    // Le défaut : la partie aléatoire faisait trois octets, soit 16,7 millions
    // de valeurs par jour. Au paradoxe des anniversaires, la collision devient
    // probable dès quelques milliers de commandes quotidiennes — un volume
    // ordinaire — et se solde par une erreur serveur chez l'acheteur qui a
    // perdu au tirage. Cinq octets, plus un rejeu de la transaction.
    await sansDeclaration();

    const acheteurs = await Promise.all(
      [0, 1, 2, 3].map(async (i) => {
        const u = await registerUser(api, {
          name: `Acheteur simultané ${i}`,
          email: uniqueEmail(`sz-conc-${i}`),
          role: 'BUYER',
          countryCode: 'TD',
        });
        u.addressId = (
          await api.post(
            '/api/v1/auth/me/addresses',
            { fullName: `Acheteur ${i}`, phone: `+2356600${1000 + i}`, line1: 'Avenue centrale', city: "N'Djamena", countryCode: 'TD' },
            u.accessToken,
          )
        ).body.id;
        await api.post('/api/v1/cart/items', { productId, quantity: 1 }, u.accessToken);
        return u;
      }),
    );

    const resultats = await Promise.all(
      acheteurs.map((u) => api.post('/api/v1/checkout', { addressId: u.addressId }, u.accessToken)),
    );

    for (const r of resultats) {
      assert.equal(r.status, 201, `checkout simultané refusé : ${JSON.stringify(r.body)}`);
    }

    // Et les références sont bien distinctes : c'est ce que l'unicité protège.
    const numeros = resultats.flatMap((r) => r.body.orders.map((o: any) => o.orderNumber));
    assert.equal(new Set(numeros).size, numeros.length, 'deux commandes portent le même numéro');
  });
});

describe('Le checkout', () => {
  it('refuse une commande vers une province que le vendeur exclut, avec son motif', async () => {
    // Sans cela, la déclaration serait décorative : on encaisserait un acheteur
    // pour une livraison que personne n'a promise.
    await prisma.toumaStoreServiceZone.deleteMany({ where: { storeId } });
    await prisma.toumaStoreServiceZone.create({ data: { storeId, countryCode: 'TD', served: true } });
    await prisma.toumaStoreServiceZone.create({
      data: { storeId, countryCode: 'TD', provinceId: tibesti.id, served: false, note: 'Nous ne desservons pas le Tibesti.' },
    });

    const adresse = (
      await api.post(
        '/api/v1/auth/me/addresses',
        {
          fullName: 'Acheteur du Tibesti',
          phone: '+23566001234',
          line1: 'Quartier central',
          city: 'Bardaï',
          countryCode: 'TD',
          provinceId: tibesti.id,
        },
        buyer.accessToken,
      )
    ).body.id;

    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const checkout = await api.post('/api/v1/checkout', { addressId: adresse }, buyer.accessToken);
    assert.equal(checkout.status, 409, JSON.stringify(checkout.body));
    assert.match(JSON.stringify(checkout.body), /Tibesti/);

    // On vide le panier pour ne pas gêner les tests suivants.
    const panier = await api.get('/api/v1/cart', buyer.accessToken);
    for (const item of panier.body.items ?? []) {
      await api.delete(`/api/v1/cart/items/${item.id}`, buyer.accessToken);
    }
  });
});

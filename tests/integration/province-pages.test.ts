import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Pages de province et tableau de bord national (V17).
 *
 * La règle qui gouverne les deux : **tout est compté sur des faits**. Une
 * province sans boutique rend zéro, et c'est l'information la plus utile — elle
 * dit où le produit n'existe pas encore. Une page de province vide est
 * précisément celle qu'on serait tenté de garnir de chiffres inventés, ce que
 * le §80 interdit.
 */
const api = new TestApi();

let admin: any;
let seller: any;
let provinceId: string;
let provinceCode: string;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  const province = await prisma.toumaProvince.findFirstOrThrow({
    where: { countryCode: 'TD', active: true },
    select: { id: true, code: true },
  });
  provinceId = province.id;
  provinceCode = province.code;

  seller = await registerUser(api, { name: 'Vendeur province', email: uniqueEmail('prov-seller'), role: 'SELLER', countryCode: 'TD' });
  const storeId = (await api.post('/api/v1/stores', { name: `Boutique province ${Date.now()}`, countryCode: 'TD' }, seller.accessToken)).body.id;
  await prisma.toumaStore.update({ where: { id: storeId }, data: { status: 'ACTIVE', provinceId } });

  admin = await registerUser(api, { name: 'Admin province', email: uniqueEmail('prov-admin'), role: 'BUYER', countryCode: 'TD' });
  await promoteToAdmin(admin.user.id);
  admin.accessToken = (await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password })).body.accessToken;
});

after(async () => {
  await api.stop();
});

describe('La fiche d’une province', () => {
  it('s’ouvre sans compte : on choisit sa province avant de s’inscrire', async () => {
    const res = await api.get(`/api/v1/geo/provinces/${provinceId}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.province.name);
  });

  it('s’atteint par son code officiel, pour une URL partageable', async () => {
    const res = await api.get(`/api/v1/geo/provinces/${provinceCode}?country=TD`);
    assert.equal(res.status, 200);
    assert.equal(res.body.province.id, provinceId);
  });

  it('compte les départements et les localités réellement chargés', async () => {
    const res = await api.get(`/api/v1/geo/provinces/${provinceId}`);
    const attendu = await prisma.toumaLocality.count({ where: { provinceId, active: true } });
    assert.equal(res.body.province.localityCount, attendu);
  });

  it('liste les boutiques actives de la province, avec leur statut de vérification réel', async () => {
    const res = await api.get(`/api/v1/geo/provinces/${provinceId}`);
    assert.ok(res.body.stores.total >= 1);
    for (const b of res.body.stores.items) {
      assert.ok(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED'].includes(b.verificationStatus), b.verificationStatus);
    }
  });

  it('ne dit jamais « desservie » sans zone, ni « indisponible » avec zone', async () => {
    // Les tables de zones et de règles d'encaissement appartiennent à
    // `delivery-zones.test.ts` et `chad-payments.test.ts`, qui les vident
    // globalement. On ne se les dispute pas : c'est **l'invariant** de la page
    // qu'on vérifie, et il tient quel que soit l'état de ces tables.
    //
    // L'invariant est celui qui compte : un délai par défaut serait une
    // promesse faite à quelqu'un qui va attendre un colis.
    for (const cible of [provinceId, provinceCode]) {
      const res = await api.get(`/api/v1/geo/provinces/${cible}?country=TD`);
      const d = res.body.delivery;
      if (d.options.length === 0) {
        assert.equal(d.served, false, 'aucune zone ne peut pas valoir « desservie »');
        assert.match(d.note, /indisponible/i, 'l’absence de zone doit être dite');
      } else {
        assert.equal(d.note, null, 'un motif d’indisponibilité avec des zones serait contradictoire');
        for (const o of d.options) {
          assert.equal(typeof o.basePrice, 'string', 'aucun tarif n’arrive en nombre');
          assert.ok(o.estimatedMaxDays >= o.estimatedMinDays, 'un délai maximal ne précède pas le minimal');
        }
      }
    }
  });

  it('n’ouvre le paiement à la livraison que sur une règle réelle', async () => {
    const res = await api.get(`/api/v1/geo/provinces/${provinceId}`);
    const regles = await prisma.toumaCodRule.count({ where: { provinceId, active: true, allowed: true } });
    assert.equal(res.body.cashOnDelivery.open, regles > 0, 'l’ouverture suit les règles, jamais un défaut');
  });

  it('répond « introuvable » sur une province inconnue', async () => {
    const res = await api.get('/api/v1/geo/provinces/province-qui-nexiste-pas');
    assert.equal(res.status, 404);
  });
});

describe('Le tableau de bord national', () => {
  it('couvre les 23 provinces du Tchad, y compris celles à zéro', async () => {
    const res = await api.get('/api/v1/admin/geo/national', admin.accessToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.provinceCount, 23);
    assert.equal(res.body.rows.length, 23);

    // Une province sans activité est une ligne à zéro, pas une ligne absente :
    // c'est elle qui dit où le produit n'existe pas encore.
    assert.ok(res.body.rows.some((r: any) => r.stores === 0), 'les provinces vides doivent apparaître');
  });

  it('rend le chiffre d’affaires par devise, jamais additionné', async () => {
    const res = await api.get('/api/v1/admin/geo/national', admin.accessToken);
    for (const ligne of res.body.rows) {
      assert.ok(Array.isArray(ligne.revenue));
      for (const r of ligne.revenue) {
        assert.equal(typeof r.total, 'string', 'aucun montant n’arrive en nombre');
        assert.ok(r.currency);
      }
    }
    assert.match(res.body.caveats.note, /jamais additionnés entre devises/);
  });

  it('distingue « aucune zone déclarée » de « non desservie »', async () => {
    // Les deux cas se ressemblent à l'écran et n'ont rien à voir : l'un est un
    // trou de configuration, l'autre une décision d'exploitation. L'invariant
    // le dit sans dépendre de l'état d'une table que d'autres suites vident.
    const res = await api.get('/api/v1/admin/geo/national', admin.accessToken);
    for (const ligne of res.body.rows) {
      if (ligne.delivery === null) continue;
      assert.ok(ligne.delivery.zones >= 1, '« null » est le seul état sans zone');
      assert.equal(typeof ligne.delivery.served, 'boolean');
    }
  });

  it('compte à part les commandes dont l’adresse n’a aucune province', async () => {
    // Les répartir « au plus proche » fabriquerait une carte de l'activité qui
    // n'a jamais existé.
    const res = await api.get('/api/v1/admin/geo/national', admin.accessToken);
    assert.equal(typeof res.body.caveats.ordersWithoutProvince, 'number');
  });

  it('reste fermé à qui n’est pas administrateur', async () => {
    const res = await api.get('/api/v1/admin/geo/national', seller.accessToken);
    assert.ok([401, 403, 404].includes(res.status), `attendu un refus, reçu ${res.status}`);
  });
});

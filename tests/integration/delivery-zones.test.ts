import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { loadGeography } from '../../src/touma/geo/geography.loader.js';
import { ZoneLogisticsProvider } from '../../src/touma/logistics/providers/zone.provider.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Zones de livraison (V17).
 *
 * Le défaut corrigé : l'unique transporteur branché facturait et datait toutes
 * les livraisons nationales à l'identique — N'Djamena → N'Djamena et
 * N'Djamena → Faya-Largeau au même prix et au même délai — et, répondant
 * toujours, ne savait jamais dire « je ne sais pas ».
 */
const api = new TestApi();
const provider = new ZoneLogisticsProvider();

let admin: any;
let ndjamena: any;
let tibesti: any;

const colis = { weightGrams: 2400 };

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
  await loadGeography('TD');

  admin = await registerUser(api, { name: 'Admin zones', email: uniqueEmail('zone-admin'), role: 'BUYER', countryCode: 'TD' });
  await promoteToAdmin(admin.user.id);
  admin.accessToken = (await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password })).body.accessToken;

  ndjamena = await prisma.toumaProvince.findFirstOrThrow({ where: { countryCode: 'TD', name: { contains: 'Djam' } } });
  tibesti = await prisma.toumaProvince.findFirstOrThrow({ where: { countryCode: 'TD', name: { contains: 'Tibesti' } } });

  await prisma.toumaDeliveryZone.deleteMany({});
});

after(async () => {
  await api.stop();
});

describe('Un transporteur qui ne sait pas le dit', () => {
  it('ne rend aucun tarif quand aucune zone ne couvre la destination', async () => {
    // C'est la vertu de ce transporteur, pas son défaut : un silence honnête
    // vaut mieux qu'un chiffre rassurant et faux, parce que le chiffre faux,
    // quelqu'un organise sa semaine dessus.
    const devis = await provider.getQuote({
      origin: { countryCode: 'TD' },
      destination: { countryCode: 'TD', provinceId: tibesti.id },
      parcel: colis,
      currency: 'XAF',
    });
    assert.deepEqual(devis, []);
  });

  it('refuse de convertir une devise sans taux officiel', async () => {
    await prisma.toumaDeliveryZone.create({
      data: {
        providerCode: 'zones',
        countryCode: 'TD',
        provinceId: ndjamena.id,
        estimatedMinDays: 1,
        estimatedMaxDays: 2,
        basePrice: '1500',
        currency: 'XAF',
        serviceName: 'Urbain',
      },
    });

    const devis = await provider.getQuote({
      origin: { countryCode: 'TD' },
      destination: { countryCode: 'TD', provinceId: ndjamena.id },
      parcel: colis,
      currency: 'EUR',
    });
    assert.deepEqual(devis, [], 'un tarif en XAF ne devient pas un tarif en EUR');
  });

  it('traite une zone déclarée non desservie comme une absence de tarif, pas comme la gratuité', async () => {
    await prisma.toumaDeliveryZone.create({
      data: {
        providerCode: 'zones',
        countryCode: 'TD',
        provinceId: tibesti.id,
        status: 'UNSERVED',
        estimatedMinDays: 0,
        estimatedMaxDays: 0,
        basePrice: '0',
        currency: 'XAF',
      },
    });

    const devis = await provider.getQuote({
      origin: { countryCode: 'TD' },
      destination: { countryCode: 'TD', provinceId: tibesti.id },
      parcel: colis,
      currency: 'XAF',
    });
    assert.deepEqual(devis, [], 'non desservi n’est pas « à zéro franc »');
  });
});

describe('Les tarifs viennent de la configuration, jamais du code', () => {
  it('applique la prise en charge et le supplément au kilo entamé', async () => {
    await prisma.toumaDeliveryZone.deleteMany({});
    await prisma.toumaDeliveryZone.create({
      data: {
        providerCode: 'zones',
        countryCode: 'TD',
        provinceId: ndjamena.id,
        estimatedMinDays: 1,
        estimatedMaxDays: 2,
        basePrice: '1500',
        pricePerKg: '1200',
        currency: 'XAF',
        serviceName: 'Urbain',
      },
    });

    const [devis] = await provider.getQuote({
      origin: { countryCode: 'TD' },
      destination: { countryCode: 'TD', provinceId: ndjamena.id },
      parcel: colis, // 2 400 g → 3 kg entamés
      currency: 'XAF',
    });
    assert.ok(devis, 'un tarif est rendu');
    // 1500 + 3 × 1200 = 5100. Le calcul est celui de la zone, pas une formule
    // cachée dans le code.
    assert.equal(devis.amount, '5100');
    assert.equal(devis.etaMinDays, 1);
    assert.equal(devis.etaMaxDays, 2);
    assert.equal(devis.serviceName, 'Urbain');
  });

  it('fait gagner la zone la plus précise sur la zone la plus large', async () => {
    await prisma.toumaDeliveryZone.deleteMany({});
    // Règle nationale…
    await prisma.toumaDeliveryZone.create({
      data: { providerCode: 'zones', countryCode: 'TD', estimatedMinDays: 5, estimatedMaxDays: 12, basePrice: '9000', currency: 'XAF', serviceName: 'National' },
    });
    // …corrigée pour une province, sans qu'il faille défaire la première.
    await prisma.toumaDeliveryZone.create({
      data: { providerCode: 'zones', countryCode: 'TD', provinceId: ndjamena.id, estimatedMinDays: 1, estimatedMaxDays: 2, basePrice: '1500', currency: 'XAF', serviceName: 'Urbain' },
    });

    const [urbain] = await provider.getQuote({
      origin: { countryCode: 'TD' },
      destination: { countryCode: 'TD', provinceId: ndjamena.id },
      parcel: { weightGrams: 500 },
      currency: 'XAF',
    });
    assert.equal(urbain.serviceName, 'Urbain');
    assert.equal(urbain.etaMaxDays, 2);

    // Une province sans exception retombe sur la règle nationale — et elle,
    // elle annonce douze jours, pas deux.
    const [national] = await provider.getQuote({
      origin: { countryCode: 'TD' },
      destination: { countryCode: 'TD', provinceId: tibesti.id },
      parcel: { weightGrams: 500 },
      currency: 'XAF',
    });
    assert.equal(national.serviceName, 'National');
    assert.equal(national.etaMaxDays, 12, 'une destination lointaine n’a plus le délai de la capitale');
  });
});

describe('Administration des zones', () => {
  it('refuse un délai maximal inférieur au minimal', async () => {
    const res = await api.post(
      '/api/v1/admin/geo/delivery-zones',
      { providerCode: 'zones', countryCode: 'TD', estimatedMinDays: 9, estimatedMaxDays: 2, basePrice: '1000', currency: 'XAF' },
      admin.accessToken,
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /inférieur au délai minimal/i);
  });

  it('n’est ouverte qu’à l’administration', async () => {
    const quidam = await registerUser(api, { name: 'Quidam', email: uniqueEmail('zone-quidam'), role: 'BUYER', countryCode: 'TD' });
    const res = await api.post(
      '/api/v1/admin/geo/delivery-zones',
      { providerCode: 'zones', countryCode: 'TD', estimatedMinDays: 1, estimatedMaxDays: 2, basePrice: '1000', currency: 'XAF' },
      quidam.accessToken,
    );
    assert.equal(res.status, 403);
  });

  it('désactive plutôt que de supprimer une zone en service', async () => {
    const creee = await api.post(
      '/api/v1/admin/geo/delivery-zones',
      { providerCode: 'zones', countryCode: 'TD', provinceId: ndjamena.id, estimatedMinDays: 1, estimatedMaxDays: 3, basePrice: '2000', currency: 'XAF' },
      admin.accessToken,
    );
    assert.equal(creee.status, 201);

    // Un devis figé dans une commande doit rester explicable : on ne supprime
    // pas la zone qui l'a produit.
    const suppression = await api.delete(`/api/v1/admin/geo/delivery-zones/${creee.body.id}`, admin.accessToken);
    assert.equal(suppression.status, 409);
    assert.match(suppression.body.error, /Désactivez/i);

    await api.patch(`/api/v1/admin/geo/delivery-zones/${creee.body.id}`, { active: false }, admin.accessToken);
    const seconde = await api.delete(`/api/v1/admin/geo/delivery-zones/${creee.body.id}`, admin.accessToken);
    assert.equal(seconde.status, 204);
  });

  it('désactive une province sans effacer son histoire', async () => {
    const res = await api.patch(`/api/v1/admin/geo/provinces/${tibesti.id}`, { active: false }, admin.accessToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.active, false);

    // Elle sort de la saisie…
    const liste = await api.get('/api/v1/geo/provinces?country=TD');
    assert.equal(liste.body.items.some((p: any) => p.id === tibesti.id), false);

    // …mais elle est toujours là, et ses localités avec.
    const encore = await prisma.toumaProvince.findUnique({ where: { id: tibesti.id } });
    assert.ok(encore, 'la province n’est pas supprimée');

    await api.patch(`/api/v1/admin/geo/provinces/${tibesti.id}`, { active: true }, admin.accessToken);
  });
});

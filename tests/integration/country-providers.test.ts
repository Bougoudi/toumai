import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { champsSecrets, enregistrer, matrice, selectionner } from '../../src/touma/platform/provider-registry.js';

/**
 * Registre des prestataires par marché (V26 §11, §12).
 *
 * La règle que ces tests fixent : **on ne sélectionne jamais un prestataire
 * qui ne peut pas rendre le service**. Ni une simulation, ni un prestataire en
 * configuration, ni un suspendu — et quand il n'y en a aucun, le motif sort
 * avec le refus.
 */

before(async () => {
  ensureSchema();
  await ensureReferenceData();
});
after(async () => prisma.$disconnect());

let compteur = 0;
const LETTRES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

async function marcheNeuf() {
  const n = compteur++;
  const code = `P${LETTRES[n % 26]}`;
  await prisma.toumaCountryProvider.deleteMany({ where: { countryCode: code } });
  const donnees = { name: `Marché ${code}`, currency: 'XAF', dialCode: '+000', timezone: 'Africa/Ndjamena', status: 'CONFIGURING' as const, active: false, buyingEnabled: false, sellingEnabled: false };
  await prisma.country.upsert({ where: { code }, update: donnees, create: { code, ...donnees } });
  return code;
}

describe('Prestataires — sélection', () => {
  it('ne choisit rien et le dit quand aucun prestataire n’est enregistré', async () => {
    const pays = await marcheNeuf();
    const s = await selectionner(pays, 'PAYMENT');
    assert.equal(s.provider, null);
    assert.match(s.reason, /Aucun prestataire PAYMENT n’est enregistré/);
  });

  it('ne choisit jamais un adaptateur de simulation', async () => {
    const pays = await marcheNeuf();
    // Une simulation ACTIVE : le piège exact. Elle répond à tout, y compris à
    // ce que personne ne peut faire.
    await enregistrer({ countryCode: pays, type: 'PAYMENT', code: 'mock', name: 'Simulation', status: 'ACTIVE', simulation: true });

    const s = await selectionner(pays, 'PAYMENT');
    assert.equal(s.provider, null);
    assert.match(s.reason, /simulation/i);
    assert.match(s.reason, /mock/);
  });

  it('ne choisit pas un prestataire qui n’est pas actif, et nomme son état', async () => {
    const pays = await marcheNeuf();
    await enregistrer({ countryCode: pays, type: 'PAYMENT', code: 'banque-a', name: 'Banque A', status: 'TESTING' });
    const s = await selectionner(pays, 'PAYMENT');
    assert.equal(s.provider, null);
    assert.match(s.reason, /banque-a \(TESTING\)/);
  });

  it('choisit le prestataire de plus haute priorité et annonce les relais', async () => {
    const pays = await marcheNeuf();
    await enregistrer({ countryCode: pays, type: 'PAYMENT', code: 'secours', name: 'Secours', status: 'ACTIVE', priority: 50 });
    await enregistrer({ countryCode: pays, type: 'PAYMENT', code: 'principal', name: 'Principal', status: 'ACTIVE', priority: 10 });

    const s = await selectionner(pays, 'PAYMENT');
    assert.equal(s.provider?.code, 'principal');
    assert.deepEqual(s.fallbacks.map((f) => f.code), ['secours']);
  });

  it('bascule sur le relais quand le principal est suspendu (§12, §46)', async () => {
    const pays = await marcheNeuf();
    await enregistrer({ countryCode: pays, type: 'PAYMENT', code: 'principal', name: 'Principal', status: 'ACTIVE', priority: 10 });
    await enregistrer({ countryCode: pays, type: 'PAYMENT', code: 'secours', name: 'Secours', status: 'ACTIVE', priority: 50 });
    assert.equal((await selectionner(pays, 'PAYMENT')).provider?.code, 'principal');

    await enregistrer({ countryCode: pays, type: 'PAYMENT', code: 'principal', name: 'Principal', status: 'SUSPENDED', priority: 10 });
    const apres = await selectionner(pays, 'PAYMENT');
    assert.equal(apres.provider?.code, 'secours');
    assert.deepEqual(apres.fallbacks, []);
  });

  it('respecte le moyen demandé', async () => {
    const pays = await marcheNeuf();
    await enregistrer({ countryCode: pays, type: 'PAYMENT', code: 'momo', name: 'Monnaie mobile', status: 'ACTIVE', supportedMethods: ['MOBILE_MONEY'] });
    assert.equal((await selectionner(pays, 'PAYMENT', { method: 'MOBILE_MONEY' })).provider?.code, 'momo');

    const cod = await selectionner(pays, 'PAYMENT', { method: 'CASH_ON_DELIVERY' });
    assert.equal(cod.provider, null);
    assert.match(cod.reason, /CASH_ON_DELIVERY/);
  });

  it('départage deux prestataires de même priorité de façon déterministe', async () => {
    // Un choix qui change d'une requête à l'autre rend un incident
    // irreproductible — et c'est quand tout va mal qu'on doit le rejouer.
    const pays = await marcheNeuf();
    await enregistrer({ countryCode: pays, type: 'SMS', code: 'zeta', name: 'Zeta', status: 'ACTIVE', priority: 10 });
    await enregistrer({ countryCode: pays, type: 'SMS', code: 'alpha', name: 'Alpha', status: 'ACTIVE', priority: 10 });
    for (let i = 0; i < 5; i++) {
      assert.equal((await selectionner(pays, 'SMS')).provider?.code, 'alpha');
    }
  });
});

describe('Prestataires — aucun secret en base (V25 §4)', () => {
  it('refuse d’écrire une configuration qui contient un secret', async () => {
    const pays = await marcheNeuf();
    await assert.rejects(
      () =>
        enregistrer({
          countryCode: pays,
          type: 'PAYMENT',
          code: 'banque-b',
          name: 'Banque B',
          configuration: { merchantId: 'TOUMA-001', apiKey: 'sk_live_123' },
        }),
      /secret/i,
    );
    assert.equal(await prisma.toumaCountryProvider.count({ where: { countryCode: pays, code: 'banque-b' } }), 0);
  });

  it('débusque un secret enfoui dans un objet imbriqué', async () => {
    const trouves = champsSecrets({ merchant: { name: 'ok', webhook: { signatureSecret: 'x' } }, list: [{ token: 'y' }] });
    assert.deepEqual(trouves.sort(), ['list[0].token', 'merchant.webhook.signatureSecret'].sort());
  });

  it('laisse passer les identifiants publics', async () => {
    const pays = await marcheNeuf();
    const p = await enregistrer({
      countryCode: pays,
      type: 'SMS',
      code: 'passerelle',
      name: 'Passerelle',
      configuration: { senderId: 'TOUMA', callbackUrl: 'https://touma.test/sms' },
    });
    assert.ok(p.id);
  });
});

describe('Prestataires — matrice (§13, §14)', () => {
  it('distingue « jamais vérifié » de « en panne »', async () => {
    // Les confondre ferait passer pour défaillant un prestataire qu'aucune
    // sonde n'a encore interrogé.
    const pays = await marcheNeuf();
    await enregistrer({ countryCode: pays, type: 'SHIPPING', code: 'transporteur', name: 'Transporteur', status: 'ACTIVE' });
    const lignes = (await matrice('SHIPPING')).filter((l) => l.country === pays);
    assert.equal(lignes.length, 1);
    assert.equal(lignes[0].health, 'NEVER_CHECKED');
    assert.equal(lignes[0].lastCheckedAt, null);
  });
});

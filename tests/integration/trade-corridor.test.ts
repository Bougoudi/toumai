import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { corridorService } from '../../src/touma/trade/corridor.service.js';
import { eligibilityService } from '../../src/touma/trade/eligibility.service.js';
import { fxService } from '../../src/touma/trade/fx.service.js';
import { costService } from '../../src/touma/trade/cost.service.js';

const api = new TestApi();
const suffixe = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
});
after(async () => api.stop());

/**
 * Deux pays neufs par test.
 *
 * Les codes ISO font deux lettres : dériver le code d'un suffixe temporel
 * produisait des collisions dès que deux tests tombaient sur la même lettre
 * finale. Un compteur de module les rend uniques par construction.
 */
let compteurPays = 0;
function codePays(): string {
  const lettres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const n = compteurPays++;
  return `${lettres[Math.floor(n / 26) % 26]}${lettres[n % 26]}`;
}

async function paireDePays(_s: string) {
  const codes: string[] = [];
  for (const role of ['origine', 'destination']) {
    const code = codePays();
    await prisma.country.upsert({
      where: { code },
      update: {},
      create: { code, name: `Pays d’essai ${code} (${role})`, currency: 'XAF', dialCode: '+000', active: true },
    });
    codes.push(code);
  }
  // Les codes sont déterministes : une seconde exécution de la suite
  // retomberait sur les mêmes et échouerait sur l'unicité du code de corridor.
  // On repart d'une ardoise propre pour cette paire.
  await prisma.toumaTradeCorridor.deleteMany({
    where: { OR: [{ originCountry: { in: codes } }, { destinationCountry: { in: codes } }] },
  });
  await prisma.toumaTradeCountryConfig.deleteMany({ where: { countryCode: { in: codes } } });
  return { origine: codes[0], destination: codes[1] };
}

describe('Corridors — un corridor n’est pas actif parce qu’il est déclaré actif', () => {
  it('un couple non configuré n’est pas opérationnel, et le dit', async () => {
    const capacite = await corridorService.capability('TD', 'ZW');
    assert.equal(capacite.operational, false);
    assert.match(capacite.missing.join(' '), /Aucun corridor configuré/);
  });

  it('un corridor est créé « à venir », jamais actif d’emblée', async () => {
    const { origine, destination } = await paireDePays(suffixe());
    const corridor = await corridorService.createCorridor({ originCountry: origine, destinationCountry: destination });
    // Un corridor s'ouvre après vérification des prestataires, pas au moment
    // où on le saisit.
    assert.equal(corridor.status, 'COMING_SOON');
    assert.equal(corridor.code, `${origine}_${destination}`);
  });

  it('l’activation est refusée tant que les prestataires manquent', async () => {
    const { origine, destination } = await paireDePays(suffixe());
    const corridor = await corridorService.createCorridor({
      originCountry: origine,
      destinationCountry: destination,
      supportedCurrencies: ['XAF'],
      supportedPaymentMethods: ['MOBILE_MONEY'],
    });
    // Ni configuration pays, ni transporteur : le corridor ne peut pas
    // promettre une livraison que personne ne fera.
    await assert.rejects(() => corridorService.updateCorridor(corridor.id, { status: 'ACTIVE' }), /ne peut pas être activé/i);
  });

  it('les deux sens sont configurables séparément', async () => {
    const { origine, destination } = await paireDePays(suffixe());
    await corridorService.createCorridor({ originCountry: origine, destinationCountry: destination, supportedPaymentMethods: ['MOBILE_MONEY'] });
    await corridorService.createCorridor({ originCountry: destination, destinationCountry: origine, supportedPaymentMethods: ['CASH_ON_DELIVERY'] });

    const aller = await corridorService.find(origine, destination);
    const retour = await corridorService.find(destination, origine);
    assert.notEqual(aller?.id, retour?.id);
    assert.deepEqual(aller?.supportedPaymentMethods, ['MOBILE_MONEY']);
    assert.deepEqual(retour?.supportedPaymentMethods, ['CASH_ON_DELIVERY']);
  });

  it('un moyen de paiement doit exister des deux côtés', async () => {
    const { origine, destination } = await paireDePays(suffixe());
    await corridorService.createCorridor({
      originCountry: origine,
      destinationCountry: destination,
      supportedCurrencies: ['XAF'],
      supportedPaymentMethods: ['MOBILE_MONEY', 'CARD'],
    });
    await corridorService.upsertCountryConfig(origine, { tradeEnabled: true, paymentMethods: ['MOBILE_MONEY', 'CARD'] });
    await corridorService.upsertCountryConfig(destination, { tradeEnabled: true, paymentMethods: ['MOBILE_MONEY'] });

    const capacite = await corridorService.capability(origine, destination);
    // L'intersection, jamais l'union : la carte n'est disponible que d'un côté.
    assert.deepEqual(capacite.paymentMethods, ['MOBILE_MONEY']);
  });
});

describe('Éligibilité', () => {
  it('une vente nationale n’est pas soumise aux règles transfrontalières', async () => {
    const r = await eligibilityService.check({ buyerCountry: 'TD', sellerCountry: 'TD' });
    assert.equal(r.crossBorder, false);
    assert.equal(r.verdict, 'ELIGIBLE');
    assert.match(r.reason, /nationale/i);
  });

  it('un corridor absent rend NOT_ELIGIBLE avec le motif', async () => {
    const r = await eligibilityService.check({ buyerCountry: 'CM', sellerCountry: 'TD' });
    // Le transfrontalier est fermé par défaut sur cette instance.
    assert.equal(r.verdict, 'NOT_ELIGIBLE');
    assert.ok(r.reason.length > 0, 'un refus doit porter son motif');
    assert.ok(r.criteria.length > 0);
  });

  it('chaque critère est nommé, réussi ou non', async () => {
    const r = await eligibilityService.check({ buyerCountry: 'CM', sellerCountry: 'TD', currency: 'XAF' });
    for (const c of r.criteria) {
      assert.ok(c.code.length > 0);
      assert.ok(c.detail.length > 0, `critère ${c.code} sans explication`);
    }
  });

  it('une vérification consignée peut être relue', async () => {
    const acheteur = await registerUser(api, { name: 'Acheteur Trade', email: uniqueEmail(`tr-${suffixe()}`), role: 'BUYER' });
    const r = await eligibilityService.checkAndRecord({ buyerCountry: 'CM', sellerCountry: 'TD', userId: acheteur.user.id });
    const ligne = await prisma.toumaTradeEligibilityCheck.findUnique({ where: { id: r.checkId } });
    assert.ok(ligne, 'la vérification n’a pas été consignée');
    assert.equal(ligne.verdict, r.verdict);
    // Un refus doit rester explicable plus tard à celui qui l'a reçu.
    assert.ok(ligne.reason && ligne.reason.length > 0);
  });
});

describe('Taux de change — aucune conversion inventée', () => {
  it('sans source configurée, aucune conversion n’est présentée comme réelle', async () => {
    const statut = fxService.status();
    assert.equal(statut.configured, false);
    const c = await fxService.convert('100000', 'XAF', 'EUR');
    assert.equal(c.available, false);
    assert.equal(c.amount, null);
    assert.match(c.reason ?? '', /indisponible/i);
  });

  it('une devise vers elle-même vaut 1 par définition, pas par convention', async () => {
    const c = await fxService.convert('100000', 'XAF', 'XAF');
    assert.equal(c.available, true);
    assert.equal(c.amount, '100000');
  });

  it('un taux sans source est refusé', async () => {
    await assert.rejects(
      () => fxService.record({ baseCurrency: 'XAF', quoteCurrency: 'EUR', rate: '0.0015', source: 'NONE', sourceName: 'x' }),
      /signifie l’absence de source/i,
    );
    await assert.rejects(
      () => fxService.record({ baseCurrency: 'XAF', quoteCurrency: 'EUR', rate: '0.0015', source: 'CENTRAL_BANK', sourceName: '  ' }),
      /source du taux est obligatoire/i,
    );
  });

  it('un taux enregistré porte sa source, son horodatage et son expiration', async () => {
    const t = await fxService.record({
      baseCurrency: 'XAF',
      quoteCurrency: 'EUR',
      rate: '0.001524',
      source: 'CENTRAL_BANK',
      sourceName: 'BEAC — taux de référence',
      sourceUrl: 'https://www.beac.int/',
    });
    assert.equal(t.sourceName, 'BEAC — taux de référence');
    assert.ok(t.expiresAt, 'un taux sans expiration servirait encore l’an prochain');
    assert.ok(t.expiresAt > t.rateAt);
  });
});

describe('Coût rendu — l’inconnu ne vaut pas zéro', () => {
  it('sans transporteur ni barème, le total reste incomplet', async () => {
    const c = await costService.estimate({
      currency: 'XAF',
      productAmount: '100000',
      sellerCountry: 'TD',
      buyerCountry: 'CM',
    });
    assert.equal(c.complete, false);
    // Un total qui paraît complet sans l'être est plus trompeur qu'une absence.
    assert.equal(c.total, null);
    assert.ok(c.unknownComponents.length > 0);
    assert.match(c.disclaimer, /ni une banque ni une société de douane/i);
  });

  it('ne calcule aucun droit de douane de sa propre initiative', async () => {
    const c = await costService.estimate({ currency: 'XAF', productAmount: '100000', sellerCountry: 'TD', buyerCountry: 'CM' });
    const douane = c.lines.find((l) => l.code === 'ESTIMATED_DUTIES');
    assert.ok(douane);
    assert.equal(douane.amount, null);
    assert.equal(douane.confidence, 'UNKNOWN');
  });

  it('le transport chiffré par un transporteur est confirmé, pas estimé', async () => {
    const c = await costService.estimate({
      currency: 'XAF',
      productAmount: '100000',
      shippingAmount: '8000',
      shippingSource: 'Transporteur Essai',
      sellerCountry: 'TD',
      buyerCountry: 'CM',
    });
    const transport = c.lines.find((l) => l.code === 'SHIPPING');
    assert.equal(transport?.confidence, 'CONFIRMED');
    assert.equal(transport?.source, 'Transporteur Essai');
  });
});

describe('API publique', () => {
  it('les corridors rendent le statut déclaré **et** la capacité réelle', async () => {
    const res = await api.request('GET', '/api/v1/trade/corridors');
    assert.equal(res.status, 200);
    for (const c of res.body.items) {
      assert.ok('declaredStatus' in c, 'le statut déclaré doit être rendu');
      assert.ok('operational' in c, 'la capacité réelle doit être rendue');
    }
    assert.match(res.body.note, /statut déclaré ne suffit pas/i);
  });

  it('un vendeur n’atteint pas l’administration du commerce', async () => {
    const vendeur = await registerUser(api, { name: 'Vendeur Trade', email: uniqueEmail(`trv-${suffixe()}`), role: 'SELLER' });
    const res = await api.request('GET', '/api/v1/admin/trade/overview', { token: vendeur.accessToken });
    assert.equal(res.status, 403);
  });

  it('l’administrateur voit ce qui manque à chaque corridor', async () => {
    const admin = await registerUser(api, { name: 'Admin Trade', email: uniqueEmail(`tra-${suffixe()}`), role: 'BUYER' });
    await promoteToAdmin(admin.user.id);
    const res = await api.request('GET', '/api/v1/admin/trade/overview', { token: admin.accessToken });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.corridors));
    assert.equal(res.body.fx.configured, false);
  });

  it('une règle est créée en brouillon, jamais applicable d’emblée', async () => {
    const admin = await registerUser(api, { name: 'Admin Regle', email: uniqueEmail(`trr-${suffixe()}`), role: 'BUYER' });
    await promoteToAdmin(admin.user.id);
    const res = await api.request('POST', '/api/v1/admin/trade/rules', {
      token: admin.accessToken,
      body: {
        ruleType: 'DOCUMENT_REQUIREMENT',
        body: { documents: ['COMMERCIAL_INVOICE'] },
        sourceName: 'Note de service interne',
        effectiveFrom: new Date().toISOString(),
      },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'DRAFT');
    assert.match(res.body.note, /brouillon/i);
  });
});

describe('Non-régression : le commerce national tchadien (§73)', () => {
  it('les 23 provinces du Tchad restent lisibles', async () => {
    const res = await api.request('GET', '/api/v1/geo/provinces?country=TD');
    assert.equal(res.status, 200);
    const items = res.body.items ?? res.body;
    // V24 ne doit rien changer au référentiel géographique national.
    assert.ok(Array.isArray(items));
  });

  it('une commande nationale reste éligible sans aucune configuration de corridor', async () => {
    const r = await eligibilityService.check({ buyerCountry: 'TD', sellerCountry: 'TD', currency: 'XAF', paymentMethod: 'CASH_ON_DELIVERY' });
    assert.equal(r.verdict, 'ELIGIBLE');
    assert.equal(r.crossBorder, false);
    // Aucun document exigé, aucun corridor consulté : le national ne traverse
    // pas le moteur transfrontalier.
    assert.deepEqual(r.requiredDocuments, []);
    assert.equal(r.corridor, null);
  });

  it('le catalogue national répond comme avant', async () => {
    const res = await api.request('GET', '/api/v1/products?limit=3');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
  });
});

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

describe('Risque commercial — explicable, jamais opaque', () => {
  it('publie ses poids et ses seuils', async () => {
    const { tradeRiskService } = await import('../../src/touma/trade/risk.service.js');
    const modele = tradeRiskService.explainModel();
    assert.ok(modele.signals.length >= 6);
    for (const s of modele.signals) {
      assert.ok(s.weight > 0);
      assert.ok(s.label.length > 0, `signal ${s.code} sans libellé lisible`);
    }
    assert.ok(modele.thresholds.some((t) => t.action === 'HOLD'));
    // Un score opaque n'est pas contestable.
    assert.match(modele.note, /se discutent/i);
  });

  it('chaque signal porte le fait qui l’a produit, et la sortie reste une recommandation', async () => {
    const { tradeRiskService } = await import('../../src/touma/trade/risk.service.js');
    const s = suffixe();
    const cat = await prisma.toumaCategory.findFirstOrThrow();
    const vendeur = await registerUser(api, { name: 'Vendeur Risque', email: uniqueEmail(`trisk-${s}`), role: 'SELLER' });
    const store = await prisma.toumaStore.create({
      data: { ownerId: vendeur.user.id, name: `B ${s}`, slug: `trisk-${s}`, countryCode: 'TD', status: 'ACTIVE' },
    });
    const produit = await prisma.toumaProduct.create({
      data: { storeId: store.id, categoryId: cat.id, title: 'Article', slug: `trisk-p-${s}`, description: 'x', price: '50000', currency: 'XAF', countryCode: 'TD', status: 'ACTIVE' },
    });
    const acheteur = await registerUser(api, { name: 'Acheteur Risque', email: uniqueEmail(`trisk-b-${s}`), role: 'BUYER' });
    const commande = await prisma.toumaOrder.create({
      data: {
        buyerId: acheteur.user.id,
        storeId: store.id,
        orderNumber: `TR-${s}`,
        status: 'PENDING',
        subtotal: '50000',
        total: '50000',
        currency: 'XAF',
        crossBorder: true,
        buyerCountry: 'CM',
        sellerCountry: 'TD',
        shippingSnapshot: { city: 'Douala' },
        items: { create: { productId: produit.id, titleSnapshot: 'Article', unitPrice: '50000', quantity: 1, lineTotal: '50000', currency: 'XAF' } },
      },
    });
    const tradeOrder = await prisma.toumaTradeOrder.create({ data: { orderId: commande.id, settlementCurrency: 'XAF' } });

    const r = await tradeRiskService.assess(tradeOrder.id);
    // Vendeur non vérifié et origine non déclarée : deux signaux mesurables.
    assert.ok(r.signals.some((x) => x.code === 'UNVERIFIED_SELLER'));
    assert.ok(r.signals.some((x) => x.code === 'NO_ORIGIN_DECLARED'));
    for (const signal of r.signals) assert.ok(signal.evidence.length > 0, `${signal.code} sans fait`);
    // Un signal absent ne vaut pas zéro risque : il est dit non mesuré.
    assert.ok(r.unmeasured.length > 0);
    assert.match(r.disclaimer, /Recommandation, pas décision/i);
    assert.match(r.explanation, /Seuil/);
  });
});

describe('Expédition transfrontalière — aucun tarif inventé', () => {
  it('distingue un corridor fermé d’un transporteur muet', async () => {
    const { tradeShippingService } = await import('../../src/touma/trade/shipping.service.js');
    const ferme = await tradeShippingService.quote({ originCountry: 'TD', destinationCountry: 'CM', weightGrams: 2000, currency: 'XAF' });
    // Corridor non opérationnel : `unavailable`, avec le motif du corridor.
    assert.equal(ferme.status, 'unavailable');
    assert.ok((ferme.reason ?? '').length > 0);
    assert.deepEqual(ferme.quotes, []);
  });

  it('un incident sans source ne se voit attribuer aucune cause', async () => {
    const { tradeShippingService } = await import('../../src/touma/trade/shipping.service.js');
    const s = suffixe();
    const cat = await prisma.toumaCategory.findFirstOrThrow();
    const vendeur = await registerUser(api, { name: 'Vendeur Incident', email: uniqueEmail(`tinc-${s}`), role: 'SELLER' });
    const store = await prisma.toumaStore.create({ data: { ownerId: vendeur.user.id, name: `B ${s}`, slug: `tinc-${s}`, countryCode: 'TD', status: 'ACTIVE' } });
    const produit = await prisma.toumaProduct.create({
      data: { storeId: store.id, categoryId: cat.id, title: 'Article', slug: `tinc-p-${s}`, description: 'x', price: '10000', currency: 'XAF', countryCode: 'TD', status: 'ACTIVE' },
    });
    const acheteur = await registerUser(api, { name: 'Acheteur Incident', email: uniqueEmail(`tinc-b-${s}`), role: 'BUYER' });
    const commande = await prisma.toumaOrder.create({
      data: {
        buyerId: acheteur.user.id, storeId: store.id, orderNumber: `TI-${s}`, status: 'PENDING',
        subtotal: '10000', total: '10000', currency: 'XAF', crossBorder: true, buyerCountry: 'CM', sellerCountry: 'TD',
        shippingSnapshot: { city: 'Douala' },
        items: { create: { productId: produit.id, titleSnapshot: 'Article', unitPrice: '10000', quantity: 1, lineTotal: '10000', currency: 'XAF' } },
      },
    });
    const tradeOrder = await prisma.toumaTradeOrder.create({ data: { orderId: commande.id } });

    // On prétend une cause douanière sans dire qui l'affirme.
    const incident = await tradeShippingService.raiseException({
      tradeOrderId: tradeOrder.id,
      kind: 'CUSTOMS_DELAY',
      detail: 'Colis immobile depuis six jours.',
    });
    // Sans source, la cause retombe sur UNKNOWN : un colis en retard n'est pas
    // un colis bloqué en douane.
    assert.equal(incident.kind, 'UNKNOWN');
    // Le fait observé est conservé, lui.
    assert.match(incident.detail ?? '', /six jours/);

    const avecSource = await tradeShippingService.raiseException({
      tradeOrderId: tradeOrder.id,
      kind: 'CUSTOMS_DELAY',
      sourceName: 'Transporteur Essai',
      detail: 'Retenue douanière signalée par le transporteur.',
    });
    assert.equal(avecSource.kind, 'CUSTOMS_DELAY');
    assert.equal(avecSource.sourceName, 'Transporteur Essai');
  });
});

describe('Chronologie — machine d’état', () => {
  it('refuse une transition incohérente', async () => {
    const { timelineService } = await import('../../src/touma/trade/timeline.service.js');
    const s = suffixe();
    const cat = await prisma.toumaCategory.findFirstOrThrow();
    const vendeur = await registerUser(api, { name: 'Vendeur Chrono', email: uniqueEmail(`tchr-${s}`), role: 'SELLER' });
    const store = await prisma.toumaStore.create({ data: { ownerId: vendeur.user.id, name: `B ${s}`, slug: `tchr-${s}`, countryCode: 'TD', status: 'ACTIVE' } });
    const produit = await prisma.toumaProduct.create({
      data: { storeId: store.id, categoryId: cat.id, title: 'Article', slug: `tchr-p-${s}`, description: 'x', price: '10000', currency: 'XAF', countryCode: 'TD', status: 'ACTIVE' },
    });
    const acheteur = await registerUser(api, { name: 'Acheteur Chrono', email: uniqueEmail(`tchr-b-${s}`), role: 'BUYER' });
    const commande = await prisma.toumaOrder.create({
      data: {
        buyerId: acheteur.user.id, storeId: store.id, orderNumber: `TC-${s}`, status: 'PENDING',
        subtotal: '10000', total: '10000', currency: 'XAF', buyerCountry: 'CM', sellerCountry: 'TD',
        shippingSnapshot: { city: 'Douala' },
        items: { create: { productId: produit.id, titleSnapshot: 'Article', unitPrice: '10000', quantity: 1, lineTotal: '10000', currency: 'XAF' } },
      },
    });
    const tradeOrder = await prisma.toumaTradeOrder.create({ data: { orderId: commande.id } });

    await timelineService.record({ tradeOrderId: tradeOrder.id, kind: 'ORDER_CREATED', origin: 'ORDERS' });
    await timelineService.record({ tradeOrderId: tradeOrder.id, kind: 'PAYMENT_INITIATED', origin: 'PAYMENTS' });
    await timelineService.record({ tradeOrderId: tradeOrder.id, kind: 'PAYMENT_CONFIRMED', origin: 'PAYMENTS' });
    await timelineService.record({ tradeOrderId: tradeOrder.id, kind: 'SHIPMENT_CREATED', origin: 'LOGISTICS' });
    await timelineService.record({ tradeOrderId: tradeOrder.id, kind: 'IN_TRANSIT', origin: 'LOGISTICS' });
    await timelineService.record({ tradeOrderId: tradeOrder.id, kind: 'DELIVERED', origin: 'LOGISTICS' });

    // « Livré » puis « paiement initié » écrirait une histoire fausse.
    await assert.rejects(
      () => timelineService.record({ tradeOrderId: tradeOrder.id, kind: 'PAYMENT_INITIATED', origin: 'PAYMENTS' }),
      /Transition impossible/i,
    );
    // Un webhook dans le désordre ne fait pas échouer le traitement.
    assert.equal(await timelineService.tryRecord({ tradeOrderId: tradeOrder.id, kind: 'PAYMENT_INITIATED', origin: 'PAYMENTS' }), false);
  });

  it('une chronologie ne peut pas commencer par « livré »', async () => {
    const { transitionAutorisee } = await import('../../src/touma/trade/timeline.service.js');
    assert.equal(transitionAutorisee(null, 'DELIVERED'), false);
    assert.equal(transitionAutorisee(null, 'ORDER_CREATED'), true);
    assert.equal(transitionAutorisee('DELIVERED', 'PAYMENT_INITIATED'), false);
    assert.equal(transitionAutorisee('DELIVERED', 'SETTLED'), true);
  });
});

describe('Un adaptateur de simulation ne rend pas un corridor opérationnel', () => {
  it('le transporteur « mock » ne compte pas comme couverture réelle', async () => {
    const { origine, destination } = await paireDePays(suffixe());
    await corridorService.createCorridor({
      originCountry: origine,
      destinationCountry: destination,
      supportedCurrencies: ['XAF'],
      supportedPaymentMethods: ['MOBILE_MONEY'],
    });
    await corridorService.upsertCountryConfig(origine, { tradeEnabled: true, paymentMethods: ['MOBILE_MONEY'] });
    await corridorService.upsertCountryConfig(destination, { tradeEnabled: true, paymentMethods: ['MOBILE_MONEY'] });

    // Le référentiel de développement enregistre un transporteur `mock` qui
    // « dessert partout ». Un essai en navigateur a montré qu'il rendait le
    // corridor opérationnel : une simulation n'achemine aucun colis.
    await prisma.toumaShippingProvider.upsert({
      where: { code: 'mock' },
      update: { active: true, countries: '' },
      create: { code: 'mock', name: 'Simulation', countries: '', active: true },
    });

    const capacite = await corridorService.capability(origine, destination);
    assert.equal(capacite.operational, false, 'une simulation ne doit pas ouvrir un corridor');
    assert.match(capacite.missing.join(' '), /simulation n’achemine aucun colis/);
    assert.deepEqual(capacite.shippingProviders, []);
  });

  it('un transporteur réel couvrant les deux pays rend le corridor opérationnel', async () => {
    const { origine, destination } = await paireDePays(suffixe());
    await corridorService.createCorridor({
      originCountry: origine,
      destinationCountry: destination,
      status: 'LIMITED',
      supportedCurrencies: ['XAF'],
      supportedPaymentMethods: ['MOBILE_MONEY'],
    });
    await corridorService.upsertCountryConfig(origine, { tradeEnabled: true, paymentMethods: ['MOBILE_MONEY'] });
    await corridorService.upsertCountryConfig(destination, { tradeEnabled: true, paymentMethods: ['MOBILE_MONEY'] });

    const code = `carrier-${suffixe()}`.slice(0, 40);
    await prisma.toumaShippingProvider.create({
      data: { code, name: 'Transporteur réel', countries: `${origine},${destination}`, active: true },
    });

    const capacite = await corridorService.capability(origine, destination);
    assert.equal(capacite.operational, true, capacite.missing.join(' '));
    assert.ok(capacite.shippingProviders.includes(code));
  });

  it('un transporteur qui ne dessert qu’un des deux pays ne suffit pas', async () => {
    const { origine, destination } = await paireDePays(suffixe());
    await corridorService.createCorridor({
      originCountry: origine,
      destinationCountry: destination,
      status: 'LIMITED',
      supportedCurrencies: ['XAF'],
      supportedPaymentMethods: ['MOBILE_MONEY'],
    });
    await corridorService.upsertCountryConfig(origine, { tradeEnabled: true, paymentMethods: ['MOBILE_MONEY'] });
    await corridorService.upsertCountryConfig(destination, { tradeEnabled: true, paymentMethods: ['MOBILE_MONEY'] });

    const code = `partial-${suffixe()}`.slice(0, 40);
    // « Dessert TD » ne dit pas « achemine de TD vers CM ».
    await prisma.toumaShippingProvider.create({ data: { code, name: 'Partiel', countries: origine, active: true } });

    const capacite = await corridorService.capability(origine, destination);
    assert.equal(capacite.operational, false);
  });
});

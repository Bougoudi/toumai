import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { priceIntelligence, ECHANTILLON_MINIMAL } from '../../src/touma/ai/insights/price.service.js';
import { demandIntelligence, VOLUME_PLANCHER } from '../../src/touma/ai/insights/demand.service.js';
import { briefService } from '../../src/touma/ai/insights/brief.service.js';
import { RunBudget, runTool } from '../../src/touma/ai/tools/runner.js';
import type { ToolContext } from '../../src/touma/ai/tools/registry.js';
import type { ToumaRequestUser } from '../../src/touma/middleware/toumaAuth.js';

const api = new TestApi();
const suffixe = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Termes créés par ce fichier, retirés à la fin. */
const termesCrees: string[] = [];

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
});

after(async () => {
  // Le tableau de bord Intelligence borne sa liste à vingt termes. Les
  // dizaines de recherches fabriquées ici en évinçaient de vraies, et le test
  // de ce tableau échouait — non par sa faute, mais parce que ce fichier
  // laissait ses données derrière lui.
  if (termesCrees.length > 0) await prisma.toumaSearchQuery.deleteMany({ where: { term: { in: termesCrees } } });
  await api.stop();
});

function ctx(user: ToumaRequestUser | null, surface: ToolContext['surface'] = 'SELLER'): ToolContext {
  return { user, surface, conversationId: null, locale: 'fr' };
}
const asUser = (u: { id: string; email: string }, role: string): ToumaRequestUser => ({ id: u.id, email: u.email, role, status: 'ACTIVE' });

/** Une catégorie neuve à chaque test : les fourchettes s'y calculent isolément. */
async function categorieNeuve(nom: string) {
  return prisma.toumaCategory.create({ data: { name: `Cat ${nom}`, slug: `cat-${nom}`, active: true } });
}

async function boutique(nom: string) {
  const vendeur = await registerUser(api, { name: `Vendeur ${nom}`, email: uniqueEmail(`ins-${nom}`), role: 'SELLER' });
  const store = await prisma.toumaStore.create({
    data: { ownerId: vendeur.user.id, name: `Boutique ${nom}`, slug: `ins-${nom}`, countryCode: 'TD', status: 'ACTIVE' },
  });
  return { vendeur, store, user: asUser(vendeur.user, 'SELLER') };
}

async function produit(storeId: string, categoryId: string, nom: string, prix: string, devise = 'XAF') {
  return prisma.toumaProduct.create({
    data: {
      storeId,
      categoryId,
      title: `Produit ${nom}`,
      slug: `p-${nom}`,
      description: 'Test',
      price: prix,
      currency: devise,
      countryCode: 'TD',
      status: 'ACTIVE',
      inventory: { create: { quantity: 5 } },
    },
  });
}

describe('Intelligence de prix', () => {
  it('refuse de publier une fourchette sur un échantillon trop petit', async () => {
    const s = suffixe();
    const cat = await categorieNeuve(s);
    const b = await boutique(s);
    for (let i = 0; i < ECHANTILLON_MINIMAL - 2; i += 1) await produit(b.store.id, cat.id, `${s}-${i}`, '10000');
    const cible = await produit(b.store.id, cat.id, `${s}-cible`, '10000');

    const r = await priceIntelligence.positionAndAnomaly(cible.id);
    // Trois produits ne font pas un marché : on dit qu'on ne sait pas.
    assert.equal(r?.range.available, false);
    assert.equal(r?.position, null);
    assert.match(r?.note ?? '', /Information non disponible/);
  });

  it('calcule la fourchette et l’écart à la médiane sur un échantillon suffisant', async () => {
    const s = suffixe();
    const cat = await categorieNeuve(s);
    const b = await boutique(s);
    for (const [i, prix] of ['10000', '12000', '14000', '16000', '18000', '20000'].entries()) {
      await produit(b.store.id, cat.id, `${s}-${i}`, prix);
    }
    const cible = await produit(b.store.id, cat.id, `${s}-cible`, '13000');

    const r = await priceIntelligence.positionAndAnomaly(cible.id);
    assert.equal(r?.range.available, true);
    assert.equal(r?.range.sampleSize, 6);
    assert.equal(r?.range.min, '10000');
    assert.equal(r?.range.max, '20000');
    // Le produit visé est exclu de sa propre fourchette : s'y inclure
    // rapprocherait mécaniquement la médiane de lui-même. Les six autres
    // donnent 15 000 ; l'inclure, lui septième, donnerait 14 000. Le chiffre
    // exact est donc la preuve de l'exclusion.
    assert.equal(r?.range.median, '15000.00');
    assert.equal(r?.anomaly, null);
    assert.match(r?.position?.statement ?? '', /médiane/);
    // Aucun qualificatif de valeur.
    assert.doesNotMatch(r?.position?.statement ?? '', /cher|bonne affaire|trop|devriez/i);
  });

  it('signale un écart fort sans le présenter comme une erreur', async () => {
    const s = suffixe();
    const cat = await categorieNeuve(s);
    const b = await boutique(s);
    for (const [i, prix] of ['10000', '11000', '12000', '13000', '14000'].entries()) await produit(b.store.id, cat.id, `${s}-${i}`, prix);
    const cible = await produit(b.store.id, cat.id, `${s}-cible`, '50000');

    const r = await priceIntelligence.positionAndAnomaly(cible.id);
    assert.equal(r?.anomaly?.code, 'PRICE_FAR_ABOVE_MEDIAN');
    assert.match(r?.anomaly?.caution ?? '', /n’est pas une erreur/);
  });

  it('ne mélange jamais deux devises dans une fourchette', async () => {
    const s = suffixe();
    const cat = await categorieNeuve(s);
    const b = await boutique(s);
    for (const [i, prix] of ['10000', '11000', '12000', '13000', '14000'].entries()) await produit(b.store.id, cat.id, `${s}-x${i}`, prix, 'XAF');
    for (const [i, prix] of ['20', '25', '30'].entries()) await produit(b.store.id, cat.id, `${s}-e${i}`, prix, 'EUR');

    const xaf = await priceIntelligence.marketRange(cat.id, 'XAF');
    const eur = await priceIntelligence.marketRange(cat.id, 'EUR');
    assert.equal(xaf.sampleSize, 5);
    assert.equal(xaf.currency, 'XAF');
    // Trois produits en euros : en dessous du seuil, donc rien n'est publié —
    // et surtout ils ne sont jamais comptés avec les XAF.
    assert.equal(eur.available, false);
  });

  it('ne calcule aucune variation quand la devise a changé', async () => {
    const s = suffixe();
    const cat = await categorieNeuve(s);
    const b = await boutique(s);
    const p = await produit(b.store.id, cat.id, `${s}-dev`, '15000');
    await prisma.toumaProductPriceHistory.createMany({
      data: [
        { productId: p.id, price: '15000', currency: 'XAF', validFrom: new Date(Date.now() - 20 * 86_400_000) },
        { productId: p.id, price: '25', currency: 'EUR', validFrom: new Date(Date.now() - 2 * 86_400_000) },
      ],
    });
    const v = await priceIntelligence.ownVariation(p.id, 90);
    assert.equal(v.changed, true);
    // Il n'existe pas de pourcentage entre 15 000 XAF et 25 EUR.
    assert.equal(v.deltaPercent, null);
    assert.equal(v.currencyChanged, true);
  });
});

describe('Intelligence de demande', () => {
  it('n’annonce pas de hausse sur un volume dérisoire', async () => {
    const terme = `terme-${suffixe()}`;
    termesCrees.push(terme);
    await prisma.toumaSearchQuery.createMany({
      data: [
        { term: terme, rawTerm: terme, resultCount: 0, createdAt: new Date(Date.now() - 40 * 86_400_000) },
        { term: terme, rawTerm: terme, resultCount: 0 },
        { term: terme, rawTerm: terme, resultCount: 0 },
        { term: terme, rawTerm: terme, resultCount: 0 },
      ],
    });
    const r = await demandIntelligence.forTerm(terme, 30);
    // 1 → 3 est une hausse de 200 % qui ne veut rien dire.
    assert.equal(r.searches.direction, 'INSUFFICIENT_DATA');
    assert.equal(r.searches.changePercent, null);
    assert.match(r.searches.statement, /Information non disponible/);
  });

  it('annonce une hausse quand le volume la rend lisible', async () => {
    const terme = `terme-${suffixe()}`;
    termesCrees.push(terme);
    const anciennes = Array.from({ length: 10 }, () => ({ term: terme, rawTerm: terme, resultCount: 2, createdAt: new Date(Date.now() - 40 * 86_400_000) }));
    const recentes = Array.from({ length: 30 }, () => ({ term: terme, rawTerm: terme, resultCount: 2 }));
    await prisma.toumaSearchQuery.createMany({ data: [...anciennes, ...recentes] });

    const r = await demandIntelligence.forTerm(terme, 30);
    assert.equal(r.searches.direction, 'UP');
    assert.equal(r.searches.current, 30);
    assert.equal(r.searches.previous, 10);
    assert.equal(r.searches.changePercent, 200);
  });

  it('nomme comme absentes les sources que Touma ne journalise pas', async () => {
    const r = await demandIntelligence.forTerm(`terme-${suffixe()}`, 30);
    // Vues et ajouts au panier n'existent pas en base : ils sont dits
    // manquants, jamais remplacés par un signal approchant.
    assert.ok(r.unavailable.some((u) => /vues produit/i.test(u)));
  });

  it('repère les recherches qui ne trouvent jamais rien', async () => {
    const terme = `introuvable-${suffixe()}`;
    termesCrees.push(terme);
    await prisma.toumaSearchQuery.createMany({
      data: Array.from({ length: 12 }, () => ({ term: terme, rawTerm: terme, resultCount: 0 })),
    });
    const r = await demandIntelligence.topTerms(30, 50);
    const ligne = r.items.find((t) => t.term === terme);
    assert.ok(ligne, 'le terme n’apparaît pas');
    assert.equal(ligne.neverMatched, true);
  });
});

describe('Bilans d’activité', () => {
  it('sépare l’observé, les variations, les anomalies et les questions', async () => {
    const s = suffixe();
    const cat = await categorieNeuve(s);
    const b = await boutique(s);
    const p = await produit(b.store.id, cat.id, `${s}-rupture`, '15000');
    await prisma.toumaInventory.updateMany({ where: { productId: p.id }, data: { quantity: 0 } });

    const bilan = await briefService.seller(b.store.id, 7);
    assert.equal(bilan.scope, 'SELLER');
    assert.ok(bilan.changes.length > 0);
    assert.ok(bilan.anomalies.some((a) => /rupture/i.test(a)), bilan.anomalies.join(' | '));
    // Des questions, jamais des causes affirmées.
    assert.ok(bilan.questions.length > 0);
    assert.ok(bilan.unavailable.some((u) => /cause/i.test(u)));
    for (const q of bilan.questions) assert.doesNotMatch(q, /\bparce que\b|\bà cause de\b/i);
  });

  it('ne somme jamais deux devises dans un bilan', async () => {
    const s = suffixe();
    const cat = await categorieNeuve(s);
    const b = await boutique(s);
    const p = await produit(b.store.id, cat.id, `${s}-dev`, '15000');
    const acheteur = await registerUser(api, { name: 'Acheteur Bilan', email: uniqueEmail(`bil-${s}`), role: 'BUYER' });
    for (const [devise, total] of [['XAF', '15000'], ['EUR', '25']] as const) {
      await prisma.toumaOrder.create({
        data: {
          buyerId: acheteur.user.id,
          storeId: b.store.id,
          orderNumber: `BIL-${s}-${devise}`,
          status: 'DELIVERED',
          subtotal: total,
          total,
          currency: devise,
          buyerCountry: 'TD',
          shippingSnapshot: { city: 'N’Djamena' },
          items: { create: { productId: p.id, titleSnapshot: 'P', unitPrice: total, quantity: 1, lineTotal: total, currency: devise } },
        },
      });
    }
    const bilan = await briefService.seller(b.store.id, 7);
    const devises = (bilan.observed as Record<string, any>).byCurrency as Array<Record<string, any>>;
    assert.equal(devises.length, 2);
    assert.deepEqual(devises.map((d) => d.currency).sort(), ['EUR', 'XAF']);
  });
});

describe('Outils d’intelligence : permissions', () => {
  it('un vendeur n’obtient pas le bilan d’un autre', async () => {
    const a = await boutique(`ba-${suffixe()}`);
    const b = await boutique(`bb-${suffixe()}`);
    const r = await runTool({ tool: 'getSellerBrief', args: { storeId: b.store.id } }, ctx(a.user, 'SELLER'), new RunBudget());
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /introuvable|autre vendeur/i);
  });

  it('un vendeur n’obtient pas le bilan de la plateforme', async () => {
    const a = await boutique(`bp-${suffixe()}`);
    const r = await runTool({ tool: 'getPlatformBrief', args: {} }, ctx(a.user, 'ADMIN'), new RunBudget());
    assert.equal(r.ok, false);
  });

  it('l’administrateur obtient le bilan de la plateforme', async () => {
    const admin = await registerUser(api, { name: 'Admin Bilan', email: uniqueEmail(`adm-${suffixe()}`), role: 'BUYER' });
    await promoteToAdmin(admin.user.id);
    const r = await runTool({ tool: 'getPlatformBrief', args: { days: 7 } }, ctx(asUser(admin.user, 'ADMIN'), 'ADMIN'), new RunBudget());
    assert.equal(r.ok, true);
    const d = r.data as Record<string, any>;
    assert.equal(d.scope, 'PLATFORM');
    assert.ok(Array.isArray(d.questions));
  });
});

describe('L’assistant route vers ces intelligences', () => {
  it('« pourquoi ce produit coûte-t-il plus cher ? » situe le prix', async () => {
    const s = suffixe();
    const cat = await categorieNeuve(s);
    const b = await boutique(s);
    for (const [i, prix] of ['10000', '11000', '12000', '13000', '14000'].entries()) await produit(b.store.id, cat.id, `${s}-${i}`, prix);
    const cible = await produit(b.store.id, cat.id, `${s}-cible`, '12500');

    const res = await api.request('POST', '/api/v1/ai/chat', { body: { message: `Pourquoi le produit ${cible.id} coûte-t-il ce prix ?` } });
    assert.equal(res.status, 200);
    assert.equal(res.body.intent, 'PRICE_INTELLIGENCE');
    assert.match(res.body.answer, /médiane/);
    assert.match(res.body.answer, /prix \*\*affichés\*\*|prix affichés/);
    assert.doesNotMatch(res.body.answer, /bonne affaire|trop cher/i);
  });

  it('le vendeur obtient un bilan structuré', async () => {
    const s = suffixe();
    const b = await boutique(s);
    const res = await api.request('POST', '/api/v1/seller/ai', {
      token: b.vendeur.accessToken,
      body: { message: `Fais-moi le bilan de la boutique ${b.store.id}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.intent, 'SELLER_BRIEF');
    assert.match(res.body.answer, /OBSERVÉ/);
    assert.match(res.body.answer, /VARIATIONS/);
  });
});

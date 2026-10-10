import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { riskInsights, ECHANTILLON_MINIMAL } from '../../src/touma/ai/insights/risk.service.js';
import { cartInsights } from '../../src/touma/ai/insights/cart.service.js';
import { RunBudget, runTool } from '../../src/touma/ai/tools/runner.js';
import type { ToolContext } from '../../src/touma/ai/tools/registry.js';
import type { ToumaRequestUser } from '../../src/touma/middleware/toumaAuth.js';

const api = new TestApi();
const suffixe = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
});
after(async () => api.stop());

const ctx = (user: ToumaRequestUser | null, surface: ToolContext['surface'] = 'BUYER'): ToolContext => ({ user, surface, conversationId: null, locale: 'fr' });
const asUser = (u: { id: string; email: string }, role: string): ToumaRequestUser => ({ id: u.id, email: u.email, role, status: 'ACTIVE' });

async function boutique(nom: string) {
  const vendeur = await registerUser(api, { name: `Vendeur ${nom}`, email: uniqueEmail(`rc-${nom}`), role: 'SELLER' });
  const store = await prisma.toumaStore.create({
    data: { ownerId: vendeur.user.id, name: `Boutique ${nom}`, slug: `rc-${nom}`, countryCode: 'TD', status: 'ACTIVE' },
  });
  return { vendeur, store };
}

async function produit(storeId: string, categoryId: string, nom: string, prix: string, stock = 10) {
  return prisma.toumaProduct.create({
    data: {
      storeId,
      categoryId,
      title: `Produit ${nom}`,
      slug: `prc-${nom}`,
      description: 'Test',
      price: prix,
      currency: 'XAF',
      countryCode: 'TD',
      status: 'ACTIVE',
      inventory: { create: { quantity: stock } },
    },
  });
}

async function commandeAvecRisque(storeId: string, buyerId: string, productId: string, niveau: 'LOW' | 'HIGH' | 'CRITICAL') {
  const o = await prisma.toumaOrder.create({
    data: {
      buyerId,
      storeId,
      orderNumber: `RC-${suffixe()}`,
      status: 'PENDING',
      subtotal: '10000',
      total: '10000',
      currency: 'XAF',
      buyerCountry: 'TD',
      shippingSnapshot: { city: 'N’Djamena' },
      items: { create: { productId, titleSnapshot: 'P', unitPrice: '10000', quantity: 1, lineTotal: '10000', currency: 'XAF' } },
    },
  });
  await prisma.toumaTransactionRisk.create({
    data: { orderId: o.id, score: niveau === 'CRITICAL' ? 80 : niveau === 'HIGH' ? 60 : 10, level: niveau, decision: 'ALLOW', factors: [] },
  });
  return o;
}

describe('Intelligence de fraude', () => {
  it('ne signale pas une boutique sur un échantillon dérisoire', async () => {
    const s = suffixe();
    const cat = await prisma.toumaCategory.create({ data: { name: `C ${s}`, slug: `c-${s}`, active: true } });
    const b = await boutique(s);
    const acheteur = await registerUser(api, { name: 'Acheteur Risque', email: uniqueEmail(`ar-${s}`), role: 'BUYER' });
    const p = await produit(b.store.id, cat.id, s, '10000');
    // Deux commandes, toutes deux critiques : 100 % de taux, et pourtant rien
    // à en conclure. Sans plancher, cette boutique serait en tête des suspects.
    for (let i = 0; i < 2; i += 1) await commandeAvecRisque(b.store.id, acheteur.user.id, p.id, 'CRITICAL');

    const signaux = await riskInsights.storesWithRiskyOrders(30);
    assert.ok(!signaux.some((x) => x.subjectId === b.store.id), 'boutique signalée sous le seuil');
  });

  it('signale une boutique au-dessus du seuil, avec ses faits et sa confiance', async () => {
    const s = suffixe();
    const cat = await prisma.toumaCategory.create({ data: { name: `C ${s}`, slug: `c-${s}`, active: true } });
    const b = await boutique(s);
    const acheteur = await registerUser(api, { name: 'Acheteur Risque Deux', email: uniqueEmail(`ar2-${s}`), role: 'BUYER' });
    const p = await produit(b.store.id, cat.id, s, '10000');
    for (let i = 0; i < ECHANTILLON_MINIMAL + 1; i += 1) {
      await commandeAvecRisque(b.store.id, acheteur.user.id, p.id, i < 4 ? 'HIGH' : 'LOW');
    }

    const signaux = await riskInsights.storesWithRiskyOrders(30);
    const mien = signaux.find((x) => x.subjectId === b.store.id);
    assert.ok(mien, 'boutique non signalée');
    assert.equal(mien.code, 'STORE_HIGH_RISK_ORDER_RATE');
    assert.equal(mien.evidence.orders, 6);
    assert.equal(mien.evidence.highOrCritical, 4);
    // Six observations : la confiance est basse, et le dit.
    assert.equal(mien.confidence, 'LOW');
    // Une revue à mener, jamais une décision prise.
    assert.match(mien.recommendedReview, /Regarder|vérifier|lire/i);
    assert.doesNotMatch(JSON.stringify(mien), /suspend|bloqu|restrict|sanction/i);
  });

  it('la file de revue rappelle qu’aucune décision n’est appliquée', async () => {
    const file = await riskInsights.reviewQueue(30);
    assert.match(file.disclaimer, /Aucune décision n’est appliquée/);
    assert.match(file.disclaimer, /restent des décisions humaines/);
  });

  it('un vendeur n’atteint pas la file de revue de fraude', async () => {
    const b = await boutique(suffixe());
    const r = await runTool({ tool: 'getRiskReviewQueue', args: {} }, ctx(asUser(b.vendeur.user, 'SELLER'), 'ADMIN'), new RunBudget());
    assert.equal(r.ok, false);
  });

  it('l’administrateur obtient la file, sans identité de compte', async () => {
    const admin = await registerUser(api, { name: 'Admin Risque', email: uniqueEmail(`adr-${suffixe()}`), role: 'BUYER' });
    await promoteToAdmin(admin.user.id);
    const r = await runTool({ tool: 'getRiskReviewQueue', args: { days: 30 } }, ctx(asUser(admin.user, 'ADMIN'), 'ADMIN'), new RunBudget());
    assert.equal(r.ok, true);
    const d = r.data as Record<string, any>;
    for (const s of d.signals as Array<Record<string, any>>) {
      // Une file de revue n'a pas besoin d'identité pour être ouverte.
      if (s.subjectType === 'USER') assert.equal(s.subjectLabel, null);
      assert.doesNotMatch(JSON.stringify(s.evidence), /@/);
    }
  });
});

describe('Assistant panier', () => {
  async function panierAvec(nom: string, articles: Array<{ prix: string; quantite: number; stock?: number }>) {
    const s = `${nom}-${suffixe()}`;
    const cat = await prisma.toumaCategory.create({ data: { name: `C ${s}`, slug: `c-${s}`, active: true } });
    const b = await boutique(s);
    const acheteur = await registerUser(api, { name: 'Acheteur Panier', email: uniqueEmail(`pan-${s}`), role: 'BUYER' });
    const cart = await prisma.toumaCart.create({ data: { userId: acheteur.user.id } });
    const produits = [];
    for (const [i, a] of articles.entries()) {
      const p = await produit(b.store.id, cat.id, `${s}-${i}`, a.prix, a.stock ?? 10);
      await prisma.toumaCartItem.create({ data: { cartId: cart.id, productId: p.id, quantity: a.quantite, unitPrice: a.prix, currency: 'XAF' } });
      produits.push(p);
    }
    return { acheteur, cat, store: b.store, produits };
  }

  it('signale un stock insuffisant, sans prédire de rupture', async () => {
    const { acheteur } = await panierAvec('stock', [{ prix: '10000', quantite: 5, stock: 2 }]);
    const a = await cartInsights.analyse(acheteur.user.id);
    assert.equal(a.stockIssues.length, 1);
    assert.equal(a.stockIssues[0].requested, 5);
    assert.equal(a.stockIssues[0].available, 2);
  });

  it('propose une alternative moins chère en disant que ce n’est pas le même produit', async () => {
    const { acheteur, cat, store } = await panierAvec('alt', [{ prix: '30000', quantite: 2 }]);
    await produit(store.id, cat.id, `moinscher-${suffixe()}`, '18000');

    const a = await cartInsights.analyse(acheteur.user.id);
    assert.equal(a.alternatives.length, 1);
    assert.equal(a.alternatives[0].savingPerUnit, '12000');
    // 12 000 × 2 articles.
    assert.equal(a.alternatives[0].savingTotal, '24000');
    assert.match(a.alternatives[0].caution, /pas le même produit/);
  });

  it('dit qu’un objectif est hors d’atteinte plutôt que de le contourner', async () => {
    const { acheteur, cat, store } = await panierAvec('obj', [{ prix: '20000', quantite: 1 }]);
    await produit(store.id, cat.id, `petit-${suffixe()}`, '18000');

    const a = await cartInsights.analyse(acheteur.user.id, { targetSaving: '15000' });
    assert.equal(a.targetSaving?.reachable, false);
    assert.equal(a.targetSaving?.bestAchievable, '2000');
  });

  it('ne modifie jamais le panier', async () => {
    const { acheteur } = await panierAvec('intact', [{ prix: '10000', quantite: 3 }]);
    const avant = await prisma.toumaCartItem.findMany({ where: { cart: { userId: acheteur.user.id } }, select: { quantity: true, productId: true } });
    await cartInsights.analyse(acheteur.user.id, { targetSaving: '5000' });
    const apres = await prisma.toumaCartItem.findMany({ where: { cart: { userId: acheteur.user.id } }, select: { quantity: true, productId: true } });
    assert.deepEqual(apres, avant);
  });

  it('l’assistant répond à « comment réduire mon panier »', async () => {
    const { acheteur, cat, store } = await panierAvec('chat', [{ prix: '30000', quantite: 1 }]);
    await produit(store.id, cat.id, `alt2-${suffixe()}`, '22000');

    const res = await api.request('POST', '/api/v1/ai/chat', {
      token: acheteur.accessToken,
      body: { message: 'Comment réduire mon panier de 10 000 XAF ?' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.intent, 'CART_OPTIMISE');
    assert.match(res.body.answer, /pas le même produit/);
    assert.match(res.body.answer, /Je ne modifie pas votre panier/);
    // Aucun frais de livraison annoncé : ils viennent du transporteur.
    assert.ok(res.body.unavailable.some((u: string) => /livraison/i.test(u)));
  });
});

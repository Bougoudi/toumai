import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { assessTransaction } from '../../src/touma/trust/transaction-risk.js';
import { assessReview, scoreAndStore } from '../../src/touma/trust/review-risk.js';

/**
 * Fraude sur les avis et risque d'une transaction.
 *
 * Les deux modules partagent une contrainte que ces contrôles verrouillent :
 * **ils recommandent, ils ne sanctionnent pas.** Un blocage ne peut venir que
 * d'une règle portant sur un fait certain, jamais d'un score.
 */
const api = new TestApi();

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
});
after(async () => api.stop());

async function boutique(suffixe: string, data: Record<string, unknown> = {}) {
  const vendeur = await registerUser(api, {
    name: `V ${suffixe}`,
    email: uniqueEmail(`risk-${suffixe}`),
    role: 'SELLER',
  });
  const store = await prisma.toumaStore.create({
    data: {
      ownerId: vendeur.user.id,
      name: `B ${suffixe}`,
      slug: `b-risk-${suffixe}-${Date.now()}`,
      countryCode: 'TD',
      status: 'ACTIVE',
      ...data,
    },
  });
  return { vendeur, store };
}

describe('Risque d’une transaction', () => {
  it('laisse passer un achat ordinaire chez un vendeur installé', async () => {
    const { store } = await boutique('ordinaire', { verificationStatus: 'APPROVED' });
    const acheteur = await registerUser(api, {
      name: 'Acheteur',
      email: uniqueEmail('risk-ordinaire'),
      role: 'BUYER',
    });
    // Compte antidaté : le facteur « compte tout neuf » ne doit pas s'appliquer
    // à quelqu'un qui n'a rien fait de suspect.
    await prisma.user.update({
      where: { id: acheteur.user.id },
      data: { createdAt: new Date(Date.now() - 200 * 86_400_000) },
    });

    const r = await assessTransaction({
      buyerId: acheteur.user.id,
      storeId: store.id,
      amount: 25_000,
      currency: 'XAF',
      paymentMethod: 'MOBILE_MONEY',
      destinationCountry: 'TD',
    });
    assert.equal(r.decision, 'ALLOW');
    assert.equal(r.level, 'LOW');
  });

  it('ne bloque jamais sur le seul cumul de facteurs', async () => {
    // Le cœur du §17. Un acheteur de N'Djamena qui commande cher, pour la
    // première fois, chez un vendeur nouveau, coche trois cases sans rien
    // faire de mal. La plateforme peut retenir le versement ; elle ne doit
    // pas refuser la vente.
    const { store } = await boutique('cumul');
    const acheteur = await registerUser(api, { name: 'Neuf', email: uniqueEmail('risk-cumul'), role: 'BUYER' });
    await prisma.toumaRiskScore.create({
      data: { userId: acheteur.user.id, score: 55, level: 'MEDIUM', signals: [] },
    });

    const r = await assessTransaction({
      buyerId: acheteur.user.id,
      storeId: store.id,
      amount: 900_000,
      currency: 'XAF',
      paymentMethod: 'CASH_ON_DELIVERY',
      destinationCountry: 'CM',
    });
    assert.notEqual(r.decision, 'BLOCK', 'aucun cumul de facteurs ne doit bloquer');
    assert.equal(r.rule, null, 'aucune règle certaine ne s’applique ici');
    assert.ok(r.factors.length >= 3, 'les facteurs doivent être nommés un par un');
    for (const f of r.factors) {
      assert.ok(f.label.length > 5, `${f.code} doit porter un libellé lisible`);
    }
  });

  it('ne bloque que sur une règle nommée portant sur un fait certain', async () => {
    const { store } = await boutique('banni');
    const acheteur = await registerUser(api, { name: 'Banni', email: uniqueEmail('risk-banni'), role: 'BUYER' });
    await prisma.toumaAccountStanding.create({
      data: { userId: acheteur.user.id, status: 'BANNED', reason: 'FRAUD' },
    });

    const r = await assessTransaction({
      buyerId: acheteur.user.id,
      storeId: store.id,
      amount: 1000,
      currency: 'XAF',
      paymentMethod: 'MOBILE_MONEY',
      destinationCountry: 'TD',
    });
    assert.equal(r.decision, 'BLOCK');
    assert.equal(r.rule, 'ACCOUNT_BANNED', 'le blocage doit citer la règle qui l’impose');
  });

  it('bloque aussi une commande vers une boutique fermée', async () => {
    const { store } = await boutique('fermee', { status: 'SUSPENDED' });
    const acheteur = await registerUser(api, { name: 'Acheteur', email: uniqueEmail('risk-fermee'), role: 'BUYER' });
    const r = await assessTransaction({
      buyerId: acheteur.user.id,
      storeId: store.id,
      amount: 1000,
      currency: 'XAF',
      paymentMethod: 'MOBILE_MONEY',
      destinationCountry: 'TD',
    });
    assert.equal(r.rule, 'STORE_INACTIVE');
  });
});

describe('Manipulation des avis', () => {
  async function avisLivre(suffixe: string, options: { rating?: number; comment?: string | null } = {}) {
    const { store, vendeur } = await boutique(`avis-${suffixe}`);
    const categorie = await prisma.toumaCategory.findFirst();
    const produit = await prisma.toumaProduct.create({
      data: {
        storeId: store.id,
        categoryId: categorie!.id,
        title: `Produit ${suffixe}`,
        slug: `p-avis-${suffixe}-${Date.now()}`,
        description: 'Test',
        price: '10000',
        currency: 'XAF',
        countryCode: 'TD',
        status: 'ACTIVE',
      },
    });
    const acheteur = await registerUser(api, {
      name: `A ${suffixe}`,
      email: uniqueEmail(`avis-${suffixe}`),
      role: 'BUYER',
    });
    const commande = await prisma.toumaOrder.create({
      data: {
        orderNumber: `TST-${suffixe}-${Date.now()}`,
        buyerId: acheteur.user.id,
        storeId: store.id,
        status: 'DELIVERED',
        currency: 'XAF',
        subtotal: '10000',
        shippingTotal: '0',
        total: '10000',
        shippingSnapshot: {},
        buyerCountry: 'TD',
        sellerCountry: 'TD',
        deliveredAt: new Date(),
      },
    });
    const avis = await prisma.toumaReview.create({
      data: {
        orderId: commande.id,
        productId: produit.id,
        authorId: acheteur.user.id,
        rating: options.rating ?? 5,
        comment: options.comment === undefined ? 'Très bon produit, conforme.' : options.comment,
      },
    });
    return { avis, acheteur, vendeur, store, produit };
  }

  it('ne signale rien sur un avis ordinaire', async () => {
    const { avis } = await avisLivre('ordinaire');
    // Déposé le jour même mais avec un texte : seul le délai très court sans
    // texte doit inquiéter.
    await prisma.toumaReview.update({
      where: { id: avis.id },
      data: { createdAt: new Date(Date.now() + 3600 * 1000) },
    });
    const r = await assessReview(avis.id);
    assert.equal(r.action, 'ALLOW');
    assert.equal(r.score, 0);
  });

  it('repère un avis déposé avant d’avoir pu essayer le produit', async () => {
    const { avis } = await avisLivre('immediat');
    const r = await assessReview(avis.id);
    const codes = r.signals.map((s) => s.code);
    assert.ok(codes.includes('IMMEDIATE_AFTER_DELIVERY'));
  });

  it('repère des coordonnées glissées dans un avis', async () => {
    const { avis } = await avisLivre('coordonnees', {
      comment: 'Bon produit, contactez-moi sur WhatsApp au +235 66 12 34 56 pour moins cher.',
    });
    const r = await assessReview(avis.id);
    const codes = r.signals.map((s) => s.code);
    assert.ok(codes.includes('CONTACT_DETAILS'), 'le démarchage doit être repéré');
  });

  it('repère un avis déposé par le vendeur lui-même', async () => {
    const { avis, store } = await avisLivre('autoavis');
    await prisma.toumaReview.update({
      where: { id: avis.id },
      data: { authorId: (await prisma.toumaStore.findUniqueOrThrow({ where: { id: store.id } })).ownerId },
    });
    const r = await assessReview(avis.id);
    const lien = r.signals.find((s) => s.code === 'LINKED_TO_SELLER');
    assert.ok(lien, 'un auto-avis doit être repéré');
    assert.equal((lien?.detail as { relation?: string }).relation, 'SAME_ACCOUNT');
  });

  it('signale sans masquer', async () => {
    // La garantie qui compte : un avis suspect reste lisible jusqu'à ce qu'un
    // humain tranche. Le masquer sur un score serait une sanction automatique.
    const { avis, store } = await avisLivre('signale');
    await prisma.toumaReview.update({
      where: { id: avis.id },
      data: {
        authorId: (await prisma.toumaStore.findUniqueOrThrow({ where: { id: store.id } })).ownerId,
        comment: 'Achetez plutôt ici : vendeur@exemple.td',
      },
    });
    const r = await scoreAndStore(avis.id);
    assert.ok(r.score >= 40);
    assert.ok(['HOLD', 'REVIEW'].includes(r.action));

    const apres = await prisma.toumaReview.findUniqueOrThrow({ where: { id: avis.id } });
    assert.equal(apres.status, 'FLAGGED', 'signalé');
    assert.notEqual(apres.status, 'HIDDEN', 'jamais masqué automatiquement');

    const consigne = await prisma.toumaReviewRiskScore.findUnique({ where: { reviewId: avis.id } });
    assert.ok(consigne, 'l’évaluation doit être consignée pour la file de modération');
    assert.ok(Array.isArray(consigne?.signals), 'les signaux sont conservés, pas seulement le score');
  });
});

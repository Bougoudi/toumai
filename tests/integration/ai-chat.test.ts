import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

const api = new TestApi();

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
});
after(async () => api.stop());

async function boutiqueAvecTelephones(suffixe: string) {
  const vendeur = await registerUser(api, { name: `Vendeur ${suffixe}`, email: uniqueEmail(`chat-${suffixe}`), role: 'SELLER' });
  const store = await prisma.toumaStore.create({
    data: { ownerId: vendeur.user.id, name: `Boutique ${suffixe}`, slug: `chat-${suffixe}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, countryCode: 'TD', status: 'ACTIVE' },
  });
  const categorie = await prisma.toumaCategory.findFirstOrThrow();
  const produits = [];
  for (const [i, prix] of ['45000', '85000', '150000'].entries()) {
    produits.push(
      await prisma.toumaProduct.create({
        data: {
          storeId: store.id,
          categoryId: categorie.id,
          title: `Téléphone ${suffixe} ${i}`,
          slug: `chat-tel-${suffixe}-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          description: 'Téléphone reconditionné, batterie changée.',
          keywords: 'telephone smartphone',
          price: prix,
          currency: 'XAF',
          countryCode: 'TD',
          status: 'ACTIVE',
          inventory: { create: { quantity: 4 } },
        },
      }),
    );
  }
  return { vendeur, store, produits };
}

describe('Assistant acheteur — recherche réelle', () => {
  it('répond à une phrase en français par des produits du catalogue', async () => {
    const { produits } = await boutiqueAvecTelephones('rech');
    const res = await api.request('POST', '/api/v1/ai/chat', { body: { message: 'Je cherche un téléphone à moins de 100 000 XAF livré à N’Djamena' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.intent, 'SEARCH_PRODUCTS');
    // Ce que l'assistant a compris est rendu, pour que l'utilisateur corrige.
    assert.match(res.body.understood, /moins de 100000/);

    // Les produits proposés existent et respectent le budget demandé.
    assert.ok(res.body.cards.length > 0, 'aucun produit proposé');
    const ids = res.body.cards.filter((c: { type: string }) => c.type === 'PRODUCT').map((c: { id: string }) => c.id);
    const enBase = await prisma.toumaProduct.findMany({ where: { id: { in: ids } }, select: { id: true, price: true } });
    assert.equal(enBase.length, ids.length, 'un produit proposé n’existe pas');
    for (const p of enBase) assert.ok(p.price.lessThanOrEqualTo(100_000), `produit hors budget : ${p.price}`);

    // Le produit à 150 000 est bien exclu : le filtre a réellement été appliqué.
    assert.ok(!ids.includes(produits[2].id), 'le budget n’a pas filtré');

    // Aucun délai de livraison annoncé.
    assert.doesNotMatch(res.body.answer, /\b\d+\s*(jours?|semaines?)\b/);
    assert.ok(res.body.unavailable.some((u: string) => /délai/i.test(u)));
  });

  it('dit d’où vient la réponse plutôt que de laisser croire à un modèle', async () => {
    const res = await api.request('POST', '/api/v1/ai/chat', { body: { message: 'bonjour' } });
    assert.equal(res.body.source.realProviderConfigured, false);
    assert.equal(res.body.source.provider, 'RULE_BASED');
    assert.match(res.body.source.note, /Aucun modèle de langage externe/);
  });

  it('rend « information non disponible » quand le catalogue n’a rien', async () => {
    const res = await api.request('POST', '/api/v1/ai/chat', { body: { message: 'Je cherche un zzzqqqwww introuvable' } });
    assert.match(res.body.answer, /Information non disponible/i);
    assert.equal(res.body.cards.length, 0);
  });

  it('compare deux produits sans en désigner un meilleur', async () => {
    const { produits } = await boutiqueAvecTelephones('cmp');
    const res = await api.request('POST', '/api/v1/ai/chat', { body: { message: `Compare ${produits[0].id} et ${produits[1].id}` } });
    assert.equal(res.body.intent, 'COMPARE_PRODUCTS');
    assert.match(res.body.answer, /je ne désigne pas de meilleur produit/i);
    // Les prix affichés sont ceux de la base.
    assert.match(res.body.answer, /45000 XAF/);
    assert.match(res.body.answer, /85000 XAF/);
    assert.match(res.body.answer, /aucun avis/i);
  });

  it('trace les appels d’outils de chaque tour', async () => {
    const res = await api.request('POST', '/api/v1/ai/chat', { body: { message: 'Je cherche des chaussures' } });
    assert.ok(res.body.toolCalls.length > 0);
    const traces = await prisma.toumaAiToolCall.count({ where: { conversationId: res.body.conversationId } });
    assert.equal(traces, res.body.toolCalls.length);
  });
});

describe('Assistant acheteur — commandes', () => {
  it('ne montre que les commandes de celui qui demande', async () => {
    const { store, produits } = await boutiqueAvecTelephones('cmd');
    const a = await registerUser(api, { name: 'Acheteur Un', email: uniqueEmail('chat-a'), role: 'BUYER' });
    const b = await registerUser(api, { name: 'Acheteur Deux', email: uniqueEmail('chat-b'), role: 'BUYER' });
    const commandeDeB = await prisma.toumaOrder.create({
      data: {
        buyerId: b.user.id,
        storeId: store.id,
        orderNumber: `CHAT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: 'PENDING',
        subtotal: '45000',
        total: '45000',
        currency: 'XAF',
        buyerCountry: 'TD',
        shippingSnapshot: { city: 'N’Djamena' },
        items: { create: { productId: produits[0].id, titleSnapshot: 'Téléphone', unitPrice: '45000', quantity: 1, lineTotal: '45000', currency: 'XAF' } },
      },
    });

    const res = await api.request('POST', '/api/v1/ai/chat', { token: a.accessToken, body: { message: 'Montre-moi mes commandes' } });
    assert.equal(res.body.intent, 'ORDER_LIST');
    assert.ok(!res.body.answer.includes(commandeDeB.orderNumber), 'la commande d’un autre a fuité');

    const cible = await api.request('POST', '/api/v1/ai/chat', { token: a.accessToken, body: { message: `Où est ma commande ${commandeDeB.id} ?` } });
    assert.ok(!cible.body.answer.includes(commandeDeB.orderNumber));
    assert.match(cible.body.answer, /Information non disponible|introuvable/i);
  });

  it('n’annonce aucun retard quand aucun événement de suivi n’existe', async () => {
    const { store, produits } = await boutiqueAvecTelephones('suivi');
    const acheteur = await registerUser(api, { name: 'Acheteur Trois', email: uniqueEmail('chat-c'), role: 'BUYER' });
    const commande = await prisma.toumaOrder.create({
      data: {
        buyerId: acheteur.user.id,
        storeId: store.id,
        orderNumber: `SUIVI-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: 'CONFIRMED',
        subtotal: '45000',
        total: '45000',
        currency: 'XAF',
        buyerCountry: 'TD',
        shippingSnapshot: { city: 'N’Djamena' },
        items: { create: { productId: produits[0].id, titleSnapshot: 'Téléphone', unitPrice: '45000', quantity: 1, lineTotal: '45000', currency: 'XAF' } },
      },
    });
    const res = await api.request('POST', '/api/v1/ai/chat', { token: acheteur.accessToken, body: { message: `Où est ma commande ${commande.id} ?` } });
    assert.match(res.body.answer, /absence d’information, pas un retard/i);
    assert.doesNotMatch(res.body.answer, /retard|en retard/i.source === '' ? /$^/ : /votre colis est en retard/i);
  });
});

describe('Conversations et mémoire', () => {
  it('poursuit une conversation et en conserve l’historique', async () => {
    const acheteur = await registerUser(api, { name: 'Acheteur Quatre', email: uniqueEmail('chat-d'), role: 'BUYER' });
    const premier = await api.request('POST', '/api/v1/ai/chat', { token: acheteur.accessToken, body: { message: 'Je cherche un sac à moins de 20 000 XAF' } });
    const second = await api.request('POST', '/api/v1/ai/chat', { token: acheteur.accessToken, body: { message: 'Et des chaussures ?', conversationId: premier.body.conversationId } });
    assert.equal(second.body.conversationId, premier.body.conversationId);

    const detail = await api.request('GET', `/api/v1/ai/conversations/${premier.body.conversationId}`, { token: acheteur.accessToken });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.messages.length, 4);
    assert.ok(detail.body.toolCalls.length > 0, 'la trace d’outils doit accompagner la conversation');
  });

  it('un visiteur ne reprend pas la conversation d’un utilisateur connecté', async () => {
    const acheteur = await registerUser(api, { name: 'Acheteur Cinq', email: uniqueEmail('chat-e'), role: 'BUYER' });
    const sienne = await api.request('POST', '/api/v1/ai/chat', { token: acheteur.accessToken, body: { message: 'Je cherche un sac' } });
    // Écrit `userId: user?.id ?? undefined`, le filtre disparaissait pour un
    // visiteur et cette conversation aurait été reprise par n'importe qui.
    const visiteur = await api.request('POST', '/api/v1/ai/chat', { body: { message: 'Bonjour', conversationId: sienne.body.conversationId } });
    assert.equal(visiteur.status, 404);
  });

  it('un utilisateur ne lit pas la conversation d’un autre', async () => {
    const a = await registerUser(api, { name: 'Acheteur Six', email: uniqueEmail('chat-f'), role: 'BUYER' });
    const b = await registerUser(api, { name: 'Acheteur Sept', email: uniqueEmail('chat-g'), role: 'BUYER' });
    const sienne = await api.request('POST', '/api/v1/ai/chat', { token: a.accessToken, body: { message: 'Je cherche un sac' } });
    const vol = await api.request('GET', `/api/v1/ai/conversations/${sienne.body.conversationId}`, { token: b.accessToken });
    assert.equal(vol.status, 404);
  });

  it('retient un budget exprimé et le rend effaçable', async () => {
    const acheteur = await registerUser(api, { name: 'Acheteur Huit', email: uniqueEmail('chat-h'), role: 'BUYER' });
    await api.request('POST', '/api/v1/ai/chat', { token: acheteur.accessToken, body: { message: 'Je cherche un téléphone à moins de 60 000 XAF' } });
    const memoire = await api.request('GET', '/api/v1/ai/memory', { token: acheteur.accessToken });
    const budget = memoire.body.items.find((m: { key: string }) => m.key === 'budget_max');
    assert.ok(budget, 'le budget n’a pas été retenu');
    assert.equal(budget.value, '60000');
    // Toute mémoire porte une expiration : rien n'est retenu indéfiniment.
    assert.ok(new Date(budget.expiresAt) > new Date());

    const efface = await api.request('DELETE', '/api/v1/ai/memory', { token: acheteur.accessToken });
    assert.ok(efface.body.deleted >= 1);
    const apres = await api.request('GET', '/api/v1/ai/memory', { token: acheteur.accessToken });
    assert.equal(apres.body.items.length, 0);
  });

  it('ne retient pas une donnée personnelle sous une clé inventée', async () => {
    const acheteur = await registerUser(api, { name: 'Acheteur Neuf', email: uniqueEmail('chat-i'), role: 'BUYER' });
    const { memoryService } = await import('../../src/touma/ai/memory.service.js');
    // Clé hors liste : ignorée. Une mémoire à clés libres finirait par
    // contenir tout ce qu'un utilisateur aura mentionné en passant.
    assert.equal(await memoryService.remember(acheteur.user.id, 'numero_telephone', '+23566123456'), false);
    const items = await memoryService.list(acheteur.user.id);
    assert.equal(items.length, 0);
  });
});

describe('Espaces et rôles', () => {
  it('un acheteur n’accède pas à l’espace vendeur de l’assistant', async () => {
    const acheteur = await registerUser(api, { name: 'Acheteur Dix', email: uniqueEmail('chat-j'), role: 'BUYER' });
    const res = await api.request('POST', '/api/v1/seller/ai', { token: acheteur.accessToken, body: { message: 'Mes ventes ?' } });
    assert.equal(res.status, 403);
  });

  it('un vendeur n’accède pas à l’espace administration', async () => {
    const vendeur = await registerUser(api, { name: 'Vendeur Onze', email: uniqueEmail('chat-k'), role: 'SELLER' });
    const res = await api.request('POST', '/api/v1/admin/ai/query', { token: vendeur.accessToken, body: { message: 'Combien de commandes aujourd’hui ?' } });
    assert.equal(res.status, 403);
  });

  it('le vendeur analyse ses ventes, séparant données et interprétation', async () => {
    const { vendeur, store } = await boutiqueAvecTelephones('ventes');
    const res = await api.request('POST', '/api/v1/seller/ai', { token: vendeur.accessToken, body: { message: `Analyse mes ventes de la boutique ${store.id}` } });
    assert.equal(res.status, 200);
    assert.match(res.body.answer, /DONNÉES/);
    assert.match(res.body.answer, /INTERPRÉTATION/);
    assert.match(res.body.answer, /RECOMMANDATION/);
    // §23 : aucune cause n'est avancée, parce qu'elle ne se lit pas en base.
    assert.match(res.body.answer, /je n’en connais pas la cause/i);
  });

  it('l’administrateur interroge des données réelles', async () => {
    const admin = await registerUser(api, { name: 'Administrateur', email: uniqueEmail('chat-adm'), role: 'BUYER' });
    await promoteToAdmin(admin.user.id);
    const res = await api.request('POST', '/api/v1/admin/ai/query', { token: admin.accessToken, body: { message: 'Quelles provinces génèrent le plus de commandes ?' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.intent, 'ADMIN_PROVINCES');
    assert.match(res.body.answer, /données réelles/i);
  });
});

describe('Signalement et qualité', () => {
  it('on ne signale que les messages qu’on a reçus', async () => {
    const a = await registerUser(api, { name: 'Acheteur Douze', email: uniqueEmail('chat-l'), role: 'BUYER' });
    const b = await registerUser(api, { name: 'Acheteur Treize', email: uniqueEmail('chat-m'), role: 'BUYER' });
    const reponse = await api.request('POST', '/api/v1/ai/chat', { token: a.accessToken, body: { message: 'Je cherche un sac' } });

    const sien = await api.request('POST', '/api/v1/ai/feedback', { token: a.accessToken, body: { messageId: reponse.body.messageId, verdict: 'WRONG_PRICE', comment: 'Le prix ne correspond pas.' } });
    assert.equal(sien.status, 201);

    // Sans ce contrôle, n'importe qui fausserait la mesure de qualité, qui
    // sert ensuite à décider si l'assistant reste ouvert.
    const autrui = await api.request('POST', '/api/v1/ai/feedback', { token: b.accessToken, body: { messageId: reponse.body.messageId, verdict: 'UNSAFE' } });
    assert.equal(autrui.status, 404);
  });

  it('le tableau de qualité compte les signalements factuels', async () => {
    const admin = await registerUser(api, { name: 'Administrateur Deux', email: uniqueEmail('chat-adm2'), role: 'BUYER' });
    await promoteToAdmin(admin.user.id);
    const res = await api.request('GET', '/api/v1/admin/ai/quality?days=7', { token: admin.accessToken });
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.toolCalls.total === 'number');
    assert.ok(typeof res.body.feedback.factualReports === 'number');
  });

  it('le tableau de coûts rappelle que les montants sont estimés', async () => {
    const admin = await registerUser(api, { name: 'Administrateur Trois', email: uniqueEmail('chat-adm3'), role: 'BUYER' });
    await promoteToAdmin(admin.user.id);
    const res = await api.request('GET', '/api/v1/admin/ai/usage?days=7', { token: admin.accessToken });
    assert.equal(res.status, 200);
    assert.match(res.body.costDisclaimer, /estimés/i);
  });
});

describe('Invites de production', () => {
  it('une nouvelle version d’invite n’est jamais active d’office', async () => {
    const admin = await registerUser(api, { name: 'Administrateur Quatre', email: uniqueEmail('chat-adm4'), role: 'BUYER' });
    await promoteToAdmin(admin.user.id);
    const creee = await api.request('POST', '/api/v1/admin/ai/prompts', { token: admin.accessToken, body: { feature: `test_${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, body: 'Consigne de test pour la fonctionnalité.' } });
    assert.equal(creee.status, 201);
    assert.equal(creee.body.active, false);

    const activee = await api.request('POST', `/api/v1/admin/ai/prompts/${creee.body.id}/activate`, { token: admin.accessToken });
    assert.equal(activee.status, 200);
    assert.equal(activee.body.active, true);
    // Deux fois active : refusé, et l'index unique partiel garantit qu'il n'y
    // en a jamais deux pour une même fonctionnalité.
    const rejeu = await api.request('POST', `/api/v1/admin/ai/prompts/${creee.body.id}/activate`, { token: admin.accessToken });
    assert.equal(rejeu.status, 400);
  });
});

describe('Travaux périodiques d’intelligence', () => {
  it('ne traite jamais deux fois la même fenêtre', async () => {
    const { aiJobs } = await import('../../src/touma/ai/jobs.js');
    await aiJobs.memories();
    const apres = await prisma.toumaAiJobRun.count({ where: { job: 'memories' } });
    // Second passage sur la même heure : refusé par l'unicité en base, et non
    // par un compteur en mémoire qui ne tiendrait pas entre deux instances.
    await aiJobs.memories();
    assert.equal(await prisma.toumaAiJobRun.count({ where: { job: 'memories' } }), apres);
  });

  it('inscrit une observation de stock une seule fois par fenêtre', async () => {
    const { vendeur, store } = await boutiqueAvecTelephones('insight');
    const categorie = await prisma.toumaCategory.findFirstOrThrow();
    const rupture = await prisma.toumaProduct.create({
      data: {
        storeId: store.id,
        categoryId: categorie.id,
        title: 'Article en rupture',
        slug: `rupture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        description: 'Test',
        price: '10000',
        currency: 'XAF',
        countryCode: 'TD',
        status: 'ACTIVE',
        inventory: { create: { quantity: 0 } },
      },
    });
    assert.ok(vendeur);
    await prisma.toumaAiJobRun.deleteMany({ where: { job: 'inventoryInsights' } });
    await aiJobsUneFois();
    const premier = await prisma.toumaAiInsight.count({ where: { subjectId: rupture.id, code: 'OUT_OF_STOCK' } });
    assert.equal(premier, 1);
    await prisma.toumaAiJobRun.deleteMany({ where: { job: 'inventoryInsights' } });
    await aiJobsUneFois();
    // Même si le travail est rejoué, l'unicité de la fenêtre empêche le doublon :
    // un produit en rupture depuis un mois ne produit pas sept cents lignes.
    assert.equal(await prisma.toumaAiInsight.count({ where: { subjectId: rupture.id, code: 'OUT_OF_STOCK' } }), 1);
  });
});

async function aiJobsUneFois() {
  const { aiJobs } = await import('../../src/touma/ai/jobs.js');
  await aiJobs.inventoryInsights();
}

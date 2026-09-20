import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

const api = new TestApi();

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
});
after(async () => api.stop());

async function catalogue(suffixe: string) {
  const vendeur = await registerUser(api, { name: `Vendeur ${suffixe}`, email: uniqueEmail(`ai-${suffixe}`), role: 'SELLER' });
  const store = await prisma.toumaStore.create({
    data: { ownerId: vendeur.user.id, name: `Boutique ${suffixe}`, slug: `ai-${suffixe}-${Date.now()}`, countryCode: 'TD', status: 'ACTIVE' },
  });
  const categorie = await prisma.toumaCategory.findFirstOrThrow();
  const produits = [];
  for (const [i, prix] of ['30000', '45000', '90000'].entries()) {
    produits.push(
      await prisma.toumaProduct.create({
        data: {
          storeId: store.id,
          categoryId: categorie.id,
          title: `Téléphone ${suffixe} ${i}`,
          slug: `tel-${suffixe}-${i}-${Date.now()}`,
          description: 'Téléphone reconditionné.',
          price: prix,
          currency: 'XAF',
          countryCode: 'TD',
          status: 'ACTIVE',
          inventory: { create: { quantity: 5 } },
        },
      }),
    );
  }
  return { vendeur, store, produits };
}

describe('GET /api/v1/ai/provider', () => {
  it('ne publie aucun secret de configuration', async () => {
    const res = await api.request('GET', '/api/v1/ai/provider');
    assert.equal(res.status, 200);
    // La route est publique. Un seul champ de trop — `apiKey` — et la clé du
    // fournisseur serait lisible sans authentification. Ce test existe parce
    // que la première écriture diffusait `env.touma.ai` en bloc.
    //
    // Le contrôle porte sur les **noms de champs** de la réponse, pas sur son
    // texte : le message d'aide cite légitimement « AI_API_KEY » pour dire quoi
    // configurer, et chercher cette chaîne dans le rendu confondrait le nom de
    // la variable avec sa valeur.
    const interdits = ['apikey', 'apisecret', 'secret', 'token', 'baseurl', 'password'];
    const fautifs: string[] = [];
    const parcourir = (valeur: unknown, chemin: string) => {
      if (Array.isArray(valeur)) return valeur.forEach((v, i) => parcourir(v, `${chemin}[${i}]`));
      if (valeur && typeof valeur === 'object') {
        for (const [cle, v] of Object.entries(valeur)) {
          const normalise = cle.toLowerCase().replace(/[-_]/g, '');
          if (interdits.some((i) => normalise.includes(i))) fautifs.push(`${chemin}.${cle}`);
          parcourir(v, `${chemin}.${cle}`);
        }
      }
    };
    parcourir(res.body, '');
    assert.deepEqual(fautifs, [], `champs sensibles exposés : ${fautifs.join(', ')}`);
  });

  it('dit honnêtement qu’aucun modèle réel n’est branché', async () => {
    const res = await api.request('GET', '/api/v1/ai/provider');
    // Sans AI_API_KEY, aucun fournisseur réel ne peut l'être. Prétendre le
    // contraire est exactement ce que §3 interdit.
    assert.equal(res.body.realProviderConfigured, false);
    assert.equal(res.body.active, 'RULE_BASED');
    assert.match(res.body.message, /configuration requise/i);
  });
});

describe('POST /api/v1/ai/generate', () => {
  it('exige une authentification', async () => {
    const res = await api.request('POST', '/api/v1/ai/generate', { body: { useCase: 'product_title', prompt: 'Chaussures' } });
    assert.equal(res.status, 401);
  });

  it('n’invente aucune caractéristique et annonce le repli', async () => {
    const { vendeur } = await catalogue('gen');
    const res = await api.request('POST', '/api/v1/ai/generate', {
      token: vendeur.accessToken,
      body: { useCase: 'product_description', prompt: 'Rédige la fiche.', context: { titre: 'Sac en toile', categorie: 'Bagagerie' } },
    });
    assert.equal(res.status, 200);
    assert.match(res.body.text, /Sac en toile/);
    assert.doesNotMatch(res.body.text, /certifi|garantie de \d|norme|imperméable/i);
    assert.equal(res.body.requiresHumanReview, true);
    // L'utilisateur doit savoir que ce sont des règles locales qui répondent.
    assert.equal(res.body.fallback, true);
    assert.match(res.body.fallbackReason, /Aucun fournisseur/i);
  });

  it('inscrit la trace sans recopier ce qui ressemble à un secret', async () => {
    const { vendeur } = await catalogue('trace');
    await api.request('POST', '/api/v1/ai/generate', {
      token: vendeur.accessToken,
      body: {
        useCase: 'store_pitch',
        prompt: 'Présente ma boutique. Contact : vendeur@example.com, clé sk_live_abcdefghijkl',
        context: { titre: 'Chez Aïcha' },
      },
    });
    const trace = await prisma.toumaAiRequest.findFirst({ where: { userId: vendeur.user.id }, orderBy: { createdAt: 'desc' } });
    assert.ok(trace, 'aucune trace écrite');
    const rendu = JSON.stringify(trace.input);
    assert.doesNotMatch(rendu, /vendeur@example\.com/);
    assert.doesNotMatch(rendu, /sk_live_abcdefghijkl/);
  });

  it('compte la consommation pour le plafond et le tableau de bord', async () => {
    const { vendeur } = await catalogue('usage');
    const avant = await prisma.toumaAiUsage.count({ where: { userId: vendeur.user.id } });
    await api.request('POST', '/api/v1/ai/generate', { token: vendeur.accessToken, body: { useCase: 'product_title', prompt: 'Chaussures en cuir' } });
    const apres = await prisma.toumaAiUsage.count({ where: { userId: vendeur.user.id } });
    assert.equal(apres, avant + 1);
    const ligne = await prisma.toumaAiUsage.findFirst({ where: { userId: vendeur.user.id }, orderBy: { createdAt: 'desc' } });
    // Un fournisseur local ne coûte rien, et l'inscrit tel quel plutôt que de
    // laisser croire à une consommation de jetons gratuite.
    assert.equal(ligne?.provider, 'RULE_BASED');
    assert.equal(ligne?.estimatedCost.toString(), '0');
  });
});

describe('POST /api/v1/ai/classify', () => {
  it('rend « information non disponible » plutôt qu’un libellé au hasard', async () => {
    const { vendeur } = await catalogue('cls');
    const res = await api.request('POST', '/api/v1/ai/classify', {
      token: vendeur.accessToken,
      body: { useCase: 'category_suggestion', text: 'zzzzz qqqqq wwwww', labels: ['Chaussures', 'Téléphones', 'Bagagerie'] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.uncertain, true);
    assert.equal(res.body.label, null);
    assert.match(res.body.message, /non disponible/i);
  });
});

describe('POST /api/v1/ai/recommend', () => {
  it('ne propose que des produits qui existent', async () => {
    const { produits } = await catalogue('reco');
    const res = await api.request('POST', '/api/v1/ai/recommend', { body: { useCase: 'similar_products', seedProductId: produits[0].id, limit: 5 } });
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length > 0);
    const ids = res.body.items.map((i: { targetId: string }) => i.targetId);
    const existants = await prisma.toumaProduct.count({ where: { id: { in: ids } } });
    assert.equal(existants, ids.length, 'une recommandation pointe vers un produit inexistant');
    // Le produit consulté ne se recommande pas lui-même.
    assert.ok(!ids.includes(produits[0].id));
    assert.equal(res.body.provider, 'DATABASE');
  });

  it('une lecture anonyme n’écrit rien en base', async () => {
    const { produits } = await catalogue('anon');
    const avant = await prisma.toumaAiRecommendation.count();
    const avantReq = await prisma.toumaAiRequest.count();
    await api.request('POST', '/api/v1/ai/recommend', { body: { useCase: 'similar_products', seedProductId: produits[0].id } });
    // Défaut relevé à l'audit : le point d'entrée était ouvert et écrivait
    // jusqu'à 24 lignes par appel, sans authentification.
    assert.equal(await prisma.toumaAiRecommendation.count(), avant);
    assert.equal(await prisma.toumaAiRequest.count(), avantReq);
  });

  it('rattache chaque recommandation à l’appel qui l’a produite', async () => {
    const { vendeur, produits } = await catalogue('lien');
    await api.request('POST', '/api/v1/ai/recommend', { token: vendeur.accessToken, body: { useCase: 'similar_products', seedProductId: produits[0].id } });
    const requete = await prisma.toumaAiRequest.findFirst({ where: { userId: vendeur.user.id, kind: 'recommend' }, orderBy: { createdAt: 'desc' }, include: { recommendations: true } });
    assert.ok(requete, 'aucune requête tracée');
    // Défaut relevé à l'audit : `requestId` n'était jamais renseigné, donc
    // aucune recommandation n'était rattachable à sa demande.
    assert.ok(requete.recommendations.length > 0, 'recommandations orphelines');
    for (const r of requete.recommendations) assert.equal(r.requestId, requete.id);
  });

  it('dit « information non disponible » quand rien ne correspond', async () => {
    const { vendeur } = await catalogue('vide');
    const res = await api.request('POST', '/api/v1/ai/recommend', { token: vendeur.accessToken, body: { useCase: 'opportunity', query: 'zzzzqqqqwwww-inexistant' } });
    assert.equal(res.body.items.length, 0);
    assert.match(res.body.message, /non disponible/i);
  });
});

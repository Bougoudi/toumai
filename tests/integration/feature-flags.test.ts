import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { featureFlagService, tranche } from '../../src/touma/admin/feature-flags.service.js';

/**
 * DRAPEAUX DE FONCTIONNALITÉ (V25 §28-29).
 *
 * Deux garanties portent tout le reste : un drapeau ne rallume jamais ce que
 * l'environnement a éteint, et l'attribution d'une tranche de déploiement est
 * **stable**. La seconde a l'air d'un détail jusqu'au jour où un rapport de
 * bogue devient irreproductible parce que la fonctionnalité clignote.
 */
const api = new TestApi();

let admin: any;
let vendeur: any;

async function poser(key: string, corps: Record<string, unknown>) {
  const res = await api.request('PUT', `/api/v1/admin/feature-flags/${key}`, {
    token: admin.accessToken,
    body: { label: `Essai ${key}`, ...corps },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  vendeur = await registerUser(api, { name: 'Vendeur drapeaux', email: uniqueEmail('ff-v'), role: 'SELLER' });
  admin = await registerUser(api, { name: 'Admin drapeaux', email: uniqueEmail('ff-a'), role: 'BUYER' });
  await promoteToAdmin(admin.user.id);
  admin.accessToken = (await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password })).body.accessToken;
});
after(async () => api.stop());

describe('Un drapeau ne rallume jamais ce que l’environnement a éteint', () => {
  it('le commerce transfrontalier reste fermé si l’instance ne l’a pas activé', async () => {
    /**
     * La garantie la plus importante de ce module.
     *
     * Sans elle, une ligne de base de données activerait en production une
     * fonctionnalité dont l'instance n'a pas les moyens — c'est-à-dire
     * promettrait à un acheteur ce que personne ne peut tenir.
     */
    await poser('trade', { enabled: true, rolloutPercent: 100 });
    const evaluation = await featureFlagService.evaluate('trade', { userId: vendeur.user.id });

    if (process.env.TOUMA_TRADE_ENABLED === 'true') {
      assert.equal(evaluation.enabled, true, 'l’instance l’autorise : le drapeau décide');
    } else {
      assert.equal(evaluation.enabled, false, 'l’instance l’interdit : aucun drapeau ne passe outre');
      assert.match(evaluation.reason, /configuration de l’instance/i);
    }
  });

  it('un drapeau inconnu est fermé, jamais ouvert par défaut', async () => {
    // Ouvert par défaut, une faute de frappe dans une clé activerait tout
    // pour tout le monde.
    const e = await featureFlagService.evaluate('cle_qui_nexiste_pas', { userId: vendeur.user.id });
    assert.equal(e.enabled, false);
    assert.match(e.reason, /inconnu/i);
  });
});

describe('Déploiement progressif', () => {
  it('attribue une tranche stable : la même personne obtient toujours la même réponse', async () => {
    const sujet = vendeur.user.id;
    const premier = tranche('essai_stabilite', sujet);
    for (let i = 0; i < 50; i += 1) assert.equal(tranche('essai_stabilite', sujet), premier);
  });

  it('deux drapeaux ne touchent pas exactement les mêmes personnes', async () => {
    // Sinon la même minorité essuierait les plâtres de toutes les nouveautés.
    const sujets = Array.from({ length: 200 }, (_, i) => `sujet-${i}`);
    const a = new Set(sujets.filter((s) => tranche('drapeau_a', s) < 10));
    const b = new Set(sujets.filter((s) => tranche('drapeau_b', s) < 10));
    const communs = [...a].filter((s) => b.has(s)).length;
    assert.ok(a.size > 0 && b.size > 0, 'les deux tranches ne sont pas vides');
    assert.ok(communs < Math.max(a.size, b.size), 'les deux tranches ne sont pas identiques');
  });

  it('répartit à peu près selon le pourcentage demandé', async () => {
    const sujets = Array.from({ length: 2000 }, (_, i) => `mesure-${i}`);
    const dedans = sujets.filter((s) => tranche('essai_repartition', s) < 25).length;
    const part = (dedans / sujets.length) * 100;
    // Une répartition très éloignée signalerait un hachage mal employé.
    assert.ok(part > 20 && part < 30, `part obtenue : ${part.toFixed(1)} %`);
  });

  it('laisse dehors un visiteur sans identité tant que le déploiement est partiel', async () => {
    await poser('essai_partiel', { enabled: true, rolloutPercent: 50, exposedToClient: true });
    const anonyme = await featureFlagService.evaluate('essai_partiel', {});
    // Un visiteur anonyme n'a rien de stable à hacher : lui tirer une tranche
    // au hasard ferait clignoter la fonctionnalité d'une page à l'autre.
    assert.equal(anonyme.enabled, false);
    assert.match(anonyme.reason, /identifiables/i);

    await poser('essai_partiel', { enabled: true, rolloutPercent: 100, exposedToClient: true });
    assert.equal((await featureFlagService.evaluate('essai_partiel', {})).enabled, true, 'à 100 %, tout le monde entre');
  });

  it('un compte nommément ciblé passe avant le pourcentage', async () => {
    await poser('essai_cible', { enabled: true, rolloutPercent: 0, userIds: [vendeur.user.id] });
    assert.equal((await featureFlagService.evaluate('essai_cible', { userId: vendeur.user.id })).enabled, true);
    assert.equal((await featureFlagService.evaluate('essai_cible', { userId: admin.user.id })).enabled, false);
  });
});

describe('Ciblage', () => {
  it('restreint par pays sans toucher aux autres dimensions', async () => {
    await poser('essai_pays', { enabled: true, rolloutPercent: 100, countries: ['TD'] });
    assert.equal((await featureFlagService.evaluate('essai_pays', { userId: vendeur.user.id, countryCode: 'TD' })).enabled, true);
    assert.equal((await featureFlagService.evaluate('essai_pays', { userId: vendeur.user.id, countryCode: 'CM' })).enabled, false);
    // Pays inconnu du contexte : la restriction s'applique, faute de pouvoir
    // prouver l'appartenance.
    assert.equal((await featureFlagService.evaluate('essai_pays', { userId: vendeur.user.id })).enabled, false);
  });
});

describe('Exposition au navigateur', () => {
  it('ne rend que les drapeaux marqués comme exposables', async () => {
    await poser('essai_public', { enabled: true, rolloutPercent: 100, exposedToClient: true });
    await poser('essai_prive', { enabled: true, rolloutPercent: 100, exposedToClient: false });

    const res = await api.request('GET', '/api/v1/features');
    assert.equal(res.status, 200);
    assert.equal(res.body.features.essai_public, true);
    // Un drapeau dit ce qui se prépare, et tout ce qui se prépare n'a pas à
    // être public.
    assert.ok(!('essai_prive' in res.body.features));
  });

  it('ne divulgue pas le motif du ciblage', async () => {
    await poser('essai_motif', { enabled: true, rolloutPercent: 100, countries: ['XX'], exposedToClient: true });
    const res = await api.request('GET', '/api/v1/features');
    const rendu = JSON.stringify(res.body);
    // Le motif décrirait le ciblage à qui n'y a pas droit.
    assert.ok(!/Réservé aux pays|XX/.test(rendu), rendu.slice(0, 200));
  });
});

describe('Accès et traçabilité', () => {
  it('modifier un drapeau demande ADMIN_SYSTEM', async () => {
    const res = await api.request('PUT', '/api/v1/admin/feature-flags/essai_interdit', {
      token: vendeur.accessToken,
      body: { label: 'Tentative' },
    });
    assert.equal(res.status, 403);
  });

  it('laisse une trace de l’avant et de l’après', async () => {
    await poser('essai_trace', { enabled: false, rolloutPercent: 0 });
    await poser('essai_trace', { enabled: true, rolloutPercent: 25 });

    const trace = await prisma.toumaAuditLog.findFirst({
      where: { action: 'admin.feature_flag.set' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(trace);
    const meta = trace.metadata as any;
    assert.equal(meta.key, 'essai_trace');
    assert.equal(meta.before.enabled, false);
    assert.equal(meta.after.enabled, true);
    assert.equal(meta.after.rolloutPercent, 25);
  });

  it('refuse une clé mal formée', async () => {
    const res = await api.request('PUT', '/api/v1/admin/feature-flags/Clé Invalide!', {
      token: admin.accessToken,
      body: { label: 'Mauvaise clé' },
    });
    assert.equal(res.status, 400);
  });
});

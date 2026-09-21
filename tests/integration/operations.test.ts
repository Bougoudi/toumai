import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { operationsService } from '../../src/touma/admin/operations.service.js';

/**
 * CENTRE D'OPÉRATIONS (V25 §53, §86, §89).
 *
 * C'est l'écran qu'on regarde à trois heures du matin pour décider s'il faut
 * réveiller quelqu'un. Une case verte pour une chose que personne ne mesure y
 * est plus dangereuse qu'une case rouge.
 *
 * Ces tests portent donc surtout sur ce que l'écran a le droit de dire.
 */
const api = new TestApi();

let admin: any;
let vendeur: any;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  vendeur = await registerUser(api, { name: 'Vendeur ops', email: uniqueEmail('ops-v'), role: 'SELLER' });
  admin = await registerUser(api, { name: 'Admin ops', email: uniqueEmail('ops-a'), role: 'BUYER' });
  await promoteToAdmin(admin.user.id);
  admin.accessToken = (await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password })).body.accessToken;
});
after(async () => api.stop());

describe('Aucun statut complaisant', () => {
  it('ne déclare jamais un prestataire de simulation « opérationnel »', async () => {
    /**
     * Le défaut que ce test existe pour empêcher — et que j'ai introduit.
     *
     * La première version comparait `aiProvider !== 'rule_based'` et affichait
     * « OK — prestataire "mock" configuré ». Un adaptateur nommé dans la
     * configuration n'est pas un modèle qui répond : c'est exactement la
     * fausse déclaration que §89 interdit, dans le module écrit pour
     * l'empêcher.
     */
    const vue = await operationsService.overview();
    for (const p of vue.providers) {
      if (p.status !== 'OK') continue;
      assert.ok(
        !/simulation|mock|factice|démonstration/i.test(p.detail),
        `« ${p.name} » est annoncé opérationnel alors que son détail parle de simulation : ${p.detail}`,
      );
    }
  });

  it('marque ce qui n’est pas mesuré plutôt que de le rendre en vert', async () => {
    const vue = await operationsService.overview();
    const noms = vue.notInstrumented.map((l) => l.name);
    // Confondre « rien de cassé » et « rien de surveillé » est ce qui fait
    // rater un incident.
    for (const attendu of ['Sauvegardes', 'Métriques', 'Alertes']) {
      assert.ok(noms.includes(attendu), `${attendu} doit apparaître`);
    }
    for (const ligne of vue.notInstrumented) {
      assert.notEqual(ligne.status, 'OK', `${ligne.name} ne peut pas être « OK » : rien ne le mesure`);
    }
  });

  it('signale l’absence de sauvegarde comme un bloqueur, pas comme un détail', async () => {
    const vue = await operationsService.overview();
    const sauvegardes = vue.notInstrumented.find((l) => l.name === 'Sauvegardes');
    assert.ok(sauvegardes);
    assert.match(sauvegardes.detail, /définitive|bloqueur/i);
  });

  it('chaque ligne porte une explication, jamais un code seul', async () => {
    const vue = await operationsService.overview();
    for (const ligne of [...vue.infrastructure, ...vue.providers, ...vue.notInstrumented]) {
      assert.ok(ligne.detail && ligne.detail.length > 20, `${ligne.name} doit expliquer son état`);
    }
  });
});

describe('État global', () => {
  it('ne peut pas être meilleur que l’intégrité des données', async () => {
    const vue = await operationsService.overview();
    if (vue.integrity.status === 'CRITICAL') assert.equal(vue.status, 'CRITICAL');
    if (vue.integrity.status === 'WARNING') assert.notEqual(vue.status, 'HEALTHY');
  });

  it('rapporte le nombre d’invariants réellement contrôlés', async () => {
    const vue = await operationsService.overview();
    assert.ok(vue.integrity.checked >= 10);
  });

  it('remonte la dette de cloisonnement des administrateurs', async () => {
    const vue = await operationsService.overview();
    // L'administrateur créé par ce fichier est non cadré : le compteur ne peut
    // pas être à zéro, et l'écran doit le dire plutôt que de l'ignorer.
    assert.ok(vue.security.adminsNonCadres >= 1);
    assert.match(vue.security.detail, /cloisonnement reste partiel/i);
  });
});

describe('Accès', () => {
  it('demande ADMIN_SYSTEM', async () => {
    assert.equal((await api.request('GET', '/api/v1/admin/operations')).status, 401);
    assert.equal((await api.request('GET', '/api/v1/admin/operations', { token: vendeur.accessToken })).status, 403);

    const res = await api.request('GET', '/api/v1/admin/operations', { token: admin.accessToken });
    assert.equal(res.status, 200);
    assert.ok(['HEALTHY', 'WARNING', 'CRITICAL'].includes(res.body.status));
  });

  it('ne laisse fuir aucun secret', async () => {
    const res = await api.request('GET', '/api/v1/admin/operations', { token: admin.accessToken });
    const rendu = JSON.stringify(res.body);
    // Une console d'exploitation est un endroit tentant pour « juste afficher
    // la configuration ».
    assert.ok(!/apiKey|secret|password|DATABASE_URL|postgresql:\/\//i.test(rendu), `fuite : ${rendu.slice(0, 200)}`);
  });
});

describe('Le transporteur de simulation ne compte pas', () => {
  it('un adaptateur de simulation ne rend pas les transporteurs opérationnels', async () => {
    const code = `essai-ops-${Math.random().toString(36).slice(2, 8)}`;
    await prisma.toumaShippingProvider.create({ data: { code: 'mock-ops', name: 'Simulation', countries: '', active: true } }).catch(() => {});
    try {
      const vue = await operationsService.overview();
      const transport = vue.providers.find((p) => p.name === 'Transporteurs');
      assert.ok(transport);
      // Une simulation répond à tout, y compris à des corridors que personne
      // ne dessert. La laisser compter était le trou de V24.
      if (transport.status === 'OK') assert.ok(!/simulation/i.test(transport.detail));

      await prisma.toumaShippingProvider.create({ data: { code, name: 'Transporteur réel d’essai', countries: 'TD,CM', active: true } });
      const apres = await operationsService.overview();
      const transportApres = apres.providers.find((p) => p.name === 'Transporteurs');
      assert.equal(transportApres!.status, 'OK', 'un transporteur réel rend le service opérationnel');
      assert.match(transportApres!.detail, new RegExp(code));
    } finally {
      await prisma.toumaShippingProvider.deleteMany({ where: { code: { in: [code, 'mock-ops'] } } });
    }
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * GESTION D'INCIDENTS (V25 §48).
 *
 * Ce que ce module sert vraiment : qu'une personne d'astreinte écrive ce
 * qu'elle constate **pendant** qu'elle le constate. C'est l'exercice que
 * personne ne refait après coup, et pourtant le seul moment où l'on sait ce
 * qu'on ne savait pas encore.
 *
 * D'où la propriété que ces tests gardent avant toutes les autres : la
 * chronologie ne se réécrit pas.
 */
const api = new TestApi();

let admin: any;
let vendeur: any;

async function ouvrir(titre: string, severity = 'P2') {
  const res = await api.request('POST', '/api/v1/admin/incidents', {
    token: admin.accessToken,
    body: { title: titre, severity, impact: 'Des acheteurs ne peuvent plus payer.', component: 'paiement' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  vendeur = await registerUser(api, { name: 'Vendeur inc', email: uniqueEmail('inc-v'), role: 'SELLER' });
  admin = await registerUser(api, { name: 'Admin inc', email: uniqueEmail('inc-a'), role: 'BUYER' });
  await promoteToAdmin(admin.user.id);
  admin.accessToken = (await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password })).body.accessToken;
});
after(async () => api.stop());

describe('Ouverture', () => {
  it('donne une référence lisible et une première ligne de chronologie', async () => {
    const incident = await ouvrir(`Paiements en échec ${Date.now()}`, 'P1');
    assert.match(incident.reference, /^INC-\d{4}-\d{4}$/);
    assert.equal(incident.status, 'OPEN');

    const detail = await api.request('GET', `/api/v1/admin/incidents/${incident.id}`, { token: admin.accessToken });
    // L'ouverture elle-même est un événement : sans elle, la frise commencerait
    // au premier commentaire, c'est-à-dire trop tard.
    assert.equal(detail.body.events.length, 1);
    assert.equal(detail.body.events[0].kind, 'STATUS');
    assert.equal(detail.body.events[0].toStatus, 'OPEN');
  });

  it('numérote sans collision', async () => {
    const a = await ouvrir(`Premier ${Date.now()}`);
    const b = await ouvrir(`Second ${Date.now()}`);
    assert.notEqual(a.reference, b.reference);
  });

  it('demande ADMIN_SYSTEM', async () => {
    const res = await api.request('POST', '/api/v1/admin/incidents', {
      token: vendeur.accessToken,
      body: { title: 'Tentative non autorisée', severity: 'P3' },
    });
    assert.equal(res.status, 403);
  });
});

describe('La chronologie ne se réécrit pas', () => {
  it('n’offre aucun moyen de modifier ou supprimer une ligne', async () => {
    const incident = await ouvrir(`Immuable ${Date.now()}`);
    await api.request('POST', `/api/v1/admin/incidents/${incident.id}/events`, {
      token: admin.accessToken,
      body: { kind: 'OBSERVATION', note: 'Les créations de paiement expirent.' },
    });

    const detail = await api.request('GET', `/api/v1/admin/incidents/${incident.id}`, { token: admin.accessToken });
    const ligne = detail.body.events.find((e: any) => e.kind === 'OBSERVATION');
    assert.ok(ligne);

    /**
     * Un compte rendu rédigé une fois qu'on connaît la fin de l'histoire est
     * toujours plus net que la réalité — et c'est précisément ce qui le rend
     * inutile. Aucune route ne permet donc de réécrire une ligne.
     *
     * Le code de refus attendu n'est pas 404 : `app.use('/api', requireAuth)`
     * ferme la marche et intercepte tout chemin `/api` que personne ne sert,
     * en rendant 401. C'est une défense de plus, et elle en dit moins sur ce
     * qui existe. Ce qui compte ici n'est pas le numéro mais la ligne, qui ne
     * doit pas avoir bougé.
     */
    for (const methode of ['PATCH', 'PUT', 'DELETE']) {
      const res = await api.request(methode, `/api/v1/admin/incidents/${incident.id}/events/${ligne.id}`, {
        token: admin.accessToken,
        body: { note: 'version arrangée après coup' },
      });
      assert.ok(
        [401, 404, 405].includes(res.status),
        `${methode} ne doit pas réécrire l’histoire (obtenu ${res.status})`,
      );
    }

    const apres = await api.request('GET', `/api/v1/admin/incidents/${incident.id}`, { token: admin.accessToken });
    assert.equal(apres.body.events.find((e: any) => e.id === ligne.id).note, 'Les créations de paiement expirent.');
  });

  it('refuse d’ajouter à un incident clos', async () => {
    const incident = await ouvrir(`Clos ${Date.now()}`);
    await api.request('POST', `/api/v1/admin/incidents/${incident.id}/status`, {
      token: admin.accessToken,
      body: { status: 'RESOLVED', note: 'Prestataire revenu.', rootCause: 'Panne du prestataire.', resolution: 'Attente du rétablissement.' },
    });
    await api.request('POST', `/api/v1/admin/incidents/${incident.id}/status`, {
      token: admin.accessToken,
      body: { status: 'CLOSED', note: 'Compte rendu écrit.' },
    });

    const res = await api.request('POST', `/api/v1/admin/incidents/${incident.id}/events`, {
      token: admin.accessToken,
      body: { kind: 'ACTION', note: 'Note ajoutée trois semaines plus tard.' },
    });
    // Rouvrir est une décision, pas un effet de bord d'une note tardive.
    assert.equal(res.status, 409);
  });
});

describe('États', () => {
  it('interdit un saut d’étape non prévu', async () => {
    const incident = await ouvrir(`Transition ${Date.now()}`);
    const res = await api.request('POST', `/api/v1/admin/incidents/${incident.id}/status`, {
      token: admin.accessToken,
      body: { status: 'CLOSED', note: 'Clôture directe.' },
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /impossible/i);
  });

  it('refuse de clore sans cause établie', async () => {
    const incident = await ouvrir(`Sans cause ${Date.now()}`);
    await api.request('POST', `/api/v1/admin/incidents/${incident.id}/status`, {
      token: admin.accessToken,
      body: { status: 'RESOLVED', note: 'Le service est revenu.' },
    });
    const res = await api.request('POST', `/api/v1/admin/incidents/${incident.id}/status`, {
      token: admin.accessToken,
      body: { status: 'CLOSED', note: 'On clôt.' },
    });
    // Un incident clos sans cause établie est un incident qu'on reverra.
    assert.equal(res.status, 400);
    assert.match(res.body.error, /cause établie/i);
  });

  it('garde la première date d’atténuation quand l’incident rechute', async () => {
    const incident = await ouvrir(`Rechute ${Date.now()}`);
    await api.request('POST', `/api/v1/admin/incidents/${incident.id}/status`, {
      token: admin.accessToken,
      body: { status: 'MITIGATED', note: 'Contournement en place.' },
    });
    const premier = (await api.request('GET', `/api/v1/admin/incidents/${incident.id}`, { token: admin.accessToken })).body.mitigatedAt;
    assert.ok(premier);

    await new Promise((r) => setTimeout(r, 1100));
    await api.request('POST', `/api/v1/admin/incidents/${incident.id}/status`, {
      token: admin.accessToken,
      body: { status: 'INVESTIGATING', note: 'Le problème revient.' },
    });
    await api.request('POST', `/api/v1/admin/incidents/${incident.id}/status`, {
      token: admin.accessToken,
      body: { status: 'MITIGATED', note: 'Contournement remis.' },
    });

    const apres = (await api.request('GET', `/api/v1/admin/incidents/${incident.id}`, { token: admin.accessToken })).body;
    // La date d'atténuation est celle où les gens ont cessé d'être gênés la
    // première fois : l'écraser embellirait le délai de rétablissement.
    assert.equal(apres.mitigatedAt, premier);
    assert.equal(apres.status, 'MITIGATED');
    // Et chaque passage a laissé sa ligne.
    assert.ok(apres.events.filter((e: any) => e.kind === 'STATUS').length >= 4);
  });

  it('trace chaque changement d’état dans le journal d’audit', async () => {
    const incident = await ouvrir(`Audité ${Date.now()}`);
    await api.request('POST', `/api/v1/admin/incidents/${incident.id}/status`, {
      token: admin.accessToken,
      body: { status: 'INVESTIGATING', note: 'On regarde.' },
    });
    const trace = await prisma.toumaAuditLog.findFirst({
      where: { action: 'admin.incident.status', entityId: incident.id },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(trace);
    assert.equal(trace.actorId, admin.user.id);
  });
});

describe('Ce que la liste n’est pas', () => {
  it('dit que les incidents sont tenus à la main', async () => {
    const res = await api.request('GET', '/api/v1/admin/incidents', { token: admin.accessToken });
    assert.equal(res.status, 200);
    // Sans cette phrase, « zéro incident » se lirait « tout va bien » — alors
    // qu'aucune alerte n'existe pour ouvrir quoi que ce soit.
    assert.match(res.body.note, /à la main|aucune alerte/i);
  });

  it('remonte au centre d’opérations avec le même avertissement', async () => {
    await ouvrir(`Visible aux opérations ${Date.now()}`, 'P0');
    const vue = await api.request('GET', '/api/v1/admin/operations', { token: admin.accessToken });
    assert.ok(vue.body.incidents.total >= 1);
    assert.ok(vue.body.incidents.bySeverity.P0 >= 1);
    assert.match(vue.body.incidents.note, /zéro incident ne veut pas dire zéro problème/i);
  });
});

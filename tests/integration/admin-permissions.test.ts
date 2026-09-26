import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * PERMISSIONS D'ADMINISTRATION (V25 §25-26).
 *
 * « Administrateur » était un interrupteur : qui l'était pouvait rembourser un
 * paiement, ajuster le grand livre, activer un corridor et suspendre un
 * vendeur. Tenable à deux personnes, intenable ensuite — le jour où quelqu'un
 * est recruté pour traiter les litiges, on lui donne aussi les paiements sans
 * le vouloir.
 *
 * Ces tests vérifient surtout les deux accidents que le découpage pouvait
 * provoquer : couper l'accès des administrateurs existants au déploiement, ou
 * donner tous les droits à un compte sans permission.
 */
const api = new TestApi();

let racine: any;

/** Administrateur **cadré**, avec exactement les permissions demandées. */
async function adminAvec(permissions: string[], etiquette: string) {
  const compte = await registerUser(api, { name: `Admin ${etiquette}`, email: uniqueEmail(`perm-${etiquette}`), role: 'BUYER' });
  await promoteToAdmin(compte.user.id);
  await prisma.user.update({ where: { id: compte.user.id }, data: { adminPermissions: permissions, adminScoped: true } });
  compte.accessToken = (await api.post('/api/v1/auth/login', { email: compte.user.email, password: compte.password })).body.accessToken;
  return compte;
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  // Administrateur « historique » : jamais cadré, donc accès complet hérité.
  racine = await registerUser(api, { name: 'Admin racine', email: uniqueEmail('perm-racine'), role: 'BUYER' });
  await promoteToAdmin(racine.user.id);
  racine.accessToken = (await api.post('/api/v1/auth/login', { email: racine.user.email, password: racine.password })).body.accessToken;
});
after(async () => api.stop());

describe('Migration sans coupure', () => {
  it('un administrateur jamais cadré conserve l’accès complet', async () => {
    // L'accident que ce choix évite : déployer le découpage et couper l'accès
    // de tous les administrateurs en place, un dimanche soir.
    const compte = await prisma.user.findUniqueOrThrow({ where: { id: racine.user.id }, select: { adminScoped: true, adminPermissions: true } });
    assert.equal(compte.adminScoped, false);
    assert.deepEqual(compte.adminPermissions, []);

    for (const route of ['/api/v1/admin/users', '/api/v1/admin/payments', '/api/v1/admin/audit']) {
      assert.equal((await api.request('GET', route, { token: racine.accessToken })).status, 200, route);
    }
  });

  it('l’écran des permissions dit qu’un compte non cadré a tout, au lieu de montrer une liste vide', async () => {
    const res = await api.request('GET', '/api/v1/admin/permissions', { token: racine.accessToken });
    assert.equal(res.status, 200);
    const ligne = res.body.admins.find((a: any) => a.id === racine.user.id);
    assert.equal(ligne.scoped, false);
    assert.deepEqual(ligne.permissions, []);
    // Une liste vide se lirait « aucun droit » : exactement l'inverse.
    assert.ok(ligne.effective.length > 0, 'les droits effectifs sont ceux qui comptent');
    assert.ok(ligne.effective.includes('ADMIN_PAYMENTS'));
  });
});

describe('Un droit ne donne pas les autres', () => {
  it('un administrateur des litiges n’atteint pas les paiements', async () => {
    const confiance = await adminAvec(['ADMIN_TRUST'], 'trust');

    assert.equal((await api.request('GET', '/api/v1/admin/verifications', { token: confiance.accessToken })).status, 200);
    const refus = await api.request('GET', '/api/v1/admin/payments', { token: confiance.accessToken });
    assert.equal(refus.status, 403);
    // Le refus nomme le droit manquant : l'existence d'une console
    // d'administration n'est pas un secret, et c'est ainsi que la bonne
    // personne demande le bon droit.
    assert.match(refus.body.error, /ADMIN_PAYMENTS/);
    assert.equal(refus.body.code, 'AUTH_FORBIDDEN');
  });

  it('ne peut pas davantage changer un rôle ni lire le journal d’audit', async () => {
    const confiance = await adminAvec(['ADMIN_TRUST'], 'trust2');
    assert.equal((await api.request('GET', '/api/v1/admin/audit', { token: confiance.accessToken })).status, 403);
    const cible = await registerUser(api, { name: 'Cible', email: uniqueEmail('perm-cible'), role: 'BUYER' });
    const res = await api.request('PATCH', `/api/v1/admin/users/${cible.user.id}/role`, {
      token: confiance.accessToken,
      body: { role: 'SELLER' },
    });
    assert.equal(res.status, 403);
  });

  it('les routeurs par domaine sont cloisonnés eux aussi', async () => {
    const commerce = await adminAvec(['ADMIN_TRADE'], 'trade');
    assert.equal((await api.request('GET', '/api/v1/admin/trade/overview', { token: commerce.accessToken })).status, 200);
    assert.equal((await api.request('GET', '/api/v1/admin/finance/overview', { token: commerce.accessToken })).status, 403);
  });

  it('un administrateur cadré sans aucune permission n’atteint rien', async () => {
    const vide = await adminAvec([], 'vide');
    for (const route of ['/api/v1/admin/users', '/api/v1/admin/audit', '/api/v1/admin/permissions']) {
      assert.equal((await api.request('GET', route, { token: vide.accessToken })).status, 403, route);
    }
  });
});

describe('Accorder des permissions', () => {
  it('demande ADMIN_SYSTEM et laisse une trace de l’avant et de l’après', async () => {
    const cible = await adminAvec([], 'cible-grant');
    const res = await api.request('PUT', `/api/v1/admin/permissions/${cible.user.id}`, {
      token: racine.accessToken,
      body: { permissions: ['ADMIN_TRUST', 'ADMIN_LOGISTICS'] },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.permissions.sort(), ['ADMIN_LOGISTICS', 'ADMIN_TRUST']);

    const trace = await prisma.toumaAuditLog.findFirst({
      where: { action: 'admin.permissions.set', entityId: cible.user.id },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(trace, 'toute attribution de droit est tracée');
    assert.equal(trace.actorId, racine.user.id, 'la trace nomme qui a accordé');
    const meta = trace.metadata as any;
    assert.deepEqual(meta.before.permissions, []);
    assert.deepEqual(meta.after.permissions.sort(), ['ADMIN_LOGISTICS', 'ADMIN_TRUST']);
  });

  it('un administrateur sans ADMIN_SYSTEM ne peut pas s’accorder de droits', async () => {
    const modeste = await adminAvec(['ADMIN_TRUST'], 'modeste');
    const res = await api.request('PUT', `/api/v1/admin/permissions/${modeste.user.id}`, {
      token: modeste.accessToken,
      body: { permissions: ['ADMIN_PAYOUTS'] },
    });
    assert.equal(res.status, 403);
    const apres = await prisma.user.findUniqueOrThrow({ where: { id: modeste.user.id }, select: { adminPermissions: true } });
    assert.deepEqual(apres.adminPermissions, ['ADMIN_TRUST'], 'aucun droit n’a été ajouté');
  });

  it('refuse une permission inventée', async () => {
    const cible = await adminAvec([], 'inventee');
    const res = await api.request('PUT', `/api/v1/admin/permissions/${cible.user.id}`, {
      token: racine.accessToken,
      body: { permissions: ['ADMIN_TOUT_POUVOIR'] },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /inconnues/i);
  });

  it('personne ne se retire à soi-même ADMIN_SYSTEM', async () => {
    const systeme = await adminAvec(['ADMIN_SYSTEM'], 'systeme');
    const res = await api.request('PUT', `/api/v1/admin/permissions/${systeme.user.id}`, {
      token: systeme.accessToken,
      body: { permissions: ['ADMIN_TRUST'] },
    });
    // Se retirer la seule permission qui permet de réattribuer les permissions,
    // c'est fermer la porte de l'intérieur sans garder la clé.
    assert.equal(res.status, 400);
    assert.match(res.body.error, /ADMIN_SYSTEM/);
  });

  it('nommer quelqu’un administrateur ne lui donne aucun droit', async () => {
    const promu = await registerUser(api, { name: 'Promu', email: uniqueEmail('perm-promu'), role: 'BUYER' });
    const res = await api.request('PATCH', `/api/v1/admin/users/${promu.user.id}/role`, {
      token: racine.accessToken,
      body: { role: 'ADMIN' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.permissions, []);

    const compte = await prisma.user.findUniqueOrThrow({ where: { id: promu.user.id }, select: { adminScoped: true, adminPermissions: true } });
    // Cadré d'emblée : l'accès complet hérité ne se crée jamais à neuf.
    assert.equal(compte.adminScoped, true);
    assert.deepEqual(compte.adminPermissions, []);

    const jeton = (await api.post('/api/v1/auth/login', { email: promu.user.email, password: promu.password })).body.accessToken;
    assert.equal((await api.request('GET', '/api/v1/admin/users', { token: jeton })).status, 403);
  });
});

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

describe('Authentification Touma', () => {
  it('refuse un mot de passe trop court', async () => {
    const res = await api.post('/api/v1/auth/register', { name: 'Test', email: uniqueEmail('court'), password: 'court', role: 'BUYER' });
    assert.equal(res.status, 400);
  });

  it('refuse un pays non desservi', async () => {
    const res = await api.post('/api/v1/auth/register', {
      name: 'Test',
      email: uniqueEmail('pays'),
      password: 'motdepasse-test-123',
      role: 'BUYER',
      countryCode: 'ZW',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /non desservi/i);
  });

  it('ne permet jamais de s’inscrire directement comme administrateur', async () => {
    const res = await api.post('/api/v1/auth/register', {
      name: 'Pirate',
      email: uniqueEmail('pirate'),
      password: 'motdepasse-test-123',
      role: 'ADMIN',
    });
    assert.equal(res.status, 400, 'le rôle ADMIN n’est pas une valeur acceptée');
  });

  it('ne révèle pas si un compte existe (anti-énumération)', async () => {
    const user = await registerUser(api, { name: 'Existe', email: uniqueEmail('existe'), role: 'BUYER' });
    const wrongPassword = await api.post('/api/v1/auth/login', { email: user.user.email, password: 'mauvais-mot-de-passe' });
    const unknownAccount = await api.post('/api/v1/auth/login', { email: uniqueEmail('inconnu'), password: 'mauvais-mot-de-passe' });
    assert.equal(wrongPassword.status, unknownAccount.status);
    // `requestId` diffère par construction — c'est un numéro par requête, pas
    // une information sur le compte. Tout le reste doit être identique au
    // caractère près : c'est ce qui empêche de distinguer « mot de passe
    // faux » de « compte inexistant », et donc de dresser la liste des
    // comptes qui existent.
    const sansTrace = ({ requestId, ...reste }: Record<string, unknown>) => reste;
    assert.deepEqual(sansTrace(wrongPassword.body), sansTrace(unknownAccount.body));
    assert.ok(wrongPassword.body.requestId !== unknownAccount.body.requestId, 'chaque requête garde son propre numéro');
  });

  it('ne stocke jamais le mot de passe en clair', async () => {
    const user = await registerUser(api, { name: 'Hash', email: uniqueEmail('hash'), role: 'BUYER' });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.user.id } });
    assert.ok(!row.passwordHash.includes(user.password));
    assert.match(row.passwordHash, /^[0-9a-f]+:[0-9a-f]+$/);
  });

  it('fait tourner le jeton de rafraîchissement à chaque usage', async () => {
    const user = await registerUser(api, { name: 'Rotation', email: uniqueEmail('rotation'), role: 'BUYER' });
    const first = await api.post('/api/v1/auth/refresh', { refreshToken: user.refreshToken });
    assert.equal(first.status, 200);
    assert.notEqual(first.body.refreshToken, user.refreshToken, 'le jeton est remplacé');

    const withNew = await api.post('/api/v1/auth/refresh', { refreshToken: first.body.refreshToken });
    assert.equal(withNew.status, 200);
  });

  it('détecte la réutilisation d’un jeton volé et coupe toute la famille', async () => {
    const user = await registerUser(api, { name: 'Vol', email: uniqueEmail('vol'), role: 'BUYER' });
    const rotated = await api.post('/api/v1/auth/refresh', { refreshToken: user.refreshToken });
    assert.equal(rotated.status, 200);

    // Rejouer l'ancien jeton = signature d'un vol.
    const replay = await api.post('/api/v1/auth/refresh', { refreshToken: user.refreshToken });
    assert.equal(replay.status, 401);
    assert.match(replay.body.error, /compromise/i);

    // La session légitime est révoquée elle aussi : l'attaquant ne gagne rien.
    const afterBreach = await api.post('/api/v1/auth/refresh', { refreshToken: rotated.body.refreshToken });
    assert.equal(afterBreach.status, 401);
  });

  it('révoque toutes les sessions à la demande', async () => {
    const user = await registerUser(api, { name: 'Logout', email: uniqueEmail('logout'), role: 'BUYER' });
    const before = await api.get('/api/v1/auth/me', user.accessToken);
    assert.equal(before.status, 200);

    const logout = await api.post('/api/v1/auth/logout', { allDevices: true }, user.accessToken);
    assert.equal(logout.status, 200);

    const afterLogout = await api.get('/api/v1/auth/me', user.accessToken);
    assert.equal(afterLogout.status, 401, 'le jeton d’accès est invalidé (tokenVersion)');
    const refresh = await api.post('/api/v1/auth/refresh', { refreshToken: user.refreshToken });
    assert.equal(refresh.status, 401);
  });

  it('refuse un compte suspendu', async () => {
    const user = await registerUser(api, { name: 'Suspendu', email: uniqueEmail('suspendu'), role: 'BUYER' });
    await prisma.user.update({ where: { id: user.user.id }, data: { status: 'SUSPENDED' } });
    const login = await api.post('/api/v1/auth/login', { email: user.user.email, password: user.password });
    assert.equal(login.status, 401);
    const me = await api.get('/api/v1/auth/me', user.accessToken);
    assert.equal(me.status, 401);
  });
});

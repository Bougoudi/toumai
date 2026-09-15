import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateRefreshToken, hashRefreshToken, refreshTokenLooksValid, signAccessToken, verifyAccessToken } from '../../src/touma/lib/tokens.js';

const user = { id: 'user_1', email: 'test@touma.dev', toumaRole: 'SELLER', tokenVersion: 3 };

describe('Jetons Touma', () => {
  it('émet et vérifie un jeton d’accès', () => {
    const payload = verifyAccessToken(signAccessToken(user));
    assert.ok(payload);
    assert.equal(payload.sub, 'user_1');
    assert.equal(payload.role, 'SELLER');
    assert.equal(payload.tv, 3);
    assert.equal(payload.purpose, 'touma_access');
  });

  it('rejette un jeton dont la signature a été modifiée', () => {
    const token = signAccessToken(user);
    const [header, body] = token.split('.');
    assert.equal(verifyAccessToken(`${header}.${body}.signature-bidon`), null);
  });

  it('rejette un jeton dont la charge utile a été réécrite (élévation de privilège)', () => {
    const token = signAccessToken(user);
    const [header, , sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...user, role: 'ADMIN', purpose: 'touma_access', exp: 99999999999 })).toString('base64url');
    assert.equal(verifyAccessToken(`${header}.${forged}.${sig}`), null);
  });

  it('rejette une chaîne quelconque', () => {
    assert.equal(verifyAccessToken('pas-un-jeton'), null);
    assert.equal(verifyAccessToken(''), null);
  });

  it('ne stocke jamais le jeton de rafraîchissement en clair', () => {
    const { token, hash } = generateRefreshToken();
    assert.ok(refreshTokenLooksValid(token));
    assert.equal(hash, hashRefreshToken(token));
    assert.notEqual(hash, token);
    assert.equal(hash.length, 64); // SHA-256 hexadécimal
  });

  it('détecte un jeton de rafraîchissement falsifié avant tout accès base', () => {
    assert.equal(refreshTokenLooksValid('valeur.inventee'), false);
  });
});

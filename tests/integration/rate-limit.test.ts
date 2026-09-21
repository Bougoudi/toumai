import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * LIMITES DE DÉBIT (V25 §22-23).
 *
 * La limitation est neutralisée par défaut dans la suite de tests : elle
 * fausserait les scénarios qui enchaînent des dizaines de connexions. Ce
 * fichier la rallume **pour lui seul** — chaque fichier tourne dans son propre
 * processus — parce qu'une protection qu'aucun test ne peut exercer est une
 * protection dont personne ne sait si elle marche.
 */
const api = new TestApi();

let a: any;
let b: any;

before(async () => {
  // Rallumé avant le démarrage : les compteurs lisent l'environnement à chaque
  // requête, mais autant que tout parte du même état.
  process.env.TOUMA_RATE_LIMIT_IN_TESTS = 'true';
  process.env.TOUMA_AI_RATE_LIMIT = '3';
  process.env.TOUMA_COUPON_RATE_LIMIT = '2';

  ensureSchema();
  await ensureReferenceData();
  await api.start();

  a = await registerUser(api, { name: 'Limite A', email: uniqueEmail('rl-a'), role: 'BUYER', countryCode: 'TD' });
  b = await registerUser(api, { name: 'Limite B', email: uniqueEmail('rl-b'), role: 'BUYER', countryCode: 'TD' });
});
after(async () => {
  delete process.env.TOUMA_RATE_LIMIT_IN_TESTS;
  delete process.env.TOUMA_AI_RATE_LIMIT;
  delete process.env.TOUMA_COUPON_RATE_LIMIT;
  await api.stop();
});

async function chat(token?: string) {
  return (await api.request('POST', '/api/v1/ai/chat', { token, body: { message: 'bonjour' } })).status;
}

describe('La limite compte par compte, pas par adresse', () => {
  it('un compte épuise son quota sans entamer celui d’un autre', async () => {
    /**
     * Le défaut que cette clé corrige.
     *
     * Une limite par IP seule punit tout un cybercafé de N'Djamena pour un
     * seul abuseur — et ceux qui en pâtissent ne comprennent pas pourquoi.
     * Dans l'autre sens, un compte qui change d'adresse échappe à la limite
     * censée l'arrêter.
     *
     * Ici, les deux comptes viennent de la **même** adresse.
     */
    for (let i = 0; i < 3; i += 1) assert.equal(await chat(a.accessToken), 200, `appel ${i + 1} du compte A`);
    assert.equal(await chat(a.accessToken), 429, 'le quatrième appel du compte A dépasse');

    assert.equal(await chat(b.accessToken), 200, 'le compte B garde son quota intact');
  });

  it('le dépassement rend le même format d’erreur que le reste de l’API', async () => {
    const res = await api.request('POST', '/api/v1/ai/chat', { token: a.accessToken, body: { message: 'encore' } });
    assert.equal(res.status, 429);
    // Sans cela, un dépassement était la seule erreur qu'un client ne pouvait
    // pas traiter comme les autres, et la seule introuvable dans le journal.
    assert.equal(res.body.code, 'SYSTEM_RATE_LIMITED');
    assert.equal(res.body.requestId, res.headers.get('x-request-id'));
    assert.ok(typeof res.body.error === 'string' && res.body.error.length > 0);
  });

  it('chaque usage a son propre compteur', async () => {
    // Le compte A a épuisé l'assistance. Un partage de seau ferait qu'une
    // conversation animée empêcherait de payer.
    assert.equal(await chat(a.accessToken), 429);
    const autre = await api.request('GET', '/api/v1/auth/me', { token: a.accessToken });
    assert.equal(autre.status, 200, 'les autres routes restent accessibles');
  });
});

describe('Essai de codes promotionnels', () => {
  it('est freiné après quelques tentatives', async () => {
    // Sans limite, essayer des codes au hasard jusqu'à en trouver un valide ne
    // coûte rien : c'est l'abus de coupon que §23 nomme.
    const essai = () =>
      api.request('POST', '/api/v1/coupons/preview', { token: b.accessToken, body: { code: `INVENTE-${Math.random().toString(36).slice(2, 8)}` } });

    const statuts: number[] = [];
    for (let i = 0; i < 4; i += 1) statuts.push((await essai()).status);
    assert.ok(statuts.includes(429), `un essai répété doit finir par être freiné, obtenu : ${statuts.join(', ')}`);
  });
});

describe('Force brute sur la connexion', () => {
  it('reste comptée par adresse, faute de compte identifiable', async () => {
    process.env.TOUMA_AUTH_RATE_LIMIT = '3';
    const essai = () => api.request('POST', '/api/v1/auth/login', { body: { email: uniqueEmail('inconnu'), password: 'faux' } });
    const statuts: number[] = [];
    for (let i = 0; i < 6; i += 1) statuts.push((await essai()).status);
    delete process.env.TOUMA_AUTH_RATE_LIMIT;

    // Au moment où cette limite sert, l'attaquant n'est précisément pas
    // authentifié : une clé par compte ne compterait rien.
    assert.ok(statuts.includes(429), `la force brute doit être freinée, obtenu : ${statuts.join(', ')}`);
  });
});

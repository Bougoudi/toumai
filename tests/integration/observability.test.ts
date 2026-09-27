import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * OBSERVABILITÉ (V25 §18-21).
 *
 * Le besoin qui justifie tout ceci est banal et coûteux : un acheteur dit
 * « mon paiement n'est jamais arrivé ». Le parcours traverse le panier, la
 * commande, le prestataire, un webhook, l'expédition — et rien ne reliait ces
 * lignes de journal entre elles. Il fallait recouper des horodatages sur un
 * serveur qui sert d'autres acheteurs à la même seconde.
 */
const api = new TestApi();

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
});
after(async () => api.stop());

describe('Identifiant de requête', () => {
  it('est renvoyé sur toute réponse', async () => {
    const res = await api.request('GET', '/api/v1/countries');
    const id = res.headers.get('x-request-id');
    assert.ok(id, 'toute réponse porte un identifiant');
    assert.ok(String(id).length >= 8);
  });

  it('change d’une requête à l’autre', async () => {
    const a = await api.request('GET', '/api/v1/countries');
    const b = await api.request('GET', '/api/v1/countries');
    assert.notEqual(a.headers.get('x-request-id'), b.headers.get('x-request-id'));
  });

  it('conserve celui du client quand il est exploitable', async () => {
    // Un proxy ou un client qui trace déjà a son propre identifiant :
    // le remplacer couperait la trace en deux.
    const fourni = 'trace-client-0123456789';
    const res = await api.request('GET', '/api/v1/countries', { headers: { 'x-request-id': fourni } });
    assert.equal(res.headers.get('x-request-id'), fourni);
  });

  it('refuse un identifiant qui pourrait salir le journal', async () => {
    // Un identifiant venu de l'extérieur finit dans les journaux, où il sera
    // relu comme du JSON. Sans contrainte de format, on y fabrique de fausses
    // entrées.
    //
    // Le cas du retour à la ligne n'est pas testé ici : la couche HTTP le
    // refuse une marche plus tôt — `fetch` rejette la valeur avant l'envoi —
    // et un test qui n'atteint jamais le code qu'il prétend éprouver ne prouve
    // rien. Restent les valeurs légales pour HTTP, qui sont celles qui
    // arrivent vraiment jusqu'ici.
    const malveillant = '","level":"info","msg":"tout va bien';
    const res = await api.request('GET', '/api/v1/countries', { headers: { 'x-request-id': malveillant } });
    const rendu = String(res.headers.get('x-request-id') ?? '');
    assert.notEqual(rendu, malveillant, 'un identifiant qui casserait le JSON du journal est remplacé');
    assert.match(rendu, /^[A-Za-z0-9._-]+$/, 'seuls des caractères inoffensifs ressortent');
  });

  it('refuse un identifiant démesuré', async () => {
    // Sans borne, chaque ligne de journal de la requête porterait ce pavé.
    const res = await api.request('GET', '/api/v1/countries', { headers: { 'x-request-id': 'a'.repeat(4096) } });
    assert.ok(String(res.headers.get('x-request-id') ?? '').length <= 128);
  });

  it('trop court, il est remplacé plutôt qu’accepté', async () => {
    const res = await api.request('GET', '/api/v1/countries', { headers: { 'x-request-id': 'court' } });
    assert.notEqual(res.headers.get('x-request-id'), 'court');
  });
});

describe('Réponses d’erreur', () => {
  it('portent un code et l’identifiant de requête', async () => {
    const res = await api.request('GET', '/api/v1/products/inexistant-0000');
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'SYSTEM_NOT_FOUND');
    assert.equal(res.body.requestId, res.headers.get('x-request-id'), 'le numéro cité au support est celui du journal');
    // `error` reste : c'est le champ que lisent l'application web et la vitrine.
    assert.ok(typeof res.body.error === 'string' && res.body.error.length > 0);
  });

  it('distinguent l’authentification manquante de l’autorisation refusée', async () => {
    const anonyme = await api.request('GET', '/api/v1/admin/intelligence');
    assert.equal(anonyme.status, 401);
    assert.equal(anonyme.body.code, 'AUTH_REQUIRED');

    const vendeur = await registerUser(api, { name: 'Vendeur obs', email: uniqueEmail('obs'), role: 'SELLER' });
    const refuse = await api.request('GET', '/api/v1/admin/intelligence', { token: vendeur.accessToken });
    assert.equal(refuse.status, 403);
    assert.equal(refuse.body.code, 'AUTH_FORBIDDEN');
  });

  it('portent un code sur une validation échouée', async () => {
    const res = await api.request('POST', '/api/v1/auth/register', { body: { email: 'pas-une-adresse' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'SYSTEM_VALIDATION');
    assert.ok(res.body.details, 'le détail de validation reste utile à un formulaire');
  });

  it('ne laissent jamais fuir une pile d’appels ni un chemin interne', async () => {
    const res = await api.request('GET', '/api/v1/products/inexistant-0000');
    const rendu = JSON.stringify(res.body);
    // Un message d'erreur détaillé renseigne autant l'attaquant que l'utilisateur.
    assert.ok(!/\/home\/|node_modules|at Object\.|prisma\./i.test(rendu), `fuite dans la réponse : ${rendu}`);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * SESSIONS ET RÉVOCATION (V25 §24).
 *
 * Ce que cet écran sert vraiment : quelqu'un se demande si son compte est
 * utilisé ailleurs. Il faut donc qu'il voie ses appareils — pas la mécanique
 * interne des jetons —, qu'il puisse en couper un, et qu'on lui dise
 * exactement ce que « couper » produit.
 */
const api = new TestApi();

let compte: any;

/** Ouvre une session supplémentaire pour le même compte. */
async function nouvelleSession(appareil: string) {
  const res = await api.request('POST', '/api/v1/auth/login', {
    body: { email: compte.user.email, password: compte.password },
    headers: { 'user-agent': appareil },
  });
  assert.equal(res.status, 200);
  return res.body;
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
  compte = await registerUser(api, { name: 'Sessions', email: uniqueEmail('sess'), role: 'BUYER' });
});
after(async () => api.stop());

describe('Liste des sessions', () => {
  it('exige une authentification', async () => {
    assert.equal((await api.request('GET', '/api/v1/auth/me/sessions')).status, 401);
  });

  it('garde le nom de l’appareil après une rotation de jeton', async () => {
    /**
     * Le défaut que ce test existe pour empêcher.
     *
     * La rotation enregistre le contexte de l'appel de rafraîchissement —
     * souvent une requête d'arrière-plan sans en-tête `user-agent`. La session
     * perdait donc son nom dès le premier renouvellement, et quelqu'un
     * cherchant « mon téléphone » dans la liste n'y trouvait qu'une ligne
     * anonyme : l'inverse de ce que cet écran sert à faire.
     */
    const telephone = await nouvelleSession('Appareil-Telephone');
    await nouvelleSession('Appareil-Portable');

    // Trois rotations sans en-tête d'appareil, comme un client qui renouvelle
    // son jeton en arrière-plan.
    let jeton = telephone.refreshToken;
    for (let i = 0; i < 3; i += 1) {
      const r = await api.request('POST', '/api/v1/auth/refresh', { body: { refreshToken: jeton } });
      assert.equal(r.status, 200);
      jeton = r.body.refreshToken;
    }

    const res = await api.request('GET', '/api/v1/auth/me/sessions', { token: compte.accessToken });
    assert.equal(res.status, 200);
    const appareils = res.body.items.map((s: any) => s.userAgent);
    assert.ok(appareils.includes('Appareil-Telephone'), `le téléphone doit rester nommé, obtenu : ${JSON.stringify(appareils)}`);
    assert.ok(appareils.includes('Appareil-Portable'));
  });

  it('montre une entrée par appareil, quel que soit le nombre de rotations', async () => {
    const avant = await api.request('GET', '/api/v1/auth/me/sessions', { token: compte.accessToken });
    const session = await nouvelleSession('Appareil-Compté');
    let jeton = session.refreshToken;
    for (let i = 0; i < 4; i += 1) {
      jeton = (await api.request('POST', '/api/v1/auth/refresh', { body: { refreshToken: jeton } })).body.refreshToken;
    }
    const apres = await api.request('GET', '/api/v1/auth/me/sessions', { token: compte.accessToken });
    // Une connexion de plus, quatre rotations : une seule session de plus.
    assert.equal(apres.body.items.length, avant.body.items.length + 1);
  });

  it('date le début de la session à la connexion, pas à la dernière rotation', async () => {
    const session = await nouvelleSession('Appareil-Daté');
    await new Promise((r) => setTimeout(r, 1100));
    await api.request('POST', '/api/v1/auth/refresh', { body: { refreshToken: session.refreshToken } });

    const res = await api.request('GET', '/api/v1/auth/me/sessions', { token: compte.accessToken });
    const cible = res.body.items.find((s: any) => s.userAgent === 'Appareil-Daté');
    assert.ok(cible);
    assert.ok(
      new Date(cible.startedAt) < new Date(cible.lastSeenAt),
      '« connecté depuis » et « vu pour la dernière fois » sont deux dates distinctes',
    );
  });

  it('signale la session courante quand on lui donne de quoi la reconnaître', async () => {
    const session = await nouvelleSession('Appareil-Courant');
    const res = await api.request(
      'GET',
      `/api/v1/auth/me/sessions?refreshToken=${encodeURIComponent(session.refreshToken)}`,
      { token: session.accessToken },
    );
    const courantes = res.body.items.filter((s: any) => s.current);
    assert.equal(courantes.length, 1, 'une seule session est la session courante');
    assert.equal(courantes[0].userAgent, 'Appareil-Courant');
  });

  it('ne laisse jamais sortir le jeton lui-même', async () => {
    const res = await api.request('GET', '/api/v1/auth/me/sessions', { token: compte.accessToken });
    const rendu = JSON.stringify(res.body);
    // Ni le jeton, ni son empreinte : une empreinte suffit à reconnaître un
    // jeton volé ailleurs.
    assert.ok(!/tokenHash|refreshToken"\s*:/.test(rendu), `fuite : ${rendu.slice(0, 200)}`);
  });

  it('dit ce que révoquer produit réellement, sans promettre une coupure instantanée', async () => {
    const res = await api.request('GET', '/api/v1/auth/me/sessions', { token: compte.accessToken });
    assert.match(res.body.note, /jeton d’accès déjà émis reste valable/i);
  });
});

describe('Révocation d’une session', () => {
  it('ferme la chaîne entière, pas seulement le dernier jeton', async () => {
    const session = await nouvelleSession('Appareil-A-Couper');
    // Une rotation : il existe désormais un jeton antérieur dans la famille.
    const rotation = await api.request('POST', '/api/v1/auth/refresh', { body: { refreshToken: session.refreshToken } });
    const jetonRecent = rotation.body.refreshToken;

    const liste = await api.request('GET', '/api/v1/auth/me/sessions', { token: compte.accessToken });
    const cible = liste.body.items.find((s: any) => s.userAgent === 'Appareil-A-Couper');
    assert.ok(cible, 'la session à couper est visible');

    const revoque = await api.request('POST', `/api/v1/auth/me/sessions/${cible.id}/revoke`, { token: compte.accessToken });
    assert.equal(revoque.status, 200);

    // Le jeton le plus récent ne marche plus…
    assert.equal((await api.request('POST', '/api/v1/auth/refresh', { body: { refreshToken: jetonRecent } })).status, 401);
    // …et l'ancien non plus. Ne révoquer que la dernière ligne aurait laissé
    // un jeton antérieur utilisable.
    assert.equal((await api.request('POST', '/api/v1/auth/refresh', { body: { refreshToken: session.refreshToken } })).status, 401);
  });

  it('ne révoque pas les autres appareils', async () => {
    const garder = await nouvelleSession('Appareil-A-Garder');
    const couper = await nouvelleSession('Appareil-Jetable');

    const liste = await api.request('GET', '/api/v1/auth/me/sessions', { token: compte.accessToken });
    const cible = liste.body.items.find((s: any) => s.userAgent === 'Appareil-Jetable');
    await api.request('POST', `/api/v1/auth/me/sessions/${cible.id}/revoke`, { token: compte.accessToken });

    const encore = await api.request('POST', '/api/v1/auth/refresh', { body: { refreshToken: garder.refreshToken } });
    assert.equal(encore.status, 200, 'couper un appareil ne doit pas déconnecter les autres');
    assert.equal((await api.request('POST', '/api/v1/auth/refresh', { body: { refreshToken: couper.refreshToken } })).status, 401);
  });

  it('ne permet pas de couper la session de quelqu’un d’autre', async () => {
    const autre = await registerUser(api, { name: 'Autre', email: uniqueEmail('autre-sess'), role: 'BUYER' });
    const sienne = await api.request('GET', '/api/v1/auth/me/sessions', { token: autre.accessToken });
    const cible = sienne.body.items[0];
    assert.ok(cible, 'le second compte a bien une session');

    const res = await api.request('POST', `/api/v1/auth/me/sessions/${cible.id}/revoke`, { token: compte.accessToken });
    // « Introuvable » et non « interdit » : répondre 403 confirmerait que
    // cette session existe.
    assert.equal(res.status, 404);

    const toujours = await api.request('POST', '/api/v1/auth/refresh', { body: { refreshToken: autre.refreshToken } });
    assert.equal(toujours.status, 200, 'la session de l’autre compte est intacte');
  });

  it('une session inconnue rend « introuvable »', async () => {
    const res = await api.request('POST', '/api/v1/auth/me/sessions/famille-imaginaire/revoke', { token: compte.accessToken });
    assert.equal(res.status, 404);
  });
});

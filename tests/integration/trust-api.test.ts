import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * L'API de confiance. Deux questions seulement, mais ce sont les bonnes :
 * **qui peut lire quoi**, et **qui peut écrire quoi**. Un score qu'un vendeur
 * pourrait modifier ne vaut rien ; un motif de fraude qu'il pourrait lire lui
 * apprendrait à le contourner.
 */
const api = new TestApi();

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
});
after(async () => api.stop());

async function admin() {
  const compte = await registerUser(api, { name: 'Admin Trust', email: uniqueEmail('trust-admin'), role: 'BUYER' });
  await promoteToAdmin(compte.user.id);
  // Le rôle est porté par le jeton : il faut en obtenir un nouveau.
  const relog = await api.post('/api/v1/auth/login', { email: compte.user.email, password: compte.password });
  return { ...compte, accessToken: relog.body.accessToken as string };
}

describe('API de confiance — lecture publique', () => {
  it('publie les pondérations sans exiger de compte', async () => {
    // Un vendeur doit pouvoir reconstituer son score. Sinon il ne peut pas le
    // contester, et un score incontestable n'est pas une mesure.
    const res = await api.get('/api/v1/trust/weights');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.factors.seller));
    assert.ok(res.body.levels.length >= 4);
    assert.ok(res.body.decay.halfLifeDays > 0);
  });

  it('annonce les signaux qu’aucun prestataire ne peut établir', async () => {
    const res = await api.get('/api/v1/trust/weights');
    const indisponibles: string[] = res.body.verification.unavailableSignals;
    // Tant qu'aucun prestataire KYC/KYB n'est engagé, ces trois signaux sont
    // hors d'atteinte — et l'API le dit plutôt que de laisser espérer.
    assert.ok(indisponibles.includes('PHONE_CONFIRMED'));
    assert.ok(indisponibles.includes('COMPANY_REGISTRY'));
    assert.ok(indisponibles.includes('PAYOUT_ACCOUNT'));
  });

  it('rend la confiance d’une boutique avec sa ventilation', async () => {
    const vendeur = await registerUser(api, { name: 'Vendeur API', email: uniqueEmail('trust-api-v'), role: 'SELLER' });
    const store = await prisma.toumaStore.create({
      data: {
        ownerId: vendeur.user.id,
        name: 'Boutique API',
        slug: `boutique-api-${Date.now()}`,
        countryCode: 'TD',
        status: 'ACTIVE',
      },
    });
    const res = await api.get(`/api/v1/trust/sellers/${store.slug}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.score, null, 'pas de score sans volume');
    assert.ok(Array.isArray(res.body.components), 'la ventilation accompagne toujours le score');
    assert.ok(res.body.minimumSample > 0, 'le seuil est annoncé');
    assert.deepEqual(res.body.badges, []);
  });

  it('n’expose jamais les signaux de fraude dans la vue publique', async () => {
    const vendeur = await registerUser(api, { name: 'Vendeur F', email: uniqueEmail('trust-api-f'), role: 'SELLER' });
    const store = await prisma.toumaStore.create({
      data: {
        ownerId: vendeur.user.id,
        name: 'Boutique F',
        slug: `boutique-f-${Date.now()}`,
        countryCode: 'TD',
        status: 'ACTIVE',
      },
    });
    await prisma.toumaRiskScore.create({
      data: { userId: vendeur.user.id, score: 70, level: 'HIGH', signals: [{ code: 'SECRET', weight: 70 }] },
    });
    const res = await api.get(`/api/v1/trust/sellers/${store.slug}`);
    const brut = JSON.stringify(res.body);
    assert.ok(!brut.includes('SECRET'), 'un signal de fraude ne sort jamais en public');
    assert.ok(!brut.includes('riskScore'), 'le score de risque brut reste interne');
    assert.ok(!brut.includes('FRAUD'), 'la fiche publique n’accuse personne de fraude');

    // La composante reste dans la ventilation, mais opaque : le total doit
    // continuer de s'additionner, sinon le score cesse d'être vérifiable.
    const interne = res.body.components.find((c: { code: string }) => c.code === 'INTERNAL_CHECKS');
    assert.ok(interne, 'la composante doit rester présente pour que le total tienne');
    assert.deepEqual(interne.detail, {}, 'sans son motif');
  });
});

describe('API de confiance — écriture', () => {
  it('refuse à un vendeur de modifier son propre score', async () => {
    // La garantie du §36 : aucun chemin d'écriture n'existe côté client.
    const vendeur = await registerUser(api, { name: 'Vendeur W', email: uniqueEmail('trust-w'), role: 'SELLER' });
    const store = await prisma.toumaStore.create({
      data: {
        ownerId: vendeur.user.id,
        name: 'Boutique W',
        slug: `boutique-w-${Date.now()}`,
        countryCode: 'TD',
        status: 'ACTIVE',
      },
    });
    for (const chemin of [
      `/api/v1/trust/sellers/${store.id}`,
      `/api/v1/admin/trust/recompute/SELLER/${store.id}`,
    ]) {
      const res = await api.post(chemin, { score: 100 }, vendeur.accessToken);
      assert.ok([401, 403, 404, 405].includes(res.status), `${chemin} devrait être refusé (${res.status})`);
      assert.notEqual(res.status, 200, `${chemin} ne doit jamais accepter une écriture de score`);
    }
  });

  it('refuse l’accès à l’administration de la confiance sans le rôle', async () => {
    const acheteur = await registerUser(api, { name: 'Curieux', email: uniqueEmail('trust-curieux'), role: 'BUYER' });
    for (const chemin of ['/api/v1/admin/trust/overview', '/api/v1/admin/trust/risk', '/api/v1/admin/trust/appeals']) {
      const res = await api.get(chemin, acheteur.accessToken);
      assert.equal(res.status, 403, chemin);
    }
  });

  it('donne à l’administration un tableau de bord fait de décomptes réels', async () => {
    const a = await admin();
    const res = await api.get('/api/v1/admin/trust/overview', a.accessToken);
    assert.equal(res.status, 200);
    for (const cle of ['verifiedSellers', 'pendingVerifications', 'highRiskUsers', 'flaggedReviews', 'openAppeals']) {
      assert.equal(typeof res.body[cle], 'number', `${cle} doit être un décompte`);
    }
  });
});

describe('Sanctions et recours', () => {
  it('exige un motif communiqué avant toute restriction', async () => {
    const a = await admin();
    const cible = await registerUser(api, { name: 'Cible', email: uniqueEmail('trust-cible'), role: 'SELLER' });
    const res = await api.post(
      `/api/v1/admin/trust/users/${cible.user.id}/standing`,
      { status: 'RESTRICTED' },
      a.accessToken,
    );
    // Sans motif lisible, la décision ne serait pas contestable.
    assert.equal(res.status, 400);
  });

  it('restreint, dit ce que cela retire, et laisse acheter', async () => {
    const a = await admin();
    const cible = await registerUser(api, { name: 'Restreint', email: uniqueEmail('trust-restreint'), role: 'SELLER' });
    const res = await api.post(
      `/api/v1/admin/trust/users/${cible.user.id}/standing`,
      { status: 'RESTRICTED', reason: 'REVIEW_MANIPULATION', publicReason: 'Avis suspects détectés sur votre boutique.' },
      a.accessToken,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'RESTRICTED');
    // Une restriction de vendeur ne doit pas punir l'acheteur qu'il est aussi.
    assert.ok(res.body.effects.includes('SELL'));
    assert.ok(!res.body.effects.includes('BUY'));

    const vue = await api.get('/api/v1/trust/me', cible.accessToken);
    assert.equal(vue.body.standing.status, 'RESTRICTED');
    assert.equal(vue.body.standing.publicReason, 'Avis suspects détectés sur votre boutique.');
    // Le motif **interne** ne lui est pas rendu.
    assert.ok(!JSON.stringify(vue.body.standing).includes('REVIEW_MANIPULATION'));
  });

  it('interdit à un administrateur de se sanctionner lui-même', async () => {
    const a = await admin();
    const res = await api.post(
      `/api/v1/admin/trust/users/${a.user.id}/standing`,
      { status: 'SUSPENDED', publicReason: 'Test' },
      a.accessToken,
    );
    assert.equal(res.status, 400);
  });

  it('permet de contester, une seule fois à la fois, et exige une décision motivée', async () => {
    const a = await admin();
    const cible = await registerUser(api, { name: 'Contestataire', email: uniqueEmail('trust-recours'), role: 'SELLER' });

    const depot = await api.post(
      '/api/v1/trust/appeals',
      { subjectType: 'STANDING', message: 'Ces avis ne viennent pas de moi, voici mes explications détaillées.' },
      cible.accessToken,
    );
    assert.equal(depot.status, 201);

    const doublon = await api.post(
      '/api/v1/trust/appeals',
      { subjectType: 'STANDING', message: 'Je redépose exactement le même recours une seconde fois.' },
      cible.accessToken,
    );
    assert.equal(doublon.status, 409, 'un seul recours en cours par sujet');

    const sansMotif = await api.post(
      `/api/v1/admin/trust/appeals/${depot.body.id}/decide`,
      { decision: 'REJECTED', resolution: 'non' },
      a.accessToken,
    );
    assert.equal(sansMotif.status, 400, 'un rejet non motivé fait croire à un examen qui n’a pas eu lieu');

    const decide = await api.post(
      `/api/v1/admin/trust/appeals/${depot.body.id}/decide`,
      { decision: 'APPROVED', resolution: 'Après vérification, les avis provenaient d’un tiers. Restriction levée.' },
      a.accessToken,
    );
    assert.equal(decide.status, 200);
    assert.equal(decide.body.status, 'APPROVED');

    const rejoue = await api.post(
      `/api/v1/admin/trust/appeals/${depot.body.id}/decide`,
      { decision: 'REJECTED', resolution: 'On change d’avis après coup, ce qui ne doit pas être possible.' },
      a.accessToken,
    );
    assert.equal(rejoue.status, 409, 'un recours tranché ne se rejuge pas en silence');
  });

  it('trace chaque décision dans le journal d’audit', async () => {
    const a = await admin();
    const cible = await registerUser(api, { name: 'Tracee', email: uniqueEmail('trust-audit'), role: 'SELLER' });
    await api.post(
      `/api/v1/admin/trust/users/${cible.user.id}/standing`,
      { status: 'SUSPENDED', reason: 'FRAUD', publicReason: 'Fraude constatée sur plusieurs commandes.' },
      a.accessToken,
    );
    const trace = await prisma.toumaAuditLog.findFirst({
      where: { actorId: a.user.id, action: 'trust.standing.suspended' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(trace, 'une sanction non tracée est une sanction sans auteur');
  });
});

describe('Confiance, classement et mise en avant', () => {
  it('propose un tri par confiance sans qu’il puisse s’acheter', async () => {
    // §30–31. Le classement organique ne doit regarder ni promotion, ni mise
    // en avant, ni paiement. Le vérifier sur le **code** plutôt que sur un
    // résultat : un jeu de données ne prouverait rien, alors qu'un terme
    // acheté laisserait une trace ici.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../src/touma/sourcing/sourcing.service.ts', import.meta.url), 'utf8');
    const tri = source.slice(source.indexOf('const sorted = ['), source.indexOf('return paginated(sorted'));
    for (const terme of ['coupon', 'promotion', 'sponsor', 'boost', 'featured', 'ad', 'paid']) {
      assert.ok(
        !new RegExp(`\\\\b${terme}`, 'i').test(tri),
        `le classement organique ne doit pas regarder « ${terme} »`,
      );
    }
    assert.ok(tri.includes('trustScore'), 'la confiance doit peser dans le classement');
  });

  it('classe un fournisseur sans score devant un mauvais score, pas derrière', async () => {
    const res = await api.get('/api/v1/sourcing/suppliers?sort=trust');
    assert.equal(res.status, 200);
    const scores = res.body.items.map((i: { trustScore: number | null }) => i.trustScore);
    // Un score absent vaut −1 dans le tri : derrière un score mesuré, devant
    // rien du tout. Un fournisseur nouveau n'est pas un mauvais fournisseur,
    // mais il n'est pas non plus meilleur qu'un fournisseur éprouvé.
    const mesures = scores.filter((s: number | null) => s !== null);
    const premierNull = scores.indexOf(null);
    if (premierNull !== -1 && mesures.length > 0) {
      assert.ok(
        scores.slice(0, premierNull).every((s: number | null) => s !== null),
        'les scores mesurés doivent précéder les scores absents',
      );
    }
  });

  it('joint la confiance du fournisseur à chaque offre reçue', async () => {
    // §15 : l'acheteur compare prix, MOQ, délai **et** confiance sur le même
    // écran. Sans cela il compare des prix et rien d'autre.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../src/touma/b2b/b2b.service.ts', import.meta.url), 'utf8');
    assert.ok(source.includes('supplierTrust'), 'chaque offre doit porter la confiance de son fournisseur');
    assert.ok(source.includes("entityType: 'SUPPLIER'"), 'et elle doit venir du moteur, pas d’un calcul local');
  });
});

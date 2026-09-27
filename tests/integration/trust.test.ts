import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { trustService } from '../../src/touma/trust/trust.service.js';
import { activeBadges } from '../../src/touma/trust/badges.js';

/**
 * Le moteur de confiance contre la vraie base.
 *
 * Les contrôles unitaires vérifient l'arithmétique ; ceux-ci vérifient ce que
 * l'arithmétique reçoit — c'est là que se logent les erreurs coûteuses : une
 * jointure qui compte les mauvaises commandes, une vérification suspendue
 * encore créditée, un score publié sur trois ventes.
 */
const api = new TestApi();

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
});
after(async () => api.stop());

async function creerBoutique(suffixe: string) {
  const vendeur = await registerUser(api, {
    name: `Vendeur ${suffixe}`,
    email: uniqueEmail(`trust-${suffixe}`),
    role: 'SELLER',
  });
  const store = await prisma.toumaStore.create({
    data: {
      ownerId: vendeur.user.id,
      name: `Boutique ${suffixe}`,
      slug: `boutique-trust-${suffixe}-${Date.now()}`,
      countryCode: 'TD',
      status: 'ACTIVE',
    },
  });
  return { vendeur, store };
}

describe('Score de confiance — vendeur', () => {
  it('ne publie pas de score tant que le volume est insuffisant', async () => {
    const { store } = await creerBoutique('neuf');
    const resultat = await trustService.compute('SELLER', store.id, 'TEST');

    // Le point central de V21 : un vendeur nouveau n'est pas un mauvais
    // vendeur. Le score est absent, pas bas.
    assert.equal(resultat.score, null, 'aucun score ne doit être publié sous le seuil');
    assert.equal(resultat.level, 'INSUFFICIENT_DATA');
    assert.equal(resultat.sampleSize, 0);
    assert.ok(resultat.minimumSample > 0, 'le seuil doit être annoncé à l’intéressé');
  });

  it('rend une ventilation complète même sans score', async () => {
    const { store } = await creerBoutique('ventilation');
    const resultat = await trustService.compute('SELLER', store.id, 'TEST');

    // « Score = 87 » sans explication est interdit ; l'absence de score ne
    // dispense pas de dire ce qui a été regardé.
    assert.ok(resultat.components.length >= 8, 'toutes les composantes sont rendues');
    for (const composante of resultat.components) {
      assert.ok(typeof composante.code === 'string' && composante.code.length > 0);
      assert.ok(['POSITIVE', 'NEGATIVE'].includes(composante.direction));
      assert.ok(composante.detail !== undefined, `${composante.code} doit citer ce qui l’a produit`);
    }
  });

  it('ne crédite pas une vérification qui n’en est pas une', async () => {
    const { store } = await creerBoutique('nonverifie');
    const avant = await trustService.compute('SELLER', store.id, 'TEST');
    const verifAvant = avant.components.find((c) => c.code === 'VERIFICATION');
    assert.equal(verifAvant?.value, 0, 'une boutique non vérifiée ne gagne aucun point de vérification');

    await prisma.toumaStore.update({
      where: { id: store.id },
      data: { verificationStatus: 'APPROVED', verificationLevel: 'BUSINESS' },
    });
    const apres = await trustService.compute('SELLER', store.id, 'TEST');
    const verifApres = apres.components.find((c) => c.code === 'VERIFICATION');
    assert.ok((verifApres?.value ?? 0) > 0, 'une vérification réelle doit compter');
    assert.equal((verifApres?.detail as { level?: string }).level, 'BUSINESS');
  });

  it('retire le crédit d’une vérification suspendue ou périmée', async () => {
    // Le cas qui ferait le plus de dégâts : une vérification retirée mais
    // encore comptée, c'est-à-dire « vendeur vérifié » affiché à tort.
    const { store } = await creerBoutique('suspendu');
    for (const statut of ['SUSPENDED', 'EXPIRED', 'UNDER_REVIEW', 'REJECTED'] as const) {
      await prisma.toumaStore.update({
        where: { id: store.id },
        data: { verificationStatus: statut, verificationLevel: 'ENTERPRISE' },
      });
      const resultat = await trustService.compute('SELLER', store.id, 'TEST');
      const verif = resultat.components.find((c) => c.code === 'VERIFICATION');
      assert.equal(verif?.value, 0, `le statut ${statut} ne doit rien créditer`);
    }
  });
});

describe('Historique du score', () => {
  it('empile des instantanés datés au lieu d’écraser', async () => {
    const { store } = await creerBoutique('historique');
    await trustService.compute('SELLER', store.id, 'ORDER_COMPLETED');
    await trustService.compute('SELLER', store.id, 'DISPUTE_OPENED');

    const historique = await trustService.history('SELLER', store.id);
    assert.ok(historique.items.length >= 2, 'chaque calcul laisse une trace');
    // Le motif est conservé tel quel : c'est lui qui permet de dire *pourquoi*
    // le score a bougé ce jour-là.
    assert.equal(historique.items[0].reason, 'DISPUTE_OPENED');
    assert.equal(historique.items[1].reason, 'ORDER_COMPLETED');
  });

  it('ne garde qu’une ligne courante par entité', async () => {
    const { store } = await creerBoutique('courant');
    await trustService.compute('SELLER', store.id, 'TEST');
    await trustService.compute('SELLER', store.id, 'TEST');
    const lignes = await prisma.toumaTrustScore.count({
      where: { entityType: 'SELLER', entityId: store.id },
    });
    assert.equal(lignes, 1);
  });
});

describe('Badges', () => {
  it('n’attribue aucun badge à une boutique sans historique', async () => {
    const { store } = await creerBoutique('sansbadge');
    await trustService.compute('SELLER', store.id, 'TEST');
    const badges = await activeBadges('SELLER', store.id);
    assert.deepEqual(badges, [], 'aucun badge ne se donne sans fait qui le justifie');
  });

  it('pose « identité vérifiée » sur une vérification réelle, et le retire quand elle tombe', async () => {
    const { store } = await creerBoutique('badge-verif');
    await prisma.toumaStore.update({
      where: { id: store.id },
      data: { verificationStatus: 'APPROVED', verificationLevel: 'BUSINESS' },
    });
    await trustService.compute('SELLER', store.id, 'SELLER_VERIFIED');

    const badges = await activeBadges('SELLER', store.id);
    const codes = badges.map((b) => b.code);
    assert.ok(codes.includes('IDENTITY_VERIFIED'));
    assert.ok(codes.includes('BUSINESS_VERIFIED'));
    // Le badge cite ce qui le justifie : sans cela il n'est pas relisible.
    const identite = badges.find((b) => b.code === 'IDENTITY_VERIFIED');
    assert.equal((identite?.evidence as { status?: string }).status, 'APPROVED');

    await prisma.toumaStore.update({ where: { id: store.id }, data: { verificationStatus: 'SUSPENDED' } });
    await trustService.compute('SELLER', store.id, 'SELLER_SUSPENDED');

    const apres = await activeBadges('SELLER', store.id);
    assert.deepEqual(apres, [], 'un badge dont la condition tombe doit être retiré');

    // Retiré, pas effacé : la ligne demeure, datée, pour être relue.
    const trace = await prisma.toumaTrustBadge.findFirst({
      where: { entityType: 'SELLER', entityId: store.id, code: 'IDENTITY_VERIFIED' },
    });
    assert.ok(trace, 'la trace du badge doit subsister');
    assert.ok(trace?.revokedAt instanceof Date);
  });
});

describe('Score de confiance — acheteur', () => {
  it('se calcule sans lire une seule donnée de personne', async () => {
    const acheteur = await registerUser(api, {
      name: 'Acheteuse',
      email: uniqueEmail('trust-acheteur'),
      role: 'BUYER',
    });
    const resultat = await trustService.compute('BUYER', acheteur.user.id, 'TEST');

    assert.equal(resultat.score, null, 'pas de score sans achat');
    const codes = resultat.components.map((c) => c.code);
    // §38 — aucune composante ne peut être un substitut d'origine ou de
    // personne. La liste est vérifiée en entier, pour qu'un ajout futur
    // échoue ici plutôt que de passer inaperçu.
    assert.deepEqual(codes.sort(), [
      'ACCOUNT_AGE',
      'CANCELLATIONS',
      'COMPLETED_ORDERS',
      'FRAUD_SIGNALS',
      'NO_ABUSE',
      'PAYMENT_RELIABILITY',
      'VERIFIED_CONTACT',
    ]);
  });

  it('ne prétend pas qu’un téléphone est vérifié', async () => {
    // TOUMA n'envoie pas de SMS : aucun numéro n'a été confirmé par son
    // porteur. Le dire serait exactement le « faux indicateur » que V21 proscrit.
    const acheteur = await registerUser(api, {
      name: 'Acheteur tel',
      email: uniqueEmail('trust-tel'),
      role: 'BUYER',
    });
    await prisma.user.update({ where: { id: acheteur.user.id }, data: { phone: `+2356${Date.now() % 10000000}` } });
    const resultat = await trustService.compute('BUYER', acheteur.user.id, 'TEST');
    const contact = resultat.components.find((c) => c.code === 'VERIFIED_CONTACT');
    assert.equal((contact?.detail as { phoneConfirmedBySms?: boolean }).phoneConfirmedBySms, false);
    assert.equal((contact?.detail as { phoneOnFile?: boolean }).phoneOnFile, true);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AVERTISSEMENT, POIDS, raisons, scorePertinence } from '../../src/touma/sourcing/matching.js';

/**
 * Les raisons d'une correspondance fournisseur (V28 §4).
 *
 * Ce que ces tests fixent : la liste n'énonce que ce que l'acheteur a demandé,
 * elle distingue « non mesuré » de « non satisfait », et les poids qu'elle
 * publie sont **ceux qui classent réellement**.
 */

const observeVide = {
  countryCode: 'TD',
  verified: false,
  matchingProducts: 0,
  capacity: 0,
  servesDestination: null,
  servesRequestedQuantity: null,
  servedCountries: [] as string[],
  reputationScore: null,
  trustScore: null,
  minOrderQty: null,
};

describe('Correspondance fournisseur — ce qui est énoncé', () => {
  it('n’énonce rien que l’acheteur n’ait demandé', () => {
    // Afficher « ✓ pays desservi » sans qu'aucun pays ait été demandé est un
    // faux signal de pertinence : un critère satisfait là où il n'y a pas de
    // critère.
    const r = raisons({ demande: {}, observe: observeVide });
    assert.deepEqual(r, []);
  });

  it('distingue « jamais expédié » de « ne dessert pas »', () => {
    // Un fournisseur qui n'a jamais expédié n'a pas échoué : personne ne lui a
    // encore rien demandé.
    const jamais = raisons({ demande: { destination: 'CM' }, observe: observeVide })[0];
    assert.equal(jamais.state, 'NOT_MEASURED');
    assert.match(jamais.detail, /n’a encore expédié nulle part/);

    const ailleurs = raisons({
      demande: { destination: 'CM' },
      observe: { ...observeVide, servesDestination: false, servedCountries: ['TD', 'NG'] },
    })[0];
    assert.equal(ailleurs.state, 'NOT_MET');
    assert.match(ailleurs.detail, /TD, NG/);
  });

  it('un fournisseur sans historique d’expédition n’est jamais marqué « non satisfait »', () => {
    // Défaut trouvé en regardant la réponse réelle du serveur, pas le code :
    // la pastille affichait « ✗ » pendant que le texte de la même ligne disait
    // « n’a encore expédié nulle part ». Les deux se contredisaient, et c'est
    // la pastille qu'un acheteur lit en premier.
    const sansHistorique = raisons({
      demande: { destination: 'CM' },
      observe: { ...observeVide, servesDestination: false, servedCountries: [] },
    })[0];
    assert.equal(sansHistorique.state, 'NOT_MEASURED');
    assert.match(sansHistorique.detail, /n’a encore expédié nulle part/);
  });

  it('signale la vérification acquise même non demandée, mais pas son absence', () => {
    const verifie = raisons({ demande: {}, observe: { ...observeVide, verified: true } });
    assert.equal(verifie.length, 1);
    assert.equal(verifie[0].code, 'VERIFIED');
    assert.match(verifie[0].detail, /ne garantit pas la transaction/);

    // Non vérifié et non demandé : on ne met pas en avant une absence.
    assert.deepEqual(raisons({ demande: {}, observe: observeVide }), []);
    // Non vérifié mais exigé : on le dit.
    const exige = raisons({ demande: { verifiedOnly: true }, observe: observeVide });
    assert.equal(exige[0].state, 'NOT_MET');
  });

  it('ne signale pas une réputation absente', () => {
    // « Réputation : non mesurée » en tête de liste ferait passer un
    // fournisseur nouveau pour un mauvais choix. Il n'a pas une mauvaise note,
    // il n'en a pas.
    const sans = raisons({ demande: { destination: 'TD' }, observe: observeVide });
    assert.ok(!sans.some((r) => r.code === 'REPUTATION'));

    const avec = raisons({ demande: {}, observe: { ...observeVide, reputationScore: 72 } });
    assert.equal(avec[0].code, 'REPUTATION');
    assert.match(avec[0].detail, /72\/100/);
  });

  it('rend les raisons dans l’ordre de leur poids', () => {
    const r = raisons({
      demande: { destination: 'CM', minQuantity: 100, country: 'TD', category: 'textile' },
      observe: { ...observeVide, verified: true, servesDestination: true, servesRequestedQuantity: true, matchingProducts: 5, capacity: 500 },
    });
    const poids = r.map((x) => x.weight);
    assert.deepEqual([...poids].sort((a, b) => b - a), poids, 'la première ligne lue doit être celle qui a le plus décidé');
    assert.equal(r[0].code, 'DESTINATION');
  });
});

describe('Correspondance fournisseur — le classement est celui qu’on publie', () => {
  /**
   * Le point qui compte. Avant, les poids vivaient dans une fonction de tri
   * que personne ne voit ; les afficher séparément les aurait laissés diverger,
   * et les raisons auraient fini par expliquer un classement abandonné.
   */
  it('le score se reconstitue exactement depuis les poids publiés', () => {
    const observe = { ...observeVide, verified: true, servesDestination: true, servesRequestedQuantity: true, reputationScore: 50, trustScore: 100 };
    const attendu = POIDS.DESTINATION + POIDS.QUANTITY + POIDS.VERIFIED + 0.5 * POIDS.REPUTATION + 1 * POIDS.TRUST;
    assert.equal(scorePertinence(observe), attendu);
  });

  it('desservir la destination pèse plus qu’une réputation parfaite', () => {
    // Un fournisseur qui livre réellement là où l'acheteur veut être livré lui
    // est plus utile qu'un fournisseur mieux noté qui ne dessert pas sa province.
    const livre = scorePertinence({ ...observeVide, servesDestination: true });
    const bienNote = scorePertinence({ ...observeVide, reputationScore: 100, trustScore: 100 });
    assert.ok(livre > bienNote, `${livre} doit dépasser ${bienNote}`);
  });

  it('un score absent ne vaut pas zéro dans l’absolu, mais ne rapporte rien', () => {
    assert.equal(scorePertinence(observeVide), 0);
    assert.equal(scorePertinence({ ...observeVide, reputationScore: 0 }), 0);
  });

  it('l’avertissement dit ce qu’une correspondance n’est pas', () => {
    assert.match(AVERTISSEMENT, /n’est pas une garantie/);
    assert.match(AVERTISSEMENT, /observe/);
  });
});

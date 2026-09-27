import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SEUIL_PERIME_MS, SEUIL_RECENT_MS, fraicheur } from '../../src/touma/market/freshness.js';

/**
 * Fraîcheur d'un signal (V29 §41).
 *
 * Ce que ces tests fixent : **un chiffre sans âge se lit comme actuel**.
 * L'absence d'indication est elle-même une affirmation, et c'est celle-là que
 * §41 interdit — « ne jamais afficher *live* si les données ne sont pas live ».
 */
const MAINTENANT = new Date('2026-09-22T18:00:00Z');
const ilYA = (ms: number) => new Date(MAINTENANT.getTime() - ms);

describe('Fraîcheur — quatre états, et le dernier n’est pas une panne', () => {
  it('sans observation, ce n’est pas zéro : il n’y a rien à dater', () => {
    // Un produit sans commande observée n'a pas une demande nulle. Il n'a pas
    // de demande mesurée, et les deux mènent à des décisions opposées.
    const f = fraicheur(null, { windowDays: 30, maintenant: MAINTENANT });
    assert.equal(f.state, 'NO_DATA');
    assert.equal(f.ageSeconds, null);
    assert.equal(f.observedAt, null);
    assert.match(f.statement, /rien à dater/);
    assert.equal(f.windowDays, 30, 'la fenêtre demandée reste rendue, même sans donnée');
  });

  it('un calcul de l’instant est LIVE, et lui seul', () => {
    assert.equal(fraicheur(ilYA(5_000), { maintenant: MAINTENANT }).state, 'LIVE');
    // Deux minutes : déjà plus « live ».
    assert.equal(fraicheur(ilYA(120_000), { maintenant: MAINTENANT }).state, 'RECENT');
  });

  it('devient périmé au-delà d’une journée', () => {
    assert.equal(fraicheur(ilYA(SEUIL_RECENT_MS + 1_000), { maintenant: MAINTENANT }).state, 'RECENT');
    assert.equal(fraicheur(ilYA(SEUIL_PERIME_MS - 1_000), { maintenant: MAINTENANT }).state, 'RECENT');
    assert.equal(fraicheur(ilYA(SEUIL_PERIME_MS + 1_000), { maintenant: MAINTENANT }).state, 'STALE');
  });

  it('un signal périmé est rendu quand même, avec son âge', () => {
    // Le masquer laisserait croire qu'il n'y a rien à savoir. Périmé et daté
    // vaut mieux qu'absent.
    const f = fraicheur(ilYA(3 * SEUIL_PERIME_MS), { windowDays: 7, maintenant: MAINTENANT });
    assert.equal(f.state, 'STALE');
    assert.ok(f.ageSeconds && f.ageSeconds > 0, 'l’âge doit être rendu');
    assert.ok(f.observedAt, 'la date doit être rendue');
    assert.match(f.statement, /3 jours/);
    assert.match(f.statement, /pas comme un état actuel/);
  });

  it('ne rend jamais un âge négatif, même si l’horloge recule', () => {
    // Une observation « dans le futur » vient d'une horloge décalée, pas d'une
    // prédiction. Un âge négatif se propagerait dans tous les affichages.
    const f = fraicheur(new Date(MAINTENANT.getTime() + 60_000), { maintenant: MAINTENANT });
    assert.equal(f.ageSeconds, 0);
    assert.equal(f.state, 'LIVE');
  });

  it('écarte un horodatage illisible au lieu de rendre « Invalid Date »', () => {
    const f = fraicheur('pas une date', { maintenant: MAINTENANT });
    assert.equal(f.state, 'NO_DATA');
    assert.match(f.statement, /illisible/);
  });

  it('chaque état porte une phrase qui dit quoi en faire', () => {
    for (const instant of [null, ilYA(5_000), ilYA(2 * SEUIL_RECENT_MS), ilYA(5 * SEUIL_PERIME_MS)]) {
      const f = fraicheur(instant, { maintenant: MAINTENANT });
      // Seuil bas à dessein : « Calculé à l'instant. » est court et suffit.
      // Ce que le test refuse, c'est une phrase vide de sens, pas une phrase brève.
      assert.ok(f.statement.length > 18, `${f.state} : phrase trop courte`);
      assert.doesNotMatch(f.statement, /^OK|^Bon/i);
    }
  });
});

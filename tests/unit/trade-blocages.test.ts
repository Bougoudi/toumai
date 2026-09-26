import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { CODES_BLOCAGE, bloquantsALActivation, phraseFr, type Blocage } from '../../src/touma/trade/corridor-blocages.js';

/**
 * Ce qui bloque l'activation d'un corridor se décidait par recherche de
 * sous-chaîne dans une phrase française. Ces tests fixent les deux propriétés
 * que ce détour perdait : la décision ne dépend plus du texte, et le texte
 * existe dans les deux langues.
 */
describe('Corridors — motifs de blocage', () => {
  it('« suspendu » et « pas encore ouvert » n’empêchent pas une activation, les autres si', () => {
    // Activer un corridor, c'est précisément lever ces deux états-là : les
    // compter bloquants rendrait l'opération impossible puisque l'un des deux
    // est toujours vrai juste avant.
    assert.deepEqual(bloquantsALActivation([{ code: 'CORRIDOR_SUSPENDED' }, { code: 'CORRIDOR_NOT_YET_OPEN' }]), []);

    const reste = CODES_BLOCAGE.filter((c) => c !== 'CORRIDOR_SUSPENDED' && c !== 'CORRIDOR_NOT_YET_OPEN');
    for (const code of reste) {
      assert.deepEqual(
        bloquantsALActivation([{ code }, { code: 'CORRIDOR_SUSPENDED' }]),
        [{ code }],
        `${code} devrait rester bloquant`,
      );
    }
  });

  it('la décision ne dépend pas de la phrase française', () => {
    // Le point de tout le changement. Auparavant, remplacer l'apostrophe
    // typographique de « n’est pas encore ouvert » par une apostrophe droite
    // suffisait à rendre le motif bloquant — sans qu'aucun test ne bouge.
    // Ici on vérifie l'indépendance là où elle se joue : `bloquantsALActivation`
    // ne reçoit que des codes, et son résultat est identique quelle que soit
    // la phrase que `phraseFr` produirait.
    const blocage: Blocage = { code: 'CORRIDOR_NOT_YET_OPEN' };
    assert.deepEqual(bloquantsALActivation([blocage]), []);
    assert.notEqual(phraseFr(blocage), '');
  });

  it('chaque code a une phrase française, et aucun paramètre n’y reste vide', () => {
    const exemples: Record<string, Record<string, string>> = {
      CORRIDOR_NOT_CONFIGURED: { origin: 'TD', destination: 'NG' },
      ORIGIN_TRADE_DISABLED: { country: 'TD' },
      DESTINATION_TRADE_DISABLED: { country: 'CM' },
      ONLY_SIMULATED_CARRIER: { providers: 'mock' },
    };
    for (const code of CODES_BLOCAGE) {
      const phrase = phraseFr({ code, params: exemples[code] });
      assert.ok(phrase.length > 10, `${code} : phrase trop courte`);
      assert.doesNotMatch(phrase, /undefined|\{[a-z]+\}/, `${code} : paramètre non substitué — « ${phrase} »`);
    }
  });

  /**
   * Un code que le serveur émet mais qu'aucun dictionnaire ne connaît
   * s'afficherait tel quel — `NO_DECLARED_CURRENCY` au milieu d'une page.
   * Ajouter un motif sans le traduire doit faire échouer ce test, pas la page.
   */
  it('chaque code est traduit dans l’application, en français et en arabe', () => {
    const source = readFileSync(new URL('../../public/touma/i18n.js', import.meta.url), 'utf8');
    for (const code of CODES_BLOCAGE) {
      const occurrences = [...source.matchAll(new RegExp(`'trade\\.blocker\\.${code}':`, 'g'))].length;
      assert.equal(occurrences, 2, `trade.blocker.${code} : attendu une fois en français et une fois en arabe`);
    }
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSensitiveKey, redact, redactedExcerpt, redactPatterns, REDACTED } from '../../src/touma/lib/redact.js';

/**
 * La V20 §21 interdit de journaliser un numéro de carte, un CVV, un code
 * secret mobile money, un secret de prestataire ou un jeton. Ces tests
 * vérifient que l'interdiction tient sur les deux chemins : le nom du champ, et
 * la forme de la valeur quand le champ ne dit rien.
 */
describe('rédaction des données sensibles', () => {
  it('reconnaît un nom de champ sensible quelle que soit son écriture', () => {
    for (const key of ['cvv', 'CVC', 'card_number', 'cardNumber', 'CARD-NUMBER', 'pin', 'access_token', 'apiKey', 'providerSecret']) {
      assert.equal(isSensitiveKey(key), true, `${key} devrait être masqué`);
    }
  });

  it('ne masque pas un champ anodin dont le nom contient un fragment', () => {
    for (const key of ['pinned', 'panier', 'total', 'orderNumber', 'currency']) {
      assert.equal(isSensitiveKey(key), false, `${key} ne devrait pas être masqué`);
    }
  });

  it('masque la valeur, pas la clé : on sait qu’un champ existait', () => {
    const out = redact({ method: 'CARD', cvv: '123', card: { cardNumber: '4111111111111111' } }) as any;
    assert.equal(out.method, 'CARD');
    assert.equal(out.cvv, REDACTED);
    assert.equal(out.card.cardNumber, REDACTED);
  });

  it('masque un numéro de carte porté par un champ au nom anodin', () => {
    const out = redact({ note: 'le client a payé avec 4111 1111 1111 1111 hier' }) as any;
    assert.ok(out.note.includes(REDACTED), 'le numéro de carte doit disparaître');
    assert.ok(out.note.includes('hier'), 'le reste de la note doit rester lisible');
  });

  it('laisse passer une suite de chiffres qui n’est pas une carte', () => {
    // Un numéro de commande long ne passe pas le test de Luhn : le masquer
    // rendrait les journaux inutilisables pour retrouver une commande.
    const out = redactPatterns('commande 1234567890123 reçue');
    assert.ok(out.includes('1234567890123'));
  });

  it('masque un jeton porteur, un JWT et une clé de prestataire', () => {
    assert.ok(redactPatterns('Authorization: Bearer abc.def-ghi_jkl').includes(REDACTED));
    assert.ok(redactPatterns('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijkl').includes(REDACTED));
    assert.ok(redactPatterns('clé sk_live_abcdefgh12345678 fournie').includes(REDACTED));
    assert.ok(redactPatterns('secret whsec_abcdefgh12345678').includes(REDACTED));
  });

  it('borne la récursion : un objet hostile ne fait pas déborder la pile', () => {
    // Un corps de webhook arrive d'un tiers non authentifié : l'imbrication
    // n'est pas plafonnée par la bienveillance de l'appelant.
    let deep: any = { bout: 'atteint' };
    for (let i = 0; i < 200; i += 1) deep = { niveau: deep };
    assert.doesNotThrow(() => redact(deep));
  });

  it('borne la taille de l’extrait d’un corps brut', () => {
    const gros = JSON.stringify({ texte: 'a'.repeat(50_000) });
    const extrait = redactedExcerpt(gros, 500);
    assert.ok(extrait.length <= 520, `extrait trop long : ${extrait.length}`);
    assert.ok(extrait.endsWith('…[tronqué]'));
  });

  it('conserve un corps illisible plutôt que de le perdre, mais le rédige', () => {
    // Le corps non-JSON est précisément celui qu'on voudra relire après une
    // tentative de forge.
    const extrait = redactedExcerpt('<<pas du json>> Bearer zzzzzzzzzzzz');
    assert.ok(extrait.includes('pas du json'));
    assert.ok(extrait.includes(REDACTED));
  });

  it('rédige les champs sensibles d’un corps JSON valide', () => {
    const extrait = redactedExcerpt(JSON.stringify({ id: 'evt_1', secret: 'très-secret', montant: '1000' }));
    assert.ok(extrait.includes('evt_1'));
    assert.ok(extrait.includes('1000'));
    assert.ok(!extrait.includes('très-secret'));
  });
});

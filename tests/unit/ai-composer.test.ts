import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compose } from '../../src/touma/ai/agents/composer.js';
import type { ToolCallOutcome } from '../../src/touma/ai/tools/runner.js';

/**
 * Le rédacteur, éprouvé sans base de données.
 *
 * Ces cas étaient jusqu'ici couverts seulement par un test d'intégration, donc
 * par ce que contenait la base au moment de l'exécution. L'un d'eux passait en
 * local et échouait en intégration continue — non par flottement, mais parce
 * que le référentiel géographique y est absent, et que le code se comportait
 * réellement différemment. Éprouver le rédacteur sur des résultats d'outils
 * fabriqués retire la base de l'équation.
 */

function outil(tool: string, data: unknown, summary = ''): ToolCallOutcome {
  return { tool, ok: true, data, summary, latencyMs: 1 };
}

const contexte = { fallback: true, providerMessage: null };

describe('Rédaction d’une recherche', () => {
  const produits = outil('searchProducts', {
    total: 1,
    items: [{ id: 'p1', title: 'Téléphone', price: '45000', currency: 'XAF', store: { name: 'Boutique', verified: false }, inStock: true, ratingCount: 0, rating: 0 }],
  });

  it('avertit du délai inconnu quand la province est reconnue', () => {
    const r = compose('SEARCH_PRODUCTS', '', [produits, outil('checkProvinceAvailability', { found: true, province: { id: 'x', name: 'N’Djamena' } })], contexte);
    assert.ok(r.unavailable.some((u) => /délai/i.test(u)), r.unavailable.join(' | '));
    assert.match(r.unavailable.join(' '), /N’Djamena/);
  });

  it('avertit du délai inconnu **aussi** quand la destination n’est pas reconnue', () => {
    // Le défaut relevé par l'intégration continue : sur une base sans
    // référentiel géographique, la mise en garde sur le délai disparaissait
    // entièrement — alors que le délai est inconnu dans les deux cas.
    const r = compose('SEARCH_PRODUCTS', '', [produits, outil('checkProvinceAvailability', { found: false, province: null })], contexte);
    assert.ok(r.unavailable.some((u) => /délai/i.test(u)), r.unavailable.join(' | '));
    assert.ok(r.unavailable.some((u) => /ne correspond à aucune province/i.test(u)));
  });

  it('n’invente aucun délai chiffré dans le texte', () => {
    const r = compose('SEARCH_PRODUCTS', '', [produits, outil('checkProvinceAvailability', { found: true, province: { id: 'x', name: 'Guéra' } })], contexte);
    assert.doesNotMatch(r.text, /\b\d+\s*(jours?|semaines?|heures?)\b/);
  });

  it('dit « information non disponible » sur un catalogue vide', () => {
    const r = compose('SEARCH_PRODUCTS', '', [outil('searchProducts', { total: 0, items: [] })], contexte);
    assert.match(r.text, /Information non disponible/i);
    assert.equal(r.cards.length, 0);
  });

  it('affiche « aucun avis » plutôt qu’une note de zéro', () => {
    const r = compose('SEARCH_PRODUCTS', '', [produits], contexte);
    assert.match(r.text, /aucun avis/i);
    assert.doesNotMatch(r.text, /0[.,]0\/5/);
  });
});

describe('Rédaction des dépenses', () => {
  const ceMois = new Date();

  it('ne somme jamais deux devises', () => {
    const r = compose(
      'SPENDING',
      '',
      [
        outil('listMyOrders', {
          total: 2,
          items: [
            { id: 'a', orderNumber: 'A', status: 'DELIVERED', total: '50000', currency: 'XAF', createdAt: ceMois },
            { id: 'b', orderNumber: 'B', status: 'DELIVERED', total: '80', currency: 'EUR', createdAt: ceMois },
          ],
        }),
      ],
      contexte,
    );
    assert.match(r.text, /50000 XAF/);
    assert.match(r.text, /80 EUR/);
    // 50 080 serait le total d'une addition que rien n'autorise.
    assert.doesNotMatch(r.text, /50080|50 080/);
    assert.match(r.text, /pas additionnées/i);
  });

  it('exclut les commandes annulées', () => {
    const r = compose(
      'SPENDING',
      '',
      [
        outil('listMyOrders', {
          total: 2,
          items: [
            { id: 'a', orderNumber: 'A', status: 'DELIVERED', total: '50000', currency: 'XAF', createdAt: ceMois },
            { id: 'b', orderNumber: 'B', status: 'CANCELLED', total: '30000', currency: 'XAF', createdAt: ceMois },
          ],
        }),
      ],
      contexte,
    );
    assert.match(r.text, /50000 XAF/);
    assert.doesNotMatch(r.text, /80000/);
  });
});

describe('Rédaction d’un suivi de commande', () => {
  it('distingue l’absence d’information d’un retard', () => {
    const r = compose(
      'ORDER_STATUS',
      '',
      [
        outil('getOrder', { id: 'o1', orderNumber: 'T-1', status: 'CONFIRMED', total: '45000', currency: 'XAF' }),
        outil('getOrderTracking', { events: [] }),
      ],
      contexte,
    );
    assert.match(r.text, /absence d’information, pas un retard/i);
    assert.ok(r.unavailable.some((u) => /date de livraison prévue/i.test(u)));
  });
});

describe('Les refus d’outils sont dits, pas dissimulés', () => {
  it('reprend le message du service métier', () => {
    const refus: ToolCallOutcome = { tool: 'getOrder', ok: false, summary: 'x', error: 'Commande introuvable.', latencyMs: 1 };
    const r = compose('ORDER_STATUS', '', [refus], contexte);
    assert.match(r.text, /Commande introuvable/);
  });
});

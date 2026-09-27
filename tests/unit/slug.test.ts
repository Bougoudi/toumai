import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { slugify, uniqueSlug } from '../../src/touma/lib/slug.js';

describe('Slugs', () => {
  it('supprime accents, ponctuation et majuscules', () => {
    assert.equal(slugify('Sésame blanc du Tchad — sac de 25 kg'), 'sesame-blanc-du-tchad-sac-de-25-kg');
    assert.equal(slugify("Côte d'Ivoire"), 'cote-d-ivoire');
  });

  it('évite les collisions en suffixant', async () => {
    const taken = new Set(['pagne-wax', 'pagne-wax-2']);
    assert.equal(await uniqueSlug('Pagne wax', async (s) => taken.has(s)), 'pagne-wax-3');
  });

  it('produit toujours un slug non vide', () => {
    assert.equal(slugify('!!!'), '');
    assert.equal(slugify('Boubou'), 'boubou');
  });
});

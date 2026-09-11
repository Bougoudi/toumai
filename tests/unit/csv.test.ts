import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeHeader, parseCsv, parseCsvObjects, toCsv } from '../../src/touma/catalog/csv.js';

/**
 * Analyse CSV. Le fichier qui arrive n'est pas un CSV idéal : c'est ce qu'un
 * tableur a produit, avec ses guillemets, son BOM et son point-virgule.
 */
describe('Lecture CSV', () => {
  it('lit un CSV simple', () => {
    assert.deepEqual(parseCsv('a,b\n1,2'), [
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('accepte le point-virgule des tableurs francophones', () => {
    assert.deepEqual(parseCsv('titre;prix\nCacao;1500'), [
      ['titre', 'prix'],
      ['Cacao', '1500'],
    ]);
  });

  it('ne se laisse pas tromper par une virgule entre guillemets', () => {
    const rows = parseCsv('titre,prix\n"Cacao, fèves",1500');
    assert.deepEqual(rows[1], ['Cacao, fèves', '1500']);
  });

  it('gère les guillemets doublés et les retours à la ligne dans une cellule', () => {
    const rows = parseCsv('titre,description\n"Sac 50""","Ligne 1\nLigne 2"');
    assert.equal(rows[1][0], 'Sac 50"');
    assert.equal(rows[1][1], 'Ligne 1\nLigne 2');
  });

  it('ignore le BOM d’Excel et les lignes vides', () => {
    const rows = parseCsv('﻿titre,prix\n\nCacao,1500\n');
    assert.equal(rows[0][0], 'titre', 'le BOM ne colle pas au premier en-tête');
    assert.equal(rows.length, 2, 'la ligne vide n’est pas une donnée');
  });

  it('normalise les en-têtes quels que soient accents, casse et espaces', () => {
    assert.equal(normalizeHeader('Prix de vente'), 'prix_de_vente');
    assert.equal(normalizeHeader(' Quantité Minimale '), 'quantite_minimale');
    assert.equal(normalizeHeader('SKU'), 'sku');
  });

  it('transforme en objets à partir des en-têtes', () => {
    const rows = parseCsvObjects('Titre;Prix\nCacao;1500');
    assert.deepEqual(rows, [{ titre: 'Cacao', prix: '1500' }]);
  });
});

describe('Écriture CSV', () => {
  it('échappe ce qui doit l’être et se relit', () => {
    const csv = toCsv(['titre', 'description'], [{ titre: 'Sac; 50 kg', description: 'Dit "premier choix"' }]);
    const rows = parseCsv(csv);
    assert.deepEqual(rows[0], ['titre', 'description']);
    assert.deepEqual(rows[1], ['Sac; 50 kg', 'Dit "premier choix"']);
  });

  it('écrit un BOM pour qu’Excel ouvre le fichier sans assistant', () => {
    assert.ok(toCsv(['a'], []).startsWith('﻿'));
  });
});

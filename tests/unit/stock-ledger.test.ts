import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { liberationExcedentaire } from '../../src/touma/inventory/stock.service.js';

/**
 * Le journal des mouvements de stock (V27 §3).
 *
 * Ce fichier fixe une propriété d'architecture, pas un comportement : **rien
 * ne modifie le stock hors du point de passage unique**. C'est la seule façon
 * de garantir que le journal est complet — un chemin oublié ne produit pas une
 * erreur, il produit un trou silencieux, et on ne le découvre que le jour où
 * un vendeur demande d'où vient son écart.
 */
describe('Stock — un seul point de passage', () => {
  it('aucun fichier hors du service de stock ne modifie la table d\u2019inventaire', () => {
    // Balayage du code plutôt qu'une relecture : une règle qu'on doit se
    // rappeler d'appliquer n'est pas une règle. Celle-ci échoue toute seule.
    const racine = fileURLToPath(new URL('../../src/', import.meta.url));

    /** Fichiers autorisés à toucher la table, et pourquoi. */
    const AUTORISES = new Map([
      ['touma/inventory/stock.service.ts', 'le point de passage unique'],
      // Ceux-ci **lisent** la table en SQL. Lire n'est pas écrire.
      ['touma/admin/integrity.service.ts', 'contrôles d\u2019intégrité, en lecture'],
      ['touma/ai/jobs.ts', 'jointure de lecture pour les suggestions'],
    ]);

    const ECRITURES = /toumaInventory\s*\.\s*(create|update|updateMany|upsert|delete|deleteMany)|UPDATE\s+"touma_inventory"|INSERT\s+INTO\s+"touma_inventory"|DELETE\s+FROM\s+"touma_inventory"/;

    const fautifs: string[] = [];
    const parcourir = (dossier: string) => {
      for (const entree of readdirSync(dossier, { withFileTypes: true })) {
        const chemin = join(dossier, entree.name);
        if (entree.isDirectory()) {
          parcourir(chemin);
          continue;
        }
        if (!entree.name.endsWith('.ts')) continue;
        const relatif = relative(racine, chemin).split(sep).join('/');
        if (AUTORISES.has(relatif)) continue;
        if (ECRITURES.test(readFileSync(chemin, 'utf8'))) fautifs.push(relatif);
      }
    };
    parcourir(racine);

    assert.deepEqual(
      fautifs,
      [],
      'Ces fichiers modifient le stock sans passer par src/touma/inventory/stock.service.ts :\n' + fautifs.join('\n'),
    );
  });
});

describe('Stock — détection d’une libération de trop', () => {
  it('reconnaît l’écart entre ce qui était demandé et ce qui a été appliqué', () => {
    // Le plancher `GREATEST(… , 0)` rend l'excédent inoffensif. Il le rendait
    // aussi invisible : c'est tout le point de comparer les deux.
    assert.equal(liberationExcedentaire({ reservedDelta: -3 }, 3), false, 'libération exacte');
    assert.equal(liberationExcedentaire({ reservedDelta: -1 }, 3), true, 'il n’y avait qu’une unité à libérer sur trois');
    assert.equal(liberationExcedentaire({ reservedDelta: 0 }, 1), true, 'le compteur était déjà à zéro');
  });
});

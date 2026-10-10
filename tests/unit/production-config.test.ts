import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { configurationFaible } from '../../src/config/production-guard.js';

/**
 * CONFIGURATION DE PRODUCTION (V25 §3).
 *
 * Ce contrôle est la dernière chose qui sépare un déploiement mal configuré
 * d'un déploiement qui signe des jetons avec une valeur publiée dans ce
 * dépôt. Il est donc éprouvé sur des valeurs **forcées**, jamais sur
 * l'environnement de la machine qui exécute les tests : le client Prisma
 * charge le `.env` du dépôt à l'import, si bien qu'un essai naïf hérite de
 * secrets que l'environnement ne porte pas — et conclut, à tort, que le
 * contrôle ne se déclenche jamais.
 */

const FORT = 'x'.repeat(40);

/** Environnement de production correct, dont chaque cas s'écarte d'un cran. */
function correcte(modifications: Record<string, string | null> = {}) {
  const base: Record<string, string> = {
    JWT_SECRET: FORT,
    ENCRYPTION_KEY: FORT,
    DATABASE_URL: 'postgresql://touma@db:5432/touma',
  };
  for (const [k, v] of Object.entries(modifications)) {
    if (v === null) delete base[k];
    else base[k] = v;
  }
  return configurationFaible({
    defini: (nom) => nom in base,
    // Les variables dérivées héritent de JWT_SECRET, comme la configuration réelle.
    valeur: (nom) => base[nom] ?? base.JWT_SECRET ?? '',
    databaseUrl: base.DATABASE_URL ?? 'file:./dev.db',
  });
}

describe('Démarrage en production', () => {
  it('accepte une configuration complète', () => {
    assert.deepEqual(correcte(), []);
  });

  it('refuse un secret absent', () => {
    assert.match(correcte({ JWT_SECRET: null }).join(' '), /JWT_SECRET \(absent\)/);
    assert.match(correcte({ ENCRYPTION_KEY: null }).join(' '), /ENCRYPTION_KEY \(absent\)/);
  });

  it('refuse la valeur de développement publiée dans ce dépôt', () => {
    // `dev-secret-change-me` est lisible par quiconque clone le dépôt : un
    // jeton signé avec elle est un jeton que n'importe qui peut forger.
    assert.match(correcte({ JWT_SECRET: 'dev-secret-change-me' }).join(' '), /valeur de développement publiée/);
  });

  it('refuse un secret trop court', () => {
    assert.match(correcte({ JWT_SECRET: 'court' }).join(' '), /32 caractères/);
  });

  it('refuse un secret dérivé présent mais faible', () => {
    // Le trou d'origine : ces trois variables n'étaient pas contrôlées. Une
    // seule d'entre elles remplace silencieusement un secret fort par un
    // secret court, sans que rien ne le signale.
    for (const nom of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'TOUMA_PAYMENT_WEBHOOK_SECRET']) {
      assert.match(correcte({ [nom]: 'court' }).join(' '), new RegExp(nom), `${nom} doit être contrôlé`);
    }
  });

  it('laisse passer un secret dérivé absent : il hérite d’un secret déjà contrôlé', () => {
    assert.deepEqual(correcte({ JWT_ACCESS_SECRET: null, TOUMA_PAYMENT_WEBHOOK_SECRET: null }), []);
  });

  it('refuse une base qui n’est pas PostgreSQL', () => {
    // Démarrer sur le fichier SQLite de repli créerait une base vide que
    // personne ne sauvegarde, et dont la disparition passerait pour une panne.
    assert.match(correcte({ DATABASE_URL: 'file:./dev.db' }).join(' '), /PostgreSQL attendu/);
    assert.match(correcte({ DATABASE_URL: null }).join(' '), /DATABASE_URL \(absent\)/);
  });

  it('ne répète jamais la valeur d’un secret dans son motif de refus', () => {
    // Un extrait de secret dans un journal d'incident est un secret dans un
    // journal d'incident.
    const motifs = correcte({ JWT_SECRET: 'secret-tres-reconnaissable' }).join(' ');
    assert.ok(!motifs.includes('secret-tres-reconnaissable'), 'le motif ne doit pas citer la valeur');
  });
});

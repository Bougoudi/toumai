/**
 * Amorçage de l'environnement de test, chargé AVANT tout autre module
 * (`node --import tsx --import ./tests/env.ts`).
 *
 * - `NODE_ENV=test` neutralise la limitation de débit, qui fausserait les
 *   scénarios enchaînant des dizaines de connexions ;
 * - `TEST_DATABASE_URL` isole les tests de la base de développement : ils
 *   créent et suppriment des données réelles, jamais dans votre base de travail.
 */
import 'dotenv/config';

process.env.NODE_ENV = 'test';
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL (ou TEST_DATABASE_URL) est requis pour exécuter les tests.');
}

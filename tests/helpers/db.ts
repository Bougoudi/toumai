import { execSync } from 'node:child_process';
import { prisma } from '../../src/db/prisma.js';

/**
 * Préparation de la base de test. Applique les migrations une seule fois par
 * exécution, puis garantit la présence du référentiel minimal (pays, catégorie).
 */
let migrated = false;

export function ensureSchema(): void {
  if (migrated) return;
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });
  migrated = true;
}

/** Référentiel minimal requis par les tests (corridor pilote). */
export async function ensureReferenceData(): Promise<void> {
  for (const c of [
    { code: 'TD', name: 'Tchad', currency: 'XAF', dialCode: '+235' },
    { code: 'CM', name: 'Cameroun', currency: 'XAF', dialCode: '+237' },
  ]) {
    await prisma.country.upsert({
      where: { code: c.code },
      update: { active: true, buyingEnabled: true, sellingEnabled: true },
      create: { ...c, active: true, buyingEnabled: true, sellingEnabled: true },
    });
  }
  // Un pays fermé, pour vérifier que Touma refuse bien d'y vendre/livrer.
  await prisma.country.upsert({
    where: { code: 'ZW' },
    update: { active: false },
    create: { code: 'ZW', name: 'Zimbabwe', currency: 'USD', dialCode: '+263', active: false, buyingEnabled: false, sellingEnabled: false },
  });
  await prisma.toumaCategory.upsert({
    where: { slug: 'test-agroalimentaire' },
    update: {},
    create: { name: 'Test agroalimentaire', slug: 'test-agroalimentaire', segment: 'BOTH' },
  });
}

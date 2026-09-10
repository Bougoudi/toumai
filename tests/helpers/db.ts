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

/**
 * Les fichiers de test s'exécutent en parallèle : deux d'entre eux peuvent créer
 * la même ligne de référentiel au même instant. `upsert` ne protège pas de cette
 * course (les deux lisent « absent » puis insèrent) : on tolère explicitement la
 * violation de contrainte d'unicité, qui signifie simplement « un autre fichier
 * de test vient de la créer ».
 */
async function ignoreDuplicate(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'P2002') throw err;
  }
}

/** Référentiel minimal requis par les tests (corridor pilote). */
export async function ensureReferenceData(): Promise<void> {
  const countries = [
    { code: 'TD', name: 'Tchad', currency: 'XAF', dialCode: '+235', active: true },
    { code: 'CM', name: 'Cameroun', currency: 'XAF', dialCode: '+237', active: true },
    // Un pays fermé, pour vérifier que Touma refuse bien d'y vendre ou d'y livrer.
    { code: 'ZW', name: 'Zimbabwe', currency: 'USD', dialCode: '+263', active: false },
  ];
  for (const c of countries) {
    await ignoreDuplicate(() =>
      prisma.country.upsert({
        where: { code: c.code },
        update: { active: c.active, buyingEnabled: c.active, sellingEnabled: c.active },
        create: { ...c, buyingEnabled: c.active, sellingEnabled: c.active },
      }),
    );
  }
  await ignoreDuplicate(() =>
    prisma.toumaCategory.upsert({
      where: { slug: 'test-agroalimentaire' },
      update: {},
      create: { name: 'Test agroalimentaire', slug: 'test-agroalimentaire', segment: 'BOTH' },
    }),
  );
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, type LocalityType } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

/**
 * Chargement de la géographie administrative depuis le jeu de données versionné.
 *
 * **Pourquoi ce fichier existe.** Une localisation était jusqu'ici une chaîne
 * saisie à la main. « N'Djamena », « Ndjamena » et « N’Djaména » étaient trois
 * villes différentes pour la base : aucun regroupement, aucun filtre par
 * province, aucune statistique nationale n'était possible.
 *
 * **Ce que ce chargeur ne fait jamais.** Il n'invente rien. Ce que la source ne
 * dit pas reste nul : les localités sans département sortent sans département,
 * les noms arabes absents restent absents, et les sous-préfectures — qu'aucune
 * source exploitable ne donne pour le Tchad — ne sont pas fabriquées. Les
 * limites sont écrites dans `docs/chad-geography-sources.md`.
 *
 * **Il est idempotent.** Rejouer `prisma db seed` ne duplique rien : chaque
 * niveau a une clé stable (code officiel pour les provinces et départements,
 * identifiant de source pour les localités).
 */

/** Emplacement du jeu de données versionné, relatif à la racine du dépôt. */
const DATASET = join(process.cwd(), 'prisma', 'seed-data', 'chad-geography.tsv');

export interface GeographyStats {
  provinces: number;
  departments: number;
  localities: number;
  /** Localités que la source ne rattache à aucun département. */
  localitiesWithoutDepartment: number;
  /**
   * Localités écartées faute de province identifiable — la source leur donne le
   * code « 00 », c'est-à-dire « non assignée ». Les rattacher à une province
   * voisine serait une invention ; les taire ferait disparaître une perte de
   * données. On les compte.
   */
  localitiesSkipped: number;
}

const LOCALITY_TYPES = new Set<string>(['CITY', 'TOWN', 'DISTRICT', 'VILLAGE', 'RURAL_AREA', 'LOCALITY', 'OTHER']);

/** Une valeur vide dans la source veut dire « inconnu », jamais « vide ». */
const orNull = (value: string | undefined): string | null => (value && value.length > 0 ? value : null);

const decimalOrNull = (value: string | undefined): Prisma.Decimal | null =>
  value && value.length > 0 && Number.isFinite(Number(value)) ? new Prisma.Decimal(value) : null;

/**
 * Charge la géographie d'un pays. Le pays doit déjà exister : c'est lui qui
 * porte la devise, l'indicatif et le fuseau, et la géographie s'y accroche.
 */
export async function loadGeography(countryCode: string, datasetPath = DATASET): Promise<GeographyStats> {
  const raw = readFileSync(datasetPath, 'utf8');
  const rows = raw.split('\n').filter((l) => l.length > 0 && !l.startsWith('#'));

  const stats: GeographyStats = { provinces: 0, departments: 0, localities: 0, localitiesWithoutDepartment: 0, localitiesSkipped: 0 };

  // Province : clé (pays, code officiel).
  const provinceIdByCode = new Map<string, string>();
  for (const line of rows) {
    const f = line.split('\t');
    if (f[0] !== 'P') continue;
    const [, code, name, nameAr, sourceId] = f;
    const province = await prisma.toumaProvince.upsert({
      where: { countryCode_code: { countryCode, code } },
      update: { name, nameAr: orNull(nameAr), sourceId: orNull(sourceId) },
      create: { countryCode, code, name, nameAr: orNull(nameAr), sourceId: orNull(sourceId) },
      select: { id: true },
    });
    provinceIdByCode.set(code, province.id);
    stats.provinces += 1;
  }

  // Département : clé (province, code officiel).
  const departmentIdByKey = new Map<string, string>();
  for (const line of rows) {
    const f = line.split('\t');
    if (f[0] !== 'D') continue;
    const [, code, provinceCode, name, nameAr, sourceId] = f;
    const provinceId = provinceIdByCode.get(provinceCode);
    // Un département dont la province est absente est ignoré plutôt que
    // rattaché arbitrairement : mieux vaut une donnée manquante qu'une fausse.
    if (!provinceId) continue;
    const department = await prisma.toumaDepartment.upsert({
      where: { provinceId_code: { provinceId, code } },
      update: { name, nameAr: orNull(nameAr), sourceId: orNull(sourceId) },
      create: { provinceId, code, name, nameAr: orNull(nameAr), sourceId: orNull(sourceId) },
      select: { id: true },
    });
    departmentIdByKey.set(`${provinceCode}.${code}`, department.id);
    stats.departments += 1;
  }

  // Localités : douze mille lignes. On les écrit par lots, et on ne les relit
  // pas une par une — `skipDuplicates` rend l'opération rejouable.
  const existing = new Set(
    (
      await prisma.toumaLocality.findMany({
        where: { province: { countryCode } },
        select: { sourceId: true },
      })
    )
      .map((l) => l.sourceId)
      .filter((s): s is string => Boolean(s)),
  );

  const batch: Prisma.ToumaLocalityCreateManyInput[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    await prisma.toumaLocality.createMany({ data: batch, skipDuplicates: true });
    batch.length = 0;
  };

  for (const line of rows) {
    const f = line.split('\t');
    if (f[0] !== 'L') continue;
    const [, sourceId, provinceCode, departmentCode, name, nameAr, type, latitude, longitude, population] = f;
    const provinceId = provinceIdByCode.get(provinceCode);
    if (!provinceId) {
      stats.localitiesSkipped += 1;
      continue;
    }

    if (!departmentCode) stats.localitiesWithoutDepartment += 1;
    stats.localities += 1;
    if (existing.has(sourceId)) continue;

    batch.push({
      provinceId,
      departmentId: departmentCode ? (departmentIdByKey.get(`${provinceCode}.${departmentCode}`) ?? null) : null,
      name,
      nameAr: orNull(nameAr),
      type: (LOCALITY_TYPES.has(type) ? type : 'LOCALITY') as LocalityType,
      sourceId,
      latitude: decimalOrNull(latitude),
      longitude: decimalOrNull(longitude),
      population: population && population.length > 0 ? Number(population) : null,
    });
    if (batch.length >= 1000) await flush();
  }
  await flush();

  return stats;
}

/** Le jeu de données est-il présent ? (Le seed doit pouvoir le dire, pas planter.) */
export function geographyDatasetPath(): string {
  return DATASET;
}

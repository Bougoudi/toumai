import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { uniqueSlug } from '../lib/slug.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';
import { parseCsvObjects, toCsv } from './csv.js';

/**
 * IMPORT ET EXPORT DE CATALOGUE.
 *
 * Un grossiste qui a deux cents références ne les saisira pas une par une :
 * sans import en masse, il ne met pas son catalogue en ligne, et la place de
 * marché reste vide. C'est un sujet d'adoption, pas de confort.
 *
 * Deux principes :
 *
 * 1. **Rien n'est écrit avant que le vendeur ait vu le résultat.** L'import se
 *    fait en deux temps : une simulation qui rend un diagnostic ligne par
 *    ligne, puis l'application. Un fichier à moitié importé, avec des erreurs
 *    découvertes après coup, coûterait plus cher à réparer qu'à ressaisir.
 * 2. **Une ligne fautive n'emporte pas les autres.** Chaque ligne est validée
 *    isolément ; l'application n'écrit que les lignes valides et rend la liste
 *    exacte de celles qui ont été rejetées, avec le motif.
 */

/** Colonnes reconnues, avec leurs synonymes français et anglais. */
const COLUMNS: Record<string, string[]> = {
  sku: ['sku', 'reference', 'ref', 'code'],
  title: ['title', 'titre', 'nom', 'designation', 'produit', 'name'],
  description: ['description', 'descriptif'],
  brand: ['brand', 'marque'],
  price: ['price', 'prix', 'prix_de_vente', 'prix_unitaire'],
  compareAtPrice: ['compare_at_price', 'prix_barre', 'ancien_prix'],
  currency: ['currency', 'devise'],
  category: ['category', 'categorie', 'category_slug'],
  quantity: ['quantity', 'quantite', 'stock'],
  minOrderQty: ['min_order_qty', 'quantite_minimale', 'minimum', 'moq'],
  weightGrams: ['weight_grams', 'poids_grammes', 'poids'],
  keywords: ['keywords', 'mots_cles'],
  status: ['status', 'statut'],
  imageUrl: ['image_url', 'image', 'photo'],
};

/** En-têtes du fichier d'export, qui sont aussi ceux attendus à l'import. */
export const EXPORT_HEADERS = [
  'sku',
  'titre',
  'description',
  'marque',
  'prix',
  'devise',
  'categorie',
  'stock',
  'quantite_minimale',
  'poids_grammes',
  'mots_cles',
  'statut',
  'image_url',
];

const MAX_ROWS = 500;

/** Retrouve une colonne quels que soient le libellé et la langue employés. */
function pick(row: Record<string, string>, field: keyof typeof COLUMNS): string {
  for (const alias of COLUMNS[field]) {
    const value = row[alias];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

/** Nombre tolérant : « 12 000,50 » et « 12000.50 » désignent le même montant. */
function toNumber(value: string): number | null {
  if (!value) return null;
  const normalized = value.replace(/\s/g, '').replace(/ /g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface ImportRowResult {
  line: number;
  sku: string | null;
  title: string | null;
  action: 'create' | 'update' | 'error';
  message?: string;
  productId?: string;
}

/**
 * Valide un fichier et, si `dryRun` est faux, applique les lignes valides.
 * La simulation et l'application partagent exactement le même code de
 * validation : ce que le vendeur a vu est ce qui sera écrit.
 */
export async function importCatalogue(
  user: ToumaRequestUser,
  storeId: string,
  csv: string,
  options: { dryRun: boolean },
) {
  const store = await prisma.toumaStore.findUnique({ where: { id: storeId }, include: { country: true } });
  if (!store) throw notFound('Boutique introuvable.');
  if (store.ownerId !== user.id && user.role !== 'ADMIN') throw notFound('Boutique introuvable.');

  const rows = parseCsvObjects(csv);
  if (rows.length === 0) throw badRequest('Fichier vide ou illisible : la première ligne doit contenir les en-têtes.');
  if (rows.length > MAX_ROWS) throw badRequest(`Ce fichier contient ${rows.length} lignes ; le maximum est de ${MAX_ROWS} par import.`);

  const [categories, existing] = await Promise.all([
    prisma.toumaCategory.findMany({ select: { id: true, slug: true, name: true } }),
    prisma.toumaProduct.findMany({ where: { storeId, sku: { not: null } }, select: { id: true, sku: true } }),
  ]);
  const categoryBySlug = new Map(categories.map((c) => [c.slug.toLowerCase(), c]));
  const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const productBySku = new Map(existing.map((p) => [p.sku!.toLowerCase(), p]));

  const currency = store.country.currency || env.touma.defaultCurrency;
  const results: ImportRowResult[] = [];
  const valid: Array<{ line: number; data: Record<string, unknown>; sku: string | null; existingId?: string }> = [];
  const seenSkus = new Set<string>();

  rows.forEach((row, index) => {
    // Ligne 1 = en-têtes : le vendeur compte comme son tableur.
    const line = index + 2;
    const sku = pick(row, 'sku').trim() || null;
    const title = pick(row, 'title').trim();

    const fail = (message: string) => results.push({ line, sku, title: title || null, action: 'error', message });

    if (!title) return fail('Le titre est obligatoire.');
    if (title.length < 3) return fail('Le titre doit faire au moins 3 caractères.');

    const price = toNumber(pick(row, 'price'));
    if (price === null) return fail('Prix manquant ou illisible.');
    if (price <= 0) return fail('Le prix doit être supérieur à zéro.');

    const quantity = toNumber(pick(row, 'quantity')) ?? 0;
    if (quantity < 0 || !Number.isInteger(quantity)) return fail('Le stock doit être un entier positif ou nul.');

    const minOrderQty = toNumber(pick(row, 'minOrderQty')) ?? 1;
    if (minOrderQty < 1 || !Number.isInteger(minOrderQty)) return fail('La quantité minimale doit être un entier d’au moins 1.');

    const weightGrams = toNumber(pick(row, 'weightGrams')) ?? 500;
    if (weightGrams < 1 || !Number.isInteger(weightGrams)) return fail('Le poids en grammes doit être un entier d’au moins 1.');

    const categoryValue = pick(row, 'category').trim().toLowerCase();
    let categoryId: string | null = null;
    if (categoryValue) {
      const category = categoryBySlug.get(categoryValue) ?? categoryByName.get(categoryValue);
      if (!category) return fail(`Catégorie « ${pick(row, 'category')} » inconnue.`);
      categoryId = category.id;
    }

    const rowCurrency = pick(row, 'currency').trim().toUpperCase();
    // Accepter une autre devise que celle du pays reviendrait à inventer un taux.
    if (rowCurrency && rowCurrency !== currency) {
      return fail(`Devise « ${rowCurrency} » : cette boutique vend en ${currency}.`);
    }

    const statusValue = pick(row, 'status').trim().toUpperCase();
    const status = statusValue === 'ACTIVE' || statusValue === 'ACTIF' ? 'ACTIVE' : statusValue === '' ? 'DRAFT' : statusValue;
    if (!['DRAFT', 'ACTIVE'].includes(status)) return fail('Statut attendu : ACTIVE ou DRAFT.');

    if (sku) {
      const key = sku.toLowerCase();
      // Deux lignes du même fichier sur la même référence : la seconde
      // écraserait silencieusement la première.
      if (seenSkus.has(key)) return fail(`Référence « ${sku} » présente deux fois dans le fichier.`);
      seenSkus.add(key);
    }

    const existingProduct = sku ? productBySku.get(sku.toLowerCase()) : undefined;
    results.push({
      line,
      sku,
      title,
      action: existingProduct ? 'update' : 'create',
      productId: existingProduct?.id,
    });
    valid.push({
      line,
      sku,
      existingId: existingProduct?.id,
      data: {
        title,
        description: pick(row, 'description').slice(0, 10_000),
        brand: pick(row, 'brand') || null,
        sku,
        price: new Prisma.Decimal(price.toFixed(4)),
        currency,
        categoryId,
        countryCode: store.countryCode,
        minOrderQty,
        weightGrams,
        keywords: pick(row, 'keywords').slice(0, 500),
        status,
        quantity,
        imageUrl: pick(row, 'imageUrl') || null,
      },
    });
  });

  const summary = {
    rows: rows.length,
    toCreate: results.filter((r) => r.action === 'create').length,
    toUpdate: results.filter((r) => r.action === 'update').length,
    errors: results.filter((r) => r.action === 'error').length,
  };

  if (options.dryRun) {
    return { dryRun: true as const, currency, summary, results: results.sort((a, b) => a.line - b.line) };
  }

  // Application : une transaction par ligne plutôt qu'une transaction géante.
  // Un catalogue de 500 références ne doit pas verrouiller la base, et une
  // ligne qui échoue à l'écriture ne doit pas annuler les 499 autres.
  const applied: ImportRowResult[] = [];
  for (const entry of valid) {
    const { imageUrl, quantity, ...fields } = entry.data as Record<string, unknown> & { imageUrl: string | null; quantity: number };
    try {
      if (entry.existingId) {
        await prisma.$transaction(async (tx) => {
          await tx.toumaProduct.update({
            where: { id: entry.existingId },
            data: {
              ...(fields as Prisma.ToumaProductUncheckedUpdateInput),
              publishedAt: fields.status === 'ACTIVE' ? new Date() : null,
            },
          });
          // Le stock d'un import remplace le stock connu : c'est l'inventaire
          // du vendeur qui fait foi, pas une addition à l'aveugle.
          await tx.toumaInventory.updateMany({
            where: { productId: entry.existingId, variantId: null },
            data: { quantity },
          });
        });
        applied.push({ line: entry.line, sku: entry.sku, title: String(fields.title), action: 'update', productId: entry.existingId });
      } else {
        const slug = await uniqueSlug(String(fields.title), async (s) => (await prisma.toumaProduct.count({ where: { slug: s } })) > 0);
        const created = await prisma.$transaction(async (tx) => {
          const product = await tx.toumaProduct.create({
            data: {
              ...(fields as Prisma.ToumaProductUncheckedCreateInput),
              storeId,
              slug,
              publishedAt: fields.status === 'ACTIVE' ? new Date() : null,
              ...(imageUrl ? { images: { create: [{ url: imageUrl, position: 0 }] } } : {}),
            },
          });
          await tx.toumaInventory.create({ data: { productId: product.id, quantity } });
          return product;
        });
        applied.push({ line: entry.line, sku: entry.sku, title: String(fields.title), action: 'create', productId: created.id });
      }
    } catch (err) {
      applied.push({
        line: entry.line,
        sku: entry.sku,
        title: String(fields.title),
        action: 'error',
        message: err instanceof Error ? err.message : 'Écriture impossible.',
      });
    }
  }

  const errors = results.filter((r) => r.action === 'error').concat(applied.filter((r) => r.action === 'error'));
  await audit({
    actorId: user.id,
    action: 'catalogue.import',
    entity: 'ToumaStore',
    entityId: storeId,
    metadata: { rows: rows.length, created: applied.filter((r) => r.action === 'create').length, updated: applied.filter((r) => r.action === 'update').length, errors: errors.length },
  });

  return {
    dryRun: false as const,
    currency,
    summary: {
      rows: rows.length,
      created: applied.filter((r) => r.action === 'create').length,
      updated: applied.filter((r) => r.action === 'update').length,
      errors: errors.length,
    },
    results: [...applied, ...results.filter((r) => r.action === 'error')].sort((a, b) => a.line - b.line),
  };
}

/**
 * Export du catalogue au même format que l'import : le vendeur exporte,
 * corrige dans son tableur, réimporte. Sans cet aller-retour, l'import ne sert
 * qu'une fois.
 */
export async function exportCatalogue(user: ToumaRequestUser, storeId: string) {
  const store = await prisma.toumaStore.findUnique({ where: { id: storeId }, select: { ownerId: true, name: true } });
  if (!store) throw notFound('Boutique introuvable.');
  if (store.ownerId !== user.id && user.role !== 'ADMIN') throw notFound('Boutique introuvable.');

  const products = await prisma.toumaProduct.findMany({
    where: { storeId, status: { not: 'ARCHIVED' } },
    include: { category: { select: { slug: true } }, inventory: { where: { variantId: null } }, images: { orderBy: { position: 'asc' }, take: 1 } },
    orderBy: { createdAt: 'desc' },
  });

  return toCsv(
    EXPORT_HEADERS,
    products.map((p) => ({
      sku: p.sku ?? '',
      titre: p.title,
      description: p.description,
      marque: p.brand ?? '',
      prix: p.price.toString(),
      devise: p.currency,
      categorie: p.category?.slug ?? '',
      stock: p.inventory[0]?.quantity ?? 0,
      quantite_minimale: p.minOrderQty,
      poids_grammes: p.weightGrams,
      mots_cles: p.keywords,
      statut: p.status,
      image_url: p.images[0]?.url ?? '',
    })),
  );
}

/** Modèle vierge, pour partir du bon format plutôt que de le deviner. */
export function templateCsv(): string {
  return toCsv(EXPORT_HEADERS, [
    {
      sku: 'CACAO-50',
      titre: 'Cacao en fèves — sac de 50 kg',
      description: 'Fèves fermentées et séchées, récolte de la saison.',
      marque: '',
      prix: '145000',
      devise: 'XAF',
      categorie: '',
      stock: '40',
      quantite_minimale: '1',
      poids_grammes: '50000',
      mots_cles: 'cacao, fèves, gros',
      statut: 'ACTIVE',
      image_url: '',
    },
  ]);
}

export const importService = { importCatalogue, exportCatalogue, templateCsv, EXPORT_HEADERS };

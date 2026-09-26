import { z } from 'zod';
import { urlWeb } from '../lib/url.js';

/**
 * Les montants transitent en **chaîne** (« 25000.00 ») : un JSON `number`
 * flottant perdrait de la précision. Ils sont convertis en Decimal côté service.
 */
const amount = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), 'Montant invalide (format attendu : 12345.67).');

export const imageSchema = z.object({
  url: urlWeb(500),
  alt: z.string().trim().max(200).optional(),
  position: z.number().int().min(0).default(0),
});

export const variantSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(60).optional(),
  priceDelta: amount.default('0'),
  quantity: z.number().int().min(0).default(0),
  position: z.number().int().min(0).default(0),
});

export const createProductSchema = z.object({
  storeId: z.string().cuid(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(10000).default(''),
  brand: z.string().trim().max(120).optional(),
  sku: z.string().trim().max(60).optional(),
  price: amount,
  compareAtPrice: amount.optional(),
  /** Devise ISO-4217 ; par défaut celle du pays de la boutique. */
  currency: z.string().trim().toUpperCase().length(3).optional(),
  categoryId: z.string().cuid().optional(),
  countryCode: z.string().trim().toUpperCase().length(2).optional(),
  /**
   * Origine **de la marchandise**, distincte du pays d'expédition.
   *
   * Un colis parti de N'Djamena peut contenir un article fabriqué ailleurs :
   * confondre les deux fait établir un certificat d'origine sur une donnée
   * fausse. Le vendeur la déclare ; Touma ne la vérifie pas, et le statut
   * enregistré reste `DECLARED` (§11).
   *
   * `null` efface la déclaration et ramène le statut à `UNKNOWN`.
   */
  countryOfOrigin: z.string().trim().toUpperCase().length(2).nullable().optional(),
  /** Pays de fabrication, quand il diffère de l'origine douanière. */
  manufacturerCountry: z.string().trim().toUpperCase().length(2).nullable().optional(),
  /** Ce sur quoi repose la déclaration : référence de document, mention du fabricant. */
  originEvidence: z.string().trim().max(300).nullable().optional(),
  minOrderQty: z.number().int().min(1).max(100000).default(1),
  weightGrams: z.number().int().min(1).max(2_000_000).default(500),
  keywords: z.string().trim().max(500).default(''),
  status: z.enum(['DRAFT', 'ACTIVE']).default('DRAFT'),
  quantity: z.number().int().min(0).default(0),
  images: z.array(imageSchema).max(12).default([]),
  variants: z.array(variantSchema).max(50).default([]),
});

export const updateProductSchema = createProductSchema
  .omit({ storeId: true, variants: true })
  .partial()
  .extend({ status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional() });

export const listProductsSchema = z.object({
  // Les espaces multiples d'un copier-coller casseraient la recherche
  // (« cacao   brut » ne correspondrait à aucun titre).
  q: z.string().trim().max(200).transform((v) => v.replace(/\s+/g, ' ')).optional(),
  category: z.string().trim().max(120).optional(),
  /** Pays **d'expédition** : d'où part le colis. Conservé tel quel (§60). */
  country: z.string().trim().toUpperCase().length(2).optional(),
  /** Pays du vendeur : là où la boutique est établie. */
  sellerCountry: z.string().trim().toUpperCase().length(2).optional(),
  /** Pays d'origine **déclaré** de la marchandise. Jamais une origine vérifiée. */
  originCountry: z.string().trim().toUpperCase().length(2).optional(),
  /**
   * « Ce qui peut réellement m'arriver ».
   *
   * Ne garde que les produits expédiables vers ce pays : ceux qui en partent
   * déjà, et ceux dont le corridor vers ce pays est **réellement
   * opérationnel** — pas seulement déclaré actif (§72).
   */
  deliverTo: z.string().trim().toUpperCase().length(2).optional(),
  /** Corridor, par son code (`TD_CM`) ou son adresse lisible (`tchad-cameroun`). */
  corridor: z.string().trim().max(120).optional(),
  store: z.string().trim().max(120).optional(),
  minPrice: amount.optional(),
  maxPrice: amount.optional(),
  availability: z.enum(['in_stock', 'out_of_stock', 'any']).default('any'),
  sort: z.enum(['recent', 'price_asc', 'price_desc', 'popular', 'relevance']).default('recent'),
  verifiedOnly: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsSchema>;

/**
 * Grille de paliers. Le vendeur envoie la grille complète : modifier un palier
 * isolé dans une grille tarifaire est une source d'erreurs, et une grille se
 * relit d'un coup d'œil.
 */
export const priceTiersSchema = z.object({
  tiers: z
    .array(
      z.object({
        /** Un palier commence forcément au-dessus de l'unité. */
        minQuantity: z.number().int().min(2),
        /** Montant en texte : jamais un flottant pour de l'argent. */
        unitPrice: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Montant invalide.'),
      }),
    )
    .max(10, 'Dix paliers suffisent : au-delà, la grille devient illisible.'),
});

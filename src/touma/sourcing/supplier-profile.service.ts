import { Prisma, type SupplierType } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { notFound } from '../lib/errors.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * PROFIL FOURNISSEUR DÉCLARÉ (V28 §1, §2).
 *
 * **La règle unique de ce fichier : une déclaration ne se fait jamais passer
 * pour une observation.**
 *
 * Le reste de TOUMA affiche ce qu'elle constate — la capacité vient du stock
 * saisi, les pays desservis des expéditions réellement faites, les délais des
 * offres passées. Ce fichier expose une autre nature d'information : ce que le
 * fournisseur dit de lui-même. Personne ne l'a vérifié.
 *
 * Les deux ne peuvent pas cohabiter à plat dans une même réponse. Un acheteur
 * qui lit « livre vers : CM, NG, TD » ne fait pas la différence entre « a déjà
 * expédié là-bas » et « dit qu'il pourrait » — et c'est sur cette différence
 * que se joue une commande de mille sacs.
 *
 * D'où la forme de sortie : tout ce qui est déclaré vit sous une clé
 * `declared`, porte `status: 'DECLARED'` et une date. Rien ne s'en échappe.
 */

/** Statut d'une information. Le même vocabulaire que l'origine marchandise (V24 §11). */
export type StatutInformation = 'DECLARED' | 'VERIFIED' | 'DISPUTED';

export interface ProfilDeclare {
  /**
   * Toujours `DECLARED`.
   *
   * Constante par construction, et non calculée : il n'existe aucun chemin de
   * code par lequel ce profil pourrait rendre `VERIFIED`. La vérification vit
   * dans `ToumaSellerVerification`, et un fournisseur ne se vérifie pas
   * lui-même en remplissant un formulaire.
   */
  status: 'DECLARED';
  types: SupplierType[];
  countries: string[];
  currencies: string[];
  leadTimeDays: number | null;
  minOrderValue: string | null;
  minOrderQty: number | null;
  paymentTerms: string | null;
  shippingNotes: string | null;
  declaredAt: Date;
  /** Ce que cette section n'est pas. Rendu avec elle, jamais séparément. */
  disclaimer: string;
}

const AVERTISSEMENT =
  'Ces informations sont déclarées par le fournisseur lui-même. TOUMA ne les a pas vérifiées. ' +
  'Elles n’ont pas la même valeur que les données observées — pays réellement desservis, capacité en stock, ' +
  'délais constatés — qui figurent ailleurs sur cette fiche.';

export interface EntreeProfil {
  types?: SupplierType[];
  countries?: string[];
  currencies?: string[];
  leadTimeDays?: number | null;
  minOrderValue?: string | null;
  minOrderQty?: number | null;
  paymentTerms?: string | null;
  shippingNotes?: string | null;
}

/** Rend le profil déclaré d'une boutique, ou `null` s'il n'a rien déclaré. */
export async function profilDeclare(storeId: string): Promise<ProfilDeclare | null> {
  const profil = await prisma.toumaSupplierProfile.findUnique({ where: { storeId } });
  if (!profil) return null;
  return {
    status: 'DECLARED',
    types: profil.types,
    countries: profil.declaredCountries,
    currencies: profil.declaredCurrencies,
    leadTimeDays: profil.declaredLeadTimeDays,
    minOrderValue: profil.declaredMinOrderValue?.toString() ?? null,
    minOrderQty: profil.declaredMinOrderQty,
    paymentTerms: profil.paymentTerms,
    shippingNotes: profil.shippingNotes,
    declaredAt: profil.declaredAt,
    disclaimer: AVERTISSEMENT,
  };
}

/**
 * Le fournisseur déclare ou met à jour son profil.
 *
 * `declaredAt` est repoussé à chaque écriture, et c'est voulu : une condition
 * commerciale d'il y a deux ans n'est pas une condition commerciale. La date
 * accompagne l'affichage pour qu'un acheteur puisse en juger lui-même.
 */
export async function declarer(user: ToumaRequestUser, storeId: string, entree: EntreeProfil): Promise<ProfilDeclare> {
  const store = await prisma.toumaStore.findUnique({ where: { id: storeId }, select: { id: true, ownerId: true } });
  // Introuvable plutôt qu'interdit : 403 confirmerait l'existence de la boutique.
  if (!store || (store.ownerId !== user.id && user.role !== 'ADMIN')) throw notFound('Boutique introuvable.');

  const valeurs = {
    ...(entree.types !== undefined ? { types: entree.types } : {}),
    ...(entree.countries !== undefined ? { declaredCountries: entree.countries.map((c) => c.toUpperCase()) } : {}),
    ...(entree.currencies !== undefined ? { declaredCurrencies: entree.currencies.map((c) => c.toUpperCase()) } : {}),
    ...(entree.leadTimeDays !== undefined ? { declaredLeadTimeDays: entree.leadTimeDays } : {}),
    ...(entree.minOrderValue !== undefined
      ? { declaredMinOrderValue: entree.minOrderValue === null ? null : new Prisma.Decimal(entree.minOrderValue) }
      : {}),
    ...(entree.minOrderQty !== undefined ? { declaredMinOrderQty: entree.minOrderQty } : {}),
    ...(entree.paymentTerms !== undefined ? { paymentTerms: entree.paymentTerms } : {}),
    ...(entree.shippingNotes !== undefined ? { shippingNotes: entree.shippingNotes } : {}),
    declaredAt: new Date(),
  };

  await prisma.toumaSupplierProfile.upsert({
    where: { storeId },
    update: valeurs,
    create: { storeId, ...valeurs },
  });

  const rendu = await profilDeclare(storeId);
  if (!rendu) throw notFound('Profil introuvable.');
  return rendu;
}

import { Prisma } from '@prisma/client';
import { prisma } from '../../../db/prisma.js';

/**
 * INTELLIGENCE DE PRIX (§20).
 *
 * Quatre lectures, toutes calculées sur des faits en base : l'historique d'un
 * produit, la fourchette réellement pratiquée dans sa catégorie, la position
 * du vendeur dans cette fourchette, et l'anomalie.
 *
 * Trois règles tiennent ce fichier :
 *
 * 1. **Une estimation n'est jamais présentée comme un prix.** Une fourchette
 *    de marché dit ce que d'autres vendeurs demandent aujourd'hui ; elle ne
 *    dit pas ce que le produit vaut, et ne s'affiche jamais comme tel.
 * 2. **Jamais entre devises.** Une fourchette mêlant XAF et EUR serait un
 *    chiffre faux dès la première ligne.
 * 3. **Un échantillon trop petit ne publie rien.** Trois produits dans une
 *    catégorie ne font pas un marché. La même règle que pour la confiance
 *    (V21) : en dessous du seuil, on dit qu'on ne sait pas.
 */

/** En dessous, aucune fourchette n'est publiée. */
export const ECHANTILLON_MINIMAL = 5;

/** Écart à la médiane au-delà duquel un prix est signalé comme atypique. */
const ECART_ANOMALIE = 0.6;

export interface FourchetteMarche {
  available: boolean;
  currency: string | null;
  min: string | null;
  median: string | null;
  max: string | null;
  sampleSize: number;
  /** Pourquoi la fourchette est absente, quand elle l'est. */
  reason: string | null;
}

function mediane(valeurs: Prisma.Decimal[]): Prisma.Decimal {
  const tries = [...valeurs].sort((a, b) => a.comparedTo(b));
  const milieu = Math.floor(tries.length / 2);
  return tries.length % 2 === 1 ? tries[milieu] : tries[milieu - 1].plus(tries[milieu]).dividedBy(2);
}

export const priceIntelligence = {
  /**
   * Historique des prix d'un produit.
   *
   * Tel qu'il a été pratiqué, avec les dates. C'est la seule base honnête d'un
   * prix barré (V22) et la seule façon de dire « ce prix a monté » sans le
   * supposer.
   */
  async history(productId: string, limit = 20) {
    const lignes = await prisma.toumaProductPriceHistory.findMany({
      where: { productId, variantId: null },
      orderBy: { validFrom: 'desc' },
      take: limit,
      select: { price: true, currency: true, source: true, validFrom: true, validTo: true },
    });
    return {
      entries: lignes.map((l) => ({
        price: l.price.toString(),
        currency: l.currency,
        source: l.source,
        from: l.validFrom,
        to: l.validTo,
        current: l.validTo === null,
      })),
      // Un produit sans historique n'a pas « toujours eu le même prix » : il
      // n'a simplement jamais été modifié depuis que l'historique existe.
      note:
        lignes.length === 0
          ? 'Aucun changement de prix enregistré pour ce produit depuis la mise en place de l’historique.'
          : null,
    };
  },

  /**
   * Fourchette réellement pratiquée dans une catégorie, à devise fixée.
   *
   * Ce sont des prix affichés par d'autres vendeurs, pas une valeur de marché.
   * La distinction n'est pas de la prudence : un prix affiché n'est pas un
   * prix payé, et présenter l'un pour l'autre tromperait aussi bien l'acheteur
   * que le vendeur qui s'y fierait pour se positionner.
   */
  async marketRange(categoryId: string, currency: string, excludeProductId?: string): Promise<FourchetteMarche> {
    const vide = (raison: string): FourchetteMarche => ({
      available: false,
      currency: null,
      min: null,
      median: null,
      max: null,
      sampleSize: 0,
      reason: raison,
    });
    if (!categoryId) return vide('Aucune catégorie n’est associée à ce produit.');

    const lignes = await prisma.toumaProduct.findMany({
      where: {
        categoryId,
        currency,
        status: 'ACTIVE',
        store: { status: 'ACTIVE' },
        ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
      },
      select: { price: true },
      take: 500,
    });

    if (lignes.length < ECHANTILLON_MINIMAL) {
      return vide(
        `Information non disponible : ${lignes.length} produit(s) comparable(s) en ${currency}, il en faut au moins ${ECHANTILLON_MINIMAL} pour qu’une fourchette veuille dire quelque chose.`,
      );
    }

    const prix = lignes.map((l) => l.price);
    return {
      available: true,
      currency,
      min: Prisma.Decimal.min(...prix).toString(),
      median: mediane(prix).toFixed(2),
      max: Prisma.Decimal.max(...prix).toString(),
      sampleSize: prix.length,
      reason: null,
    };
  },

  /**
   * Position d'un produit dans la fourchette de sa catégorie, et anomalie.
   *
   * Une anomalie n'est **pas** un jugement : c'est un écart mesuré à la
   * médiane. Un prix trois fois supérieur peut être celui d'un produit
   * réellement différent rangé dans la même catégorie — c'est même le cas le
   * plus fréquent. L'outil signale l'écart et laisse la conclusion à l'humain.
   */
  async positionAndAnomaly(productId: string) {
    const produit = await prisma.toumaProduct.findFirst({
      where: { id: productId, status: 'ACTIVE', store: { status: 'ACTIVE' } },
      select: { id: true, title: true, price: true, currency: true, categoryId: true, category: { select: { name: true } } },
    });
    if (!produit) return null;

    const fourchette = await this.marketRange(produit.categoryId ?? '', produit.currency, produit.id);
    if (!fourchette.available || !fourchette.median) {
      return {
        product: { id: produit.id, title: produit.title, price: produit.price.toString(), currency: produit.currency },
        range: fourchette,
        position: null,
        anomaly: null,
        note: fourchette.reason,
      };
    }

    const median = new Prisma.Decimal(fourchette.median);
    const ecart = produit.price.minus(median).dividedBy(median);
    const ecartNombre = Number(ecart.toFixed(4));

    return {
      product: { id: produit.id, title: produit.title, price: produit.price.toString(), currency: produit.currency, category: produit.category?.name ?? null },
      range: fourchette,
      position: {
        deviationFromMedian: ecartNombre,
        aboveMedian: ecartNombre > 0,
        /** Formulation factuelle, sans « trop cher » ni « bonne affaire ». */
        statement: `Ce prix se situe ${Math.abs(ecartNombre * 100).toFixed(0)} % ${ecartNombre > 0 ? 'au-dessus' : 'en dessous'} de la médiane des ${fourchette.sampleSize} produits comparables de la catégorie, en ${produit.currency}.`,
      },
      anomaly:
        Math.abs(ecartNombre) >= ECART_ANOMALIE
          ? {
              code: ecartNombre > 0 ? 'PRICE_FAR_ABOVE_MEDIAN' : 'PRICE_FAR_BELOW_MEDIAN',
              deviation: ecartNombre,
              caution:
                'Un écart n’est pas une erreur : un produit réellement différent rangé dans la même catégorie produit le même écart. À vérifier, pas à corriger d’office.',
            }
          : null,
      note: null,
    };
  },

  /**
   * Variation de prix propre au produit, sur une fenêtre.
   *
   * Répond à « pourquoi ce produit coûte-t-il plus cher ? » par un fait : il a
   * changé de prix à telle date, ou il n'a pas changé. Jamais par une cause.
   */
  async ownVariation(productId: string, days = 90) {
    const depuis = new Date(Date.now() - days * 86_400_000);
    const lignes = await prisma.toumaProductPriceHistory.findMany({
      where: { productId, variantId: null, validFrom: { gte: depuis } },
      orderBy: { validFrom: 'asc' },
      select: { price: true, currency: true, validFrom: true },
    });
    if (lignes.length < 2) {
      return { changed: false, changes: 0, note: `Aucun changement de prix enregistré sur ${days} jours.` };
    }
    const devises = new Set(lignes.map((l) => l.currency));
    const premier = lignes[0];
    const dernier = lignes[lignes.length - 1];
    return {
      changed: true,
      changes: lignes.length - 1,
      from: { price: premier.price.toString(), currency: premier.currency, at: premier.validFrom },
      to: { price: dernier.price.toString(), currency: dernier.currency, at: dernier.validFrom },
      // Un changement de devise interdit de calculer une variation : il n'y a
      // pas de pourcentage entre 15 000 XAF et 25 EUR.
      deltaPercent:
        devises.size === 1 && !premier.price.isZero()
          ? Number(dernier.price.minus(premier.price).dividedBy(premier.price).times(100).toFixed(1))
          : null,
      currencyChanged: devises.size > 1,
      note: null,
    };
  },
};

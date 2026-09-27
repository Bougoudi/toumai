import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * TOUMA GROWTH — intégrité des prix.
 *
 * **Le problème.** « 25 000 XAF → 20 000 XAF, économisez 5 000 » suppose que
 * 25 000 a réellement été demandé. Sans preuve, c'est une affirmation
 * invérifiable — et une affirmation invérifiable sur un prix est un mensonge
 * commercial, pas une maladresse d'affichage. Il suffirait de monter un prix
 * une heure pour annoncer une remise le lendemain.
 *
 * **La règle.** Un prix de référence n'est affichable que s'il a été
 * **réellement pratiqué**, pendant au moins `referencePriceMinDays` jours
 * consécutifs, dans la même devise, au cours de l'année écoulée. Sinon, le
 * produit s'affiche à son prix, sans barré ni économie. Ne rien afficher est
 * toujours préférable à afficher une économie qu'on ne peut pas justifier.
 *
 * C'est aussi ce que demandent plusieurs droits de la consommation. Ici, la
 * règle est appliquée parce qu'elle est juste, pas parce qu'un texte l'impose
 * au Tchad — aucune vérification de ce point n'a été faite, et ce module ne
 * prétend pas trancher une question de droit local.
 */

/** Consigne un changement de prix. Ne lève jamais : un prix doit pouvoir changer. */
export async function recordPrice(input: {
  productId: string;
  variantId?: string | null;
  price: Prisma.Decimal | string;
  currency: string;
  source?: 'SELLER' | 'IMPORT' | 'PROMOTION' | 'ADMIN';
}): Promise<void> {
  try {
    const prix = new Prisma.Decimal(input.price);
    const variantId = input.variantId ?? null;

    const courant = await prisma.toumaProductPriceHistory.findFirst({
      where: { productId: input.productId, variantId, validTo: null },
      orderBy: { validFrom: 'desc' },
    });

    // Même prix, même devise : rien ne s'est passé. Écrire une ligne à chaque
    // enregistrement du formulaire ferait une histoire illisible.
    if (courant && courant.price.equals(prix) && courant.currency === input.currency) return;

    const maintenant = new Date();
    await prisma.$transaction([
      ...(courant
        ? [
            prisma.toumaProductPriceHistory.update({
              where: { id: courant.id },
              data: { validTo: maintenant },
            }),
          ]
        : []),
      prisma.toumaProductPriceHistory.create({
        data: {
          productId: input.productId,
          variantId,
          price: prix,
          currency: input.currency,
          source: input.source ?? 'SELLER',
          validFrom: maintenant,
        },
      }),
    ]);
  } catch (err) {
    // Un vendeur ne doit pas être empêché de corriger son prix parce que
    // l'historique a bronché. L'historique est précieux ; le prix juste l'est
    // davantage.
    logger.error('Historique de prix non consigné', { productId: input.productId, err: String(err) });
  }
}

export interface ReferencePrice {
  /** Prix barré affichable, ou `null` s'il n'est pas justifiable. */
  amount: Prisma.Decimal | null;
  currency: string | null;
  /** Depuis quand ce prix était pratiqué — ce qui rend l'affirmation vérifiable. */
  since: Date | null;
  /** Jours pendant lesquels il a été pratiqué. */
  heldDays: number | null;
}

/**
 * Prix de référence affichable pour un produit.
 *
 * Rend `null` dans tous les cas douteux — prix jamais pratiqué assez
 * longtemps, devise différente, historique absent, prix de référence inférieur
 * au prix actuel (ce qui ne serait pas une remise).
 */
export async function referencePrice(
  productId: string,
  currentPrice: Prisma.Decimal | string,
  currency: string,
  variantId: string | null = null,
): Promise<ReferencePrice> {
  const vide: ReferencePrice = { amount: null, currency: null, since: null, heldDays: null };
  try {
    const actuel = new Prisma.Decimal(currentPrice);
    const minJours = env.touma.growth.referencePriceMinDays;
    const depuis = new Date(Date.now() - 365 * 86_400_000);

    const lignes = await prisma.toumaProductPriceHistory.findMany({
      where: { productId, variantId, currency, validFrom: { gte: depuis } },
      orderBy: { validFrom: 'desc' },
      take: 50,
    });
    if (lignes.length === 0) return vide;

    // Le meilleur prix **plus élevé que l'actuel** ayant tenu assez longtemps.
    let meilleur: { price: Prisma.Decimal; since: Date; days: number } | null = null;
    for (const ligne of lignes) {
      if (!ligne.price.greaterThan(actuel)) continue;
      const fin = ligne.validTo ?? new Date();
      const jours = (fin.getTime() - ligne.validFrom.getTime()) / 86_400_000;
      if (jours < minJours) continue;
      if (!meilleur || ligne.price.greaterThan(meilleur.price)) {
        meilleur = { price: ligne.price, since: ligne.validFrom, days: Math.floor(jours) };
      }
    }
    if (!meilleur) return vide;

    return { amount: meilleur.price, currency, since: meilleur.since, heldDays: meilleur.days };
  } catch (err) {
    logger.error('Prix de référence non calculé', { productId, err: String(err) });
    return vide;
  }
}

/**
 * Économie affichable. `null` quand aucun prix de référence n'est justifiable
 * — et l'interface doit alors ne rien afficher, pas afficher zéro.
 */
export function savings(reference: ReferencePrice, currentPrice: Prisma.Decimal | string): Prisma.Decimal | null {
  if (reference.amount === null) return null;
  const ecart = reference.amount.minus(new Prisma.Decimal(currentPrice));
  return ecart.greaterThan(0) ? ecart : null;
}

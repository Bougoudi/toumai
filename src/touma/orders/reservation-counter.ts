import type { Prisma } from '@prisma/client';

/**
 * Libération d'une réservation de stock.
 *
 * `reserved` est un compteur de suivi : au checkout, `quantity` est déjà
 * décrémentée, si bien que la disponibilité à la vente ne dépend pas de lui.
 * Il sert à savoir ce qui est engagé mais pas encore livré — et c'est
 * précisément ce qu'on lit dans un rapport quand on se demande pourquoi les
 * chiffres ne tombent pas juste.
 *
 * Trois chemins le décrémentent : l'annulation, l'expiration de réservation et
 * la réception d'un retour. Aucun n'avait de plancher, et un contrôle
 * d'intégrité a trouvé 101 lignes à `reserved = -1` : une libération de plus
 * que de prises. Un compteur négatif n'est pas seulement laid, il fausse
 * durablement toute somme construite dessus, et rien ne le signalait.
 *
 * `GREATEST(… , 0)` rend la libération excédentaire inoffensive : elle ne fait
 * rien au-delà de zéro au lieu de creuser. Cela ne **répare** pas la cause —
 * savoir lequel des trois chemins libère deux fois reste à établir — mais cela
 * empêche la conséquence, et le contrôle d'intégrité le signalera si cela
 * recommence.
 */
export async function libererReservation(
  tx: Prisma.TransactionClient,
  input: { productId: string; variantId: string | null; quantity: number; restock: boolean },
): Promise<void> {
  if (input.quantity <= 0) return;

  // `variantId` nul doit se comparer avec IS NULL : `= NULL` ne correspond à
  // rien en SQL, et la ligne « produit simple » ne serait jamais touchée.
  if (input.variantId === null) {
    await tx.$executeRaw`
      UPDATE "touma_inventory"
         SET "quantity" = "quantity" + ${input.restock ? input.quantity : 0},
             "reserved" = GREATEST("reserved" - ${input.quantity}, 0)
       WHERE "productId" = ${input.productId} AND "variantId" IS NULL`;
    return;
  }
  await tx.$executeRaw`
    UPDATE "touma_inventory"
       SET "quantity" = "quantity" + ${input.restock ? input.quantity : 0},
           "reserved" = GREATEST("reserved" - ${input.quantity}, 0)
     WHERE "productId" = ${input.productId} AND "variantId" = ${input.variantId}`;
}

import type { Prisma, StockMovementType } from '@prisma/client';
import { requestIdCourant } from '../../middleware/request-context.js';

/**
 * MOUVEMENTS DE STOCK (V27 §3).
 *
 * **La règle de ce fichier, et la seule qui compte : le stock ne bouge que
 * par ici.** Six endroits du code faisaient auparavant un `UPDATE quantity`
 * direct — création de produit, correction vendeur, import, passage de
 * commande, libération de réservation, réception de retour. Aucun ne laissait
 * de trace.
 *
 * Ce que cela coûtait est écrit noir sur blanc dans `reservation-counter.ts` :
 * un contrôle d'intégrité avait trouvé 101 lignes à `reserved = -1`, et le
 * commentaire concède qu'on ignore lequel des trois chemins de libération
 * décrémente deux fois. La question était insoluble, faute de journal. Elle ne
 * l'est plus.
 *
 * **Ce fichier ne change pas la règle de disponibilité.** `quantity` reste ce
 * qui est vendable, `reserved` reste un compteur de suivi, et le décrément au
 * passage de commande reste conditionnel — c'est lui qui empêche deux acheteurs
 * de prendre le même dernier article. On ajoute la trace, on ne touche pas à
 * l'arbitrage.
 */

export interface MouvementDemande {
  productId: string;
  variantId: string | null;
  type: StockMovementType;
  quantityDelta: number;
  reservedDelta?: number;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
  actorId?: string | null;
}

/**
 * Écrit la ligne de journal correspondant à un état déjà appliqué.
 *
 * Les deux « après » sont passés par l'appelant, qui vient de faire la mise à
 * jour et connaît donc le résultat exact. Les relire ici ouvrirait une fenêtre
 * pendant laquelle un autre mouvement pourrait s'intercaler, et le journal
 * raconterait une histoire qui n'a jamais eu lieu.
 */
async function journaliser(
  tx: Prisma.TransactionClient,
  demande: MouvementDemande,
  apres: { quantity: number; reserved: number },
): Promise<void> {
  await tx.toumaStockMovement.create({
    data: {
      productId: demande.productId,
      variantId: demande.variantId,
      type: demande.type,
      quantityDelta: demande.quantityDelta,
      reservedDelta: demande.reservedDelta ?? 0,
      quantityAfter: apres.quantity,
      reservedAfter: apres.reserved,
      reason: demande.reason ?? null,
      referenceType: demande.referenceType ?? null,
      referenceId: demande.referenceId ?? null,
      actorId: demande.actorId ?? null,
      // Relie le mouvement au journal d'accès de V25 : « quelle requête a fait
      // descendre ce stock » devient répondable sans recoupement d'horodatage.
      requestId: requestIdCourant(),
    },
  });
}

/**
 * Crée la ligne d'inventaire d'un produit ou d'une variante.
 *
 * Une création est un mouvement comme un autre : sans elle au journal, le
 * premier article d'un catalogue apparaîtrait de nulle part et toute somme
 * remontant l'histoire serait fausse dès la première ligne.
 */
export async function creerStock(
  tx: Prisma.TransactionClient,
  input: { productId: string; variantId: string | null; quantity: number; actorId?: string | null; reason?: string; type?: StockMovementType },
) {
  const ligne = await tx.toumaInventory.create({
    data: { productId: input.productId, variantId: input.variantId, quantity: input.quantity },
  });
  await journaliser(
    tx,
    {
      productId: input.productId,
      variantId: input.variantId,
      type: input.type ?? 'INITIAL',
      quantityDelta: input.quantity,
      reason: input.reason ?? 'Création de l’article au catalogue.',
      actorId: input.actorId,
    },
    { quantity: ligne.quantity, reserved: ligne.reserved },
  );
  return ligne;
}

/**
 * Fixe la quantité vendable à une valeur donnée.
 *
 * C'est une **correction**, pas une variation : le vendeur dit « il y en a 12 »,
 * pas « ajoutes-en trois ». Le journal enregistre l'écart réellement produit,
 * qui peut être négatif, nul ou positif — et un écart nul est enregistré lui
 * aussi, parce que « le vendeur a recompté et confirmé 12 » est une information.
 */
export async function fixerStock(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    variantId: string | null;
    quantity: number;
    type?: StockMovementType;
    reason?: string;
    referenceType?: string;
    referenceId?: string;
    actorId?: string | null;
  },
) {
  const existant = await tx.toumaInventory.findFirst({
    where: { productId: input.productId, variantId: input.variantId },
  });

  if (!existant) {
    return creerStock(tx, {
      productId: input.productId,
      variantId: input.variantId,
      quantity: input.quantity,
      actorId: input.actorId,
      reason: input.reason,
      type: input.type,
    });
  }

  const ligne = await tx.toumaInventory.update({ where: { id: existant.id }, data: { quantity: input.quantity } });
  await journaliser(
    tx,
    {
      productId: input.productId,
      variantId: input.variantId,
      type: input.type ?? 'ADJUSTMENT',
      quantityDelta: ligne.quantity - existant.quantity,
      reason: input.reason ?? `Quantité fixée à ${input.quantity} par le vendeur.`,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      actorId: input.actorId,
    },
    { quantity: ligne.quantity, reserved: ligne.reserved },
  );
  return ligne;
}

/**
 * Décrément conditionnel au passage de commande.
 *
 * La condition `quantity >= demandée` est la seule chose qui empêche deux
 * acheteurs simultanés de vendre le même dernier article. Elle est conservée
 * telle quelle : ce n'est pas un détail d'implémentation, c'est le verrou.
 *
 * Rend `false` quand le stock est insuffisant, **sans rien journaliser** : un
 * mouvement qui n'a pas eu lieu n'a rien à faire dans un journal de mouvements.
 */
export async function prelever(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    variantId: string | null;
    quantity: number;
    type?: StockMovementType;
    reason?: string;
    referenceType?: string;
    referenceId?: string;
    actorId?: string | null;
  },
): Promise<boolean> {
  const applique = await tx.toumaInventory.updateMany({
    where: { productId: input.productId, variantId: input.variantId, quantity: { gte: input.quantity } },
    data: { quantity: { decrement: input.quantity }, reserved: { increment: input.quantity } },
  });
  if (applique.count !== 1) return false;

  // Relecture nécessaire : `updateMany` ne rend pas la ligne. Elle a lieu dans
  // la même transaction que la mise à jour, donc personne ne s'est intercalé.
  const ligne = await tx.toumaInventory.findFirst({
    where: { productId: input.productId, variantId: input.variantId },
    select: { quantity: true, reserved: true },
  });
  if (!ligne) return false;

  await journaliser(
    tx,
    {
      productId: input.productId,
      variantId: input.variantId,
      type: input.type ?? 'SALE',
      quantityDelta: -input.quantity,
      reservedDelta: input.quantity,
      reason: input.reason ?? 'Passage de commande.',
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      actorId: input.actorId,
    },
    ligne,
  );
  return true;
}

/**
 * Libère une réservation, avec ou sans remise en stock.
 *
 * `GREATEST(reserved - n, 0)` rend une libération excédentaire inoffensive au
 * lieu de creuser sous zéro. Ce plancher masquait jusqu'ici la cause ; le
 * journal la révèle désormais — quand l'écart réellement appliqué est plus
 * petit que celui demandé, c'est qu'une libération était de trop, et le
 * mouvement porte le nom du chemin qui l'a produite.
 */
export async function libererStock(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    variantId: string | null;
    quantity: number;
    restock: boolean;
    type: StockMovementType;
    reason?: string;
    referenceType?: string;
    referenceId?: string;
    actorId?: string | null;
  },
): Promise<void> {
  if (input.quantity <= 0) return;

  const avant = await tx.toumaInventory.findFirst({
    where: { productId: input.productId, variantId: input.variantId },
    select: { quantity: true, reserved: true },
  });
  if (!avant) return;

  // `variantId` nul doit se comparer avec IS NULL : `= NULL` ne correspond à
  // rien en SQL, et la ligne « produit simple » ne serait jamais touchée.
  const ajout = input.restock ? input.quantity : 0;
  if (input.variantId === null) {
    await tx.$executeRaw`
      UPDATE "touma_inventory"
         SET "quantity" = "quantity" + ${ajout},
             "reserved" = GREATEST("reserved" - ${input.quantity}, 0)
       WHERE "productId" = ${input.productId} AND "variantId" IS NULL`;
  } else {
    await tx.$executeRaw`
      UPDATE "touma_inventory"
         SET "quantity" = "quantity" + ${ajout},
             "reserved" = GREATEST("reserved" - ${input.quantity}, 0)
       WHERE "productId" = ${input.productId} AND "variantId" = ${input.variantId}`;
  }

  const apres = await tx.toumaInventory.findFirst({
    where: { productId: input.productId, variantId: input.variantId },
    select: { quantity: true, reserved: true },
  });
  if (!apres) return;

  await journaliser(
    tx,
    {
      productId: input.productId,
      variantId: input.variantId,
      type: input.type,
      quantityDelta: apres.quantity - avant.quantity,
      // L'écart **réellement** appliqué, pas celui demandé. Quand le plancher
      // a mordu, les deux diffèrent — et c'est précisément le signal qu'on
      // cherchait depuis qu'on a trouvé des compteurs négatifs.
      reservedDelta: apres.reserved - avant.reserved,
      reason: input.reason,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      actorId: input.actorId,
    },
    apres,
  );
}

/**
 * Une libération a-t-elle porté au-delà de ce qui était réservé ?
 *
 * Le plancher rend l'excédent inoffensif ; cette fonction le rend **visible**.
 * `demande` est le nombre d'unités qu'on voulait libérer : si le compteur n'a
 * pas baissé d'autant, il n'y avait pas autant à libérer.
 */
export function liberationExcedentaire(mouvement: { reservedDelta: number }, demande: number): boolean {
  return mouvement.reservedDelta > -demande;
}

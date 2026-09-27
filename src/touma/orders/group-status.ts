import type { OrderGroupStatus, Prisma, ToumaOrderStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

/**
 * Statut d'une commande globale, **déduit** de ses sous-commandes.
 *
 * Jusqu'ici il ne l'était pas : le groupe passait à « payé » et n'en bougeait
 * plus. Sur une commande à trois vendeurs dont l'un avait livré et les deux
 * autres préparaient, l'acheteur lisait encore « payée ». La valeur
 * `PARTIALLY_FULFILLED` existait dans le schéma et n'était écrite nulle part.
 *
 * Le principe : **le groupe avance au rythme du plus lent, et le dit quand ses
 * vendeurs ne sont pas au même endroit.** Un acheteur qui a reçu deux colis sur
 * trois doit lire « partiellement livrée », pas « livrée » (ce serait faux) ni
 * « payée » (ce serait inutile).
 *
 * Les sous-commandes annulées sont **ignorées, pas comptées comme en retard** :
 * si un vendeur sur trois annule et que les deux autres livrent, la commande est
 * livrée. Elle n'est annulée que lorsqu'il ne reste plus rien.
 */

/** Rang d'avancement d'une sous-commande. Plus c'est haut, plus c'est avancé. */
const RANG: Record<ToumaOrderStatus, number> = {
  PENDING: 0,
  PAID: 1,
  CONFIRMED: 2,
  PROCESSING: 3,
  READY_TO_SHIP: 4,
  SHIPPED: 5,
  IN_TRANSIT: 5,
  DELIVERED: 6,
  COMPLETED: 7,
  // Hors course : traités à part.
  CANCELLED: -1,
  REFUNDED: -1,
  DISPUTED: -1,
};

/** Statut du groupe correspondant à un rang, quand tous les vendeurs y sont. */
const UNIFORME: Record<number, OrderGroupStatus> = {
  0: 'PENDING',
  1: 'PAID',
  2: 'PAID',
  3: 'PROCESSING',
  4: 'PROCESSING',
  5: 'SHIPPED',
  6: 'DELIVERED',
  7: 'COMPLETED',
};

/**
 * Calcule le statut du groupe. Fonction pure : c'est elle qu'on teste, sans
 * base de données.
 */
export function groupStatusFrom(statuses: ToumaOrderStatus[]): OrderGroupStatus {
  if (statuses.length === 0) return 'PENDING';

  const vivants = statuses.filter((s) => s !== 'CANCELLED' && s !== 'REFUNDED');

  // Plus rien de vivant : soit tout est remboursé, soit tout est annulé.
  if (vivants.length === 0) {
    return statuses.some((s) => s === 'REFUNDED') ? 'REFUNDED' : 'CANCELLED';
  }

  // Un litige en cours ne change pas l'avancement logistique : la commande
  // reste là où elle en est, et le litige se lit ailleurs.
  const enCourse = vivants.filter((s) => s !== 'DISPUTED');
  if (enCourse.length === 0) return 'PROCESSING';

  const rangs = enCourse.map((s) => RANG[s]);
  const min = Math.min(...rangs);
  const max = Math.max(...rangs);

  if (min === max) return UNIFORME[min] ?? 'PAID';

  // Les vendeurs ne sont pas au même endroit : on nomme l'écart plutôt que de
  // le masquer derrière le plus petit dénominateur commun.
  if (max >= 6 && min < 6) return 'PARTIALLY_DELIVERED';
  if (max >= 5 && min < 5) return 'PARTIALLY_SHIPPED';
  // Écart en amont de l'expédition : personne n'a rien reçu, la commande est
  // simplement en cours de traitement.
  return 'PROCESSING';
}

/**
 * Recalcule et enregistre le statut d'un groupe. À appeler après tout
 * changement d'état d'une sous-commande.
 *
 * Ne redescend jamais un groupe déjà remboursé : un remboursement est une
 * décision comptable, pas une étape logistique.
 */
export async function refreshGroupStatus(groupId: string | null | undefined, tx?: Prisma.TransactionClient): Promise<void> {
  if (!groupId) return;
  const db = tx ?? prisma;

  const orders = await db.toumaOrder.findMany({ where: { groupId }, select: { status: true } });
  if (orders.length === 0) return;

  const status = groupStatusFrom(orders.map((o) => o.status));

  await db.toumaOrderGroup.updateMany({
    where: { id: groupId, status: { not: 'REFUNDED' } },
    data: { status },
  });
}

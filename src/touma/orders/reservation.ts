import { prisma } from '../../db/prisma.js';
import { libererReservation } from './reservation-counter.js';
import { logger } from '../../utils/logger.js';

/**
 * Expiration des réservations de stock.
 *
 * Le checkout sort les articles du catalogue immédiatement : c'est ce qui
 * empêche deux acheteurs de se disputer le dernier sac. Mais jusqu'ici la
 * réservation n'avait aucune durée de vie. Un acheteur qui ferme l'onglet, dont
 * le Mobile Money échoue ou qui change d'avis laissait la commande en attente
 * — et le stock sorti du catalogue **pour toujours**. Un vendeur avec dix sacs
 * de cacao pouvait n'en voir aucun à la vente parce que dix personnes avaient
 * ouvert un checkout sans payer.
 *
 * Trois règles gouvernent ce balayage.
 *
 * **1. On ne touche jamais une commande dont le paiement est en cours.**
 * C'est le point délicat. Entre le moment où l'acheteur part chez le
 * prestataire de paiement et celui où le webhook revient, la commande est
 * encore « en attente » — et annuler là, c'est risquer d'encaisser une commande
 * annulée. Un groupe qui porte un paiement en cours ou réussi est donc intouché,
 * quel que soit son âge.
 *
 * **2. La prise est atomique.** L'annulation passe par une mise à jour
 * conditionnée au statut : si un paiement arrive dans le même instant, la
 * condition ne s'applique pas et le balayage passe son chemin. Rejouer le
 * balayage ne fait rien de plus la seconde fois.
 *
 * **3. Le stock revient exactement comme il est parti.** `quantity` remonte,
 * `reserved` redescend — sans quoi le compteur de réservations dériverait à
 * chaque annulation.
 */

/** Durée d'une réservation, en minutes. Configurable ; 15 minutes par défaut. */
export const RESERVATION_MINUTES = Number(process.env.TOUMA_ORDER_RESERVATION_MINUTES ?? 15);

/**
 * Intervalle minimal entre deux balayages déclenchés par le trafic. Sans lui,
 * chaque checkout lancerait une requête d'inventaire inutile : le stock ne se
 * périme pas à la seconde près.
 */
const SWEEP_INTERVAL_MS = Number(process.env.TOUMA_RESERVATION_SWEEP_MS ?? 30_000);

let lastSweep = 0;

/** Paiements qui interdisent l'expiration : l'argent est parti, ou il part. */
const PAYMENT_IN_FLIGHT = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;

export interface ExpiryResult {
  /** Sous-commandes annulées. */
  cancelled: number;
  /** Articles remis en rayon. */
  restocked: number;
}

/**
 * Libère les réservations des commandes restées impayées au-delà du délai.
 * Idempotent : deux exécutions simultanées n'annulent pas deux fois.
 */
export async function expireStaleReservations(now = new Date()): Promise<ExpiryResult> {
  const limit = new Date(now.getTime() - RESERVATION_MINUTES * 60_000);

  const candidates = await prisma.toumaOrder.findMany({
    where: {
      status: 'PENDING',
      placedAt: { lt: limit },
      // Règle 1 : aucun paiement engagé, ni sur la sous-commande, ni sur le
      // groupe qu'elle partage avec les autres vendeurs du même panier.
      payments: { none: { status: { in: [...PAYMENT_IN_FLIGHT] } } },
      OR: [{ groupId: null }, { group: { payments: { none: { status: { in: [...PAYMENT_IN_FLIGHT] } } } } }],
    },
    select: {
      id: true,
      groupId: true,
      orderNumber: true,
      items: { select: { productId: true, variantId: true, quantity: true } },
    },
    take: 200,
  });

  let cancelled = 0;
  let restocked = 0;

  for (const order of candidates) {
    try {
      // `null` = la commande n'était plus à nous ; un nombre = articles remis.
      const released = await prisma.$transaction(async (tx) => {
        // Règle 2 : prise atomique. Si un paiement vient d'arriver et a fait
        // passer la commande à PAID, la condition ne trouve rien.
        const claim = await tx.toumaOrder.updateMany({
          where: { id: order.id, status: 'PENDING' },
          data: {
            status: 'CANCELLED',
            cancelledAt: now,
            cancelReason: `Réservation expirée après ${RESERVATION_MINUTES} minutes sans paiement.`,
          },
        });
        if (claim.count !== 1) return null;

        // Règle 3 : le stock revient exactement comme il est parti.
        let lines = 0;
        for (const item of order.items) {
          if (!item.productId) continue;
          await libererReservation(tx, {
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
            restock: true,
          });
          lines += item.quantity;
        }

        // Le groupe suit : s'il ne reste plus rien de vivant, il est annulé.
        if (order.groupId) {
          const vivants = await tx.toumaOrder.count({
            where: { groupId: order.groupId, status: { notIn: ['CANCELLED'] } },
          });
          if (vivants === 0) {
            await tx.toumaOrderGroup.updateMany({
              where: { id: order.groupId, status: { in: ['PENDING'] } },
              data: { status: 'CANCELLED' },
            });
          }
        }

        return lines;
      });

      // Une commande sans ligne rattachée à un produit encore existant remet
      // zéro article en rayon — elle est tout de même annulée.
      if (released !== null) {
        cancelled += 1;
        restocked += released;
      }
    } catch (err) {
      // Une commande récalcitrante ne doit pas empêcher les autres d'être
      // libérées : le balayage continue et l'incident part au journal.
      logger.error('Réservation non libérée', {
        orderNumber: order.orderNumber,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (cancelled > 0) logger.info('Réservations de stock libérées', { cancelled, restocked });
  return { cancelled, restocked };
}

/**
 * Balayage opportuniste, appelé sur le chemin du checkout : le stock libéré
 * redevient visible pour l'acheteur suivant sans attendre une tâche planifiée.
 * Ne s'exécute qu'une fois par intervalle, et n'échoue jamais bruyamment — ce
 * n'est pas la validation du panier qui doit tomber si le balayage trébuche.
 */
export async function sweepReservations(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  try {
    await expireStaleReservations();
  } catch (err) {
    logger.error('Balayage des réservations en échec', { err: err instanceof Error ? err.message : String(err) });
  }
}

/** Remet le compteur à zéro (tests). */
export function resetSweepThrottle(): void {
  lastSweep = 0;
}

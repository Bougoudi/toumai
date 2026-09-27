import type { DisputePriority, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';
import { notify } from '../lib/notifications.js';

/**
 * Délais de réponse et escalade d'un litige.
 *
 * **Le défaut corrigé.** Un litige attendait indéfiniment. Un vendeur qui ne
 * répondait jamais bloquait l'acheteur aussi sûrement qu'un refus — sans jamais
 * refuser, donc sans que rien ne le signale. Et réciproquement : un acheteur qui
 * ouvre un litige puis disparaît laissait le vendeur avec une commande gelée.
 *
 * Le silence devient donc une réponse, au bout d'un délai, et **c'est le serveur
 * qui le constate**. Jamais le navigateur : une escalade qui dépend d'un onglet
 * ouvert n'arrive pas pour celui qui a fermé le sien.
 *
 * Ce que l'escalade fait, et surtout ce qu'elle ne fait pas : elle porte le
 * dossier devant un humain. **Elle ne tranche rien.** Personne n'est débité,
 * personne n'est remboursé, personne n'est sanctionné parce qu'un compteur est
 * arrivé à zéro.
 */

/** Délai laissé à chaque partie pour répondre, en heures. */
export const RESPONSE_HOURS = Number(process.env.TOUMA_DISPUTE_RESPONSE_HOURS ?? 72);

/** Seuils de priorité, en unités monétaires de la commande. */
const MONTANT_ELEVE = Number(process.env.TOUMA_DISPUTE_HIGH_AMOUNT ?? 500_000);

/**
 * Calcule la priorité d'un litige.
 *
 * C'est un **ordre de passage**, pas une décision : il dit dans quel ordre
 * l'assistance regarde les dossiers, rien d'autre. Le §18 le demande
 * explicitement, et le mot compte — un score qui « décide » à la place d'un
 * humain est précisément ce qu'il ne faut pas construire.
 */
export function computePriority(input: {
  amount: Prisma.Decimal | number;
  category: string;
  previousDisputesOnStore: number;
}): DisputePriority {
  const montant = Number(input.amount);

  // La fraude passe devant : elle peut concerner d'autres acheteurs que celui
  // qui a signalé.
  if (input.category === 'FRAUD') return 'CRITICAL';

  // Un montant élevé ou une boutique qui accumule les litiges : à regarder vite.
  if (montant >= MONTANT_ELEVE || input.previousDisputesOnStore >= 3) return 'HIGH';

  // Un colis jamais reçu immobilise de l'argent des deux côtés.
  if (input.category === 'NON_DELIVERY') return 'HIGH';

  if (montant <= MONTANT_ELEVE / 50) return 'LOW';
  return 'NORMAL';
}

/** Date limite de réponse à partir de maintenant. */
export function deadlineFrom(now = new Date(), hours = RESPONSE_HOURS): Date {
  return new Date(now.getTime() + hours * 3_600_000);
}

export interface EscalationResult {
  escalated: number;
}

/**
 * Escalade les litiges dont le délai de réponse est dépassé.
 *
 * Idempotent : la prise est conditionnée au statut, donc une réponse arrivée
 * dans le même instant l'emporte et le balayage passe son chemin.
 */
export async function escalateOverdueDisputes(now = new Date()): Promise<EscalationResult> {
  const candidats = await prisma.toumaDispute.findMany({
    where: {
      OR: [
        { status: 'SELLER_RESPONSE_REQUIRED', sellerResponseDeadline: { lt: now } },
        { status: 'BUYER_RESPONSE_REQUIRED', buyerResponseDeadline: { lt: now } },
      ],
    },
    select: {
      id: true,
      status: true,
      openedById: true,
      order: { select: { buyerId: true, orderNumber: true, store: { select: { ownerId: true } } } },
    },
    take: 200,
  });

  let escalated = 0;

  for (const dispute of candidats) {
    try {
      const pris = await prisma.toumaDispute.updateMany({
        // Condition sur le statut d'origine : si la partie vient de répondre,
        // rien ne se passe.
        where: { id: dispute.id, status: dispute.status },
        data: { status: 'ESCALATED', escalatedAt: now, priority: 'HIGH' },
      });
      if (pris.count !== 1) continue;
      escalated += 1;

      // Les deux parties sont prévenues : celle qui n'a pas répondu apprend que
      // son silence a été constaté, l'autre que son dossier avance.
      const silencieux = dispute.status === 'SELLER_RESPONSE_REQUIRED' ? dispute.order.store.ownerId : dispute.order.buyerId;
      const autre = silencieux === dispute.order.buyerId ? dispute.order.store.ownerId : dispute.order.buyerId;

      for (const userId of new Set([silencieux, autre])) {
        await notify({
          userId,
          type: 'DISPUTE_ESCALATED',
          title: `Litige sur la commande ${dispute.order.orderNumber}`,
          body: 'Le délai de réponse est écoulé : le dossier est confié à l’assistance TOUMA. Aucune décision n’est prise pour l’instant.',
          data: { disputeId: dispute.id },
        });
      }
    } catch (err) {
      logger.error('Litige non escaladé', { disputeId: dispute.id, err: err instanceof Error ? err.message : String(err) });
    }
  }

  if (escalated > 0) logger.info('Litiges escaladés faute de réponse', { escalated });
  return { escalated };
}

/** Intervalle minimal entre deux balayages déclenchés par le trafic. */
const SWEEP_INTERVAL_MS = Number(process.env.TOUMA_DISPUTE_SWEEP_MS ?? 60_000);
let lastSweep = 0;

/**
 * Balayage opportuniste, sur le chemin de la consultation des litiges. Ne
 * s'exécute qu'une fois par intervalle et n'échoue jamais bruyamment : ce n'est
 * pas la lecture d'un dossier qui doit tomber si l'escalade trébuche.
 */
export async function sweepDisputes(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  try {
    await escalateOverdueDisputes();
  } catch (err) {
    logger.error('Balayage des litiges en échec', { err: err instanceof Error ? err.message : String(err) });
  }
}

/** Remet le compteur à zéro (tests). */
export function resetDisputeSweep(): void {
  lastSweep = 0;
}

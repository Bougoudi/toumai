import type { TrustEntityType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { notify } from '../lib/notifications.js';
import { trustService } from './trust.service.js';

/**
 * TOUMA TRUST — événements.
 *
 * **Pourquoi passer par des événements plutôt que recalculer partout.** Une
 * commande terminée, un litige ouvert, un avis signalé changent la confiance
 * de plusieurs entités à la fois : la boutique, l'acheteur, le produit. Les
 * recalculer en ligne allongerait le chemin critique d'un paiement pour un
 * chiffre qui n'a pas besoin d'être à la microseconde.
 *
 * **Ce que ce n'est pas.** Ni une file de travaux, ni un bus de messages. Un
 * fait est consigné, puis consommé — soit tout de suite en tâche de fond, soit
 * au prochain balayage. Il n'y a **ni reprise après échec, ni garantie
 * d'exécution** : un événement perdu est rattrapé par le recalcul périodique,
 * parce que le score se recalcule toujours depuis des faits en base et jamais
 * depuis un cumul d'incréments. C'est ce qui rend l'approximation acceptable
 * ici, et c'est aussi pourquoi le même raccourci serait inacceptable pour de
 * l'argent.
 */

/** Faits qui font bouger la confiance. */
export type TrustEventType =
  | 'SELLER_VERIFIED'
  | 'SELLER_SUSPENDED'
  | 'ORDER_COMPLETED'
  | 'ORDER_CANCELLED'
  | 'ORDER_REFUNDED'
  | 'DISPUTE_OPENED'
  | 'DISPUTE_RESOLVED'
  | 'DELIVERY_COMPLETED'
  | 'REVIEW_CREATED'
  | 'REVIEW_FLAGGED'
  | 'PAYMENT_FAILED'
  | 'FRAUD_SIGNAL_CREATED';

export interface TrustEventInput {
  entityType: TrustEntityType;
  entityId: string;
  type: TrustEventType;
  detail?: Record<string, unknown>;
}

/**
 * Consigne un fait. **Ne lève jamais** : la confiance est un produit dérivé,
 * et une commande ne doit pas échouer parce que son événement de réputation
 * n'a pas pu être écrit.
 */
export async function recordTrustEvent(input: TrustEventInput | TrustEventInput[]): Promise<void> {
  if (!env.touma.trust.enabled) return;
  const events = Array.isArray(input) ? input : [input];
  try {
    await prisma.toumaTrustEvent.createMany({
      data: events.map((e) => ({
        entityType: e.entityType,
        entityId: e.entityId,
        type: e.type,
        detail: (e.detail ?? {}) as Prisma.InputJsonValue,
      })),
    });
  } catch (err) {
    logger.error('Événement de confiance non consigné', { err: String(err) });
  }
}

/**
 * Consomme les événements en attente et recalcule les entités concernées.
 *
 * Deux propriétés tiennent la fonction :
 *
 * - **Une entité n'est recalculée qu'une fois par passage**, quel que soit le
 *   nombre d'événements la concernant. Dix commandes livrées dans l'heure ne
 *   déclenchent pas dix calculs.
 * - **Un échec sur une entité n'interrompt pas les autres.** Les événements
 *   d'une entité en échec restent non consommés et repasseront.
 */
export async function processTrustEvents(limit = 500): Promise<{ processed: number; entities: number }> {
  if (!env.touma.trust.enabled) return { processed: 0, entities: 0 };

  const pending = await prisma.toumaTrustEvent.findMany({
    where: { processedAt: null },
    orderBy: { occurredAt: 'asc' },
    take: limit,
  });
  if (pending.length === 0) return { processed: 0, entities: 0 };

  // Regroupement : une entité, un calcul, et le motif du dernier fait observé.
  const parEntite = new Map<string, { type: TrustEntityType; id: string; reason: string; eventIds: string[] }>();
  for (const e of pending) {
    const cle = `${e.entityType}:${e.entityId}`;
    const existant = parEntite.get(cle);
    if (existant) {
      existant.reason = e.type;
      existant.eventIds.push(e.id);
    } else {
      parEntite.set(cle, { type: e.entityType, id: e.entityId, reason: e.type, eventIds: [e.id] });
    }
  }

  let traites = 0;
  for (const entite of parEntite.values()) {
    try {
      const avant = await prisma.toumaTrustScore.findUnique({
        where: { entityType_entityId: { entityType: entite.type, entityId: entite.id } },
        select: { score: true },
      });
      const apres = await trustService.compute(entite.type, entite.id, entite.reason);
      await prisma.toumaTrustEvent.updateMany({
        where: { id: { in: entite.eventIds } },
        data: { processedAt: new Date() },
      });
      traites += entite.eventIds.length;
      await notifierSiSignificatif(entite.type, entite.id, avant?.score ?? null, apres.score);
    } catch (err) {
      // L'entité a peut-être été supprimée entre-temps, ou la base a bronché.
      // Ses événements restent en attente ; les autres entités continuent.
      logger.error('Confiance non recalculée', {
        entityType: entite.type,
        entityId: entite.id,
        err: String(err),
      });
    }
  }

  return { processed: traites, entities: parEntite.size };
}

/**
 * Prévient l'intéressé quand son score bouge **significativement**.
 *
 * Le seuil n'est pas du confort : sans lui, un vendeur recevrait une
 * notification à chaque commande livrée, apprendrait à les ignorer, et ne
 * verrait pas celle qui compte.
 */
async function notifierSiSignificatif(
  entityType: TrustEntityType,
  entityId: string,
  avant: number | null,
  apres: number | null,
) {
  if (avant === null || apres === null) return;
  if (Math.abs(apres - avant) < env.touma.trust.notifyDelta) return;

  // Seuls un vendeur et un fournisseur sont prévenus : le score d'un acheteur
  // ne lui demande aucune action, et celui d'un produit n'appartient à personne.
  let userId: string | null = null;
  if (entityType === 'SELLER') {
    const store = await prisma.toumaStore.findUnique({ where: { id: entityId }, select: { ownerId: true } });
    userId = store?.ownerId ?? null;
  } else if (entityType === 'SUPPLIER') {
    userId = entityId;
  }
  if (!userId) return;

  const monte = apres > avant;
  await notify({
    userId,
    type: 'TRUST_SCORE_CHANGED',
    title: monte ? 'Votre score de confiance a progressé' : 'Votre score de confiance a baissé',
    body: `${avant} → ${apres}. Le détail par composante est dans votre espace confiance.`,
    data: { entityType, entityId, previous: avant, current: apres },
  }).catch(() => undefined);
}

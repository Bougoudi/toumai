import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';

/**
 * Notifications : le domaine métier ne connaît **aucun** canal (email, SMS,
 * WhatsApp, push). Il publie un événement ; les canaux sont branchés plus tard
 * derrière `NotificationChannel` sans toucher au métier.
 */
export type NotificationType =
  | 'ORDER_CREATED'
  | 'ORDER_STATUS_CHANGED'
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'SHIPMENT_CREATED'
  | 'SHIPMENT_UPDATED'
  | 'VERIFICATION_SUBMITTED'
  | 'VERIFICATION_APPROVED'
  | 'VERIFICATION_REJECTED'
  | 'DISPUTE_OPENED'
  | 'DISPUTE_RESOLVED'
  | 'NEW_ORDER_FOR_SELLER'
  // ── Messagerie et négociation (V14) ──────────────────────────────────────
  | 'MESSAGE_RECEIVED'
  | 'MESSAGE_REPLY'
  | 'ATTACHMENT_RECEIVED'
  | 'OFFER_RECEIVED'
  | 'COUNTER_OFFER_RECEIVED'
  | 'OFFER_ACCEPTED'
  | 'OFFER_REJECTED'
  | 'NEGOTIATION_EXPIRING'
  | 'NEGOTIATION_EXPIRED'
  | 'RFQ_UPDATE'
  | 'ORDER_UPDATE'
  // ── Exécution des commandes (V15) ────────────────────────────────────────
  | 'SELLER_ORDER_CREATED'
  | 'SELLER_ORDER_CONFIRMED'
  | 'ORDER_READY_TO_SHIP'
  | 'ORDER_IN_TRANSIT'
  | 'DELIVERY_CONFIRMED'
  | 'RESERVATION_EXPIRED'
  | 'PAYOUT_ELIGIBLE';

/**
 * Catégories de préférence. Elles regroupent les types : un utilisateur coupe
 * « les messages », pas « MESSAGE_REPLY ».
 */
export type NotificationCategory = 'MESSAGES' | 'NEGOTIATION' | 'RFQ' | 'ORDERS' | 'MARKETING';

const CATEGORY_BY_TYPE: Partial<Record<NotificationType, NotificationCategory>> = {
  MESSAGE_RECEIVED: 'MESSAGES',
  MESSAGE_REPLY: 'MESSAGES',
  ATTACHMENT_RECEIVED: 'MESSAGES',
  OFFER_RECEIVED: 'NEGOTIATION',
  COUNTER_OFFER_RECEIVED: 'NEGOTIATION',
  OFFER_ACCEPTED: 'NEGOTIATION',
  OFFER_REJECTED: 'NEGOTIATION',
  NEGOTIATION_EXPIRING: 'NEGOTIATION',
  NEGOTIATION_EXPIRED: 'NEGOTIATION',
  RFQ_UPDATE: 'RFQ',
  ORDER_CREATED: 'ORDERS',
  ORDER_STATUS_CHANGED: 'ORDERS',
  ORDER_UPDATE: 'ORDERS',
  NEW_ORDER_FOR_SELLER: 'ORDERS',
  PAYMENT_SUCCEEDED: 'ORDERS',
  PAYMENT_FAILED: 'ORDERS',
  SHIPMENT_CREATED: 'ORDERS',
  SHIPMENT_UPDATED: 'ORDERS',
  SELLER_ORDER_CREATED: 'ORDERS',
  SELLER_ORDER_CONFIRMED: 'ORDERS',
  ORDER_READY_TO_SHIP: 'ORDERS',
  ORDER_IN_TRANSIT: 'ORDERS',
  DELIVERY_CONFIRMED: 'ORDERS',
  RESERVATION_EXPIRED: 'ORDERS',
  PAYOUT_ELIGIBLE: 'ORDERS',
};

/** Catégorie d'un type de notification (par défaut : ORDERS, jamais MARKETING). */
export function categoryOf(type: NotificationType): NotificationCategory {
  return CATEGORY_BY_TYPE[type] ?? 'ORDERS';
}

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Canaux souhaités : IN_APP (toujours), EMAIL, SMS, WHATSAPP, PUSH. */
  channels?: string[];
}

/** Canal de diffusion. Implémentations réelles ajoutées sans modifier le métier. */
export interface NotificationChannel {
  readonly code: string;
  supports(input: NotificationInput): boolean;
  deliver(input: NotificationInput): Promise<void>;
}

const channels: NotificationChannel[] = [];

/** Enregistre un canal (email, SMS…) au démarrage de l'application. */
export function registerNotificationChannel(channel: NotificationChannel): void {
  if (!channels.some((c) => c.code === channel.code)) channels.push(channel);
}

/**
 * Publie une notification : persistée en base (canal « in-app » natif) puis
 * transmise aux canaux enregistrés. Un canal en échec n'annule jamais l'action
 * métier qui a déclenché la notification.
 */
export async function notify(input: NotificationInput): Promise<void> {
  const category = categoryOf(input.type);
  // Préférences : l'absence d'enregistrement vaut « in-app oui, e-mail non ».
  let preference: { inApp: boolean; email: boolean } | null = null;
  try {
    preference = await prisma.toumaNotificationPreference.findUnique({
      where: { userId_category: { userId: input.userId, category } },
      select: { inApp: true, email: true },
    });
  } catch (err) {
    logger.warn('Préférences de notification illisibles', { err: err instanceof Error ? err.message : String(err) });
  }

  const inApp = preference?.inApp ?? true;
  const email = preference?.email ?? false;
  const requested = input.channels?.length ? input.channels : [...(inApp ? ['IN_APP'] : []), ...(email ? ['EMAIL'] : [])];
  if (requested.length === 0) return;

  if (!inApp && !input.channels?.length) {
    // Canal in-app coupé : on ne persiste pas, on laisse les autres canaux faire.
    await deliverToChannels(requested, input);
    return;
  }

  try {
    await prisma.toumaNotification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: (input.data ?? {}) as object,
        channels: requested.join(','),
      },
    });
  } catch (err) {
    logger.error('Notification non enregistrée', { type: input.type, err: err instanceof Error ? err.message : String(err) });
  }

  await deliverToChannels(requested, input);
}

/** Transmet aux canaux enregistrés ; un canal en échec n'annule jamais le métier. */
async function deliverToChannels(requested: string[], input: NotificationInput): Promise<void> {
  await Promise.all(
    channels
      .filter((c) => requested.includes(c.code) && c.supports(input))
      .map((c) =>
        c.deliver(input).catch((err: unknown) =>
          logger.error('Canal de notification en échec', {
            channel: c.code,
            err: err instanceof Error ? err.message : String(err),
          }),
        ),
      ),
  );
}

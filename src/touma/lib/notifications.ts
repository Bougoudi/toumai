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
  | 'NEW_ORDER_FOR_SELLER';

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
  const requested = input.channels?.length ? input.channels : ['IN_APP'];
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

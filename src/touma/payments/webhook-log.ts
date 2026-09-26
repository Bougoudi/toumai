import { createHash } from 'node:crypto';
import type { WebhookOutcome } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';
import { redactedExcerpt } from '../lib/redact.js';

/**
 * Trace des webhooks reçus — **y compris ceux qui sont refusés**.
 *
 * Jusqu'ici, un webhook rejeté pour signature invalide était journalisé puis
 * oublié. C'est exactement la trace qu'on voudra le jour où quelqu'un tente
 * d'en forger un : combien de tentatives, depuis quelle adresse, sur quelle
 * référence de paiement, et depuis quand.
 *
 * Le point d'entrée est public. Trois précautions en découlent, et aucune n'est
 * facultative :
 *
 * - le corps n'est jamais conservé tel quel — il est **rédigé** puis **tronqué** ;
 * - son empreinte SHA-256 est conservée, ce qui suffit à reconnaître deux
 *   tentatives identiques sans stocker deux fois le contenu ;
 * - une panne d'écriture de la trace **ne casse jamais** le traitement du
 *   webhook, pas plus que le journal d'audit ne casse l'action qu'il observe.
 */

export interface WebhookTrace {
  provider: string;
  outcome: WebhookOutcome;
  reason?: string | null;
  eventId?: string | null;
  eventType?: string | null;
  providerRef?: string | null;
  paymentId?: string | null;
  signatureValid: boolean;
  signatureAgeSeconds?: number | null;
  body: Buffer;
  sourceIp?: string | null;
  userAgent?: string | null;
}

export async function recordWebhookDelivery(trace: WebhookTrace): Promise<void> {
  try {
    await prisma.toumaWebhookDelivery.create({
      data: {
        provider: trace.provider.slice(0, 60),
        outcome: trace.outcome,
        reason: trace.reason ?? null,
        eventId: trace.eventId ?? null,
        eventType: trace.eventType ?? null,
        providerRef: trace.providerRef ?? null,
        paymentId: trace.paymentId ?? null,
        signatureValid: trace.signatureValid,
        signatureAgeSeconds: trace.signatureAgeSeconds ?? null,
        bodySha256: createHash('sha256').update(trace.body).digest('hex'),
        bodyBytes: trace.body.byteLength,
        bodyExcerpt: redactedExcerpt(trace.body),
        sourceIp: trace.sourceIp ?? null,
        userAgent: trace.userAgent?.slice(0, 300) ?? null,
      },
    });
  } catch (err) {
    logger.error('Trace de webhook non écrite', {
      provider: trace.provider,
      outcome: trace.outcome,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Purge des traces anciennes.
 *
 * Une table qu'un tiers non authentifié peut faire grossir se purge, sinon elle
 * devient elle-même la panne. La durée de conservation reste une question
 * ouverte pour le conseil juridique (`docs/payments/compliance-boundaries.md`) :
 * 90 jours est un défaut d'exploitation, pas une réponse à cette question.
 */
export async function purgeWebhookDeliveries(olderThanDays = 90): Promise<number> {
  const limite = new Date(Date.now() - olderThanDays * 24 * 3600 * 1000);
  const { count } = await prisma.toumaWebhookDelivery.deleteMany({ where: { createdAt: { lt: limite } } });
  return count;
}

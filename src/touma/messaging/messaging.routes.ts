import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { asyncHandler, parseBody, parseQuery } from '../../middleware/validate.js';
import { authenticate, currentUser, requireRole } from '../middleware/toumaAuth.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { readAttachment, safeContentType, verifySignature } from './attachments.js';
import { subscribe } from './events.js';
import { messagingService } from './messaging.service.js';
import { moderationService } from './moderation.service.js';
import { notificationPreferenceService, templatesService } from './templates.service.js';
import {
  blockUserSchema,
  editMessageSchema,
  listConversationsSchema,
  listMessagesSchema,
  moderationQuerySchema,
  notificationPreferenceSchema,
  openConversationSchema,
  participationSchema,
  reportMessageSchema,
  resolveReportSchema,
  riskQuerySchema,
  savedReplySchema,
  savedReplyUpdateSchema,
  searchMessagesSchema,
  sendMessageSchema,
} from './messaging.schema.js';

/** Décode un en-tête encodé par le client (`encodeURIComponent`). */
function decodeHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export const conversationRouter = Router();
export const messageRouter = Router();
export const attachmentRouter = Router();
export const messagingRouter = Router();

// ── Conversations ────────────────────────────────────────────────────────────
conversationRouter.use(authenticate);

conversationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = parseQuery(listConversationsSchema, req);
    res.json(await messagingService.list(currentUser(req), query));
  }),
);

/** Compatibilité V13 : la pastille d'en-tête lisait `{ count }`. */
conversationRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => res.json(await messagingService.unreadSummary(currentUser(req).id))),
);

conversationRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parseBody(openConversationSchema, req);
    const result = await messagingService.openWithStore(currentUser(req), input);
    res.status(result.created ? 201 : 200).json(result);
  }),
);

conversationRouter.get('/:id', asyncHandler(async (req, res) => res.json(await messagingService.get(currentUser(req), req.params.id))));

conversationRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = parseBody(participationSchema, req);
    res.json(await messagingService.updateParticipation(currentUser(req), req.params.id, input));
  }),
);

conversationRouter.post('/:id/read', asyncHandler(async (req, res) => res.json(await messagingService.markRead(currentUser(req), req.params.id))));

conversationRouter.get(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const query = parseQuery(listMessagesSchema, req);
    res.json(await messagingService.messages(currentUser(req), req.params.id, query));
  }),
);

conversationRouter.post(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const input = parseBody(sendMessageSchema, req);
    res.status(201).json(await messagingService.sendMessage(currentUser(req), req.params.id, input));
  }),
);

/**
 * Envoi d'un fichier. Le corps est **brut** : le type réel est déduit du
 * contenu, jamais de l'en-tête. Le nom d'origine voyage dans `x-file-name`.
 */
conversationRouter.post(
  '/:id/attachments',
  asyncHandler(async (req, res) => {
    const content = req.body;
    if (!Buffer.isBuffer(content) || content.length === 0) {
      throw badRequest('Envoyez le fichier en corps brut (content-type: application/octet-stream).');
    }
    // Un en-tête HTTP ne transporte que des octets latin-1 : « échantillon.png »
    // n'y tient pas tel quel. Le client encode, le serveur décode — et tolère
    // une valeur non encodée plutôt que de perdre le fichier.
    const fileName = decodeHeader(req.get('x-file-name')) ?? 'fichier';
    const caption = decodeHeader(req.get('x-caption'));
    res.status(201).json(await messagingService.attach(currentUser(req), req.params.id, content, fileName, caption));
  }),
);

// ── Messages ─────────────────────────────────────────────────────────────────
messageRouter.use(authenticate);

messageRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const query = parseQuery(searchMessagesSchema, req);
    res.json(await messagingService.search(currentUser(req), query.q, query.limit));
  }),
);

/** Répondre à un message sans connaître l'identifiant de sa conversation. */
messageRouter.post(
  '/:id/reply',
  asyncHandler(async (req, res) => {
    const input = parseBody(editMessageSchema, req);
    const target = await messagingService.conversationOfMessage(currentUser(req), req.params.id);
    res.status(201).json(await messagingService.sendMessage(currentUser(req), target, { body: input.body, replyToId: req.params.id }));
  }),
);

messageRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = parseBody(editMessageSchema, req);
    res.json(await messagingService.editMessage(currentUser(req), req.params.id, input.body));
  }),
);

messageRouter.delete('/:id', asyncHandler(async (req, res) => res.json(await messagingService.deleteMessage(currentUser(req), req.params.id))));

messageRouter.post(
  '/:id/report',
  asyncHandler(async (req, res) => {
    const input = parseBody(reportMessageSchema, req);
    res.status(201).json(await moderationService.reportMessage(currentUser(req), req.params.id, input));
  }),
);

// ── Pièces jointes ───────────────────────────────────────────────────────────
/**
 * L'authentification n'est exigée que si aucune URL signée n'est présentée :
 * une signature valide **est** l'autorisation, et elle expire.
 */
attachmentRouter.use((req, res, next) => {
  const signed = typeof req.query.expires === 'string' && typeof req.query.signature === 'string';
  if (signed) return next();
  return authenticate(req, res, next);
});

/**
 * Téléchargement. Deux chemins, une seule règle : seuls les participants
 * accèdent au fichier — par contrôle de participation, ou par signature.
 */
attachmentRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const expires = typeof req.query.expires === 'string' ? req.query.expires : null;
    const signature = typeof req.query.signature === 'string' ? req.query.signature : null;

    let attachment;
    if (expires && signature) {
      if (!verifySignature(req.params.id, expires, signature)) throw unauthorized('Lien expiré ou invalide.');
      attachment = await messagingService.attachmentBySignature(req.params.id);
    } else {
      attachment = await messagingService.attachmentForUser(currentUser(req), req.params.id);
    }

    if (!attachment.storageKey) {
      // Pièce jointe historique référencée par une URL externe (V13).
      return res.redirect(302, attachment.url ?? '/');
    }

    const content = await readAttachment(attachment.storageKey);
    // Jamais rendu comme document actif : téléchargement, sans reniflage de type.
    res.setHeader('content-type', safeContentType(attachment.mimeType));
    res.setHeader('content-disposition', `attachment; filename="${attachment.name.replace(/"/g, '')}"`);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'private, max-age=60');
    res.send(content);
  }),
);

// ── Flux temps réel, modèles, préférences, modération ────────────────────────

/** Ticket de flux : l'`EventSource` du navigateur ne porte pas d'en-tête. */
function streamTicket(userId: string): { ticket: string; expiresAt: string } {
  const expires = Math.floor(Date.now() / 1000) + 60;
  const signature = createHmac('sha256', env.touma.accessSecret).update(`stream.${userId}.${expires}`).digest('hex');
  return { ticket: `${userId}.${expires}.${signature}`, expiresAt: new Date(expires * 1000).toISOString() };
}

function verifyTicket(ticket: string): string | null {
  const [userId, expires, signature] = ticket.split('.');
  if (!userId || !expires || !signature) return null;
  if (Number(expires) * 1000 < Date.now()) return null;
  const expected = Buffer.from(createHmac('sha256', env.touma.accessSecret).update(`stream.${userId}.${expires}`).digest('hex'));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? userId : null;
}

messagingRouter.post(
  '/stream-ticket',
  authenticate,
  asyncHandler(async (req, res) => res.json(streamTicket(currentUser(req).id))),
);

/**
 * Flux d'événements. Le ticket est à usage court et ne donne accès qu'aux
 * événements de son propre compte — jamais au contenu des messages.
 */
messagingRouter.get('/stream', (req, res) => {
  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : '';
  const userId = verifyTicket(ticket);
  if (!userId) {
    res.status(401).json({ error: 'Ticket de flux invalide ou expiré.' });
    return;
  }

  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders?.();
  res.write(`event: ready\ndata: {"ok":true}\n\n`);

  const detach = subscribe(userId, res);
  // Battement régulier : garde la connexion ouverte derrière les proxys.
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    detach();
  });
});

messagingRouter.get('/templates', authenticate, asyncHandler(async (req, res) => res.json(await templatesService.list(currentUser(req)))));

messagingRouter.post(
  '/templates',
  authenticate,
  asyncHandler(async (req, res) => res.status(201).json(await templatesService.create(currentUser(req), parseBody(savedReplySchema, req)))),
);

messagingRouter.patch(
  '/templates/:id',
  authenticate,
  asyncHandler(async (req, res) => res.json(await templatesService.update(currentUser(req), req.params.id, parseBody(savedReplyUpdateSchema, req)))),
);

messagingRouter.delete(
  '/templates/:id',
  authenticate,
  asyncHandler(async (req, res) => res.json(await templatesService.remove(currentUser(req), req.params.id))),
);

messagingRouter.get('/preferences', authenticate, asyncHandler(async (req, res) => res.json(await notificationPreferenceService.list(currentUser(req).id))));

messagingRouter.put(
  '/preferences',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = parseBody(notificationPreferenceSchema, req);
    res.json(await notificationPreferenceService.update(currentUser(req).id, input.category, input));
  }),
);

messagingRouter.get('/blocks', authenticate, asyncHandler(async (req, res) => res.json(await moderationService.listBlocks(currentUser(req).id))));

messagingRouter.post(
  '/blocks',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = parseBody(blockUserSchema, req);
    res.status(201).json(await moderationService.blockUser(currentUser(req), input.userId, input.reason));
  }),
);

messagingRouter.delete(
  '/blocks/:userId',
  authenticate,
  asyncHandler(async (req, res) => res.json(await moderationService.unblockUser(currentUser(req), req.params.userId))),
);

// ── Modération (administration) ──────────────────────────────────────────────
messagingRouter.get(
  '/reports',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => res.json(await moderationService.listReports(currentUser(req), parseQuery(moderationQuerySchema, req)))),
);

messagingRouter.post(
  '/reports/:id/resolve',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => res.json(await moderationService.resolveReport(currentUser(req), req.params.id, parseBody(resolveReportSchema, req)))),
);

messagingRouter.get(
  '/risk-flags',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => res.json(await moderationService.listRiskFlags(currentUser(req), parseQuery(riskQuerySchema, req)))),
);

messagingRouter.post(
  '/risk-flags/:id/resolve',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { status } = parseBody(z.object({ status: z.enum(['CLEARED', 'CONFIRMED']) }), req);
    res.json(await moderationService.resolveRiskFlag(currentUser(req), req.params.id, status));
  }),
);

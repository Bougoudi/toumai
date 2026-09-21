import { Router } from 'express';
import { aiLimiter } from '../../middleware/security.js';
import { requirePermission } from '../admin/permissions.js';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, parseBody, parseQuery } from '../../middleware/validate.js';
import { badRequest, notFound } from '../lib/errors.js';
import { authenticate, currentUser, optionalAuth, requireAdmin, requireRole } from '../middleware/toumaAuth.js';
import { assistant, type Surface } from './agents/agent.js';
import { confirmationService } from './confirmation.service.js';
import { memoryService } from './memory.service.js';
import { usageService } from './usage.service.js';
import { evaluationService } from './evaluation.service.js';

/**
 * Points d'entrée conversationnels (§61).
 *
 * Un routeur par espace, parce que l'espace décide des outils : mélanger
 * `/ai/chat` et `/seller/ai` sur une même route laisserait la surface au choix
 * de l'appelant, et un acheteur demanderait la surface vendeur.
 */

const chatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationId: z.string().cuid().optional(),
  locale: z.enum(['fr', 'ar']).optional(),
  confirmationId: z.string().cuid().optional(),
});

function chatHandler(surface: Surface) {
  return asyncHandler(async (req, res) => {
    const input = parseBody(chatSchema, req);
    res.json(await assistant.chat(req.toumaUser ?? null, { ...input, surface }));
  });
}

// ── Espace acheteur : /api/v1/ai ────────────────────────────────────────────
export const aiChatRouter = Router();

aiChatRouter.post('/chat', optionalAuth, aiLimiter, chatHandler('BUYER'));

aiChatRouter.get(
  '/capabilities',
  optionalAuth,
  asyncHandler(async (req, res) => res.json(assistant.capabilities(req.toumaUser ?? null, 'BUYER'))),
);

aiChatRouter.get(
  '/conversations',
  authenticate,
  asyncHandler(async (req, res) => res.json(await assistant.listConversations(currentUser(req)))),
);

aiChatRouter.get(
  '/conversations/:id',
  authenticate,
  asyncHandler(async (req, res) => res.json(await assistant.getConversation(currentUser(req), req.params.id))),
);

aiChatRouter.delete(
  '/conversations/:id',
  authenticate,
  asyncHandler(async (req, res) => res.json(await assistant.deleteConversation(currentUser(req), req.params.id))),
);

/**
 * Retour utilisateur (§39).
 *
 * Le verdict est une liste fermée : « incorrect » et « prix faux » ne
 * demandent pas la même vérification, et un champ libre unique produirait un
 * tas de textes que personne ne trierait.
 */
const feedbackSchema = z.object({
  messageId: z.string().cuid(),
  verdict: z.enum(['HELPFUL', 'NOT_HELPFUL', 'INCORRECT', 'OUTDATED', 'IRRELEVANT', 'UNSAFE', 'WRONG_PRODUCT', 'WRONG_PRICE']),
  comment: z.string().trim().max(1000).optional(),
});

aiChatRouter.post(
  '/feedback',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = parseBody(feedbackSchema, req);
    const user = currentUser(req);
    const message = await prisma.toumaAiMessage.findFirst({
      where: { id: input.messageId, conversation: { userId: user.id } },
      select: { id: true, conversationId: true },
    });
    // On ne note que ce qu'on a reçu : sans ce contrôle, n'importe qui
    // pourrait signaler le message de n'importe qui et fausser la mesure de
    // qualité — qui sert ensuite à décider si l'assistant reste ouvert.
    if (!message) throw notFound('Message introuvable.');
    const retour = await prisma.toumaAiFeedback.create({
      data: { messageId: message.id, conversationId: message.conversationId, userId: user.id, verdict: input.verdict, comment: input.comment ?? null },
      select: { id: true, verdict: true, createdAt: true },
    });
    res.status(201).json({ ...retour, message: 'Merci. Ce signalement est lu par l’équipe Touma.' });
  }),
);

// ── Confirmations d'action ──────────────────────────────────────────────────
aiChatRouter.get(
  '/confirmations',
  authenticate,
  asyncHandler(async (req, res) => res.json(await confirmationService.list(currentUser(req).id))),
);

aiChatRouter.post(
  '/confirmations/:id/confirm',
  authenticate,
  asyncHandler(async (req, res) => {
    const demande = await confirmationService.confirm(currentUser(req).id, req.params.id);
    res.json({
      id: demande.id,
      status: demande.status,
      tool: demande.tool,
      /**
       * Confirmer n'exécute pas. L'exécution passe par un nouveau tour de
       * conversation portant cet identifiant, et relit les paramètres en base.
       * Deux étapes plutôt qu'une, pour que la validation et l'action laissent
       * chacune leur trace.
       */
      next: 'Renvoyez votre demande à l’assistant avec cet identifiant de confirmation pour que l’action soit exécutée.',
    });
  }),
);

aiChatRouter.post(
  '/confirmations/:id/reject',
  authenticate,
  asyncHandler(async (req, res) => res.json(await confirmationService.reject(currentUser(req).id, req.params.id))),
);

// ── Mémoire ─────────────────────────────────────────────────────────────────
aiChatRouter.get(
  '/memory',
  authenticate,
  asyncHandler(async (req, res) => res.json({ items: await memoryService.list(currentUser(req).id) })),
);

aiChatRouter.delete(
  '/memory',
  authenticate,
  asyncHandler(async (req, res) => {
    const cle = typeof req.query.key === 'string' ? req.query.key : undefined;
    res.json({ deleted: await memoryService.forget(currentUser(req).id, cle) });
  }),
);

// ── Espace vendeur : /api/v1/seller/ai ──────────────────────────────────────
export const sellerAiRouter = Router();
sellerAiRouter.use(authenticate, requireRole('SELLER', 'ADMIN'));
sellerAiRouter.post('/', aiLimiter, chatHandler('SELLER'));
sellerAiRouter.get(
  '/capabilities',
  asyncHandler(async (req, res) => res.json(assistant.capabilities(currentUser(req), 'SELLER'))),
);

// ── Espace professionnel : /api/v1/business/ai ──────────────────────────────
export const businessAiRouter = Router();
businessAiRouter.use(authenticate);
businessAiRouter.post('/', chatHandler('BUSINESS'));
businessAiRouter.get(
  '/capabilities',
  asyncHandler(async (req, res) => res.json(assistant.capabilities(currentUser(req), 'BUSINESS'))),
);

// ── Espace administration : /api/v1/admin/ai ────────────────────────────────
export const adminAiRouter = Router();
adminAiRouter.use(authenticate, requireAdmin, requirePermission('ADMIN_AI'));
adminAiRouter.post('/query', chatHandler('ADMIN'));

const joursSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

adminAiRouter.get(
  '/usage',
  asyncHandler(async (req, res) => {
    const { days } = parseQuery(joursSchema, req);
    res.json(await usageService.dashboard(days));
  }),
);

adminAiRouter.get(
  '/quality',
  asyncHandler(async (req, res) => {
    const { days } = parseQuery(joursSchema, req);
    res.json(await evaluationService.quality(days));
  }),
);

adminAiRouter.get(
  '/feedback',
  asyncHandler(async (req, res) => {
    const { days } = parseQuery(joursSchema, req);
    res.json(await evaluationService.feedbackQueue(days));
  }),
);

adminAiRouter.get(
  '/jobs',
  asyncHandler(async (_req, res) => {
    const runs = await prisma.toumaAiJobRun.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json({ items: runs });
  }),
);

/** Invites de production (§59) : lecture, création d'une version, activation. */
const promptSchema = z.object({
  feature: z.string().trim().min(2).max(80),
  body: z.string().trim().min(10).max(8000),
  notes: z.string().trim().max(500).optional(),
});

adminAiRouter.get(
  '/prompts',
  asyncHandler(async (_req, res) => {
    const items = await prisma.toumaAiPromptVersion.findMany({ orderBy: [{ feature: 'asc' }, { version: 'desc' }], take: 100 });
    res.json({ items });
  }),
);

adminAiRouter.post(
  '/prompts',
  asyncHandler(async (req, res) => {
    const input = parseBody(promptSchema, req);
    const dernier = await prisma.toumaAiPromptVersion.findFirst({ where: { feature: input.feature }, orderBy: { version: 'desc' }, select: { version: true } });
    const version = await prisma.toumaAiPromptVersion.create({
      data: { feature: input.feature, version: (dernier?.version ?? 0) + 1, body: input.body, notes: input.notes ?? null, createdBy: currentUser(req).id, active: false },
    });
    // Créée **inactive**. Une nouvelle version d'invite qui s'activerait seule
    // changerait le comportement de production sans que personne ne l'ait
    // décidé — ce que §59 interdit explicitement.
    res.status(201).json({ ...version, note: 'Version créée inactive. Activez-la explicitement pour qu’elle serve en production.' });
  }),
);

adminAiRouter.post(
  '/prompts/:id/activate',
  asyncHandler(async (req, res) => {
    const version = await prisma.toumaAiPromptVersion.findUnique({ where: { id: req.params.id } });
    if (!version) throw notFound('Version d’invite introuvable.');
    if (version.active) throw badRequest('Cette version est déjà active.');
    // Désactivation puis activation dans la même transaction : l'index unique
    // partiel refuserait deux versions actives, et une transaction évite de
    // laisser la fonctionnalité sans invite entre les deux écritures.
    await prisma.$transaction([
      prisma.toumaAiPromptVersion.updateMany({ where: { feature: version.feature, active: true }, data: { active: false } }),
      prisma.toumaAiPromptVersion.update({ where: { id: version.id }, data: { active: true } }),
    ]);
    res.json({ id: version.id, feature: version.feature, version: version.version, active: true });
  }),
);

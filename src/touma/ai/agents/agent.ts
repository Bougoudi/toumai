import { prisma } from '../../../db/prisma.js';
import { env } from '../../../config/env.js';
import { badRequest, forbidden, notFound, serviceUnavailable } from '../../lib/errors.js';
import type { ToumaRequestUser } from '../../middleware/toumaAuth.js';
import { aiGateway } from '../gateway.js';
import { detectInjection } from '../injection.js';
import { memoryService } from '../memory.service.js';
import { maskPersonalData } from '../privacy.js';
import { RunBudget, runTool, type ToolCallOutcome } from '../tools/runner.js';
import { toolsFor, type ToolContext } from '../tools/registry.js';
import { compose } from './composer.js';
import { planFromMessage } from './intent.js';

/**
 * ASSISTANT TOUMA (§10, §36).
 *
 * L'enchaînement complet d'un tour :
 *
 *   message → analyse d'injection → plan → outils réels → rédaction → trace
 *
 * Deux choses n'arrivent jamais ici.
 *
 * **Le modèle ne voit pas la base.** Il ne reçoit que ce que les outils ont
 * rapporté, encadré comme données externes. Un résultat d'outil contient du
 * texte écrit par des tiers — une description de produit, un message de
 * vendeur — et une consigne qu'on y aurait glissée doit rester une donnée.
 *
 * **Le modèle ne choisit pas les faits.** Les chiffres affichés sont rédigés
 * par le composeur à partir des résultats d'outils. Un modèle branché sert à
 * tourner la phrase, jamais à fournir un prix.
 */

export type Surface = ToolContext['surface'];

const SURFACES_PAR_ROLE: Record<string, Surface[]> = {
  BUYER: ['BUYER', 'BUSINESS', 'SUPPORT'],
  SELLER: ['BUYER', 'SELLER', 'BUSINESS', 'SUPPORT'],
  ADMIN: ['BUYER', 'SELLER', 'BUSINESS', 'SUPPORT', 'ADMIN'],
};

function assertSurface(user: ToumaRequestUser | null, surface: Surface): void {
  if (!user) {
    // Un visiteur reste sur l'espace acheteur. Les autres exposent des outils
    // qui demandent un compte, et les proposer sans compte reviendrait à
    // promettre ce qui sera refusé à l'exécution.
    if (surface !== 'BUYER') throw forbidden('Connectez-vous pour utiliser cet espace de l’assistant.');
    return;
  }
  const permises = SURFACES_PAR_ROLE[user.role] ?? ['BUYER'];
  if (!permises.includes(surface)) throw forbidden('Votre rôle ne donne pas accès à cet espace de l’assistant.');
}

function featureEnabled(surface: Surface): boolean {
  const c = env.touma.ai;
  if (!c.enabled || !c.chatEnabled) return false;
  if (surface === 'SELLER') return c.sellerCopilotEnabled;
  if (surface === 'BUSINESS') return c.businessEnabled;
  if (surface === 'ADMIN') return c.adminEnabled;
  return true;
}

export interface ChatInput {
  message: string;
  conversationId?: string | null;
  surface?: Surface;
  locale?: string;
  /** Confirmation apportée par l'utilisateur pour une action en attente. */
  confirmationId?: string | null;
}

export const assistant = {
  /** Outils réellement disponibles depuis un espace, pour l'interface. */
  capabilities(user: ToumaRequestUser | null, surface: Surface) {
    assertSurface(user, surface);
    const outils = toolsFor({ user, surface, conversationId: null, locale: 'fr' });
    return {
      surface,
      enabled: featureEnabled(surface),
      tools: outils.map((t) => ({ name: t.name, description: t.description, risk: t.risk })),
      /** §41/§42 rendus visibles : ce que l'assistant ne fera jamais seul. */
      neverAutomatic: ['paiement', 'remboursement', 'versement au vendeur', 'confirmation de commande', 'restriction d’un vendeur', 'publication d’un produit'],
    };
  },

  async chat(user: ToumaRequestUser | null, input: ChatInput) {
    const surface: Surface = input.surface ?? 'BUYER';
    assertSurface(user, surface);
    if (!featureEnabled(surface)) throw serviceUnavailable('L’assistant Touma est désactivé pour cet espace.');

    const conversation = await resoudreConversation(user, input, surface);
    const ctx: ToolContext = { user, surface, conversationId: conversation.id, locale: input.locale ?? conversation.locale };

    // Plafonds d'usage. Vérifiés avant tout travail : un utilisateur au-delà de
    // sa limite ne doit pas déclencher une série d'appels d'outils.
    await aiGateway.guard({ feature: `chat_${surface.toLowerCase()}`, scope: { userId: user?.id ?? null }, enabled: true });

    const propre = maskPersonalData(input.message.trim()).slice(0, 2000);
    const verdict = detectInjection(input.message);

    await prisma.toumaAiMessage.create({
      data: { conversationId: conversation.id, role: 'USER', content: propre, injectionScore: verdict.score.toFixed(4) },
    });

    const memoire = user ? await memoryService.recall(user.id) : {};
    const plan = planFromMessage(input.message, ctx, memoire);

    // Exécution des outils, sous budget. Une confirmation apportée par
    // l'utilisateur ne s'applique qu'au premier appel du plan : un jeton de
    // validation ne doit pas couvrir une série d'actions.
    const budget = new RunBudget();
    const resultats: ToolCallOutcome[] = [];
    let confirmation = input.confirmationId ?? null;
    for (const appel of plan.calls) {
      resultats.push(await runTool({ ...appel, confirmationId: confirmation }, ctx, budget));
      confirmation = null;
    }

    const enAttente = resultats.find((r) => r.awaitingConfirmation);
    const reponse = enAttente
      ? {
          text: `${enAttente.confirmation!.summary}\n\nCette action demande votre confirmation avant que je l’exécute.`,
          cards: [],
          unavailable: [],
          suggestions: ['Confirmer', 'Annuler'],
        }
      : compose(plan.intent, plan.understood, resultats, { fallback: true, providerMessage: null });

    if (user && plan.remember) {
      for (const m of plan.remember) await memoryService.remember(user.id, m.key, m.value, conversation.id);
    }

    const message = await prisma.toumaAiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: reponse.text,
        attachments: reponse.cards as object,
        provider: 'RULE_BASED',
        model: 'touma-rules-v1',
      },
    });

    await prisma.toumaAiToolCall.updateMany({ where: { conversationId: conversation.id, messageId: null }, data: { messageId: message.id } });
    await prisma.toumaAiConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date(), ...(conversation.title ? {} : { title: propre.slice(0, 80) }) } });

    return {
      conversationId: conversation.id,
      messageId: message.id,
      intent: plan.intent,
      /** Ce que l'assistant a compris, pour que l'utilisateur puisse corriger. */
      understood: plan.understood,
      answer: reponse.text,
      cards: reponse.cards,
      unavailable: reponse.unavailable,
      suggestions: reponse.suggestions,
      ...(enAttente ? { confirmation: enAttente.confirmation } : {}),
      /** Traçabilité visible : quels outils ont été appelés, et lesquels ont échoué. */
      toolCalls: resultats.map((r) => ({ tool: r.tool, ok: r.ok, summary: r.summary, latencyMs: r.latencyMs })),
      /**
       * Dit à chaque tour d'où vient la réponse. Sans fournisseur réel, ce sont
       * des règles locales et des requêtes en base — et l'utilisateur a le droit
       * de le savoir plutôt que de croire parler à un modèle.
       */
      source: {
        provider: 'RULE_BASED',
        realProviderConfigured: false,
        note: 'Réponse composée à partir des données réelles de Touma par des règles locales. Aucun modèle de langage externe n’est configuré.',
      },
      injection: verdict.suspicious ? { detected: true, codes: verdict.codes } : { detected: false, codes: [] },
    };
  },

  async listConversations(user: ToumaRequestUser, limit = 20) {
    return prisma.toumaAiConversation.findMany({
      where: { userId: user.id },
      orderBy: { lastMessageAt: 'desc' },
      take: limit,
      select: { id: true, title: true, surface: true, locale: true, lastMessageAt: true, createdAt: true, _count: { select: { messages: true } } },
    });
  },

  async getConversation(user: ToumaRequestUser, id: string) {
    const conversation = await prisma.toumaAiConversation.findFirst({
      where: { id, userId: user.id },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, take: 100, select: { id: true, role: true, content: true, attachments: true, createdAt: true } },
        // La trace d'outils est rendue avec la conversation : §36 demande que
        // les appels soient auditables, et le premier public de cet audit est
        // la personne dont on a lu les données.
        toolCalls: { orderBy: { createdAt: 'asc' }, take: 100, select: { tool: true, riskLevel: true, ok: true, summary: true, error: true, createdAt: true } },
      },
    });
    if (!conversation) throw notFound('Conversation introuvable.');
    return conversation;
  },

  async deleteConversation(user: ToumaRequestUser, id: string) {
    const { count } = await prisma.toumaAiConversation.deleteMany({ where: { id, userId: user.id } });
    if (count === 0) throw notFound('Conversation introuvable.');
    return { deleted: true };
  },
};

async function resoudreConversation(user: ToumaRequestUser | null, input: ChatInput, surface: Surface) {
  if (input.conversationId) {
    const existante = await prisma.toumaAiConversation.findFirst({
      // `userId: null` pour un visiteur, et non `undefined`.
      //
      // Écrit `user?.id ?? undefined`, le filtre disparaissait entièrement et
      // un visiteur qui devinait un identifiant reprenait la conversation de
      // quelqu'un d'autre — il y écrivait ses messages. `null` filtre sur les
      // conversations sans propriétaire, qui sont les seules qu'un visiteur
      // puisse avoir ouvertes.
      where: { id: input.conversationId, userId: user ? user.id : null },
    });
    if (!existante) throw notFound('Conversation introuvable.');
    if (existante.surface !== surface) throw badRequest('Cette conversation appartient à un autre espace de l’assistant.');
    return existante;
  }
  return prisma.toumaAiConversation.create({
    data: { userId: user?.id ?? null, surface, locale: input.locale ?? 'fr' },
  });
}

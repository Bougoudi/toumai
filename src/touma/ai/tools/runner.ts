import { createHash } from 'node:crypto';
import { prisma } from '../../../db/prisma.js';
import { env } from '../../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { minimizeForProvider } from '../privacy.js';
import { confirmationService } from '../confirmation.service.js';
import { getTool, isRoleAllowed, requiresConfirmation, type AiTool, type ToolContext } from './registry.js';
import './catalog.tools.js';
import './orders.tools.js';
import './trust.tools.js';
import './seller.tools.js';
import './b2b.tools.js';
import './admin.tools.js';
import './insights.tools.js';
import './trade.tools.js';

/**
 * EXÉCUTEUR D'OUTILS (§7, §42, §43, §45).
 *
 * Toute exécution d'outil passe par ici, et y subit dans l'ordre :
 *
 *   1. l'existence de l'outil,
 *   2. la surface et le rôle,
 *   3. la validation zod des arguments,
 *   4. la porte de confirmation pour les niveaux sensibles,
 *   5. les bornes de boucle,
 *   6. l'exécution,
 *   7. l'inscription au journal d'audit.
 *
 * L'audit est écrit **même en cas d'échec**. Un refus est précisément ce qu'on
 * veut retrouver : une tentative d'accès à la commande d'un autre laisse une
 * trace, sinon la seule chose qu'on saurait d'une attaque est qu'elle n'a pas
 * marché.
 */

export interface ToolCallRequest {
  tool: string;
  args: unknown;
  /** Identifiant d'une confirmation humaine, pour un outil qui l'exige. */
  confirmationId?: string | null;
}

export interface ToolCallOutcome {
  tool: string;
  ok: boolean;
  /** `true` quand l'outil attend une confirmation humaine avant d'agir. */
  awaitingConfirmation?: boolean;
  confirmation?: { id: string; summary: string; riskLevel: string; expiresAt: Date };
  data?: unknown;
  summary: string;
  cards?: Array<Record<string, unknown>>;
  error?: string;
  latencyMs: number;
}

/** Empreinte des arguments : reconnaît un appel identique sans les conserver. */
export function hashArgs(tool: string, args: unknown): string {
  return createHash('sha256').update(`${tool}:${stableStringify(args)}`).digest('hex').slice(0, 32);
}

/** JSON à clés triées : `{a,b}` et `{b,a}` sont le même appel. */
function stableStringify(valeur: unknown): string {
  if (valeur === null || typeof valeur !== 'object') return JSON.stringify(valeur) ?? 'null';
  if (Array.isArray(valeur)) return `[${valeur.map(stableStringify).join(',')}]`;
  const entrees = Object.entries(valeur as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entrees.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * Compteur d'une exécution d'assistant.
 *
 * Porté par l'appelant plutôt que global : deux utilisateurs simultanés ne
 * doivent pas se partager un quota de boucle. Trois bornes, parce que les
 * emballements ne se ressemblent pas — un agent qui appelle vingt outils
 * différents, un qui rappelle le même en boucle, et un qui reste bloqué sur un
 * outil lent.
 */
export class RunBudget {
  private appels = 0;
  private readonly debut = Date.now();
  private readonly vus = new Map<string, number>();

  constructor(
    readonly maxCalls = env.touma.ai.maxToolCalls,
    readonly maxRunMs = env.touma.ai.maxRunMs,
    readonly maxRepeats = 2,
  ) {}

  /** Lève si une borne est franchie. Message en français, destiné à l'écran. */
  consume(empreinte: string): void {
    this.appels += 1;
    if (this.appels > this.maxCalls) throw new HttpError(429, `L’assistant a atteint sa limite de ${this.maxCalls} appels d’outils pour cette demande.`);
    if (Date.now() - this.debut > this.maxRunMs) throw new HttpError(429, 'L’assistant a dépassé son temps d’exécution pour cette demande.');
    const repetitions = (this.vus.get(empreinte) ?? 0) + 1;
    this.vus.set(empreinte, repetitions);
    // Le même outil avec les mêmes arguments une troisième fois n'apportera
    // pas une réponse différente : c'est une boucle, et l'arrêter tôt évite de
    // payer trois fois pour le même résultat.
    if (repetitions > this.maxRepeats) throw new HttpError(429, 'L’assistant répète le même appel : exécution interrompue.');
  }

  get calls(): number {
    return this.appels;
  }
}

async function auditer(input: {
  ctx: ToolContext;
  tool: string;
  risk: string;
  argsHash: string;
  args: unknown;
  summary: string | null;
  ok: boolean;
  error?: string;
  latencyMs: number;
  confirmationId?: string | null;
}): Promise<void> {
  await prisma.toumaAiToolCall
    .create({
      data: {
        conversationId: input.ctx.conversationId,
        userId: input.ctx.user?.id ?? null,
        tool: input.tool,
        riskLevel: input.risk as never,
        argsHash: input.argsHash,
        // Les arguments sont minimisés avant écriture : un identifiant de
        // commande est utile à l'audit, une adresse recopiée ne l'est pas.
        args: minimizeForProvider(input.args) as object,
        summary: input.summary,
        ok: input.ok,
        error: input.error ?? null,
        latencyMs: input.latencyMs,
        confirmationId: input.confirmationId ?? null,
      },
    })
    .catch(() => undefined);
}

/** Refus commun : trace puis renvoie un résultat d'échec lisible. */
async function refuser(ctx: ToolContext, tool: string, risk: string, empreinte: string, args: unknown, message: string, debut: number): Promise<ToolCallOutcome> {
  const latencyMs = Date.now() - debut;
  await auditer({ ctx, tool, risk, argsHash: empreinte, args, summary: null, ok: false, error: message, latencyMs });
  return { tool, ok: false, summary: message, error: message, latencyMs };
}

export async function runTool(request: ToolCallRequest, ctx: ToolContext, budget: RunBudget): Promise<ToolCallOutcome> {
  const debut = Date.now();
  const empreinte = hashArgs(request.tool, request.args);
  const outil: AiTool | undefined = getTool(request.tool);

  if (!outil) {
    // Un outil inconnu n'est jamais une erreur bénigne : soit le modèle en a
    // inventé un, soit quelqu'un en essaie un au hasard. Les deux s'inscrivent.
    return refuser(ctx, request.tool, 'READ_ONLY', empreinte, request.args, `Outil inconnu : ${request.tool}.`, debut);
  }

  try {
    budget.consume(empreinte);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Limite atteinte.';
    return refuser(ctx, outil.name, outil.risk, empreinte, request.args, message, debut);
  }

  if (!outil.surfaces.includes(ctx.surface)) {
    return refuser(ctx, outil.name, outil.risk, empreinte, request.args, `L’outil « ${outil.name} » n’est pas disponible depuis cet espace.`, debut);
  }
  if (!isRoleAllowed(outil, ctx.user?.role ?? null)) {
    return refuser(ctx, outil.name, outil.risk, empreinte, request.args, `Votre rôle ne permet pas d’utiliser « ${outil.name} ».`, debut);
  }

  const analyse = outil.inputSchema.safeParse(request.args);
  if (!analyse.success) {
    // Des arguments malformés viennent d'un modèle qui a mal compris ou de
    // quelqu'un qui essaie. Dans les deux cas l'outil ne s'exécute pas : le
    // schéma est la frontière, pas une indication.
    const detail = analyse.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`).join(' ; ');
    return refuser(ctx, outil.name, outil.risk, empreinte, request.args, `Arguments invalides pour « ${outil.name} » — ${detail}`, debut);
  }

  // ── Porte de confirmation ─────────────────────────────────────────────────
  if (requiresConfirmation(outil.risk)) {
    if (!ctx.user) {
      return refuser(ctx, outil.name, outil.risk, empreinte, analyse.data, 'Cette action demande un compte connecté et une confirmation.', debut);
    }
    if (!request.confirmationId) {
      const demande = await confirmationService.create({
        userId: ctx.user.id,
        conversationId: ctx.conversationId,
        tool: outil.name,
        riskLevel: outil.risk,
        parameters: analyse.data as Record<string, unknown>,
        summary: `${outil.description.split('.')[0]}.`,
      });
      const latencyMs = Date.now() - debut;
      await auditer({ ctx, tool: outil.name, risk: outil.risk, argsHash: empreinte, args: analyse.data, summary: 'Confirmation demandée.', ok: true, latencyMs, confirmationId: demande.id });
      return {
        tool: outil.name,
        ok: true,
        awaitingConfirmation: true,
        confirmation: { id: demande.id, summary: demande.summary, riskLevel: demande.riskLevel, expiresAt: demande.expiresAt },
        summary: 'Cette action demande votre confirmation avant d’être exécutée.',
        latencyMs,
      };
    }
    try {
      // Les paramètres exécutés sont ceux **enregistrés**, jamais ceux renvoyés
      // avec la confirmation : sinon il suffirait de valider un texte à l'écran
      // et d'en exécuter un autre.
      const demande = await confirmationService.requireConfirmed(ctx.user.id, request.confirmationId, outil.name);
      const resultat = await outil.handler(demande.parameters as never, ctx);
      await confirmationService.markExecuted(demande.id, null);
      const latencyMs = Date.now() - debut;
      await auditer({ ctx, tool: outil.name, risk: outil.risk, argsHash: empreinte, args: demande.parameters, summary: resultat.summary, ok: true, latencyMs, confirmationId: demande.id });
      return { tool: outil.name, ok: true, data: resultat.data, summary: resultat.summary, cards: resultat.cards, latencyMs };
    } catch (err) {
      const message = err instanceof HttpError ? err.message : 'Confirmation invalide.';
      return refuser(ctx, outil.name, outil.risk, empreinte, analyse.data, message, debut);
    }
  }

  // ── Exécution ─────────────────────────────────────────────────────────────
  try {
    const resultat = await outil.handler(analyse.data as never, ctx);
    const latencyMs = Date.now() - debut;
    await auditer({ ctx, tool: outil.name, risk: outil.risk, argsHash: empreinte, args: analyse.data, summary: resultat.summary, ok: true, latencyMs });
    return { tool: outil.name, ok: true, data: resultat.data, summary: resultat.summary, cards: resultat.cards, latencyMs };
  } catch (err) {
    // Un refus du service métier — 403, 404 — remonte tel quel : c'est lui qui
    // décide, et son message est le bon. Toute autre erreur est rendue
    // générique : un message d'exception de base de données n'a rien à faire
    // dans une conversation avec un acheteur.
    const message = err instanceof HttpError ? err.message : `L’outil « ${outil.name} » n’a pas abouti.`;
    return refuser(ctx, outil.name, outil.risk, empreinte, analyse.data, message, debut);
  }
}

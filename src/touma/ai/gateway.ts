import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { serviceUnavailable, tooManyRequests } from '../lib/errors.js';
import { minimizeForProvider } from './privacy.js';
import { sanitizeSegments } from './injection.js';
import { route, RULE_BASED, type Routage } from './registry.js';
import { usageService, type UsageScope } from './usage.service.js';
import {
  ProviderNotConfigured,
  ProviderUnsupported,
  type AiSegment,
  type AiTask,
  type ClassifyTextResult,
  type GenerateTextResult,
  type ModerateResult,
  type StructuredResult,
} from './ai.types.js';

/**
 * PASSERELLE D'IA — le passage obligé (§2).
 *
 * Rien n'appelle un fournisseur directement. Tout passe ici, et ici seulement
 * s'appliquent, dans cet ordre :
 *
 *   1. le coupe-circuit de fonctionnalité,
 *   2. les plafonds d'usage,
 *   3. la détection d'injection sur les segments externes,
 *   4. la minimisation des données,
 *   5. le routage vers un fournisseur et un modèle,
 *   6. le repli local en cas d'échec,
 *   7. l'inscription de la consommation et de la trace.
 *
 * Un seul chemin, parce qu'une garantie qui dépend de la discipline de chaque
 * appelant n'est pas une garantie. Si demain un développeur ajoute une
 * fonctionnalité d'IA, il n'a pas à se souvenir de sept règles : il appelle la
 * passerelle et les sept s'appliquent.
 */

export interface GatewayContext {
  feature: string;
  scope: UsageScope;
  conversationId?: string | null;
  /** Coupe-circuit propre à la fonctionnalité, évalué en plus du coupe-circuit général. */
  enabled?: boolean;
}

export interface GatewayMeta {
  provider: string;
  model: string;
  fallback: boolean;
  fallbackReason: string | null;
  injectionScore: number;
  injectionCodes: string[];
  latencyMs: number;
}

function assertEnabled(ctx: GatewayContext): void {
  if (!env.touma.ai.enabled) throw serviceUnavailable('L’assistant Touma est désactivé.');
  if (ctx.enabled === false) throw serviceUnavailable('Cette fonction de l’assistant est désactivée.');
}

/**
 * Exécute un appel avec repli.
 *
 * Le repli n'est pas un rattrapage silencieux : `fallback` et `fallbackReason`
 * remontent jusqu'à l'appelant, et jusqu'à l'interface. Un utilisateur a le
 * droit de savoir qu'il lit une réponse produite par des règles locales plutôt
 * que par le modèle annoncé — c'est la même exigence que pour un paiement dont
 * le prestataire n'est pas branché.
 */
async function withFallback<T extends { provider: string; model: string }>(
  ctx: GatewayContext,
  task: AiTask,
  primaire: (routage: Routage) => Promise<T>,
  repli: (routage: Routage) => Promise<T>,
): Promise<{ result: T; meta: Omit<GatewayMeta, 'injectionScore' | 'injectionCodes'> }> {
  const debut = Date.now();
  const routage = route(task);

  const inscrire = async (r: { provider: string; model: string }, tokens: { inputTokens?: number; outputTokens?: number }, ok: boolean) => {
    await usageService.record({
      scope: ctx.scope,
      conversationId: ctx.conversationId ?? null,
      feature: ctx.feature,
      task,
      provider: r.provider,
      model: r.model,
      inputTokens: tokens.inputTokens ?? 0,
      outputTokens: tokens.outputTokens ?? 0,
      ok,
      latencyMs: Date.now() - debut,
    });
  };

  if (routage.fallback) {
    const result = await repli(routage);
    await inscrire(result, result as never, true);
    return { result, meta: { provider: result.provider, model: result.model, fallback: true, fallbackReason: routage.fallbackReason, latencyMs: Date.now() - debut } };
  }

  try {
    const result = await primaire(routage);
    await inscrire(result, result as never, true);
    return { result, meta: { provider: result.provider, model: result.model, fallback: false, fallbackReason: null, latencyMs: Date.now() - debut } };
  } catch (err) {
    // Le fournisseur réel a échoué : délai dépassé, panne, capacité manquante.
    // L'application continue (§47). Elle ne rend pas une erreur à quelqu'un qui
    // cherchait un produit parce qu'un tiers est indisponible.
    const raison =
      err instanceof ProviderNotConfigured || err instanceof ProviderUnsupported
        ? err.message
        : `Fournisseur « ${routage.provider.code} » indisponible.`;
    await inscrire({ provider: routage.provider.code, model: routage.model }, {}, false);
    const routageRepli: Routage = { provider: RULE_BASED, model: RULE_BASED.defaultModel, fallback: true, fallbackReason: raison };
    const result = await repli(routageRepli);
    await inscrire(result, result as never, true);
    return { result, meta: { provider: result.provider, model: result.model, fallback: true, fallbackReason: raison, latencyMs: Date.now() - debut } };
  }
}

/** Prépare les segments : détection d'injection puis minimisation. */
function prepare(segments: AiSegment[]) {
  const nettoyes = sanitizeSegments(segments);
  const minimises = nettoyes.segments.map((s) =>
    // Seuls les segments qui sortent de Touma sont minimisés. La consigne
    // système est écrite par nous et ne contient rien de personnel ; la passer
    // au masque n'apporterait rien et abîmerait des exemples.
    s.origin === 'SYSTEM' || s.origin === 'TOOL_POLICY' ? s : { ...s, content: String(minimizeForProvider(s.content)) },
  );
  return { segments: minimises, score: nettoyes.score, codes: nettoyes.codes };
}

export const aiGateway = {
  /** État du fournisseur, sans appel réseau. */
  async guard(ctx: GatewayContext): Promise<void> {
    assertEnabled(ctx);
    const verdict = await usageService.check(ctx.scope);
    if (!verdict.allowed) throw tooManyRequests(verdict.message ?? 'Limite d’utilisation de l’assistant atteinte.');
  },

  async generateText(
    ctx: GatewayContext,
    input: { task?: AiTask; segments: AiSegment[]; maxWords?: number; locale?: string },
  ): Promise<{ result: GenerateTextResult; meta: GatewayMeta }> {
    await this.guard(ctx);
    const prepared = prepare(input.segments);
    const task = input.task ?? 'GENERATE';
    const requete = { task, feature: ctx.feature, segments: prepared.segments, maxWords: input.maxWords, locale: input.locale };
    const { result, meta } = await withFallback<GenerateTextResult>(
      ctx,
      task,
      (r) => r.provider.generateText(requete, r.model),
      (r) => r.provider.generateText(requete, r.model),
    );
    return { result, meta: { ...meta, injectionScore: prepared.score, injectionCodes: prepared.codes } };
  },

  /**
   * Sortie structurée. Le résultat est **brut** : la validation appartient à
   * l'appelant, qui seul connaît son schéma zod (§46).
   */
  async structured(
    ctx: GatewayContext,
    input: { segments: AiSegment[]; schemaName: string; schemaDescription: string },
  ): Promise<{ result: StructuredResult; meta: GatewayMeta }> {
    await this.guard(ctx);
    const prepared = prepare(input.segments);
    const requete = { task: 'STRUCTURED' as const, feature: ctx.feature, segments: prepared.segments, schemaName: input.schemaName, schemaDescription: input.schemaDescription };
    const { result, meta } = await withFallback<StructuredResult>(
      ctx,
      'STRUCTURED',
      (r) => r.provider.generateStructuredOutput(requete, r.model),
      (r) => r.provider.generateStructuredOutput(requete, r.model),
    );
    return { result, meta: { ...meta, injectionScore: prepared.score, injectionCodes: prepared.codes } };
  },

  async classify(ctx: GatewayContext, input: { text: string; labels: string[] }): Promise<{ result: ClassifyTextResult; meta: GatewayMeta }> {
    await this.guard(ctx);
    const prepared = prepare([{ origin: 'EXTERNAL', content: input.text, label: 'texte à classer' }]);
    const requete = { feature: ctx.feature, text: prepared.segments[0].content, labels: input.labels };
    const { result, meta } = await withFallback<ClassifyTextResult>(
      ctx,
      'CLASSIFY',
      (r) => r.provider.classify(requete, r.model),
      (r) => r.provider.classify(requete, r.model),
    );
    return { result, meta: { ...meta, injectionScore: prepared.score, injectionCodes: prepared.codes } };
  },

  async moderate(ctx: GatewayContext, input: { text: string }): Promise<{ result: ModerateResult; meta: GatewayMeta }> {
    await this.guard(ctx);
    const prepared = prepare([{ origin: 'EXTERNAL', content: input.text, label: 'texte à modérer' }]);
    const requete = { feature: ctx.feature, text: prepared.segments[0].content };
    const { result, meta } = await withFallback<ModerateResult>(
      ctx,
      'MODERATE',
      (r) => r.provider.moderate(requete, r.model),
      (r) => r.provider.moderate(requete, r.model),
    );
    return { result, meta: { ...meta, injectionScore: prepared.score, injectionCodes: prepared.codes } };
  },

  /**
   * Trace d'un appel, dans le modèle existant `ToumaAiRequest`.
   *
   * `input` et `output` sont minimisés avant écriture. C'est le défaut relevé à
   * l'audit : l'invite était recopiée telle quelle en base, y compris ce qu'un
   * utilisateur y avait collé sans réfléchir.
   */
  async trace(input: {
    userId: string | null;
    provider: string;
    kind: string;
    useCase: string;
    payload: object;
    output?: object;
    ok: boolean;
    latencyMs: number;
    error?: string;
  }): Promise<string | null> {
    const ligne = await prisma.toumaAiRequest
      .create({
        data: {
          userId: input.userId,
          provider: input.provider,
          kind: input.kind,
          useCase: input.useCase,
          input: minimizeForProvider(input.payload) as object,
          output: (input.output ? minimizeForProvider(input.output) : {}) as object,
          status: input.ok ? 'OK' : 'ERROR',
          latencyMs: input.latencyMs,
          error: input.error ?? null,
        },
        select: { id: true },
      })
      .catch(() => null);
    return ligne?.id ?? null;
  },
};

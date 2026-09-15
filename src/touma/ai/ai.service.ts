import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { HeuristicAiProvider } from './providers/heuristic.provider.js';
import type { AiProvider, ClassifyRequest, GenerateRequest, RecommendRequest } from './ai.types.js';

const providers = new Map<string, AiProvider>();

export function registerAiProvider(provider: AiProvider): void {
  providers.set(provider.code, provider);
}

registerAiProvider(new HeuristicAiProvider());

function activeProvider(): AiProvider {
  const provider = providers.get(env.touma.aiProvider) ?? providers.get('mock');
  if (!provider) throw new Error('Aucun fournisseur d’IA enregistré.');
  return provider;
}

/** Trace chaque appel (traçabilité, coûts, débogage) sans jamais bloquer l'appelant. */
async function traced<T>(userId: string | null, kind: string, useCase: string, input: object, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const provider = activeProvider();
  try {
    const output = await run();
    await prisma.toumaAiRequest
      .create({
        data: {
          userId,
          provider: provider.code,
          kind,
          useCase,
          input: input as object,
          output: output as object,
          status: 'OK',
          latencyMs: Date.now() - started,
        },
      })
      .catch(() => undefined);
    return output;
  } catch (err) {
    await prisma.toumaAiRequest
      .create({
        data: {
          userId,
          provider: provider.code,
          kind,
          useCase,
          input: input as object,
          status: 'ERROR',
          latencyMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        },
      })
      .catch(() => undefined);
    throw err;
  }
}

export const aiService = {
  providerInfo() {
    const p = activeProvider();
    return { code: p.code, name: p.name };
  },

  async generate(userId: string | null, request: GenerateRequest) {
    return traced(userId, 'generate', request.useCase, request as object, () => activeProvider().generate(request));
  },

  async classify(userId: string | null, request: ClassifyRequest) {
    return traced(userId, 'classify', request.useCase, request as object, () => activeProvider().classify(request));
  },

  async recommend(userId: string | null, request: RecommendRequest) {
    const result = await traced(userId, 'recommend', request.useCase, request as object, () => activeProvider().recommend(request));
    // Les recommandations sont persistées : elles restent des *propositions*
    // tant qu'un humain ne les a pas acceptées (`acceptedAt`).
    await prisma.toumaAiRecommendation
      .createMany({
        data: result.items.map((i) => ({
          targetType: i.targetType,
          targetId: i.targetId,
          score: i.score.toFixed(4),
          reason: i.reason,
          payload: (i.payload ?? {}) as object,
        })),
      })
      .catch(() => undefined);
    return result;
  },
};

import { env } from '../../config/env.js';
import { aiGateway } from './gateway.js';
import { providerStatus } from './registry.js';
import { recommendationService } from './recommendation.service.js';
import type { RecommendationItem } from './ai.types.recommend.js';
import type { AiSegment } from './ai.types.js';

/**
 * Services d'IA de premier niveau : génération, classement, recommandation.
 *
 * Tout passe par `aiGateway`. Ce fichier n'appelle jamais un fournisseur
 * directement et n'a aucune raison de le faire.
 */

export type GenerateUseCase = 'product_description' | 'product_title' | 'store_pitch' | 'support_reply';

/**
 * Consignes système, par cas d'usage.
 *
 * Elles disent toutes la même chose sous des formes différentes : n'invente
 * pas. C'est répétitif à lire et c'est le point (§14, §71) — la consigne la
 * plus utile est celle qui interdit d'ajouter ce qu'on ne sait pas.
 */
const CONSIGNES: Record<GenerateUseCase, string> = {
  product_description:
    "Tu rédiges une fiche produit pour la place de marché Touma. N'utilise QUE les informations fournies. N'invente jamais : matière, dimensions, certification, garantie, norme, origine, allégation médicale ou technique. Ce qui n'est pas fourni doit être présenté comme à compléter par le vendeur. Écris en français simple, pour une lecture sur téléphone.",
  product_title:
    "Tu proposes un titre de produit court (moins de 120 caractères) à partir des seules informations fournies. Aucune promesse, aucun superlatif, aucune donnée inventée.",
  store_pitch:
    "Tu rédiges une présentation de boutique à partir des seules informations fournies. N'invente ni ancienneté, ni nombre de clients, ni certification, ni chiffre.",
  support_reply:
    "Tu proposes un brouillon de réponse au service client. Tu ne promets jamais un remboursement, un délai ou un geste commercial : ce sont des décisions humaines. Si l'information manque, dis-le.",
};

export const aiService = {
  /**
   * Qui répond réellement, et s'il s'agit d'un modèle réel ou du repli.
   *
   * Les drapeaux sont **énumérés un par un**, jamais diffusés en bloc depuis la
   * configuration. Ce point d'entrée est public : y répandre `env.touma.ai`
   * publierait `AI_API_KEY` sur une route sans authentification. La liste
   * explicite est plus longue à écrire, et c'est précisément ce qui la rend
   * sûre — ajouter un secret à la configuration ne l'ajoute pas à la réponse.
   */
  providerInfo() {
    const c = env.touma.ai;
    return {
      ...providerStatus(),
      features: {
        enabled: c.enabled,
        chat: c.chatEnabled,
        search: c.searchEnabled,
        recommendations: c.recommendationsEnabled,
        sellerCopilot: c.sellerCopilotEnabled,
        business: c.businessEnabled,
        admin: c.adminEnabled,
        embeddings: c.embeddingsEnabled,
        automation: c.automationEnabled,
      },
    };
  },

  /** Génère un texte. Le résultat est toujours une **proposition**. */
  async generate(
    userId: string | null,
    input: { useCase: GenerateUseCase; prompt: string; context?: Record<string, unknown>; maxWords?: number },
  ) {
    const debut = Date.now();
    const segments: AiSegment[] = [
      { origin: 'SYSTEM', content: CONSIGNES[input.useCase] },
      // Le contexte est présenté comme des faits nommés : c'est ce que le
      // fournisseur local sait lire, et ce qu'un modèle réel lit également
      // sans ambiguïté sur ce qui lui est fourni et ce qui ne l'est pas.
      ...(input.context ? [{ origin: 'SYSTEM' as const, content: factsBlock(input.context) }] : []),
      { origin: 'USER', content: input.prompt },
    ];

    const { result, meta } = await aiGateway.generateText(
      { feature: input.useCase, scope: { userId } },
      { task: input.useCase === 'support_reply' ? 'REASON' : 'GENERATE', segments, maxWords: input.maxWords },
    );

    await aiGateway.trace({
      userId,
      provider: result.provider,
      kind: 'generate',
      useCase: input.useCase,
      payload: { prompt: input.prompt, context: input.context ?? {} },
      output: { text: result.text },
      ok: true,
      latencyMs: Date.now() - debut,
    });

    return {
      text: result.text,
      provider: result.provider,
      model: result.model,
      fallback: meta.fallback,
      fallbackReason: meta.fallbackReason,
      /** Jamais publié automatiquement : un humain relit et valide. */
      requiresHumanReview: true,
    };
  },

  async classify(userId: string | null, input: { useCase: 'category_suggestion' | 'moderation'; text: string; labels: string[] }) {
    const debut = Date.now();
    const { result, meta } = await aiGateway.classify({ feature: input.useCase, scope: { userId } }, { text: input.text, labels: input.labels });
    await aiGateway.trace({
      userId,
      provider: result.provider,
      kind: 'classify',
      useCase: input.useCase,
      payload: { text: input.text, labels: input.labels },
      output: { label: result.label, score: result.score },
      ok: true,
      latencyMs: Date.now() - debut,
    });
    return {
      // Un classement incertain ne rend pas de libellé. Rendre « le moins pire »
      // ferait ranger un produit dans une catégorie que rien ne soutient.
      label: result.uncertain ? null : result.label,
      score: result.score,
      uncertain: result.uncertain,
      provider: result.provider,
      fallback: meta.fallback,
      fallbackReason: meta.fallbackReason,
      requiresHumanReview: true,
      ...(result.uncertain ? { message: 'Information non disponible : aucun libellé ne correspond au texte fourni.' } : {}),
    };
  },

  /**
   * Recommandations. Calculées en base, jamais produites par un modèle.
   *
   * L'écriture de trace n'a lieu que pour un utilisateur connu : le point
   * d'entrée reste consultable par un visiteur, mais une lecture anonyme ne
   * remplit plus la base.
   */
  async recommend(userId: string | null, input: { useCase: 'similar_products' | 'supplier_match' | 'opportunity'; seedProductId?: string | null; query?: string; limit?: number }) {
    const debut = Date.now();
    const limit = Math.min(input.limit ?? 8, 24);

    let items: RecommendationItem[] = [];
    if (input.useCase === 'similar_products' && input.seedProductId) {
      items = await recommendationService.similar(input.seedProductId, limit);
    }
    if (items.length === 0) items = await recommendationService.popular(input.query, limit);

    if (userId) {
      const requestId = await aiGateway.trace({
        userId,
        provider: 'DATABASE',
        kind: 'recommend',
        useCase: input.useCase,
        payload: { seedProductId: input.seedProductId ?? null, query: input.query ?? null, limit },
        output: { count: items.length },
        ok: true,
        latencyMs: Date.now() - debut,
      });
      await recommendationService.persist(requestId, items);
    }

    return {
      items,
      /** Aucun modèle n'intervient, et la réponse le dit plutôt que de le taire. */
      provider: 'DATABASE',
      basis: 'Catalogue Touma : catégorie, prix, pays d’expédition, commandes constatées.',
      ...(items.length === 0 ? { message: 'Information non disponible : aucun produit ne correspond.' } : {}),
    };
  },
};

/** Contexte rendu sous forme de faits nommés, une ligne par fait. */
function factsBlock(context: Record<string, unknown>): string {
  return Object.entries(context)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join('\n');
}

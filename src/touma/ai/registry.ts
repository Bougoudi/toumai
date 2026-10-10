import { env } from '../../config/env.js';
import { RuleBasedProvider } from './providers/rule-based.provider.js';
import { AnthropicProvider, OpenAiCompatibleProvider } from './providers/http.provider.js';
import type { AiProvider, AiTask } from './ai.types.js';

/**
 * Registre des fournisseurs et routage de modèle (§3, §4, §47).
 *
 * Une seule fonction décide *qui* répond et *avec quel modèle*, et elle ne peut
 * jamais rendre « personne » : `RULE_BASED` est toujours enregistré. C'est ce
 * qui permet d'affirmer §47 — l'application fonctionne sans IA externe — sans
 * avoir à le vérifier fonctionnalité par fonctionnalité.
 */

const registre = new Map<string, AiProvider>();

/** Repli permanent, enregistré au chargement du module. */
export const RULE_BASED = new RuleBasedProvider();
registre.set(RULE_BASED.code, RULE_BASED);

export function registerProvider(provider: AiProvider): void {
  registre.set(provider.code.toUpperCase(), provider);
}

/** Adresses par défaut, uniquement pour les fournisseurs publics connus. */
const URLS_PAR_DEFAUT: Record<string, string> = {
  OPENAI: 'https://api.openai.com/v1',
  ANTHROPIC: 'https://api.anthropic.com',
};

/**
 * Construit le fournisseur externe décrit par l'environnement.
 *
 * Rien n'est construit sans clé : un fournisseur à moitié configuré serait
 * enregistré, choisi par le routage, puis échouerait à chaque appel. Mieux vaut
 * qu'il n'existe pas, et que le repli prenne la main dès le premier appel.
 */
function buildConfiguredProvider(): AiProvider | null {
  const code = env.touma.ai.provider.toUpperCase();
  if (code === 'RULE_BASED') return null;

  const apiKey = env.touma.ai.apiKey;
  const baseUrl = env.touma.ai.baseUrl || URLS_PAR_DEFAUT[code] || '';
  const model = env.touma.ai.model;
  if (!apiKey || !baseUrl || !model) return null;

  const options = { code, apiKey, baseUrl, model, timeoutMs: env.touma.ai.timeoutMs };
  switch (code) {
    case 'ANTHROPIC':
      return new AnthropicProvider({ ...options, name: 'Anthropic' });
    case 'OPENAI':
      return new OpenAiCompatibleProvider({ ...options, name: 'OpenAI' });
    case 'LOCAL':
      // Un serveur local compatible OpenAI (vLLM, Ollama, llama.cpp). Même
      // format de fil, donc même implémentation : une clé factice suffit à
      // ces serveurs, et `AI_BASE_URL` est alors obligatoire.
      return new OpenAiCompatibleProvider({ ...options, name: 'Modèle local' });
    default:
      // `GOOGLE` et les autres : nommés dans le cahier des charges, pas écrits.
      // Les enregistrer vides ferait croire qu'il suffit d'une clé.
      return null;
  }
}

let externe: AiProvider | null | undefined;

/** Fournisseur externe configuré, ou `null`. Construit une seule fois. */
export function configuredProvider(): AiProvider | null {
  if (externe === undefined) {
    externe = buildConfiguredProvider();
    if (externe) registre.set(externe.code, externe);
  }
  return externe;
}

/** Réinitialise le cache — pour les tests, qui changent l'environnement. */
export function resetProviderCache(): void {
  externe = undefined;
}

/** Capacité requise par chaque famille de tâche. */
const CAPACITE: Record<AiTask, keyof AiProvider['capabilities']> = {
  CLASSIFY: 'classify',
  GENERATE: 'generateText',
  STRUCTURED: 'generateStructuredOutput',
  EMBED: 'embed',
  MODERATE: 'moderate',
  TRANSLATE: 'generateText',
  REASON: 'generateText',
};

/**
 * Routage de modèle (§4).
 *
 * Une classification tient en un mot : la confier au modèle le plus puissant
 * coûte cent fois plus pour la même réponse. Un raisonnement sur des chiffres
 * de ventes, à l'inverse, se dégrade sur un modèle économique. Le découpage est
 * configurable ; sans configuration, tout retombe sur `AI_MODEL`.
 */
export function routeModel(task: AiTask, provider: AiProvider): string {
  const c = env.touma.ai;
  if (provider.code === RULE_BASED.code) return provider.defaultModel;
  switch (task) {
    case 'CLASSIFY':
    case 'MODERATE':
      return c.fastModel || provider.defaultModel;
    case 'REASON':
    case 'STRUCTURED':
      return c.reasoningModel || provider.defaultModel;
    case 'EMBED':
      return c.embeddingModel || provider.defaultModel;
    default:
      return provider.defaultModel;
  }
}

export interface Routage {
  provider: AiProvider;
  model: string;
  /** Vrai quand le repli local répond à la place du fournisseur demandé. */
  fallback: boolean;
  /** Pourquoi le repli a pris la main — `null` quand il n'a pas eu à le faire. */
  fallbackReason: string | null;
}

/**
 * Choisit le fournisseur pour une tâche.
 *
 * Le repli est décidé **avant** l'appel, à partir des capacités déclarées, et
 * non après une exception. Une capacité manquante n'est pas une panne : c'est
 * une information connue d'avance, et attendre l'échec pour l'apprendre ferait
 * payer une latence réseau pour rien.
 */
export function route(task: AiTask): Routage {
  const demande = configuredProvider();
  const besoin = CAPACITE[task];

  if (!demande) {
    return {
      provider: RULE_BASED,
      model: routeModel(task, RULE_BASED),
      fallback: true,
      fallbackReason: 'Aucun fournisseur d’IA réel configuré.',
    };
  }
  if (!demande.configured) {
    return { provider: RULE_BASED, model: routeModel(task, RULE_BASED), fallback: true, fallbackReason: `Fournisseur « ${demande.code} » non configuré.` };
  }
  if (!demande.capabilities[besoin]) {
    return {
      provider: RULE_BASED,
      model: routeModel(task, RULE_BASED),
      fallback: true,
      fallbackReason: `Le fournisseur « ${demande.code} » ne déclare pas la capacité « ${besoin} ».`,
    };
  }
  return { provider: demande, model: routeModel(task, demande), fallback: false, fallbackReason: null };
}

/** État des fournisseurs, pour `/ai/provider` et le tableau de bord admin. */
export function providerStatus() {
  const actif = configuredProvider();
  return {
    active: actif?.configured ? actif.code : RULE_BASED.code,
    name: actif?.configured ? actif.name : RULE_BASED.name,
    /**
     * Le point capital de cette réponse : dire si un modèle réel répond. Sans
     * lui, une interface pourrait afficher « IA active » alors que ce sont des
     * règles locales qui répondent — exactement ce que §3 interdit.
     */
    realProviderConfigured: Boolean(actif?.configured),
    fallback: RULE_BASED.code,
    message: actif?.configured
      ? null
      : 'Fournisseur d’IA réel non activé — configuration requise (AI_PROVIDER, AI_MODEL, AI_API_KEY). Les réponses proviennent des règles locales.',
    providers: [...registre.values()].map((p) => ({
      code: p.code,
      name: p.name,
      configured: p.configured,
      capabilities: p.capabilities,
    })),
  };
}

/**
 * TOUMA INTELLIGENCE — contrat des fournisseurs et des outils (V23).
 *
 * Deux règles tiennent tout le reste :
 *
 * 1. **Le modèle n'est jamais source de vérité.** Un prix, un stock, une
 *    commande, un paiement viennent de PostgreSQL via un service métier. Le
 *    modèle met en phrases ce que les outils ont lu ; il n'ajoute pas de faits.
 * 2. **Le modèle n'exécute rien de sensible.** Il propose ; un humain confirme.
 *    Le niveau de risque d'un outil décide si cette confirmation est exigée, et
 *    ce n'est pas au modèle d'en juger.
 */

/** Famille de tâche — miroir de l'énumération Prisma `AiTaskKind`. */
export type AiTask = 'CLASSIFY' | 'GENERATE' | 'STRUCTURED' | 'EMBED' | 'MODERATE' | 'TRANSLATE' | 'REASON';

/** Niveau de risque — miroir de l'énumération Prisma `AiRiskLevel`. */
export type AiRisk = 'READ_ONLY' | 'LOW_RISK' | 'MEDIUM_RISK' | 'HIGH_RISK' | 'FINANCIAL';

/**
 * Ce qu'un fournisseur sait faire.
 *
 * Déclaré plutôt que deviné : sans cela, rien ne distingue un fournisseur qui
 * produit des embeddings d'un qui lèvera une exception à la première demande,
 * et le repli n'aurait aucun moyen de savoir qu'il doit intervenir **avant**
 * l'appel plutôt qu'après l'échec.
 */
export interface AiCapabilities {
  generateText: boolean;
  generateStructuredOutput: boolean;
  embed: boolean;
  moderate: boolean;
  classify: boolean;
}

export const NO_CAPABILITIES: AiCapabilities = {
  generateText: false,
  generateStructuredOutput: false,
  embed: false,
  moderate: false,
  classify: false,
};

/**
 * Message adressé au fournisseur, avec son **origine**.
 *
 * L'origine n'est pas décorative : `EXTERNAL` désigne ce qui vient d'un tiers
 * (description produit, message vendeur, avis, document téléversé). Une
 * consigne écrite dans une description produit n'est pas une consigne — elle
 * est une donnée qui contient du texte impératif. Séparer les origines est ce
 * qui permet à la passerelle de le dire au modèle, et au détecteur d'injection
 * de ne regarder que ce qui mérite d'être regardé.
 */
export type AiSegmentOrigin = 'SYSTEM' | 'TOOL_POLICY' | 'USER' | 'EXTERNAL';

export interface AiSegment {
  origin: AiSegmentOrigin;
  content: string;
  /** Provenance lisible d'un segment externe : « description du produit X ». */
  label?: string;
}

export interface GenerateTextRequest {
  task: AiTask;
  feature: string;
  segments: AiSegment[];
  maxWords?: number;
  locale?: string;
}

export interface GenerateTextResult {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredRequest<T = unknown> {
  task: AiTask;
  feature: string;
  segments: AiSegment[];
  /** Schéma attendu, décrit pour le modèle. La validation reste côté serveur. */
  schemaName: string;
  schemaDescription: string;
  example?: T;
}

export interface StructuredResult {
  /** Donnée **non validée**. L'appelant la passe par zod avant d'y toucher. */
  raw: unknown;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface EmbedRequest {
  feature: string;
  texts: string[];
}

export interface EmbedResult {
  vectors: number[][];
  dimensions: number;
  provider: string;
  model: string;
  inputTokens: number;
}

export interface ModerateRequest {
  feature: string;
  text: string;
}

export interface ModerateResult {
  flagged: boolean;
  categories: string[];
  score: number;
  provider: string;
  model: string;
}

export interface ClassifyTextRequest {
  feature: string;
  text: string;
  labels: string[];
}

export interface ClassifyTextResult {
  label: string;
  score: number;
  provider: string;
  model: string;
  /** Vrai quand aucun libellé ne correspond réellement. */
  uncertain: boolean;
}

/**
 * Fournisseur d'intelligence.
 *
 * Un fournisseur qui ne sait pas faire quelque chose le déclare dans
 * `capabilities` **et** lève `ProviderUnsupported` si on l'appelle quand même.
 * Les deux, parce que la déclaration oriente le routage et que l'exception
 * empêche un routage fautif de produire une réponse inventée.
 */
export interface AiProvider {
  readonly code: string;
  readonly name: string;
  readonly capabilities: AiCapabilities;
  /** Le fournisseur est-il réellement utilisable (clé présente, service joignable) ? */
  readonly configured: boolean;
  /** Modèle par défaut, tel qu'il sera consigné dans `ToumaAiUsage.model`. */
  readonly defaultModel: string;

  generateText(request: GenerateTextRequest, model: string): Promise<GenerateTextResult>;
  generateStructuredOutput(request: StructuredRequest, model: string): Promise<StructuredResult>;
  embed(request: EmbedRequest, model: string): Promise<EmbedResult>;
  moderate(request: ModerateRequest, model: string): Promise<ModerateResult>;
  classify(request: ClassifyTextRequest, model: string): Promise<ClassifyTextResult>;
}

/** Le fournisseur ne sait pas traiter cette demande. Déclenche le repli. */
export class ProviderUnsupported extends Error {
  constructor(providerCode: string, what: string) {
    super(`Le fournisseur « ${providerCode} » ne sait pas ${what}.`);
    this.name = 'ProviderUnsupported';
  }
}

/**
 * Le fournisseur existe dans le code mais n'est pas configuré.
 *
 * Distinct de `ProviderUnsupported` : là, la fonction existerait si quelqu'un
 * fournissait une clé. Le message le dit, parce que « non disponible » et
 * « configuration requise » n'appellent pas la même action.
 */
export class ProviderNotConfigured extends Error {
  constructor(providerCode: string) {
    super(`Fournisseur d'IA réel « ${providerCode} » non activé — configuration requise.`);
    this.name = 'ProviderNotConfigured';
  }
}

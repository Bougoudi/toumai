/**
 * TOUMA AI — contrat des fournisseurs d'IA.
 *
 * Règle non négociable : l'IA **n'exécute jamais** d'action financière
 * irréversible. Elle propose ; un humain valide (publication, prix, paiement,
 * remboursement). Chaque appel est tracé dans `ToumaAiRequest`.
 */

export interface GenerateRequest {
  useCase: 'product_description' | 'product_title' | 'store_pitch' | 'support_reply';
  prompt: string;
  context?: Record<string, unknown>;
  maxWords?: number;
}

export interface GenerateResult {
  text: string;
  provider: string;
}

export interface ClassifyRequest {
  useCase: 'category_suggestion' | 'moderation';
  text: string;
  labels: string[];
}

export interface ClassifyResult {
  label: string;
  score: number;
  provider: string;
}

export interface RecommendRequest {
  useCase: 'similar_products' | 'supplier_match' | 'opportunity';
  userId?: string | null;
  seedProductId?: string | null;
  query?: string;
  limit?: number;
}

export interface RecommendationItem {
  targetType: 'PRODUCT' | 'SUPPLIER' | 'PRICE' | 'CATEGORY';
  targetId: string | null;
  score: number;
  reason: string;
  payload?: Record<string, unknown>;
}

export interface RecommendResult {
  items: RecommendationItem[];
  provider: string;
}

export interface AiProvider {
  readonly code: string;
  readonly name: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  classify(request: ClassifyRequest): Promise<ClassifyResult>;
  recommend(request: RecommendRequest): Promise<RecommendResult>;
}

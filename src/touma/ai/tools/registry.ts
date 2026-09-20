import type { z } from 'zod';
import type { AiRisk } from '../ai.types.js';
import type { ToumaRequestUser } from '../../middleware/toumaAuth.js';

/**
 * REGISTRE D'OUTILS (§6, §7).
 *
 * Un outil est la seule façon dont l'assistant touche aux données de Touma.
 * Il ne lit pas la base : il appelle un service métier, avec l'objet
 * utilisateur de **celui qui parle**.
 *
 * C'est le point qui rend §65 et §67 vrais plutôt que déclarés. Les services
 * portent déjà le contrôle d'accès — `orderService.get` lève `notFound` pour la
 * commande d'un autre, `productService.requireOwned` lève `forbidden` pour le
 * produit d'un autre vendeur. En passant par eux, la couche IA **hérite** de ce
 * contrôle au lieu de le réécrire. Une escalade de privilège par outil
 * supposerait un service déjà percé — auquel cas l'API l'est sans IA.
 *
 * L'inverse — un outil qui ferait sa propre requête Prisma « pour aller plus
 * vite » — créerait un second chemin d'accès aux données, avec ses propres
 * oublis. Il n'y en a aucun ici, et le test de sécurité le vérifie.
 */

export interface ToolContext {
  /** `null` pour un visiteur : seuls les outils publics lui sont ouverts. */
  user: ToumaRequestUser | null;
  surface: 'BUYER' | 'SELLER' | 'BUSINESS' | 'ADMIN' | 'SUPPORT';
  conversationId: string | null;
  locale: string;
}

export interface ToolResult {
  /** Données réelles, telles que le service les a rendues. */
  data: unknown;
  /** Résumé court pour l'audit — ce qui a été lu, pas ce qui a été lu en entier. */
  summary: string;
  /**
   * Cartes à afficher (produits, commandes, devis). L'interface n'invente rien :
   * elle rend ce que le service a renvoyé.
   */
  cards?: Array<Record<string, unknown>>;
}

export interface AiTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  /** Description lue par le modèle : dit ce que l'outil fait *et ne fait pas*. */
  description: string;
  inputSchema: S;
  risk: AiRisk;
  /** Surfaces autorisées. Un acheteur n'atteint pas les outils vendeur. */
  surfaces: ToolContext['surface'][];
  /** Rôles autorisés. `null` dans la liste = accessible sans compte. */
  roles: Array<'BUYER' | 'SELLER' | 'ADMIN' | null>;
  handler: (input: z.infer<S>, ctx: ToolContext) => Promise<ToolResult>;
}

const outils = new Map<string, AiTool>();

export function registerTool(tool: AiTool): void {
  if (outils.has(tool.name)) throw new Error(`Outil « ${tool.name} » déjà enregistré.`);
  outils.set(tool.name, tool);
}

export function getTool(name: string): AiTool | undefined {
  return outils.get(name);
}

export function allTools(): AiTool[] {
  return [...outils.values()];
}

/**
 * Outils visibles depuis un contexte donné.
 *
 * Le filtrage a lieu **avant** que le modèle ne voie la liste : un outil
 * d'administration n'est pas décrit à un acheteur. Ne pas le décrire n'est pas
 * la sécurité — celle-ci est vérifiée à l'exécution — mais c'est ce qui évite
 * qu'un modèle propose une action qu'il ne peut pas faire, et donc qu'un
 * utilisateur se voie refuser ce qu'on venait de lui promettre.
 */
export function toolsFor(ctx: ToolContext): AiTool[] {
  const role = ctx.user?.role ?? null;
  return allTools().filter((t) => t.surfaces.includes(ctx.surface) && isRoleAllowed(t, role));
}

export function isRoleAllowed(tool: AiTool, role: string | null): boolean {
  // L'administrateur voit ce qui lui est explicitement listé, comme partout
  // ailleurs dans Touma. Un passe-droit général ici créerait un chemin d'accès
  // admin qui ne ressemble à aucun autre, donc qu'on oublierait d'auditer.
  return tool.roles.includes(role as 'BUYER' | 'SELLER' | 'ADMIN' | null);
}

/**
 * Niveaux exigeant une confirmation humaine avant exécution (§7, §41, §42).
 *
 * `MEDIUM_RISK` y est inclus : publier un produit est réversible, mais il est
 * public entre-temps, et un catalogue publié par erreur au nom d'un vendeur
 * engage sa réputation avant qu'il ne s'en aperçoive.
 */
const EXIGE_CONFIRMATION: AiRisk[] = ['MEDIUM_RISK', 'HIGH_RISK', 'FINANCIAL'];

export function requiresConfirmation(risk: AiRisk): boolean {
  return EXIGE_CONFIRMATION.includes(risk);
}

/** Description des outils destinée au modèle (§6 : nom, rôle, limites). */
export function describeTools(tools: AiTool[]): string {
  return tools
    .map((t) => `- ${t.name} (${t.risk}) : ${t.description}`)
    .join('\n');
}

/** Pour les tests, qui enregistrent des outils factices. */
export function clearTools(): void {
  outils.clear();
}

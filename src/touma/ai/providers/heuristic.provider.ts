import { prisma } from '../../../db/prisma.js';
import type {
  AiProvider,
  ClassifyRequest,
  ClassifyResult,
  GenerateRequest,
  GenerateResult,
  RecommendRequest,
  RecommendResult,
} from '../ai.types.js';

/**
 * Fournisseur d'IA « heuristique » : aucune dépendance externe, aucun coût,
 * résultats déterministes. Il permet de faire fonctionner Touma AI de bout en
 * bout dès maintenant, et sert de repli quand aucun modèle n'est configuré.
 *
 * Un fournisseur réel (modèle de langage) s'ajoute en implémentant la même
 * interface, sans toucher au reste de l'application.
 */
export class HeuristicAiProvider implements AiProvider {
  readonly code = 'mock';
  readonly name = 'Touma AI (heuristique locale)';

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const ctx = request.context ?? {};
    const title = String(ctx.title ?? request.prompt).trim();
    const category = ctx.category ? String(ctx.category) : null;
    const country = ctx.countryCode ? String(ctx.countryCode) : null;

    if (request.useCase === 'product_title') {
      const words = title.split(/\s+/).filter(Boolean).slice(0, 10);
      const enriched = [...words];
      if (category && !title.toLowerCase().includes(category.toLowerCase())) enriched.push(`— ${category}`);
      return { text: enriched.join(' ').slice(0, 120), provider: this.code };
    }

    const parts = [
      `${title} proposé par un vendeur${country ? ` basé au ${country}` : ''} sur Touma.`,
      category ? `Catégorie : ${category}.` : '',
      'Fiche à compléter par le vendeur : matière, dimensions, conditionnement, délai de préparation.',
      'Livraison assurée par un transporteur partenaire Touma, suivi disponible dans votre compte.',
    ].filter(Boolean);
    const max = request.maxWords ?? 120;
    return { text: parts.join(' ').split(/\s+/).slice(0, max).join(' '), provider: this.code };
  }

  /** Classement par recouvrement de mots (transparent et explicable). */
  async classify(request: ClassifyRequest): Promise<ClassifyResult> {
    const words = new Set(
      request.text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2),
    );
    let best = { label: request.labels[0] ?? 'AUTRE', score: 0 };
    for (const label of request.labels) {
      const tokens = label
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2);
      const hits = tokens.filter((t) => words.has(t)).length;
      const score = tokens.length ? hits / tokens.length : 0;
      if (score > best.score) best = { label, score };
    }
    return { ...best, provider: this.code };
  }

  /** Recommandations basées sur le catalogue réel (même catégorie, prix proche). */
  async recommend(request: RecommendRequest): Promise<RecommendResult> {
    const limit = Math.min(request.limit ?? 8, 24);

    if (request.useCase === 'similar_products' && request.seedProductId) {
      const seed = await prisma.toumaProduct.findUnique({ where: { id: request.seedProductId } });
      if (seed) {
        const items = await prisma.toumaProduct.findMany({
          where: {
            id: { not: seed.id },
            status: 'ACTIVE',
            store: { status: 'ACTIVE' },
            OR: [{ categoryId: seed.categoryId ?? undefined }, { countryCode: seed.countryCode }],
          },
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: { id: true, title: true, price: true, currency: true, categoryId: true },
        });
        return {
          provider: this.code,
          items: items.map((p) => ({
            targetType: 'PRODUCT' as const,
            targetId: p.id,
            score: p.categoryId && p.categoryId === seed.categoryId ? 0.8 : 0.5,
            reason: p.categoryId === seed.categoryId ? 'Même catégorie' : 'Même pays d’expédition',
            payload: { title: p.title, price: p.price.toString(), currency: p.currency },
          })),
        };
      }
    }

    const products = await prisma.toumaProduct.findMany({
      where: {
        status: 'ACTIVE',
        store: { status: 'ACTIVE' },
        ...(request.query
          ? {
              OR: [
                { title: { contains: request.query, mode: 'insensitive' as const } },
                { keywords: { contains: request.query, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      take: limit,
      orderBy: { orderItems: { _count: 'desc' } },
      select: { id: true, title: true, price: true, currency: true },
    });
    return {
      provider: this.code,
      items: products.map((p) => ({
        targetType: 'PRODUCT' as const,
        targetId: p.id,
        score: 0.6,
        reason: request.query ? `Correspond à « ${request.query} »` : 'Produit populaire sur Touma',
        payload: { title: p.title, price: p.price.toString(), currency: p.currency },
      })),
    };
  }
}

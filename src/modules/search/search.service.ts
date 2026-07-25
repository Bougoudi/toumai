import type { Offer, SearchRequest, Supplier } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { parseList, scoreSupplier, type SearchCriteria } from '../../utils/scoring.js';
import type { SearchInput } from './search.schema.js';

type SupplierWithOffers = Supplier & { offers: Offer[] };

/** Fusionne les critères d'un produit (optionnel) avec les critères explicites. */
async function buildCriteria(input: SearchInput): Promise<SearchCriteria> {
  let base: Partial<SearchCriteria> = {};

  if (input.productId) {
    const product = await prisma.product.findUnique({ where: { id: input.productId } });
    if (!product) throw new HttpError(404, 'Produit introuvable');
    base = {
      query: product.name,
      category: product.category,
      keywords: parseList(product.keywords),
      targetUnitPrice: product.targetUnitPrice,
      targetQuantity: product.targetQuantity,
      region: product.region,
      requiredCertifications: parseList(product.requiredCertifications),
    };
  }

  return {
    query: input.query || base.query || '',
    category: input.category ?? base.category ?? null,
    keywords: input.keywords ? parseList(input.keywords) : (base.keywords ?? []),
    targetUnitPrice: input.targetUnitPrice ?? base.targetUnitPrice ?? null,
    targetQuantity: input.targetQuantity ?? base.targetQuantity ?? null,
    region: input.region ?? base.region ?? null,
    requiredCertifications: input.requiredCertifications
      ? parseList(input.requiredCertifications)
      : (base.requiredCertifications ?? []),
  };
}

/** Sélectionne la meilleure offre d'un fournisseur pour des critères donnés. */
function bestOfferFor(criteria: SearchCriteria, supplier: SupplierWithOffers): Offer | null {
  if (supplier.offers.length === 0) return null;
  const scored = supplier.offers.map((offer) => ({
    offer,
    score: scoreSupplier(criteria, supplier, offer).total,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].offer;
}

/**
 * Moteur de matching : score et classe tous les fournisseurs pertinents.
 * Pré-filtre par catégorie/région pour limiter le nombre de candidats.
 */
export async function runMatching(criteria: SearchCriteria, limit: number) {
  const candidates = (await prisma.supplier.findMany({
    where: {
      ...(criteria.region
        ? { OR: [{ region: { contains: criteria.region } }, { country: { contains: criteria.region } }] }
        : {}),
      ...(criteria.category
        ? { offers: { some: { category: { contains: criteria.category } } } }
        : {}),
    },
    include: { offers: true },
  })) as SupplierWithOffers[];

  const ranked = candidates
    .map((supplier) => {
      const offer = bestOfferFor(criteria, supplier);
      const breakdown = scoreSupplier(criteria, supplier, offer);
      return { supplier, offer, breakdown };
    })
    .filter((r) => r.breakdown.total > 0)
    .sort((a, b) => b.breakdown.total - a.breakdown.total)
    .slice(0, limit)
    .map((r, index) => ({ ...r, rank: index + 1 }));

  return ranked;
}

export const searchService = {
  /** Lance une recherche synchrone : calcule et persiste les résultats immédiatement. */
  async searchNow(input: SearchInput) {
    const criteria = await buildCriteria(input);
    const request = await this.createRequest(input, 'RUNNING');
    try {
      const ranked = await runMatching(criteria, input.limit);
      await this.persistMatches(request.id, ranked);
      await prisma.searchRequest.update({
        where: { id: request.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      return { request: { ...request, status: 'COMPLETED' }, criteria, results: ranked };
    } catch (err) {
      await prisma.searchRequest.update({
        where: { id: request.id },
        data: { status: 'FAILED', error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  },

  /** Enregistre une recherche à traiter plus tard par le worker (asynchrone). */
  async queueRequest(input: SearchInput) {
    // On valide l'existence du produit tout de suite pour un feedback rapide.
    await buildCriteria(input);
    return this.createRequest(input, 'PENDING');
  },

  async createRequest(input: SearchInput, status: string): Promise<SearchRequest> {
    return prisma.searchRequest.create({
      data: {
        productId: input.productId ?? null,
        query: input.query,
        category: input.category ?? null,
        keywords: input.keywords,
        targetUnitPrice: input.targetUnitPrice ?? null,
        targetQuantity: input.targetQuantity ?? null,
        region: input.region ?? null,
        requiredCertifications: input.requiredCertifications,
        status,
      },
    });
  },

  async persistMatches(
    searchRequestId: string,
    ranked: Awaited<ReturnType<typeof runMatching>>,
  ) {
    await prisma.supplierMatch.deleteMany({ where: { searchRequestId } });
    if (ranked.length === 0) return;
    await prisma.supplierMatch.createMany({
      data: ranked.map((r) => ({
        searchRequestId,
        supplierId: r.supplier.id,
        offerId: r.offer?.id ?? null,
        score: r.breakdown.total,
        rank: r.rank,
        breakdown: JSON.stringify(r.breakdown),
      })),
    });
  },

  /** Traite une demande en attente (utilisé par le worker cron). */
  async processRequest(request: SearchRequest) {
    await prisma.searchRequest.update({
      where: { id: request.id },
      data: { status: 'RUNNING' },
    });
    try {
      const criteria = await buildCriteria({
        productId: request.productId ?? undefined,
        query: request.query,
        category: request.category ?? undefined,
        keywords: request.keywords,
        targetUnitPrice: request.targetUnitPrice ?? undefined,
        targetQuantity: request.targetQuantity ?? undefined,
        region: request.region ?? undefined,
        requiredCertifications: request.requiredCertifications,
        limit: 20,
        async: true,
      });
      const ranked = await runMatching(criteria, 20);
      await this.persistMatches(request.id, ranked);
      await prisma.searchRequest.update({
        where: { id: request.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      logger.info('Recherche traitée', { requestId: request.id, results: ranked.length });
    } catch (err) {
      await prisma.searchRequest.update({
        where: { id: request.id },
        data: { status: 'FAILED', error: err instanceof Error ? err.message : String(err) },
      });
      logger.error('Échec du traitement de recherche', { requestId: request.id });
    }
  },

  /** Récupère une recherche et ses résultats classés. */
  async getRequest(id: string) {
    const request = await prisma.searchRequest.findUnique({
      where: { id },
      include: {
        matches: {
          orderBy: { rank: 'asc' },
          include: { supplier: true, offer: true },
        },
      },
    });
    if (!request) throw new HttpError(404, 'Recherche introuvable');
    return {
      ...request,
      matches: request.matches.map((m) => ({ ...m, breakdown: JSON.parse(m.breakdown) })),
    };
  },

  async listRequests(params: { status?: string; take: number; skip: number }) {
    const where = params.status ? { status: params.status } : {};
    const [items, total] = await Promise.all([
      prisma.searchRequest.findMany({
        where,
        take: params.take,
        skip: params.skip,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { matches: true } } },
      }),
      prisma.searchRequest.count({ where }),
    ]);
    return { items, total, take: params.take, skip: params.skip };
  },
};

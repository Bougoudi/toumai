import type { MarketOpportunity } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { computeMargin, computeSalePrice } from '../../utils/pricing.js';
import {
  generateDescription,
  generateImages,
  generateSku,
} from '../../utils/productContent.js';
import type { GenerateProductsInput } from './product.schema.js';

/** Transforme une opportunité marché en produit de catalogue. */
function buildProductData(opp: MarketOpportunity, autoPublish: boolean) {
  const cost = opp.estimatedCostPrice ?? 9.99;
  const sale = opp.estimatedSalePrice ?? computeSalePrice(cost);
  return {
    sku: generateSku(opp.category, opp.title),
    name: opp.title,
    description: generateDescription(opp.title, opp.niche),
    category: opp.category,
    keywords: opp.keywords,
    currency: opp.currency,
    costPrice: cost,
    salePrice: sale,
    margin: computeMargin(sale, cost),
    status: autoPublish ? 'ACTIVE' : 'DRAFT',
    source: 'generated',
    images: generateImages(opp.title),
    region: opp.region,
    targetUnitPrice: cost,
    opportunityId: opp.id,
    generatedAt: new Date(),
  };
}

export const generationService = {
  /**
   * Pilier 2 : génère des produits en masse à partir des meilleures
   * opportunités marché non encore importées. Trace le lot dans GenerationRun.
   */
  async generate(input: GenerateProductsInput) {
    const minScore = input.minScore ?? env.pricing.minOpportunityScore;
    const limit = Math.min(input.limit, env.quotas.productsPerRun);

    const run = await prisma.generationRun.create({
      data: {
        source: 'opportunities',
        requested: limit,
        params: JSON.stringify({ ...input, minScore, limit }),
      },
    });

    try {
      const opportunities = await prisma.marketOpportunity.findMany({
        where: {
          status: { in: ['NEW', 'EVALUATED'] },
          opportunityScore: { gte: minScore },
          ...(input.category ? { category: input.category } : {}),
        },
        orderBy: { opportunityScore: 'desc' },
        take: limit,
      });

      let generated = 0;
      let skipped = 0;
      let failed = 0;

      for (const opp of opportunities) {
        try {
          const data = buildProductData(opp, input.autoPublish);
          const exists = await prisma.product.findFirst({
            where: { opportunityId: opp.id },
            select: { id: true },
          });
          if (exists) {
            skipped += 1;
            continue;
          }
          await prisma.product.create({ data });
          await prisma.marketOpportunity.update({
            where: { id: opp.id },
            data: { status: 'IMPORTED' },
          });
          generated += 1;
        } catch (err) {
          failed += 1;
          logger.warn('Échec génération produit', {
            opportunityId: opp.id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const finished = await prisma.generationRun.update({
        where: { id: run.id },
        data: { generated, skipped, failed, status: 'COMPLETED', finishedAt: new Date() },
      });
      logger.info('Génération de produits terminée', { runId: run.id, generated, skipped, failed });
      return finished;
    } catch (err) {
      await prisma.generationRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: err instanceof Error ? err.message : String(err), finishedAt: new Date() },
      });
      throw err;
    }
  },

  async listRuns(params: { take: number; skip: number }) {
    const [items, total] = await Promise.all([
      prisma.generationRun.findMany({ take: params.take, skip: params.skip, orderBy: { startedAt: 'desc' } }),
      prisma.generationRun.count(),
    ]);
    return { items, total, take: params.take, skip: params.skip };
  },

  async getRun(id: string) {
    const run = await prisma.generationRun.findUnique({ where: { id } });
    if (!run) throw new HttpError(404, 'Lot de génération introuvable');
    return run;
  },
};

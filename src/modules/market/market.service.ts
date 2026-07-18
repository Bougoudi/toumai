import type { MarketConnector, NormalizedOpportunity } from '../../automation/connectors/market/base.market.connector.js';
import { MockMarketConnector } from '../../automation/connectors/market/mock.market.connector.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { opportunityScore } from '../../utils/opportunity.js';
import type { ScanMarketInput } from './market.schema.js';

/** Connecteurs d'analyse marché actifs. Ajoutez vos vraies sources ici. */
const connectors: MarketConnector[] = [new MockMarketConnector()];

async function upsertOpportunity(source: string, o: NormalizedOpportunity) {
  const score = opportunityScore(o);
  const estimatedMargin =
    o.estimatedSalePrice != null && o.estimatedCostPrice != null
      ? Number((o.estimatedSalePrice - o.estimatedCostPrice).toFixed(2))
      : null;

  const data = {
    source,
    externalId: o.externalId,
    title: o.title,
    category: o.category,
    keywords: o.keywords,
    niche: o.niche ?? null,
    region: o.region ?? null,
    currency: o.currency ?? 'EUR',
    demandScore: o.demandScore,
    competitionScore: o.competitionScore,
    trendScore: o.trendScore,
    opportunityScore: score,
    estimatedCostPrice: o.estimatedCostPrice ?? null,
    estimatedSalePrice: o.estimatedSalePrice ?? null,
    estimatedMargin,
    rawMetrics: JSON.stringify(o.rawMetrics ?? {}),
  };

  await prisma.marketOpportunity.upsert({
    where: { source_externalId: { source, externalId: o.externalId } },
    // On préserve le statut existant (ex: IMPORTED) lors des re-scans.
    update: {
      demandScore: data.demandScore,
      competitionScore: data.competitionScore,
      trendScore: data.trendScore,
      opportunityScore: data.opportunityScore,
      estimatedCostPrice: data.estimatedCostPrice,
      estimatedSalePrice: data.estimatedSalePrice,
      estimatedMargin: data.estimatedMargin,
      rawMetrics: data.rawMetrics,
    },
    create: data,
  });
}

export const marketService = {
  /** Lance une analyse de marché (pilier 1) via tous les connecteurs. */
  async scan(input: ScanMarketInput = {}) {
    let discovered = 0;
    for (const connector of connectors) {
      const opportunities = await connector.discover(input);
      for (const o of opportunities) {
        await upsertOpportunity(connector.name, o);
        discovered += 1;
      }
      logger.info('Analyse marché', { connector: connector.name, opportunities: opportunities.length });
    }
    return { discovered };
  },

  async list(params: {
    status?: string;
    category?: string;
    minScore?: number;
    take: number;
    skip: number;
  }) {
    const where = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.category ? { category: params.category } : {}),
      ...(params.minScore != null ? { opportunityScore: { gte: params.minScore } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.marketOpportunity.findMany({
        where,
        take: params.take,
        skip: params.skip,
        orderBy: { opportunityScore: 'desc' },
      }),
      prisma.marketOpportunity.count({ where }),
    ]);
    return { items, total, take: params.take, skip: params.skip };
  },

  async getById(id: string) {
    const opp = await prisma.marketOpportunity.findUnique({ where: { id } });
    if (!opp) throw new HttpError(404, 'Opportunité introuvable');
    return opp;
  },

  async setStatus(id: string, status: string) {
    await this.getById(id);
    return prisma.marketOpportunity.update({ where: { id }, data: { status } });
  },
};

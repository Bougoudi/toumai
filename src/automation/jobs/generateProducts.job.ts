import { env } from '../../config/env.js';
import { generationService } from '../../modules/products/generation.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Job d'automatisation (pilier 2) : génère automatiquement des produits
 * à partir des meilleures opportunités, dans la limite du quota configuré.
 */
export async function generateProductsJob(limit = env.quotas.productsPerRun) {
  const run = await generationService.generate({
    limit,
    autoPublish: true,
    minScore: env.pricing.minOpportunityScore,
  });
  logger.info('Génération automatique terminée', {
    runId: run.id,
    generated: run.generated,
    skipped: run.skipped,
  });
  return run;
}

import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';
import { searchService } from '../../modules/search/search.service.js';

/**
 * Job d'automatisation : traite les recherches en attente (status = PENDING).
 * Permet de découpler la soumission d'une recherche de son exécution
 * (utile pour de gros volumes ou des sources lentes).
 */
export async function runPendingSearchesJob(batchSize = 10) {
  const pending = await prisma.searchRequest.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });

  if (pending.length === 0) return 0;

  logger.info('Traitement des recherches en attente', { count: pending.length });
  for (const request of pending) {
    await searchService.processRequest(request);
  }
  return pending.length;
}

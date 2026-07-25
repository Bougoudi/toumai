import { marketService } from '../../modules/market/market.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Job d'automatisation (pilier 1) : analyse le marché en continu et
 * met à jour la base d'opportunités produits.
 */
export async function marketScanJob(params?: { category?: string; region?: string; limit?: number }) {
  const { discovered } = await marketService.scan(params ?? {});
  logger.info('Analyse marché terminée', { discovered });
  return discovered;
}

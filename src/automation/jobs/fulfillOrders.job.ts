import { fulfillmentService } from '../../modules/orders/fulfillment.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Job d'automatisation (pilier 3) : honore automatiquement les commandes
 * payées en passant les bons d'achat chez les fournisseurs.
 */
export async function fulfillOrdersJob(batchSize = 20) {
  const processed = await fulfillmentService.fulfillPaidOrders(batchSize);
  if (processed > 0) logger.info('Commandes exécutées', { processed });
  return processed;
}

import { channelService } from '../../modules/channels/channel.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Job d'automatisation : importe les commandes de tous les canaux de vente
 * connectés (Etsy, eBay, Amazon...) dans Toumai. Les commandes importées sont
 * marquées PAID, ce qui déclenche l'achat & expédition automatiques.
 */
export async function syncChannelsJob() {
  const imported = await channelService.syncAllConnected();
  if (imported > 0) logger.info('Commandes marketplace importées', { imported });
  return imported;
}

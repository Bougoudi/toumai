import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { fulfillOrdersJob } from './jobs/fulfillOrders.job.js';
import { generateProductsJob } from './jobs/generateProducts.job.js';
import { marketScanJob } from './jobs/marketScan.job.js';
import { refreshSuppliersJob } from './jobs/refreshSuppliers.job.js';
import { runPendingSearchesJob } from './jobs/runPendingSearches.job.js';
import { simulateDemandJob } from './jobs/simulateDemand.job.js';

export interface CycleReport {
  opportunities: number;
  productsGenerated: number;
  suppliers: number;
  ordersCreated: number;
  ordersFulfilled: number;
  searchesProcessed: number;
  durationMs: number;
}

/**
 * Exécute un cycle complet des 4 piliers, dans l'ordre :
 *   4. rafraîchit les fournisseurs   (approvisionnement à jour)
 *   1. analyse le marché             (nouvelles opportunités)
 *   2. génère des produits           (catalogue enrichi)
 *   (option) simule la demande       (commandes clients)
 *   3. honore les commandes payées   (achat + expédition)
 *   4. traite les recherches en file
 *
 * Chaque étape est isolée : une erreur n'interrompt pas le cycle.
 */
export async function runFullCycle(): Promise<CycleReport> {
  const start = Date.now();
  const report: CycleReport = {
    opportunities: 0,
    productsGenerated: 0,
    suppliers: 0,
    ordersCreated: 0,
    ordersFulfilled: 0,
    searchesProcessed: 0,
    durationMs: 0,
  };

  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      logger.error(`Cycle: étape ${name} a échoué`, {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  };

  logger.info('🛫 Pilote automatique : début de cycle');

  await step('refreshSuppliers', async () => {
    report.suppliers = await refreshSuppliersJob();
  });
  await step('marketScan', async () => {
    report.opportunities = await marketScanJob();
  });
  await step('generateProducts', async () => {
    const run = await generateProductsJob();
    report.productsGenerated = run.generated;
  });
  if (env.autopilot.simulateDemand) {
    await step('simulateDemand', async () => {
      report.ordersCreated = await simulateDemandJob(env.autopilot.ordersPerCycle);
    });
  }
  await step('fulfillOrders', async () => {
    report.ordersFulfilled = await fulfillOrdersJob();
  });
  await step('runPendingSearches', async () => {
    report.searchesProcessed = await runPendingSearchesJob();
  });

  report.durationMs = Date.now() - start;
  logger.info('🛬 Pilote automatique : cycle terminé', { ...report });
  return report;
}

/**
 * Boucle de pilotage autonome : enchaîne les cycles à intervalle régulier.
 * Utilisée par `npm run autopilot`. S'arrête proprement sur SIGINT/SIGTERM.
 */
export async function runAutopilotLoop(intervalSeconds = env.autopilot.intervalSeconds) {
  let running = true;
  const stop = (signal: string) => {
    logger.info('Pilote automatique : arrêt demandé', { signal });
    running = false;
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  logger.info('Pilote automatique démarré', { intervalSeconds });
  while (running) {
    await runFullCycle();
    if (!running) break;
    await new Promise((r) => setTimeout(r, intervalSeconds * 1000));
  }
  logger.info('Pilote automatique arrêté.');
}

// Exécution autonome : `npm run autopilot`
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runAutopilotLoop().catch((err) => {
    logger.error('Pilote automatique : erreur fatale', {
      err: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}

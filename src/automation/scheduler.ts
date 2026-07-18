import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { fulfillOrdersJob } from './jobs/fulfillOrders.job.js';
import { generateProductsJob } from './jobs/generateProducts.job.js';
import { marketScanJob } from './jobs/marketScan.job.js';
import { refreshSuppliersJob } from './jobs/refreshSuppliers.job.js';
import { runPendingSearchesJob } from './jobs/runPendingSearches.job.js';
import { simulateDemandJob } from './jobs/simulateDemand.job.js';

let started = false;

/** Exécute un job en capturant les erreurs pour ne pas casser le cron. */
function safe(name: string, fn: () => Promise<unknown>) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      logger.error(`Job ${name} a échoué`, { err: err instanceof Error ? err.message : String(err) });
    }
  };
}

/**
 * Démarre toutes les tâches planifiées (les 4 piliers).
 * Intégré au serveur (ENABLE_SCHEDULER=true) ou lançable seul (`npm run worker`).
 */
export function startScheduler() {
  if (started) return;
  started = true;
  const s = env.scheduler;

  cron.schedule(s.marketScanCron, safe('marketScan', () => marketScanJob())); // pilier 1
  cron.schedule(s.generateProductsCron, safe('generateProducts', () => generateProductsJob())); // pilier 2
  cron.schedule(s.fulfillOrdersCron, safe('fulfillOrders', () => fulfillOrdersJob())); // pilier 3
  cron.schedule(s.refreshSuppliersCron, safe('refreshSuppliers', () => refreshSuppliersJob())); // pilier 4
  cron.schedule(s.runSearchesCron, safe('runSearches', () => runPendingSearchesJob())); // pilier 4

  // Simulateur de demande (fait tourner le pilier 3 sans boutique réelle).
  if (env.autopilot.simulateDemand) {
    cron.schedule(
      s.simulateDemandCron,
      safe('simulateDemand', () => simulateDemandJob(env.autopilot.ordersPerCycle)),
    );
  }

  logger.info('Planificateur démarré', {
    marketScan: s.marketScanCron,
    generateProducts: s.generateProductsCron,
    fulfillOrders: s.fulfillOrdersCron,
    refreshSuppliers: s.refreshSuppliersCron,
    runSearches: s.runSearchesCron,
    simulateDemand: env.autopilot.simulateDemand ? s.simulateDemandCron : 'off',
  });
}

// Exécution autonome : `npm run worker`
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startScheduler();
  logger.info('Worker en cours d’exécution. Ctrl+C pour arrêter.');
}

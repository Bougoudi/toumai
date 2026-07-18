import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { refreshSuppliersJob } from './jobs/refreshSuppliers.job.js';
import { runPendingSearchesJob } from './jobs/runPendingSearches.job.js';

let started = false;

/**
 * Démarre les tâches planifiées (cron).
 * Peut être appelé depuis le serveur HTTP (ENABLE_SCHEDULER=true)
 * ou exécuté de façon autonome via `npm run worker`.
 */
export function startScheduler() {
  if (started) return;
  started = true;

  cron.schedule(env.scheduler.refreshSuppliersCron, async () => {
    try {
      await refreshSuppliersJob();
    } catch (err) {
      logger.error('refreshSuppliersJob a échoué', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  });

  cron.schedule(env.scheduler.runSearchesCron, async () => {
    try {
      await runPendingSearchesJob();
    } catch (err) {
      logger.error('runPendingSearchesJob a échoué', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  });

  logger.info('Planificateur démarré', {
    refreshSuppliers: env.scheduler.refreshSuppliersCron,
    runSearches: env.scheduler.runSearchesCron,
  });
}

// Exécution autonome : `npm run worker`
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startScheduler();
  logger.info('Worker en cours d’exécution. Ctrl+C pour arrêter.');
}

import { createApp } from './app.js';
import { env } from './config/env.js';
import { runFullCycle } from './automation/autopilot.js';
import { startScheduler } from './automation/scheduler.js';
import { prisma } from './db/prisma.js';
import { logger } from './utils/logger.js';

async function main() {
  const app = createApp();

  const server = app.listen(env.port, () => {
    logger.info('Serveur Toumai démarré', { port: env.port, env: env.nodeEnv });
  });

  if (env.scheduler.enabled) {
    startScheduler();
    // Pilote automatique : premier cycle immédiat (sans attendre le cron).
    if (env.autopilot.runOnStart) {
      runFullCycle().catch((err) =>
        logger.error('Cycle initial du pilote automatique en échec', {
          err: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  // Arrêt propre
  const shutdown = async (signal: string) => {
    logger.info('Arrêt en cours', { signal });
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Échec du démarrage', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

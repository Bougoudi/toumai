import { createApp } from './app.js';
import { env, isProd } from './config/env.js';
import { runFullCycle } from './automation/autopilot.js';
import { startScheduler } from './automation/scheduler.js';
import { prisma } from './db/prisma.js';
import { loadSettings } from './modules/settings/settings.service.js';
import { logger } from './utils/logger.js';

/** Refuse de démarrer en production avec des secrets par défaut / trop faibles. */
function assertSecureConfig() {
  if (!isProd) return;
  const weak: string[] = [];
  if (!process.env.JWT_SECRET || env.auth.jwtSecret === 'dev-secret-change-me' || env.auth.jwtSecret.length < 32) {
    weak.push('JWT_SECRET (≥ 32 caractères aléatoires requis)');
  }
  if (!process.env.ENCRYPTION_KEY || env.security.encryptionKey.length < 32) {
    weak.push('ENCRYPTION_KEY (≥ 32 caractères aléatoires requis)');
  }
  if (weak.length) {
    logger.error('Démarrage refusé : secrets non sécurisés en production', { weak });
    throw new Error(`Configuration non sécurisée : ${weak.join(', ')}`);
  }
}

async function main() {
  assertSecureConfig();
  await loadSettings();
  const app = createApp();

  const server = app.listen(env.port, () => {
    logger.info('Serveur Toumai démarré', { port: env.port, env: env.nodeEnv });
    // eslint-disable-next-line no-console
    console.log(`\n  🚀 Application Toumai : http://localhost:${env.port}\n`);
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

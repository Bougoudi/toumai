import { createConnection } from 'node:net';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';

/**
 * Sondes de disponibilité Touma.
 *
 * `/health` répond dès que le processus vit (liveness). `/ready` vérifie les
 * dépendances critiques (readiness) : tant que PostgreSQL n'est pas joignable,
 * l'instance ne doit pas recevoir de trafic.
 */

export interface DependencyReport {
  name: string;
  status: 'ok' | 'down' | 'skipped';
  /** Une dépendance non requise n'empêche pas la mise en service. */
  required: boolean;
  latencyMs?: number;
  detail?: string;
}

async function checkPostgres(): Promise<DependencyReport> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { name: 'postgres', status: 'ok', required: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { name: 'postgres', status: 'down', required: true, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * PING Redis en TCP brut : évite d'ajouter un client Redis tant que le cache
 * n'est pas réellement utilisé côté métier.
 */
async function checkRedis(): Promise<DependencyReport> {
  if (!env.redis.enabled) return { name: 'redis', status: 'skipped', required: false, detail: 'REDIS_URL non défini' };
  const started = Date.now();
  const url = new URL(env.redis.url);
  return new Promise<DependencyReport>((resolve) => {
    const socket = createConnection({ host: url.hostname, port: Number(url.port || 6379) });
    const done = (report: DependencyReport) => {
      socket.destroy();
      resolve(report);
    };
    socket.setTimeout(2000);
    socket.on('connect', () => socket.write('PING\r\n'));
    socket.on('data', (data) => {
      const ok = data.toString().startsWith('+PONG');
      done({ name: 'redis', status: ok ? 'ok' : 'down', required: false, latencyMs: Date.now() - started });
    });
    socket.on('timeout', () => done({ name: 'redis', status: 'down', required: false, detail: 'délai dépassé' }));
    socket.on('error', (err) => done({ name: 'redis', status: 'down', required: false, detail: err.message }));
  });
}

/** Rapport complet de disponibilité. */
export async function readiness() {
  const dependencies = await Promise.all([checkPostgres(), checkRedis()]);
  const ready = dependencies.every((d) => !d.required || d.status === 'ok');
  return {
    ready,
    service: 'touma',
    version: 'v1',
    environment: env.nodeEnv,
    dependencies,
    /** Adaptateurs actifs (utile en exploitation pour savoir ce qui tourne). */
    adapters: {
      payments: env.touma.paymentProvider,
      logistics: env.touma.logisticsProvider,
      ai: env.touma.aiProvider,
      storage: env.storage.enabled ? 's3' : 'none',
    },
    checkedAt: new Date().toISOString(),
  };
}

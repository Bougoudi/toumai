import { createHash, createHmac } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';

/**
 * Statistiques de visite de la boutique, respectueuses de la vie privée :
 * aucun cookie, aucune adresse IP stockée, empreinte de visiteur recalculée
 * avec un sel quotidien (donc non traçable d'un jour à l'autre), conservation
 * 14 jours. Les robots et les visiteurs « Do Not Track / GPC » sont ignorés.
 */

const RETENTION_DAYS = 14;
const ACTIVE_MINUTES = 5;
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|lighthouse|headless|pagespeed|curl|wget|python|monitor/i;

function visitorId(ip: string, ua: string): string {
  const day = new Date().toISOString().slice(0, 10);
  const salt = createHmac('sha256', env.auth.jwtSecret).update(`visits:${day}`).digest();
  return createHash('sha256').update(salt).update(ip).update('|').update(ua).digest('base64url').slice(0, 22);
}

let lastPurge = 0;
async function purgeOld() {
  if (Date.now() - lastPurge < 3600_000) return;
  lastPurge = Date.now();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600_000);
  await prisma.pageView.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

/** Middleware : enregistre les pages HTML de la boutique affichées avec succès. */
export function trackPageView(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'GET' || !req.path.startsWith('/boutique')) return next();
  const ua = req.get('user-agent') ?? '';
  if (!ua || BOT.test(ua) || req.get('dnt') === '1' || req.get('sec-gpc') === '1') return next();
  res.on('finish', () => {
    if (res.statusCode !== 200 || !String(res.getHeader('content-type') ?? '').includes('text/html')) return;
    const path = req.path.replace(/\/+$/, '').slice(0, 200) || '/boutique';
    prisma.pageView
      .create({ data: { visitor: visitorId(req.ip ?? '', ua), path } })
      .then(purgeOld)
      .catch((err) => logger.warn('Statistique de visite non enregistrée', { err: err instanceof Error ? err.message : String(err) }));
  });
  next();
}

async function distinctVisitors(since: Date): Promise<number> {
  const rows = await prisma.pageView.groupBy({ by: ['visitor'], where: { createdAt: { gte: since } } });
  return rows.length;
}

export const analyticsService = {
  async summary() {
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = new Date(today.getTime() - (RETENTION_DAYS - 1) * 24 * 3600_000);
    const [activeVisitors, visitorsToday, pageViewsToday, top, recent] = await Promise.all([
      distinctVisitors(new Date(now - ACTIVE_MINUTES * 60_000)),
      distinctVisitors(today),
      prisma.pageView.count({ where: { createdAt: { gte: today } } }),
      prisma.pageView.groupBy({
        by: ['path'],
        where: { createdAt: { gte: from } },
        _count: { _all: true },
        orderBy: { _count: { path: 'desc' } },
        take: 10,
      }),
      prisma.pageView.findMany({ where: { createdAt: { gte: from } }, select: { visitor: true, createdAt: true } }),
    ]);
    // Visiteurs uniques et pages vues par jour (14 jours, du plus ancien au plus récent).
    const days = new Map<string, { views: number; visitors: Set<string> }>();
    for (let i = 0; i < RETENTION_DAYS; i++) {
      const d = new Date(from.getTime() + i * 24 * 3600_000);
      days.set(dayKey(d), { views: 0, visitors: new Set() });
    }
    for (const r of recent) {
      const d = days.get(dayKey(r.createdAt));
      if (d) {
        d.views++;
        d.visitors.add(r.visitor);
      }
    }
    return {
      activeVisitors,
      visitorsToday,
      pageViewsToday,
      retentionDays: RETENTION_DAYS,
      topPages: top.map((t) => ({ page: t.path, views: t._count._all })),
      daily: [...days].map(([day, d]) => ({ day, views: d.views, visitors: d.visitors.size })),
    };
  },
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

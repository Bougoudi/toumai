import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { env, isProd } from '../../config/env.js';
import { asyncHandler } from '../../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { analyticsService } from './analytics.service.js';

/**
 * Tableau de bord « visiteurs » autonome : /admin/login → /admin/analytics.
 * Accès par un secret unique ADMIN_DASHBOARD_TOKEN (≥ 32 caractères), pratique
 * pour consulter les visites depuis un téléphone sans ouvrir toute l'appli.
 *
 * - Le secret n'est jamais mis dans l'URL : il est envoyé une fois (POST), puis
 *   remplacé par un cookie de session signé, HttpOnly, SameSite=Strict, 12 h.
 * - Non configuré (ou secret trop court) → ces pages répondent 404.
 * - Ce tableau ne donne accès qu'aux statistiques anonymes, rien d'autre.
 */
export const adminDashboardRouter = Router();

const COOKIE = 'tm_dash';
const TTL_MS = 12 * 3600_000;

function secret(): string {
  const t = (process.env.ADMIN_DASHBOARD_TOKEN ?? '').trim();
  return t.length >= 32 ? t : '';
}
if ((process.env.ADMIN_DASHBOARD_TOKEN ?? '').trim() && !secret()) {
  logger.warn('ADMIN_DASHBOARD_TOKEN trop court (≥ 32 caractères requis) : /admin/login désactivé');
}

const sameBytes = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Session = expiration + signature HMAC (clé dérivée du secret : changer le secret déconnecte tout le monde). */
function sign(exp: number): string {
  const mac = createHmac('sha256', `${env.auth.jwtSecret}:${secret()}`).update(`dash:${exp}`).digest('base64url');
  return `${exp}.${mac}`;
}
function validSession(req: Request): boolean {
  const raw = (req.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw) return false;
  const exp = Number(raw.split('.')[0]);
  return Number.isFinite(exp) && exp > Date.now() && sameBytes(raw, sign(exp));
}
function cookie(value: string, maxAgeS: number): string {
  return `${COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeS}${isProd ? '; Secure' : ''}`;
}

const page = (title: string, body: string, script: string) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${title}</title>
<link rel="stylesheet" href="/admin-dashboard.css"></head>
<body>${body}<script src="${script}" defer></script></body></html>`;

function noStore(res: Response) {
  res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow');
}

// Désactivé tant que le secret n'est pas configuré.
adminDashboardRouter.use('/admin', (_req, res, next) => (secret() ? next() : res.status(404).type('text/plain').send('Not found')));

adminDashboardRouter.get('/admin', (_req, res) => res.redirect(302, '/admin/analytics'));

adminDashboardRouter.get('/admin/login', (req, res) => {
  noStore(res);
  if (validSession(req)) return res.redirect(302, '/admin/analytics');
  res.type('html').send(
    page(
      'Connexion — tableau de bord',
      `<main class="login"><div class="card"><h1>Tableau de bord visiteurs</h1><p class="muted">Accès privé.</p>
<form id="f" method="post" action="/admin/login"><label>Code d'accès<input id="t" name="token" type="password" autocomplete="current-password" required></label>
<button type="submit">Se connecter</button><p id="err" class="err" role="alert"></p></form></div></main>`,
      '/admin-dashboard.js',
    ),
  );
});

/** Anti force brute : 5 essais / 15 min par IP. */
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false });

adminDashboardRouter.post(
  '/admin/login',
  loginLimiter,
  express.urlencoded({ extended: false, limit: '2kb' }),
  (req, res) => {
    noStore(res);
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const wantsJson = (req.get('accept') ?? '').includes('application/json');
    if (!token || !sameBytes(token, secret())) {
      logger.warn('Échec de connexion au tableau de bord visiteurs');
      return wantsJson ? res.status(401).json({ error: 'Code incorrect.' }) : res.redirect(303, '/admin/login?e=1');
    }
    res.set('Set-Cookie', cookie(sign(Date.now() + TTL_MS), TTL_MS / 1000));
    return wantsJson ? res.json({ ok: true }) : res.redirect(303, '/admin/analytics');
  },
);

adminDashboardRouter.post('/admin/logout', (_req, res) => {
  noStore(res);
  res.set('Set-Cookie', cookie('', 0)).redirect(303, '/admin/login');
});

adminDashboardRouter.get('/admin/analytics', (req, res) => {
  noStore(res);
  if (!validSession(req)) return res.redirect(302, '/admin/login');
  res.type('html').send(
    page(
      'Visiteurs — tableau de bord',
      `<main class="dash"><header><div><h1>Visiteurs de la boutique</h1>
<p class="muted">Statistiques anonymes, sans cookie visiteur · conservation 14 jours · robots exclus.</p></div>
<form method="post" action="/admin/logout"><button class="ghost" type="submit">Se déconnecter</button></form></header>
<div class="grid">
<div class="card"><span>En ce moment</span><b id="active">—</b><small>5 dernières minutes</small></div>
<div class="card"><span>Visiteurs aujourd’hui</span><b id="visitors">—</b></div>
<div class="card"><span>Pages vues aujourd’hui</span><b id="views">—</b></div>
</div>
<div class="card"><h2>14 derniers jours</h2><table><thead><tr><th>Jour</th><th>Visiteurs</th><th>Pages vues</th><th></th></tr></thead><tbody id="daily"></tbody></table></div>
<div class="card"><h2>Pages les plus visitées</h2><table><thead><tr><th>Page</th><th>Vues</th></tr></thead><tbody id="pages"></tbody></table></div>
<p class="muted"><button id="refresh" class="ghost" type="button">Actualiser</button> <span id="updated"></span></p></main>`,
      '/admin-dashboard.js',
    ),
  );
});

adminDashboardRouter.get(
  '/admin/analytics/data',
  asyncHandler(async (req, res) => {
    noStore(res);
    if (!validSession(req)) return res.status(401).json({ error: 'Session expirée.' });
    res.json(await analyticsService.summary());
  }),
);

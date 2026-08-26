import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import {
  getAliexpressCreds,
  getAliexpressTokens,
  setAliexpressTokens,
  type AliexpressTokens,
} from '../settings/settings.service.js';

/**
 * Flux OAuth 2.0 AliExpress (plateforme ouverte « IOP », zone Singapour).
 *
 * L'utilisateur ouvre l'URL d'autorisation dans son navigateur, se connecte à
 * SON compte AliExpress et autorise l'application. AliExpress redirige alors
 * vers notre callback avec un `code` à usage unique, que le serveur échange
 * contre un `access_token` (+ `refresh_token`). Ce jeton débloque la recherche
 * par mot-clé `aliexpress.ds.text.search` (indisponible sans jeton).
 *
 * Signature des endpoints système `/rest/...` : HMAC-SHA256 sur
 * `apiPath + concat(tri(clé+valeur))`, en hexadécimal majuscule.
 */

const AUTHORIZE_URL = 'https://api-sg.aliexpress.com/oauth/authorize';
const REST_BASE = 'https://api-sg.aliexpress.com/rest';
const TOKEN_CREATE_PATH = '/auth/token/create';
const TOKEN_REFRESH_PATH = '/auth/token/refresh';

const hmacState = (data: string) =>
  createHmac('sha256', env.auth.jwtSecret).update(data).digest('base64url');

/** État signé (anti-CSRF). */
function signState(): string {
  const body = Buffer.from(JSON.stringify({ p: 'aliexpress', n: randomBytes(8).toString('hex') })).toString('base64url');
  return `${body}.${hmacState(body)}`;
}
function verifyState(state: string): boolean {
  const [body, sig] = (state || '').split('.');
  if (!body || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(hmacState(body));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Signature IOP pour un endpoint système REST. */
function signRest(apiPath: string, params: Record<string, string>, appSecret: string): string {
  const concat = Object.keys(params)
    .sort()
    .map((k) => k + params[k])
    .join('');
  return createHmac('sha256', appSecret).update(apiPath + concat, 'utf8').digest('hex').toUpperCase();
}

export const aliexpressOAuthService = {
  /** URL de redirection à enregistrer comme « Callback URL » dans l'app AliExpress. */
  redirectUri() {
    return `${env.publicUrl.replace(/\/$/, '')}/api/aliexpress/oauth/callback`;
  },

  /** Démarre le flux : URL d'autorisation à ouvrir dans le navigateur. */
  async authorizeUrl(): Promise<{ url: string; redirectUri: string }> {
    const creds = await getAliexpressCreds();
    if (!creds.appKey) throw new HttpError(400, 'Clé App AliExpress manquante.');
    const params = new URLSearchParams({
      response_type: 'code',
      force_auth: 'true',
      redirect_uri: this.redirectUri(),
      client_id: creds.appKey,
      state: signState(),
    });
    return { url: `${AUTHORIZE_URL}?${params.toString()}`, redirectUri: this.redirectUri() };
  },

  /** Callback : échange le `code` contre des jetons et les enregistre. */
  async handleCallback(query: Record<string, string>): Promise<void> {
    if (!verifyState(query.state)) throw new HttpError(400, 'État OAuth invalide.');
    const code = query.code;
    if (!code) throw new HttpError(400, 'Code d’autorisation manquant.');
    const tokens = await this.exchange(TOKEN_CREATE_PATH, { code });
    await setAliexpressTokens(tokens);
    logger.info('AliExpress : jeton OAuth obtenu', { expiresAt: tokens.expiresAt });
  },

  /** Renvoie un access_token valide (rafraîchi si expiré), ou undefined. */
  async getValidAccessToken(): Promise<string | undefined> {
    const t = await getAliexpressTokens();
    if (t.accessToken && (!t.expiresAt || t.expiresAt > Date.now() + 60_000)) return t.accessToken;
    if (!t.refreshToken) return t.accessToken; // pas de refresh possible : on tente l'existant
    try {
      const refreshed = await this.exchange(TOKEN_REFRESH_PATH, { refresh_token: t.refreshToken });
      await setAliexpressTokens(refreshed);
      return refreshed.accessToken;
    } catch (e) {
      logger.warn('AliExpress : échec du rafraîchissement du jeton', { err: String(e).slice(0, 120) });
      return t.accessToken;
    }
  },

  /** État de la connexion (pour l'UI / le diagnostic). */
  async status(): Promise<{ configured: boolean; connected: boolean; expiresAt?: number }> {
    const creds = await getAliexpressCreds();
    const t = await getAliexpressTokens();
    return {
      configured: Boolean(creds.appKey && creds.appSecret),
      connected: Boolean(t.accessToken),
      expiresAt: t.expiresAt,
    };
  },

  /** Appel signé d'un endpoint système REST (création / rafraîchissement de jeton). */
  async exchange(apiPath: string, biz: Record<string, string>): Promise<AliexpressTokens> {
    const creds = await getAliexpressCreds();
    if (!creds.appKey || !creds.appSecret) throw new HttpError(400, 'Identifiants AliExpress manquants.');
    const params: Record<string, string> = {
      app_key: creds.appKey,
      timestamp: String(Date.now()),
      sign_method: 'sha256',
      ...biz,
    };
    params.sign = signRest(apiPath, params, creds.appSecret);

    const res = await fetch(REST_BASE + apiPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    // IOP renvoie soit les champs directement, soit une erreur (`code` != 0 / message).
    const accessToken = data.access_token;
    if (!accessToken) {
      const msg = data.error_message || data.message || data.code || `HTTP ${res.status}`;
      throw new HttpError(502, `AliExpress OAuth: ${String(msg).slice(0, 160)}`);
    }
    // Durée de vie : `expires_in` (secondes) ou `expire_time` (epoch ms) selon la variante.
    let expiresAt: number | undefined;
    if (data.expires_in) expiresAt = Date.now() + Number(data.expires_in) * 1000;
    else if (data.expire_time) expiresAt = Number(data.expire_time);
    return {
      accessToken: String(accessToken),
      refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
      expiresAt,
    };
  },
};

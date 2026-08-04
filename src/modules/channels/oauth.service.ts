import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { decryptJson, encryptJson } from '../../utils/crypto.js';

/**
 * Flux OAuth 2.0 pour les canaux de vente (Etsy, eBay, Amazon SP-API).
 *
 * L'utilisateur fournit les identifiants de SON app développeur (client id/secret)
 * et enregistre l'URL de redirection ci-dessous chez la plateforme. Le bouton
 * « Autoriser » lance le flux ; le callback récupère et rafraîchit les jetons.
 */

type OAuthConfig = Record<string, string>;

interface TokenSet {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
}

const DEF: Record<
  string,
  {
    authUrl: string;
    tokenUrl: string;
    scopes: string[];
    pkce: boolean;
    /** id client dans la config (Etsy: keystring ; eBay: clientId ; Amazon: appId). */
    clientIdKey: string;
    clientSecretKey?: string;
    /** eBay redirige via un « RuName » au lieu d'une URL brute. */
    redirectKey?: string;
  }
> = {
  etsy: {
    authUrl: 'https://www.etsy.com/oauth/connect',
    tokenUrl: 'https://api.etsy.com/v3/public/oauth/token',
    scopes: ['listings_r', 'listings_w', 'transactions_r'],
    pkce: true,
    clientIdKey: 'apiKey',
  },
  ebay: {
    authUrl: 'https://auth.ebay.com/oauth2/authorize',
    tokenUrl: 'https://api.ebay.com/identity/v1/oauth2/token',
    scopes: [
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
      // Requis pour créer/lire les « business policies » (règles de vente).
      'https://api.ebay.com/oauth/api_scope/sell.account',
    ],
    pkce: false,
    clientIdKey: 'clientId',
    clientSecretKey: 'clientSecret',
    redirectKey: 'ruName',
  },
  amazon: {
    authUrl: 'https://sellercentral.amazon.com/apps/authorize/consent',
    tokenUrl: 'https://api.amazon.com/auth/o2/token',
    scopes: [],
    pkce: false,
    clientIdKey: 'lwaClientId',
    clientSecretKey: 'lwaClientSecret',
  },
};

const b64url = (b: Buffer) => b.toString('base64url');
const hmac = (data: string) => createHmac('sha256', env.auth.jwtSecret).update(data).digest('base64url');

/** État signé (anti-CSRF) transportant l'id du canal. */
function signState(payload: object): string {
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, n: randomBytes(8).toString('hex') })));
  return `${body}.${hmac(body)}`;
}
function verifyState(state: string): { channelId: string; type: string } | null {
  const [body, sig] = (state || '').split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(hmac(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
}

export const oauthService = {
  /** URL de redirection à enregistrer dans l'app développeur de la plateforme. */
  redirectUri() {
    return `${env.publicUrl.replace(/\/$/, '')}/api/oauth/callback`;
  },

  /** Démarre le flux : renvoie l'URL d'autorisation vers la plateforme. */
  async start(channelId: string) {
    const ch = await prisma.salesChannel.findUnique({ where: { id: channelId } });
    if (!ch) throw new HttpError(404, 'Canal introuvable');
    const def = DEF[ch.type];
    if (!def) throw new HttpError(400, 'OAuth non supporté pour ce canal.');
    const config = decryptJson<OAuthConfig>(ch.config);
    const clientId = config[def.clientIdKey] || config.appId;
    if (!clientId) throw new HttpError(400, `Identifiant client manquant (${def.clientIdKey}).`);

    const state = signState({ channelId, type: ch.type });
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: def.redirectKey ? config[def.redirectKey] || this.redirectUri() : this.redirectUri(),
      state,
    });
    if (def.scopes.length) params.set('scope', def.scopes.join(' '));

    if (def.pkce) {
      const verifier = b64url(randomBytes(32));
      const challenge = b64url(createHash('sha256').update(verifier).digest());
      params.set('code_challenge', challenge);
      params.set('code_challenge_method', 'S256');
      config._pkceVerifier = verifier;
      await prisma.salesChannel.update({ where: { id: channelId }, data: { config: encryptJson(config) } });
    }
    if (ch.type === 'amazon') {
      // Consentement SP-API : application_id + version beta.
      params.delete('response_type');
      params.delete('client_id');
      params.set('application_id', config.appId || clientId);
      params.set('version', 'beta');
    }
    return { url: `${def.authUrl}?${params.toString()}` };
  },

  /** Callback : échange le code contre des jetons et connecte le canal. */
  async callback(query: Record<string, string>): Promise<string> {
    const state = verifyState(query.state);
    if (!state) throw new HttpError(400, 'État OAuth invalide.');
    const code = query.code || query.spapi_oauth_code;
    if (!code) throw new HttpError(400, 'Code d’autorisation manquant.');

    const ch = await prisma.salesChannel.findUnique({ where: { id: state.channelId } });
    if (!ch) throw new HttpError(404, 'Canal introuvable');
    const def = DEF[ch.type];
    const config = decryptJson<OAuthConfig>(ch.config);

    const tokens = await this.exchangeCode(ch.type, config, code);
    this.store(config, tokens);
    delete config._pkceVerifier;
    await prisma.salesChannel.update({
      where: { id: ch.id },
      data: { config: encryptJson(config), status: 'CONNECTED', error: null },
    });
    logger.info('Canal autorisé (OAuth)', { channel: ch.type });
    // Redirige vers l'app.
    return `${env.publicUrl.replace(/\/$/, '')}/?channel=${ch.type}&connected=1`;
  },

  /** Renvoie une config avec un accessToken valide (rafraîchi si expiré). */
  async ensureToken(channelId: string, config: OAuthConfig): Promise<OAuthConfig> {
    const def = DEF[config._type as string] ?? DEF[(await this.typeOf(channelId)) ?? ''];
    const tokens: TokenSet = {
      accessToken: config.accessToken,
      refreshToken: config.refreshToken,
      expiresAt: config.expiresAt ? Number(config.expiresAt) : undefined,
    };
    const valid = tokens.accessToken && (!tokens.expiresAt || tokens.expiresAt > Date.now() + 60_000);
    if (valid || !tokens.refreshToken || !def) return config;

    const refreshed = await this.refresh(await this.typeOf(channelId), config, tokens.refreshToken);
    this.store(config, refreshed);
    await prisma.salesChannel.update({ where: { id: channelId }, data: { config: encryptJson(config) } });
    return config;
  },

  async typeOf(channelId: string) {
    const ch = await prisma.salesChannel.findUnique({ where: { id: channelId }, select: { type: true } });
    return ch?.type ?? null;
  },

  store(config: OAuthConfig, t: TokenSet) {
    if (t.accessToken) config.accessToken = t.accessToken;
    if (t.refreshToken) config.refreshToken = t.refreshToken;
    if (t.expiresAt) config.expiresAt = String(t.expiresAt);
  },

  // ── Échange / rafraîchissement de jetons ────────────────
  async exchangeCode(type: string, config: OAuthConfig, code: string): Promise<TokenSet> {
    const def = DEF[type];
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: def.redirectKey ? config[def.redirectKey] || this.redirectUri() : this.redirectUri(),
    });
    if (def.pkce && config._pkceVerifier) {
      body.set('client_id', config[def.clientIdKey]);
      body.set('code_verifier', config._pkceVerifier);
    }
    return this.tokenRequest(type, config, body);
  },

  async refresh(type: string | null, config: OAuthConfig, refreshToken: string): Promise<TokenSet> {
    if (!type) throw new HttpError(400, 'Type de canal inconnu.');
    const def = DEF[type];
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (def.pkce) body.set('client_id', config[def.clientIdKey]);
    if (def.scopes.length && type === 'ebay') body.set('scope', def.scopes.join(' '));
    return this.tokenRequest(type, config, body);
  },

  async tokenRequest(type: string, config: OAuthConfig, body: URLSearchParams): Promise<TokenSet> {
    const def = DEF[type];
    // Surcharge possible du endpoint (bac à sable / tests) : OAUTH_TOKEN_URL_ETSY, ...
    const tokenUrl = process.env[`OAUTH_TOKEN_URL_${type.toUpperCase()}`] || def.tokenUrl;
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    // eBay & Amazon : authentification client (Basic ou champs de corps).
    if (def.clientSecretKey) {
      if (type === 'ebay') {
        const basic = Buffer.from(`${config[def.clientIdKey]}:${config[def.clientSecretKey]}`).toString('base64');
        headers.Authorization = `Basic ${basic}`;
      } else {
        body.set('client_id', config[def.clientIdKey]);
        body.set('client_secret', config[def.clientSecretKey]);
      }
    }
    const res = await fetch(tokenUrl, { method: 'POST', headers, body });
    if (!res.ok) {
      const t = await res.text();
      logger.error('Échange de jeton OAuth échoué', { type, status: res.status });
      throw new HttpError(502, `Autorisation ${type} échouée: ${t.slice(0, 160)}`);
    }
    const data = await res.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : undefined,
    };
  },
};

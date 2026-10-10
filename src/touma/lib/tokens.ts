import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Jetons Touma : un **jeton d'accès** court (JWT HS256, secret dédié) et un
 * **jeton de rafraîchissement** opaque, stocké haché en base et soumis à
 * rotation (voir `auth.service.ts`).
 */

export interface AccessTokenPayload {
  sub: string;
  email: string;
  /** Rôle place de marché : BUYER | SELLER | ADMIN. */
  role: string;
  /** Version de session : incrémentée pour révoquer tous les jetons. */
  tv: number;
  purpose: 'touma_access';
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Comparaison à temps constant de deux signatures. */
function signatureMatches(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Émet un jeton d'accès court pour un utilisateur. */
export function signAccessToken(user: { id: string; email: string; toumaRole: string; tokenVersion: number }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      role: user.toumaRole,
      tv: user.tokenVersion,
      purpose: 'touma_access',
      iat: now,
      exp: now + env.touma.accessTtlSeconds,
    } satisfies AccessTokenPayload),
  );
  return `${header}.${payload}.${sign(`${header}.${payload}`, env.touma.accessSecret)}`;
}

/** Vérifie un jeton d'accès ; renvoie la charge utile ou `null`. */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  if (!signatureMatches(sig, sign(`${header}.${payload}`, env.touma.accessSecret))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as AccessTokenPayload;
    if (data.purpose !== 'touma_access') return null;
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Jeton de rafraîchissement : valeur aléatoire opaque (256 bits) signée par le
 * secret de rafraîchissement. La base ne stocke que son SHA-256 — une fuite de
 * la base ne permet donc pas de rejouer un jeton.
 */
export function generateRefreshToken(): { token: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  const mac = sign(raw, env.touma.refreshSecret);
  const token = `${raw}.${mac}`;
  return { token, hash: hashRefreshToken(token) };
}

/** Hash de stockage d'un jeton de rafraîchissement. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Vérifie l'intégrité d'un jeton de rafraîchissement (avant tout accès base). */
export function refreshTokenLooksValid(token: string): boolean {
  const [raw, mac] = (token || '').split('.');
  if (!raw || !mac) return false;
  return signatureMatches(mac, sign(raw, env.touma.refreshSecret));
}

import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../config/env.js';

const scryptAsync = promisify(scrypt);

// ── Mots de passe (scrypt) ─────────────────────────────────

/** Hache un mot de passe : renvoie `sel:hash` (hex). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** Vérifie un mot de passe contre un hash `sel:hash`. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// ── JWT (HS256) ────────────────────────────────────────────

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string): string {
  return createHmac('sha256', env.auth.jwtSecret).update(data).digest('base64url');
}

export interface TokenPayload {
  sub: string; // user id
  email: string;
  role: string;
  tv: number; // version de session (révocation)
  iat: number;
  exp: number;
}

/** Génère un JWT signé pour un utilisateur. */
export function signToken(user: { id: string; email: string; role: string; tokenVersion?: number }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      role: user.role,
      tv: user.tokenVersion ?? 0,
      iat: now,
      exp: now + env.auth.jwtTtlSeconds,
    }),
  );
  const sig = sign(`${header}.${payload}`);
  return `${header}.${payload}.${sig}`;
}

/**
 * Jeton de réinitialisation de mot de passe (30 min). Contient `tv` (tokenVersion) :
 * après une réinitialisation on incrémente tokenVersion, ce qui rend tout lien
 * précédent invalide (usage unique).
 */
export function signPasswordReset(userId: string, tokenVersion: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: userId, tv: tokenVersion, purpose: 'reset', iat: now, exp: now + 1800 }));
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

/** Vérifie un jeton de réinitialisation ; renvoie { userId, tv } ou null. */
export function verifyPasswordReset(token: string): { userId: string; tv: number } | null {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = sign(`${header}.${payload}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.purpose !== 'reset' || (data.exp && data.exp < Math.floor(Date.now() / 1000))) return null;
    return { userId: data.sub as string, tv: Number(data.tv) };
  } catch {
    return null;
  }
}

/** Jeton « step-up » (2 min) : preuve d'une ré-authentification récente pour une action sensible. */
export function signStepUp(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: userId, purpose: 'stepup', iat: now, exp: now + 120 }));
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

/** Vérifie un jeton step-up ; renvoie l'id utilisateur ou null. */
export function verifyStepUp(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = sign(`${header}.${payload}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.purpose !== 'stepup' || (data.exp && data.exp < Math.floor(Date.now() / 1000))) return null;
    return data.sub as string;
  } catch {
    return null;
  }
}

/**
 * Jeton de défi MFA (court, 5 min) : émis après le mot de passe, échangé contre
 * un vrai jeton une fois le second facteur validé. Ne donne aucun accès à l'API.
 */
export function signMfaChallenge(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: userId, purpose: 'mfa', iat: now, exp: now + 300 }));
  const sig = sign(`${header}.${payload}`);
  return `${header}.${payload}.${sig}`;
}

/** Vérifie un jeton de défi MFA et renvoie l'id utilisateur, ou null. */
export function verifyMfaChallenge(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = sign(`${header}.${payload}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.purpose !== 'mfa' || (data.exp && data.exp < Math.floor(Date.now() / 1000))) return null;
    return data.sub as string;
  } catch {
    return null;
  }
}

/** Vérifie un JWT et renvoie sa charge utile, ou null si invalide/expiré. */
export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = sign(`${header}.${payload}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as TokenPayload;
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

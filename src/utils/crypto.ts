import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Chiffrement symétrique des données sensibles en base (AES-256-GCM).
 * Utilisé pour les identifiants des canaux de vente (clés API / jetons OAuth).
 *
 * Format : `enc:v1:<base64(iv|tag|ciphertext)>`. Les valeurs sans ce préfixe
 * sont considérées comme du texte clair (compatibilité ascendante).
 */
const PREFIX = 'enc:v1:';
// Clé dérivée (32 octets) à partir du secret, avec un sel applicatif constant.
const key = scryptSync(env.security.encryptionKey, 'toumai-enc-salt', 32);

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(payload: string): string {
  if (!payload || !payload.startsWith(PREFIX)) return payload; // texte clair hérité
  try {
    const raw = Buffer.from(payload.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** Chiffre un objet JSON. */
export function encryptJson(obj: unknown): string {
  return encrypt(JSON.stringify(obj));
}

/** Déchiffre vers un objet JSON (retourne {} si vide/illisible). */
export function decryptJson<T = Record<string, string>>(payload: string): T {
  const s = decrypt(payload || '');
  try {
    return (s ? JSON.parse(s) : {}) as T;
  } catch {
    return {} as T;
  }
}

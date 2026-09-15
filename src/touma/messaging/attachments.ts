import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { env } from '../../config/env.js';
import { badRequest } from '../lib/errors.js';
import { attachmentStorage, setAttachmentStorage } from './storage.js';
import { s3StorageFromEnv } from './s3-storage.js';

export { assertStorageKey, attachmentStorage, setAttachmentStorage, type AttachmentStorage } from './storage.js';

/**
 * Pièces jointes de la messagerie.
 *
 * Trois règles, qui découlent d'un même constat : **le navigateur n'est pas
 * une source fiable**.
 *
 *  1. Le type déclaré ne vaut rien : on lit les premiers octets du fichier.
 *  2. La taille déclarée ne vaut rien : on mesure le contenu reçu.
 *  3. Le fichier n'est jamais servi depuis une URL publique : il est stocké
 *     sous une clé non devinable et rendu par une URL signée à durée courte,
 *     réservée aux participants du fil.
 */

/** Types acceptés, et l'extension canonique qu'on leur donne au stockage. */
const ACCEPTED = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
} as const;

export type AcceptedMime = keyof typeof ACCEPTED;

export const MAX_ATTACHMENT_BYTES = Number(process.env.TOUMA_ATTACHMENT_MAX_BYTES ?? 10 * 1024 * 1024);
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/** Durée de validité d'une URL signée (secondes). */
const SIGNED_URL_TTL = Number(process.env.TOUMA_ATTACHMENT_URL_TTL ?? 300);

function startsWith(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buffer[offset + i] === b);
}

/**
 * Reconnaît le type réel à partir du contenu. Renvoie `null` si le contenu ne
 * correspond à aucun format accepté — c'est un refus, pas un avertissement.
 */
export function sniffMime(buffer: Buffer, declaredName: string): AcceptedMime | null {
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf'; // %PDF
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';

  // Un .xlsx est une archive ZIP. On n'accepte l'archive que si le nom annonce
  // un classeur : une archive quelconque reste refusée.
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) && /\.xlsx$/i.test(declaredName)) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }

  // Un CSV n'a pas de signature : il doit être du texte lisible, sans octet nul
  // et sans début de balisage exécutable.
  if (/\.csv$/i.test(declaredName) && isPlainText(buffer)) return 'text/csv';

  return null;
}

/** Le contenu est-il du texte simple, sans balisage exécutable ? */
function isPlainText(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 4096);
  if (head.includes(0)) return false;
  const text = head.toString('utf8');
  if (text.includes('�')) return false; // séquence UTF-8 invalide
  return !/^\s*(?:<!doctype|<html|<\?xml|<svg|<script)/i.test(text);
}

/** Contenus formellement interdits, quel que soit le nom du fichier. */
export function isForbiddenBinary(buffer: Buffer): boolean {
  return (
    startsWith(buffer, [0x4d, 0x5a]) || // exécutable Windows (MZ)
    startsWith(buffer, [0x7f, 0x45, 0x4c, 0x46]) || // ELF
    startsWith(buffer, [0xca, 0xfe, 0xba, 0xbe]) || // Mach-O / class Java
    startsWith(buffer, [0x23, 0x21]) // shebang (#!)
  );
}

export interface StoredAttachment {
  storageKey: string;
  name: string;
  mimeType: AcceptedMime;
  sizeBytes: number;
  checksum: string;
}

/**
 * Choisit le stockage au démarrage : S3 si l'environnement le décrit, local
 * sinon. Appelé une fois par `createApp()` — une configuration S3 incomplète
 * doit faire échouer le démarrage, pas la première pièce jointe envoyée.
 */
export function initAttachmentStorage(): void {
  const s3 = s3StorageFromEnv();
  if (s3) setAttachmentStorage(s3);
}

/** Nom de fichier sûr pour l'affichage : ni chemin, ni caractère de contrôle. */
export function safeDisplayName(name: string): string {
  const base = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (base || 'fichier').slice(0, 120);
}

/**
 * Valide puis stocke un contenu reçu. Le type retenu est celui **déduit du
 * contenu**, jamais celui annoncé par le client.
 */
export async function storeAttachment(content: Buffer, declaredName: string): Promise<StoredAttachment> {
  if (content.length === 0) throw badRequest('Fichier vide.');
  if (content.length > MAX_ATTACHMENT_BYTES) {
    throw badRequest(`Fichier trop volumineux : ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} Mo au maximum.`);
  }
  if (isForbiddenBinary(content)) throw badRequest('Ce type de fichier n’est pas autorisé.');

  const name = safeDisplayName(declaredName);
  const mimeType = sniffMime(content, name);
  if (!mimeType) {
    throw badRequest('Format non reconnu. Formats acceptés : PDF, JPEG, PNG, WebP, XLSX, CSV.');
  }

  const checksum = createHash('sha256').update(content).digest('hex');
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomBytes(16).toString('hex')}.${ACCEPTED[mimeType]}`;
  await attachmentStorage().put(key, content);

  return { storageKey: key, name, mimeType, sizeBytes: content.length, checksum };
}

/** Lit un contenu stocké. */
export async function readAttachment(key: string): Promise<Buffer> {
  return attachmentStorage().get(key);
}

// ── URL signées ──────────────────────────────────────────────────────────────

function signature(attachmentId: string, expiresAt: number): string {
  return createHmac('sha256', env.touma.accessSecret).update(`${attachmentId}.${expiresAt}`).digest('hex');
}

/**
 * Fabrique une URL signée, valable quelques minutes, pour un participant.
 *
 * Le chemin est un paramètre parce que deux ressources distinctes se servent de
 * ce mécanisme : les pièces jointes de la messagerie et les preuves de litige,
 * qui vivent dans deux tables différentes. Une preuve pointée vers le chemin des
 * pièces jointes se cherchait dans la mauvaise table et ne se trouvait jamais :
 * elle pouvait être versée, listée, et **jamais ouverte** — y compris par
 * l'arbitre qui décidait dessus.
 *
 * La signature, elle, reste calculée sur `id.expiration` : les liens déjà émis
 * continuent de valoir.
 */
export function signedUrl(attachmentId: string, basePath = '/api/v1/attachments'): { url: string; expiresAt: string } {
  const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL;
  const sig = signature(attachmentId, expiresAt);
  return {
    url: `${basePath}/${attachmentId}?expires=${expiresAt}&signature=${sig}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

/** Vérifie une signature d'URL (comparaison à temps constant). */
export function verifySignature(attachmentId: string, expires: string, sig: string): boolean {
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return false;
  const expected = Buffer.from(signature(attachmentId, expiresAt));
  const given = Buffer.from(String(sig));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Type renvoyé au téléchargement. On ne sert jamais un contenu envoyé par un
 * utilisateur comme du HTML ou du SVG : ces types exécutent du script dans le
 * navigateur, sous notre origine.
 */
export function safeContentType(mimeType: string): string {
  return (Object.keys(ACCEPTED) as string[]).includes(mimeType) ? mimeType : 'application/octet-stream';
}

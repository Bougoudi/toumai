import { createHash, createHmac } from 'node:crypto';
import { env } from '../../config/env.js';
import { HttpError, notFound } from '../lib/errors.js';
import { logger } from '../../utils/logger.js';
import { assertStorageKey, type AttachmentStorage } from './storage.js';

/**
 * Stockage des pièces jointes sur un service objet compatible S3
 * (MinIO, Cloudflare R2, Scaleway, Wasabi, Backblaze B2, AWS S3).
 *
 * Trois décisions, toutes dictées par la même règle : **le bucket reste privé**.
 *
 *  1. Aucune URL du bucket n'est jamais remise à un navigateur. Le fichier est
 *     lu par le serveur, qui vérifie d'abord que le demandeur participe bien au
 *     fil, puis le sert derrière notre propre URL signée. Une URL présignée S3
 *     court-circuiterait ce contrôle : quiconque la recopie pourrait lire la
 *     pièce jointe pendant toute sa durée de validité.
 *  2. Aucun objet n'est écrit avec une ACL publique. La configuration du bucket
 *     (accès bloqué, chiffrement au repos) relève de l'exploitant ; le code ne
 *     la contredit jamais.
 *  3. La signature est calculée ici, sans SDK : AWS Signature V4 tient en une
 *     poignée de HMAC, et le dépôt évite déjà les dépendances superflues.
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
const REQUEST_TIMEOUT_MS = Number(process.env.S3_TIMEOUT_MS ?? 10_000);

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * Clé de signature dérivée du secret, de la date, de la région et du service.
 * Exportée pour être confrontée au vecteur d'exemple publié par AWS : si cette
 * dérivation est fausse, aucune requête ne sera jamais acceptée.
 */
export function deriveSigningKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), service), 'aws4_request');
}

/** Encodage RFC 3986, celui qu'attend la requête canonique. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `2026-09-13T15:04:05.123Z` → `20260913T150405Z`. */
function amzDate(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
  keyPrefix: string;
  forcePathStyle: boolean;
}

export class S3CompatibleStorage implements AttachmentStorage {
  readonly code = 's3';

  constructor(private readonly config: S3Config) {}

  private objectPath(key: string): string {
    return `${this.config.keyPrefix}${assertStorageKey(key)}`;
  }

  private target(key: string): { url: URL; canonicalUri: string } {
    const base = new URL(this.config.endpoint);
    const object = this.objectPath(key);
    const segments = object.split('/').map(encodeRfc3986).join('/');

    if (this.config.forcePathStyle) {
      const prefix = base.pathname.replace(/\/+$/, '');
      const canonicalUri = `${prefix}/${encodeRfc3986(this.config.bucket)}/${segments}`;
      return { url: new URL(`${base.origin}${canonicalUri}`), canonicalUri };
    }
    const canonicalUri = `/${segments}`;
    return { url: new URL(`${base.protocol}//${this.config.bucket}.${base.host}${canonicalUri}`), canonicalUri };
  }

  /** Signature V4 d'une requête unique, charge utile incluse. */
  private sign(
    method: 'GET' | 'PUT',
    url: URL,
    canonicalUri: string,
    payloadHash: string,
    extraHeaders: Record<string, string>,
    now: Date,
  ): Record<string, string> {
    const stamp = amzDate(now);
    const dateStamp = stamp.slice(0, 8);
    const headers: Record<string, string> = {
      ...extraHeaders,
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': stamp,
    };

    const names = Object.keys(headers)
      .map((n) => n.toLowerCase())
      .sort();
    const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join('');
    const signedHeaders = names.join(';');

    const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${this.config.region}/${SERVICE}/aws4_request`;
    const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');

    const signingKey = deriveSigningKey(this.config.secretKey, dateStamp, this.config.region, SERVICE);
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    return {
      ...headers,
      authorization: `${ALGORITHM} Credential=${this.config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  async put(key: string, content: Buffer): Promise<void> {
    const { url, canonicalUri } = this.target(key);
    const headers = this.sign(
      'PUT',
      url,
      canonicalUri,
      sha256Hex(content),
      { 'content-type': 'application/octet-stream' },
      new Date(),
    );

    const response = await this.send(url, { method: 'PUT', headers, body: new Uint8Array(content) });
    if (!response.ok) {
      // Le corps de la réponse peut nommer le bucket : il reste dans le journal.
      logger.error('Écriture S3 refusée', { status: response.status, detail: await this.detail(response) });
      throw new HttpError(502, 'Le stockage des pièces jointes est momentanément indisponible.');
    }
  }

  async get(key: string): Promise<Buffer> {
    const { url, canonicalUri } = this.target(key);
    const headers = this.sign('GET', url, canonicalUri, sha256Hex(''), {}, new Date());

    const response = await this.send(url, { method: 'GET', headers });
    if (response.status === 404) throw notFound('Pièce jointe introuvable.');
    if (!response.ok) {
      logger.error('Lecture S3 refusée', { status: response.status, detail: await this.detail(response) });
      throw new HttpError(502, 'Le stockage des pièces jointes est momentanément indisponible.');
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async send(url: URL, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      logger.error('Stockage S3 injoignable', { err: err instanceof Error ? err.message : String(err) });
      throw new HttpError(502, 'Le stockage des pièces jointes est momentanément indisponible.');
    }
  }

  /** Extrait de la réponse d'erreur, borné : il part au journal, jamais au client. */
  private async detail(response: Response): Promise<string> {
    try {
      return (await response.text()).slice(0, 500);
    } catch {
      return '';
    }
  }
}

/**
 * Construit l'adaptateur S3 si — et seulement si — la configuration est
 * complète. Une configuration partielle est une erreur d'exploitation : mieux
 * vaut le dire au démarrage que stocker en local sans que personne ne le sache.
 */
export function s3StorageFromEnv(): S3CompatibleStorage | null {
  const { endpoint, bucket, accessKey, secretKey, region, keyPrefix, forcePathStyle } = env.storage;
  if (!endpoint && !bucket && !accessKey && !secretKey) return null;

  const missing = [
    ['S3_ENDPOINT', endpoint],
    ['S3_BUCKET', bucket],
    ['S3_ACCESS_KEY', accessKey],
    ['S3_SECRET_KEY', secretKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`Stockage S3 incomplet : ${missing.join(', ')} manquant(s).`);
  }

  return new S3CompatibleStorage({ endpoint, bucket, accessKey, secretKey, region, keyPrefix, forcePathStyle });
}

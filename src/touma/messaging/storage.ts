import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { badRequest } from '../lib/errors.js';

/**
 * Stockage de fichiers privés. L'implémentation locale écrit hors du dossier
 * servi statiquement : aucun fichier envoyé n'est accessible par URL directe.
 * Un adaptateur S3 se branche ici sans toucher au reste.
 */
export interface AttachmentStorage {
  readonly code: string;
  put(key: string, content: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

/**
 * Valide une clé de stockage. Elle est fabriquée par nous — mais un jour
 * quelqu'un appellera ces fonctions avec autre chose, et le contrôle doit être
 * au même endroit pour tous les adaptateurs : un chemin absolu ou une remontée
 * n'a pas le même effet sur un disque et sur un service objet, et aucun des
 * deux n'est acceptable.
 */
export function assertStorageKey(key: string): string {
  const segments = key.split('/');
  const valid =
    /^[\w/-]+\.[a-z0-9]{1,5}$/i.test(key) &&
    !key.startsWith('/') &&
    !key.endsWith('/') &&
    segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  if (!valid) throw badRequest('Clé de stockage invalide.');
  return key;
}

class LocalPrivateStorage implements AttachmentStorage {
  readonly code = 'local';
  private readonly root = path.resolve(process.env.TOUMA_ATTACHMENT_DIR ?? 'var/touma-attachments');

  private resolve(key: string): string {
    return path.join(this.root, assertStorageKey(key));
  }

  async put(key: string, content: Buffer): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
}

let storage: AttachmentStorage = new LocalPrivateStorage();

/** Remplace le stockage (adaptateur S3, tests). */
export function setAttachmentStorage(next: AttachmentStorage): void {
  storage = next;
}

export function attachmentStorage(): AttachmentStorage {
  return storage;
}

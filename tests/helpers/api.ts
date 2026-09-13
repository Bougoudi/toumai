import { createHmac, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

/**
 * Harnais de test : démarre l'application Express réelle sur un port libre et
 * expose un client HTTP minimal. Les tests parlent à la **vraie** API (aucun
 * service n'est simulé côté Touma), avec une vraie base PostgreSQL.
 */

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export class TestApi {
  private server?: Server;
  private baseUrl = '';

  async start(): Promise<void> {
    const app = createApp();
    await new Promise<void>((resolve) => {
      this.server = app.listen(0, () => {
        const address = this.server!.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        this.baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    await prisma.$disconnect();
  }

  get url(): string {
    return this.baseUrl;
  }

  async request<T = any>(
    method: string,
    path: string,
    options: { body?: unknown; token?: string; headers?: Record<string, string>; raw?: Buffer } = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    let body: BodyInit | undefined;
    if (options.raw) {
      body = options.raw;
      headers['content-type'] = headers['content-type'] ?? 'application/json';
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get = <T = any>(path: string, token?: string) => this.request<T>('GET', path, { token });
  post = <T = any>(path: string, body?: unknown, token?: string, headers?: Record<string, string>) =>
    this.request<T>('POST', path, { body, token, headers });
  patch = <T = any>(path: string, body?: unknown, token?: string) => this.request<T>('PATCH', path, { body, token });
  put = <T = any>(path: string, body?: unknown, token?: string) => this.request<T>('PUT', path, { body, token });
  delete = <T = any>(path: string, token?: string) => this.request<T>('DELETE', path, { token });

  /** Envoi d'un fichier en corps brut (pièces jointes de la messagerie). */
  upload = <T = any>(path: string, content: Buffer, fileName: string, token?: string, caption?: string) =>
    this.request<T>('POST', path, {
      raw: content,
      token,
      headers: {
        'content-type': 'application/octet-stream',
        'x-file-name': fileName,
        ...(caption ? { 'x-caption': caption } : {}),
      },
    });
}

/** Adresse e-mail unique par test (aucune collision entre exécutions). */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@touma.test`;
}

/** Signe un webhook de paiement comme le ferait un prestataire réel. */
export function signWebhook(payload: unknown, secret: string): { raw: Buffer; signature: string } {
  const raw = Buffer.from(JSON.stringify(payload));
  return { raw, signature: `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` };
}

/** Crée un compte et renvoie ses jetons. */
export async function registerUser(
  api: TestApi,
  input: { name: string; email: string; role: 'BUYER' | 'SELLER'; countryCode?: string; password?: string },
) {
  const password = input.password ?? 'motdepasse-test-123';
  const res = await api.post('/api/v1/auth/register', {
    name: input.name,
    email: input.email,
    password,
    role: input.role,
    countryCode: input.countryCode ?? 'TD',
  });
  if (res.status !== 201) throw new Error(`Inscription échouée (${res.status}) : ${JSON.stringify(res.body)}`);
  return { ...res.body, password } as { user: any; accessToken: string; refreshToken: string; password: string };
}

/** Promeut un compte au rôle ADMIN (opération base, comme le ferait l'exploitant). */
export async function promoteToAdmin(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { toumaRole: 'ADMIN' } });
}

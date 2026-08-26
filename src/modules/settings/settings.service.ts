import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { decrypt, encrypt } from '../../utils/crypto.js';
import { logger } from '../../utils/logger.js';

/** Préfixe des réglages secrets : non exposés via l'API, ignorés par le cache. */
const SECRET_PREFIX = 'secret.';

/** Réglages modifiables de l'application (surchargent les valeurs d'environnement). */
export interface AppSettings {
  defaultMarkup: number;
  minOpportunityScore: number;
  productsPerRun: number;
  currency: string;
  autopilotIntervalSeconds: number;
  simulateDemand: boolean;
  ordersPerCycle: number;
}

const DEFAULTS: AppSettings = {
  defaultMarkup: env.pricing.defaultMarkup,
  minOpportunityScore: env.pricing.minOpportunityScore,
  productsPerRun: env.quotas.productsPerRun,
  currency: env.pricing.currency,
  autopilotIntervalSeconds: env.autopilot.intervalSeconds,
  simulateDemand: env.autopilot.simulateDemand,
  ordersPerCycle: env.autopilot.ordersPerCycle,
};

let cache: AppSettings = { ...DEFAULTS };

/** Charge les réglages depuis la base (au démarrage). */
export async function loadSettings() {
  try {
    const rows = await prisma.setting.findMany();
    const merged = { ...DEFAULTS };
    for (const row of rows) {
      if (row.key.startsWith(SECRET_PREFIX)) continue; // secrets : hors cache/API
      try {
        (merged as Record<string, unknown>)[row.key] = JSON.parse(row.value);
      } catch {
        /* ignore une valeur corrompue */
      }
    }
    cache = merged;
    logger.info('Réglages chargés');
  } catch {
    /* base pas encore prête : on garde les valeurs par défaut */
  }
}

/** Réglages courants (synchrone, depuis le cache). */
export function getSettings(): AppSettings {
  return cache;
}

export interface AliexpressCreds {
  appKey?: string;
  appSecret?: string;
  trackingId?: string;
  feedName?: string;
}

/** Identifiants AliExpress : base (secret déchiffré) puis repli sur l'environnement. */
export async function getAliexpressCreds(): Promise<AliexpressCreds> {
  const envAli = env.connectors.aliexpress;
  try {
    const rows = await prisma.setting.findMany({
      where: {
        key: {
          in: [
            `${SECRET_PREFIX}aliexpressAppKey`,
            `${SECRET_PREFIX}aliexpressAppSecret`,
            `${SECRET_PREFIX}aliexpressTrackingId`,
            `${SECRET_PREFIX}aliexpressFeedName`,
          ],
        },
      },
    });
    const m: Record<string, string> = {};
    for (const r of rows) m[r.key.slice(SECRET_PREFIX.length)] = r.value;
    const enc = m.aliexpressAppSecret;
    return {
      appKey: m.aliexpressAppKey || envAli.appKey || undefined,
      appSecret: enc ? decrypt(enc) : envAli.appSecret || undefined,
      trackingId: m.aliexpressTrackingId || envAli.trackingId || undefined,
      feedName: m.aliexpressFeedName || undefined,
    };
  } catch {
    return {
      appKey: envAli.appKey || undefined,
      appSecret: envAli.appSecret || undefined,
      trackingId: envAli.trackingId || undefined,
    };
  }
}

export interface AiCreds {
  provider: string; // 'gemini' | 'openai' | 'anthropic'
  apiKey?: string;
  model?: string;
}

/** Identifiants de l'IA (service client) : clé chiffrée au repos. */
export async function getAiCreds(): Promise<AiCreds> {
  try {
    const rows = await prisma.setting.findMany({
      where: {
        key: {
          in: [
            `${SECRET_PREFIX}aiProvider`,
            `${SECRET_PREFIX}aiApiKey`,
            `${SECRET_PREFIX}aiModel`,
          ],
        },
      },
    });
    const m: Record<string, string> = {};
    for (const r of rows) m[r.key.slice(SECRET_PREFIX.length)] = r.value;
    return {
      provider: m.aiProvider || 'gemini',
      apiKey: m.aiApiKey ? decrypt(m.aiApiKey) : undefined,
      model: m.aiModel || undefined,
    };
  } catch {
    return { provider: 'gemini' };
  }
}

/** Enregistre les identifiants de l'IA (clé chiffrée au repos). */
export async function setAiCreds(input: Partial<AiCreds>): Promise<{ ok: true; configured: boolean }> {
  const ops = [] as ReturnType<typeof prisma.setting.upsert>[];
  const put = (key: string, value: string) =>
    ops.push(
      prisma.setting.upsert({
        where: { key: SECRET_PREFIX + key },
        create: { key: SECRET_PREFIX + key, value },
        update: { value },
      }),
    );
  if (input.provider != null) put('aiProvider', input.provider.trim());
  if (input.apiKey != null) put('aiApiKey', encrypt(input.apiKey.trim()));
  if (input.model != null) put('aiModel', input.model.trim());
  if (ops.length) await prisma.$transaction(ops);
  const creds = await getAiCreds();
  return { ok: true, configured: Boolean(creds.apiKey) };
}

export interface AliexpressTokens {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
}

/** Jetons OAuth AliExpress (secrets chiffrés au repos). */
export async function getAliexpressTokens(): Promise<AliexpressTokens> {
  try {
    const rows = await prisma.setting.findMany({
      where: {
        key: {
          in: [
            `${SECRET_PREFIX}aliexpressAccessToken`,
            `${SECRET_PREFIX}aliexpressRefreshToken`,
            `${SECRET_PREFIX}aliexpressTokenExpiresAt`,
          ],
        },
      },
    });
    const m: Record<string, string> = {};
    for (const r of rows) m[r.key.slice(SECRET_PREFIX.length)] = r.value;
    return {
      accessToken: m.aliexpressAccessToken ? decrypt(m.aliexpressAccessToken) : undefined,
      refreshToken: m.aliexpressRefreshToken ? decrypt(m.aliexpressRefreshToken) : undefined,
      expiresAt: m.aliexpressTokenExpiresAt ? Number(m.aliexpressTokenExpiresAt) : undefined,
    };
  } catch {
    return {};
  }
}

/** Enregistre les jetons OAuth AliExpress (access/refresh chiffrés). */
export async function setAliexpressTokens(t: AliexpressTokens): Promise<void> {
  const ops = [] as ReturnType<typeof prisma.setting.upsert>[];
  const put = (key: string, value: string) =>
    ops.push(
      prisma.setting.upsert({
        where: { key: SECRET_PREFIX + key },
        create: { key: SECRET_PREFIX + key, value },
        update: { value },
      }),
    );
  if (t.accessToken != null) put('aliexpressAccessToken', encrypt(t.accessToken));
  if (t.refreshToken != null) put('aliexpressRefreshToken', encrypt(t.refreshToken));
  if (t.expiresAt != null) put('aliexpressTokenExpiresAt', String(t.expiresAt));
  if (ops.length) await prisma.$transaction(ops);
}

/** Enregistre les identifiants AliExpress (secret chiffré au repos). */
export async function setAliexpressCreds(input: AliexpressCreds): Promise<{ ok: true; configured: boolean }> {
  const ops = [] as ReturnType<typeof prisma.setting.upsert>[];
  const put = (key: string, value: string) =>
    ops.push(
      prisma.setting.upsert({
        where: { key: SECRET_PREFIX + key },
        create: { key: SECRET_PREFIX + key, value },
        update: { value },
      }),
    );
  if (input.appKey != null) put('aliexpressAppKey', input.appKey.trim());
  if (input.appSecret != null) put('aliexpressAppSecret', encrypt(input.appSecret.trim()));
  if (input.trackingId != null) put('aliexpressTrackingId', input.trackingId.trim());
  if (input.feedName != null) put('aliexpressFeedName', input.feedName.trim());
  if (ops.length) await prisma.$transaction(ops);
  const creds = await getAliexpressCreds();
  return { ok: true, configured: Boolean(creds.appKey && creds.appSecret) };
}

export const settingsService = {
  get: () => ({ ...cache, defaults: DEFAULTS }),

  async update(patch: Partial<AppSettings>) {
    const next: AppSettings = { ...cache, ...patch };
    const entries = Object.entries(patch);
    await prisma.$transaction(
      entries.map(([key, value]) =>
        prisma.setting.upsert({
          where: { key },
          create: { key, value: JSON.stringify(value) },
          update: { value: JSON.stringify(value) },
        }),
      ),
    );
    cache = next;
    logger.info('Réglages mis à jour', { keys: entries.map(([k]) => k) });
    return { ...cache, defaults: DEFAULTS };
  },

  /** Restaure les valeurs par défaut. */
  async reset() {
    await prisma.setting.deleteMany();
    cache = { ...DEFAULTS };
    return { ...cache, defaults: DEFAULTS };
  },

  /**
   * Supprime toutes les données métier / de démonstration (commandes, produits,
   * fournisseurs, opportunités, clients, etc.) pour repartir sur une base propre.
   *
   * CONSERVE : les comptes utilisateurs (admin), les réglages de l'application et
   * les connexions de canaux de vente (SalesChannel). L'ordre de suppression
   * respecte les contraintes de clés étrangères (enfants avant parents).
   */
  async purgeBusinessData() {
    await prisma.$transaction([
      prisma.supplierMatch.deleteMany(),
      prisma.searchRequest.deleteMany(),
      prisma.channelListing.deleteMany(),
      prisma.favorite.deleteMany(),
      prisma.competitorProduct.deleteMany(),
      prisma.competitor.deleteMany(),
      prisma.ad.deleteMany(),
      prisma.orderItem.deleteMany(),
      prisma.purchaseOrder.deleteMany(),
      prisma.order.deleteMany(),
      prisma.customer.deleteMany(),
      prisma.offer.deleteMany(),
      prisma.product.deleteMany(),
      prisma.supplier.deleteMany(),
      prisma.marketOpportunity.deleteMany(),
      prisma.generationRun.deleteMany(),
      prisma.withdrawal.deleteMany(),
    ]);
    logger.warn('Données métier réinitialisées (purge des données de démonstration)');
    return { ok: true };
  },
};

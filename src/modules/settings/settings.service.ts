import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';

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

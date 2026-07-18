import 'dotenv/config';

/** Configuration centralisée, lue depuis les variables d'environnement. */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'file:./dev.db',

  /** Règles commerciales (dropshipping). */
  pricing: {
    /** Marge appliquée au prix d'achat pour fixer le prix de vente (ex: 2.5 = +150 %). */
    defaultMarkup: Number(process.env.DEFAULT_MARKUP ?? 2.5),
    /** Score d'opportunité minimum pour générer un produit automatiquement. */
    minOpportunityScore: Number(process.env.MIN_OPPORTUNITY_SCORE ?? 60),
    currency: process.env.DEFAULT_CURRENCY ?? 'EUR',
  },

  /** Quotas d'automatisation. */
  quotas: {
    /** Nombre max de produits générés par cycle de génération. */
    productsPerRun: Number(process.env.PRODUCTS_PER_RUN ?? 200),
  },

  scheduler: {
    enabled: (process.env.ENABLE_SCHEDULER ?? 'true') === 'true',
    marketScanCron: process.env.CRON_MARKET_SCAN ?? '*/30 * * * *',
    generateProductsCron: process.env.CRON_GENERATE_PRODUCTS ?? '0 */6 * * *',
    fulfillOrdersCron: process.env.CRON_FULFILL_ORDERS ?? '*/1 * * * *',
    refreshSuppliersCron: process.env.CRON_REFRESH_SUPPLIERS ?? '0 * * * *',
    runSearchesCron: process.env.CRON_RUN_SEARCHES ?? '*/2 * * * *',
    simulateDemandCron: process.env.CRON_SIMULATE_DEMAND ?? '*/3 * * * *',
  },

  /** Mode pilote automatique. */
  autopilot: {
    /** Exécute un cycle complet dès le démarrage (sans attendre le cron). */
    runOnStart: (process.env.AUTOPILOT_RUN_ON_START ?? 'true') === 'true',
    /** Intervalle (secondes) entre deux cycles en exécution autonome (`npm run autopilot`). */
    intervalSeconds: Number(process.env.AUTOPILOT_INTERVAL_SECONDS ?? 60),
    /** Simule des commandes clients pour faire tourner le pilier 3 sans boutique réelle. */
    simulateDemand: (process.env.SIMULATE_DEMAND ?? 'true') === 'true',
    /** Nombre de commandes simulées par cycle. */
    ordersPerCycle: Number(process.env.SIMULATED_ORDERS_PER_CYCLE ?? 3),
  },
} as const;

export const isProd = env.nodeEnv === 'production';

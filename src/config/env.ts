import 'dotenv/config';

const port = Number(process.env.PORT ?? 3000);

/** Configuration centralisée, lue depuis les variables d'environnement. */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port,
  databaseUrl: process.env.DATABASE_URL ?? 'file:./dev.db',
  /** URL publique (pour les redirections de paiement). */
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${port}`,

  /** Règles commerciales (dropshipping). */
  pricing: {
    defaultMarkup: Number(process.env.DEFAULT_MARKUP ?? 2.5),
    minOpportunityScore: Number(process.env.MIN_OPPORTUNITY_SCORE ?? 60),
    currency: process.env.DEFAULT_CURRENCY ?? 'EUR',
  },

  quotas: {
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
    syncChannelsCron: process.env.CRON_SYNC_CHANNELS ?? '*/5 * * * *',
  },

  autopilot: {
    runOnStart: (process.env.AUTOPILOT_RUN_ON_START ?? 'true') === 'true',
    intervalSeconds: Number(process.env.AUTOPILOT_INTERVAL_SECONDS ?? 60),
    simulateDemand: (process.env.SIMULATE_DEMAND ?? 'true') === 'true',
    ordersPerCycle: Number(process.env.SIMULATED_ORDERS_PER_CYCLE ?? 3),
  },

  /**
   * Connecteurs de sources externes. Si `url`/`key` sont fournis, le connecteur
   * HTTP réel est utilisé ; sinon, on retombe sur le connecteur de démonstration.
   */
  connectors: {
    market: { url: process.env.MARKET_API_URL ?? '', key: process.env.MARKET_API_KEY ?? '' },
    supplier: { url: process.env.SUPPLIER_API_URL ?? '', key: process.env.SUPPLIER_API_KEY ?? '' },
    fulfillment: { url: process.env.FULFILLMENT_API_URL ?? '', key: process.env.FULFILLMENT_API_KEY ?? '' },
  },

  /** Authentification (JWT). */
  auth: {
    /** Clé de signature des jetons. À changer impérativement en production. */
    jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
    /** Durée de validité d'un jeton, en secondes (défaut 7 jours). */
    jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS ?? 7 * 24 * 3600),
  },

  /** Paiement Stripe (cartes Visa / Mastercard, etc.). */
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    get enabled() {
      return !!process.env.STRIPE_SECRET_KEY;
    },
  },
} as const;

export const isProd = env.nodeEnv === 'production';

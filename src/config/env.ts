import 'dotenv/config';

const port = Number(process.env.PORT ?? 3000);

/**
 * Mode démonstration. `true` (défaut) : l'appli génère des données factices
 * (fausses commandes, faux fournisseurs, fausses opportunités) pour la prise en
 * main. `false` (production réelle) : aucune donnée simulée n'est créée ; seules
 * les vraies sources connectées (API fournisseurs, canaux de vente, paiements)
 * alimentent l'application.
 */
const demoMode = (process.env.DEMO_MODE ?? 'true') === 'true';

/** Configuration centralisée, lue depuis les variables d'environnement. */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port,
  /** Mode démonstration (données factices) vs production réelle. */
  demoMode,
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
    // La simulation de demande n'existe qu'en mode démo : en production réelle,
    // les commandes proviennent uniquement des vrais canaux de vente.
    simulateDemand: demoMode && (process.env.SIMULATE_DEMAND ?? 'true') === 'true',
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
    /** Reconnaissance d'image (recherche produit par photo). `provider` : 'google' ou générique. */
    vision: {
      url: process.env.VISION_API_URL ?? '',
      key: process.env.VISION_API_KEY ?? '',
      provider: (process.env.VISION_PROVIDER ?? '').toLowerCase(),
    },
    /** Base de données de codes-barres (scan EAN/UPC). La clé est optionnelle (ex. Open Food Facts). */
    barcode: { url: process.env.BARCODE_API_URL ?? '', key: process.env.BARCODE_API_KEY ?? '' },
  },

  /** Authentification (JWT). */
  auth: {
    /** Clé de signature des jetons. À changer impérativement en production. */
    jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
    /** Durée de validité d'un jeton, en secondes (défaut 7 jours). */
    jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS ?? 7 * 24 * 3600),
  },

  /** Sécurité. */
  security: {
    /** Clé de chiffrement des données sensibles en base (identifiants des canaux). */
    encryptionKey: process.env.ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? 'dev-secret-change-me',
    /** Origines autorisées pour les requêtes cross-origin (vide = même origine uniquement). */
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  },

  /** Paiement Stripe (cartes Visa / Mastercard, etc. — Europe/international). */
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    get enabled() {
      return !!process.env.STRIPE_SECRET_KEY;
    },
  },

  /**
   * Paiement iyzico (cartes — Turquie). Modèle « carte → portefeuille → retrait
   * IBAN » : le client paie par carte sur la page hébergée iyzico, iyzico détient
   * l'argent puis le solde apparaît dans le portefeuille de l'appli ; le retrait
   * vers l'IBAN se fait depuis le portefeuille.
   *
   * `uri` par défaut = bac à sable (sandbox), gratuit et sans document. En
   * production réelle, mettre `https://api.iyzipay.com` + les vraies clés.
   */
  iyzico: {
    apiKey: process.env.IYZICO_API_KEY ?? '',
    secretKey: process.env.IYZICO_SECRET_KEY ?? '',
    uri: process.env.IYZICO_URI ?? 'https://sandbox-api.iyzipay.com',
    get enabled() {
      return !!process.env.IYZICO_API_KEY && !!process.env.IYZICO_SECRET_KEY;
    },
    get sandbox() {
      return (process.env.IYZICO_URI ?? 'https://sandbox-api.iyzipay.com').includes('sandbox');
    },
  },

  /**
   * Prestataire de paiement carte actif. `auto` (défaut) : iyzico s'il est
   * configuré, sinon Stripe. On peut forcer via `PAYMENT_PROVIDER=iyzico|stripe`.
   */
  get paymentProvider(): 'iyzico' | 'stripe' | 'none' {
    const forced = (process.env.PAYMENT_PROVIDER ?? '').toLowerCase();
    if (forced === 'iyzico') return this.iyzico.enabled ? 'iyzico' : 'none';
    if (forced === 'stripe') return this.stripe.enabled ? 'stripe' : 'none';
    if (this.iyzico.enabled) return 'iyzico';
    if (this.stripe.enabled) return 'stripe';
    return 'none';
  },
} as const;

export const isProd = env.nodeEnv === 'production';

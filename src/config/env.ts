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
    /**
     * Recherche de produits AliExpress (« Trouver des produits »). App Key +
     * App Secret depuis le portail AliExpress Open Platform. `trackingId`
     * (facultatif) = identifiant de suivi affilié.
     */
    aliexpress: {
      appKey: process.env.ALIEXPRESS_APP_KEY ?? '',
      appSecret: process.env.ALIEXPRESS_APP_SECRET ?? '',
      trackingId: process.env.ALIEXPRESS_TRACKING_ID ?? '',
    },
  },

  /** Authentification (JWT). */
  auth: {
    /** Clé de signature des jetons. À changer impérativement en production. */
    jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
    /** Durée de validité d'un jeton, en secondes (défaut 7 jours). */
    jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS ?? 7 * 24 * 3600),
  },

  /**
   * TOUMA — place de marché africaine (corridor pilote Tchad ↔ Cameroun).
   * Rien n'est codé en dur : pays, devises et taux de commission sont
   * configurables (les pays vivent en base, voir le modèle `Country`).
   */
  touma: {
    /** Secrets distincts pour les jetons d'accès et de rafraîchissement. */
    accessSecret: process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET ?? 'dev-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? `${process.env.JWT_SECRET ?? 'dev-secret-change-me'}:refresh`,
    /** Jeton d'accès court (défaut 15 min). */
    accessTtlSeconds: Number(process.env.TOUMA_ACCESS_TTL_SECONDS ?? 15 * 60),
    /** Jeton de rafraîchissement (défaut 30 jours), soumis à rotation. */
    refreshTtlSeconds: Number(process.env.TOUMA_REFRESH_TTL_SECONDS ?? 30 * 24 * 3600),
    /** Commission plateforme par défaut (0.05 = 5 %). Jamais codée en dur ailleurs. */
    commissionRate: Number(process.env.TOUMA_COMMISSION_RATE ?? 0.05),
    /** Devise de repli quand le pays n'en déclare aucune. */
    defaultCurrency: process.env.TOUMA_DEFAULT_CURRENCY ?? 'XAF',
    /** Pagination : taille par défaut et maximum autorisé. */
    pageSize: Number(process.env.TOUMA_PAGE_SIZE ?? 20),
    maxPageSize: Number(process.env.TOUMA_MAX_PAGE_SIZE ?? 100),
    /** Secret de signature des webhooks de paiement (HMAC). */
    paymentWebhookSecret: process.env.TOUMA_PAYMENT_WEBHOOK_SECRET ?? process.env.JWT_SECRET ?? 'dev-secret-change-me',
    /**
     * Fenêtre d'acceptation d'un webhook, en secondes (défaut 5 min).
     *
     * Au-delà, un webhook correctement signé est refusé : sans cette borne, un
     * webhook capté puis rejoué des mois plus tard, avec un identifiant jamais
     * vu, serait accepté. Trop serrée, elle rejetterait des livraisons
     * légitimement retardées par le réseau — c'est le compromis que règle cette
     * valeur, et le prestataire réel dira laquelle il tolère.
     */
    webhookToleranceSeconds: Number(process.env.TOUMA_WEBHOOK_TOLERANCE_SECONDS ?? 300),
    /** Délai d'ouverture d'une demande de retour après livraison (jours). */
    returnWindowDays: Number(process.env.TOUMA_RETURN_WINDOW_DAYS ?? 14),
    /**
     * Fidélité. Les points ne traversent pas les devises : ils ne sont gagnés
     * que sur les commandes libellées dans `loyaltyCurrency`, faute de taux de
     * change officiel.
     */
    loyaltyEnabled: process.env.TOUMA_LOYALTY_ENABLED !== 'false',
    loyaltyCurrency: process.env.TOUMA_LOYALTY_CURRENCY ?? process.env.TOUMA_DEFAULT_CURRENCY ?? 'XAF',
    /** Points gagnés par unité monétaire dépensée (0.01 = 1 point pour 100). */
    loyaltyEarnRate: Number(process.env.TOUMA_LOYALTY_EARN_RATE ?? 0.01),
    /** Valeur d'un point à l'usage, en unités monétaires. */
    loyaltyPointValue: Number(process.env.TOUMA_LOYALTY_POINT_VALUE ?? 1),
    /** Part maximale du panier réglable en points (0.5 = la moitié). */
    loyaltyMaxShare: Number(process.env.TOUMA_LOYALTY_MAX_SHARE ?? 0.5),
    /** Paliers, du plus bas au plus haut : « NOM:pointsCumulés » séparés par des virgules. */
    loyaltyTiers: process.env.TOUMA_LOYALTY_TIERS ?? 'BRONZE:0,ARGENT:500,OR:2000,PLATINE:10000',
    /**
     * Identité légale de TOUMA, portée sur les reçus de paiement. Tant qu'elle
     * n'est pas renseignée, le document le dit plutôt que d'inventer une
     * raison sociale ou un numéro d'immatriculation.
     */
    companyName: process.env.TOUMA_COMPANY_NAME ?? '',
    companyLegalName: process.env.TOUMA_COMPANY_LEGAL_NAME ?? '',
    companyRegistrationNo: process.env.TOUMA_COMPANY_REGISTRATION_NO ?? '',
    companyTaxId: process.env.TOUMA_COMPANY_TAX_ID ?? '',
    companyAddress: process.env.TOUMA_COMPANY_ADDRESS ?? '',
    companyCountry: process.env.TOUMA_COMPANY_COUNTRY ?? '',
    companyEmail: process.env.TOUMA_COMPANY_EMAIL ?? '',
    /**
     * Réputation vendeur. En dessous de `reputationMinOrders` commandes
     * livrées, aucun indicateur n'est publié : un taux calculé sur deux
     * commandes ne dit rien et induirait l'acheteur en erreur.
     */
    reputationMinOrders: Number(process.env.TOUMA_REPUTATION_MIN_ORDERS ?? 5),
    /** Durée de validité d'un instantané de réputation (secondes). */
    reputationTtlSeconds: Number(process.env.TOUMA_REPUTATION_TTL_SECONDS ?? 3600),
    /** Adaptateurs actifs (mock tant qu'aucun prestataire réel n'est raccordé). */
    paymentProvider: process.env.TOUMA_PAYMENT_PROVIDER ?? 'mock',
    logisticsProvider: process.env.TOUMA_LOGISTICS_PROVIDER ?? 'mock',
    aiProvider: process.env.TOUMA_AI_PROVIDER ?? 'mock',
  },

  /** Cache / file d'attente (Redis). Optionnel : l'API démarre sans. */
  redis: {
    url: process.env.REDIS_URL ?? '',
    get enabled() {
      return !!process.env.REDIS_URL;
    },
  },

  /** Stockage objet compatible S3 (images produits, documents de vérification). */
  storage: {
    endpoint: process.env.S3_ENDPOINT ?? '',
    bucket: process.env.S3_BUCKET ?? '',
    accessKey: process.env.S3_ACCESS_KEY ?? '',
    secretKey: process.env.S3_SECRET_KEY ?? '',
    region: process.env.S3_REGION ?? 'auto',
    /** Préfixe des objets, pour cohabiter avec d'autres usages du même bucket. */
    keyPrefix: (process.env.S3_KEY_PREFIX ?? '').replace(/^\/+|\/+$/g, '') ? `${(process.env.S3_KEY_PREFIX ?? '').replace(/^\/+|\/+$/g, '')}/` : '',
    /**
     * Adressage par chemin (`endpoint/bucket/clé`). C'est le mode accepté
     * partout ; l'adressage par sous-domaine se réserve aux services qui
     * l'exigent.
     */
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    get enabled() {
      return !!process.env.S3_ENDPOINT && !!process.env.S3_BUCKET;
    },
  },

  /** Sécurité. */
  security: {
    /** Clé de chiffrement des données sensibles en base (identifiants des canaux). */
    encryptionKey: process.env.ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? 'dev-secret-change-me',
    /** Origines autorisées pour les requêtes cross-origin (vide = même origine uniquement). */
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  },

  /**
   * Envoi d'e-mails (réinitialisation de mot de passe « mot de passe oublié »).
   * Via l'API HTTP de Resend (gratuit, simple) : définir RESEND_API_KEY. Sans
   * clé, l'envoi est désactivé (la réinitialisation par e-mail est indisponible).
   */
  email: {
    resendApiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.EMAIL_FROM ?? 'Toumai <onboarding@resend.dev>',
    apiUrl: process.env.EMAIL_API_URL ?? 'https://api.resend.com/emails',
    get enabled() {
      return !!process.env.RESEND_API_KEY;
    },
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
   * eBay : jeton de vérification pour la « notification de suppression de compte »
   * (obligatoire pour activer un jeu de clés Production). Le même jeton doit être
   * saisi dans le portail développeur eBay, à côté de l'URL de notification
   * `${PUBLIC_URL}/api/ebay/account-deletion`.
   */
  ebay: {
    verificationToken: process.env.EBAY_VERIFICATION_TOKEN ?? '',
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

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
     * Entretien périodique du domaine (balayages et purges).
     *
     * Activé par défaut : les balayages étaient jusqu'ici déclenchés par le
     * trafic, ce qui marche la journée et pas la nuit — or c'est la nuit que
     * les délais expirent. Le désactiver est un choix d'exploitation (un
     * déploiement où un autre processus s'en charge), pas un réglage de
     * confort.
     */
    maintenanceEnabled: (process.env.TOUMA_MAINTENANCE_ENABLED ?? 'true') === 'true',
    maintenanceCron: {
      /** Le stock réservé doit revenir vite : un article hors catalogue ne se vend pas. */
      reservations: process.env.TOUMA_CRON_RESERVATIONS ?? '*/2 * * * *',
      settlements: process.env.TOUMA_CRON_SETTLEMENTS ?? '*/10 * * * *',
      disputes: process.env.TOUMA_CRON_DISPUTES ?? '*/15 * * * *',
      /** Recalcul de la confiance : utile, jamais urgent. */
      trust: process.env.TOUMA_CRON_TRUST ?? '*/5 * * * *',
      /** Clôture des ventes flash : la minute suffit, elles sont courtes. */
      flashSales: process.env.TOUMA_CRON_FLASH_SALES ?? '* * * * *',
      /**
       * Travaux d'intelligence : la fenêtre est l'heure, donc l'horaire aussi.
       * Les faire tourner plus souvent ne produirait rien de plus — la
       * deuxième passe de la même heure est refusée par l'unicité en base.
       */
      intelligence: process.env.TOUMA_CRON_INTELLIGENCE ?? '7 * * * *',
      /** Les purges n'ont aucune urgence : une fois par nuit suffit. */
      purges: process.env.TOUMA_CRON_PURGES ?? '30 3 * * *',
    },
    /**
     * Conservation des traces de webhook, en jours.
     *
     * Une durée d'exploitation, pas une réponse à la question de conservation
     * des données financières — celle-là attend le conseil juridique
     * (`docs/payments/compliance-boundaries.md`).
     */
    webhookRetentionDays: Number(process.env.TOUMA_WEBHOOK_RETENTION_DAYS ?? 90),
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

    /**
     * TOUMA Trust (V21).
     *
     * Les seuils et la décroissance sont des réglages d'exploitation, pas des
     * constantes de code : une place de marché qui démarre n'a pas le volume
     * d'une place installée, et ces valeurs devront être revues avec des
     * vendeurs réels. Les pondérations, elles, vivent dans
     * `src/touma/trust/weights.ts` et sont publiées.
     */
    trust: {
      /** Coupe-circuit général du module (§47 — feature flags). */
      enabled: process.env.TOUMA_TRUST_ENABLED !== 'false',
      verificationEnabled: process.env.TOUMA_TRUST_VERIFICATION_ENABLED !== 'false',
      reviewModerationEnabled: process.env.TOUMA_TRUST_REVIEW_MODERATION_ENABLED !== 'false',
      supplierScoreEnabled: process.env.TOUMA_TRUST_SUPPLIER_SCORE_ENABLED !== 'false',
      transactionRiskEnabled: process.env.TOUMA_TRUST_TRANSACTION_RISK_ENABLED !== 'false',
      /**
       * L'explication d'un score par l'IA reste **fermée par défaut**. Le score
       * est déjà explicable sans elle : la ventilation suffit. L'IA ne fait que
       * mettre en phrases, et il vaut mieux qu'elle soit absente que
       * approximative sur un sujet qui décide d'une réputation.
       */
      aiEnabled: process.env.TOUMA_TRUST_AI_ENABLED === 'true',
      /** Volume minimal avant de publier un score. */
      minSellerOrders: Number(process.env.TOUMA_TRUST_MIN_SELLER_ORDERS ?? 5),
      minBuyerOrders: Number(process.env.TOUMA_TRUST_MIN_BUYER_ORDERS ?? 3),
      minProductOrders: Number(process.env.TOUMA_TRUST_MIN_PRODUCT_ORDERS ?? 5),
      minSupplierQuotes: Number(process.env.TOUMA_TRUST_MIN_SUPPLIER_QUOTES ?? 3),
      /** Décroissance temporelle des événements négatifs. */
      decayHalfLifeDays: Number(process.env.TOUMA_TRUST_DECAY_HALF_LIFE_DAYS ?? 180),
      decayHorizonDays: Number(process.env.TOUMA_TRUST_DECAY_HORIZON_DAYS ?? 730),
      /** Durée de validité d'un score avant recalcul (secondes). */
      ttlSeconds: Number(process.env.TOUMA_TRUST_TTL_SECONDS ?? 3600),
      /**
       * Écart de score à partir duquel l'intéressé est notifié. Sans ce seuil,
       * un vendeur recevrait une notification à chaque commande livrée.
       */
      notifyDelta: Number(process.env.TOUMA_TRUST_NOTIFY_DELTA ?? 5),
    },

    /**
     * TOUMA Growth (V22).
     *
     * Chaque levier a son drapeau parce qu'ils s'arrêtent séparément : couper
     * les promotions automatiques un jour de bug n'a aucune raison de couper
     * aussi la fidélité, qui porte des points déjà gagnés.
     */
    growth: {
      promotionsEnabled: process.env.TOUMA_GROWTH_PROMOTIONS_ENABLED !== 'false',
      couponsEnabled: process.env.TOUMA_GROWTH_COUPONS_ENABLED !== 'false',
      campaignsEnabled: process.env.TOUMA_GROWTH_CAMPAIGNS_ENABLED !== 'false',
      sellerMarketingEnabled: process.env.TOUMA_GROWTH_SELLER_MARKETING_ENABLED !== 'false',
      /**
       * Ventes flash, parrainage, automatisation et tests A/B sont **fermés par
       * défaut**. Ce ne sont pas des réglages de confort : chacun a un mode
       * d'échec qui se paie cher — survente pour une vente flash, fraude pour
       * un parrainage, courriels en rafale pour une automatisation. Ils
       * s'ouvrent quand quelqu'un a décidé de les exploiter, pas parce qu'ils
       * ont été écrits.
       */
      flashSalesEnabled: process.env.TOUMA_GROWTH_FLASH_SALES_ENABLED === 'true',
      referralsEnabled: process.env.TOUMA_GROWTH_REFERRALS_ENABLED === 'true',
      marketingAutomationEnabled: process.env.TOUMA_GROWTH_AUTOMATION_ENABLED === 'true',
      abTestingEnabled: process.env.TOUMA_GROWTH_AB_TESTING_ENABLED === 'true',
      /**
       * Durée minimale pendant laquelle un prix doit avoir été pratiqué pour
       * qu'on puisse l'afficher barré. Sans elle, il suffirait de monter un
       * prix une heure pour annoncer une remise le lendemain.
       */
      referencePriceMinDays: Number(process.env.TOUMA_GROWTH_REFERENCE_PRICE_MIN_DAYS ?? 30),
    },
    /**
     * TOUMA Intelligence (V23).
     *
     * Le fournisseur par défaut est `RULE_BASED` : local, déterministe, sans
     * clé et sans coût. Ce n'est pas un pis-aller en attendant mieux — c'est le
     * repli obligatoire (§47), celui qui répond quand le modèle réel est
     * indisponible. L'application doit fonctionner entièrement sans IA
     * externe ; un fournisseur configuré est une amélioration, jamais une
     * dépendance.
     */
    ai: {
      /** Coupe-circuit général. Tout `/ai` répond 503 quand il est baissé. */
      enabled: process.env.TOUMA_AI_ENABLED !== 'false',
      chatEnabled: process.env.TOUMA_AI_CHAT_ENABLED !== 'false',
      searchEnabled: process.env.TOUMA_AI_SEARCH_ENABLED !== 'false',
      recommendationsEnabled: process.env.TOUMA_AI_RECOMMENDATIONS_ENABLED !== 'false',
      sellerCopilotEnabled: process.env.TOUMA_AI_SELLER_COPILOT_ENABLED !== 'false',
      businessEnabled: process.env.TOUMA_AI_BUSINESS_ENABLED !== 'false',
      adminEnabled: process.env.TOUMA_AI_ADMIN_ENABLED !== 'false',
      /**
       * Embeddings et automatisation sont **fermés par défaut**. Les premiers
       * coûtent à chaque écriture de produit et n'ont d'intérêt qu'avec un
       * fournisseur réel ; la seconde laisse l'IA déclencher des actions sans
       * qu'on la regarde. Les ouvrir est une décision d'exploitation.
       */
      embeddingsEnabled: process.env.TOUMA_AI_EMBEDDINGS_ENABLED === 'true',
      automationEnabled: process.env.TOUMA_AI_AUTOMATION_ENABLED === 'true',

      /** `RULE_BASED` | `OPENAI` | `ANTHROPIC` | `LOCAL`. */
      provider: process.env.AI_PROVIDER ?? process.env.TOUMA_AI_PROVIDER ?? 'RULE_BASED',
      /** Jamais de valeur par défaut : une clé absente doit rester absente. */
      apiKey: process.env.AI_API_KEY ?? '',
      baseUrl: process.env.AI_BASE_URL ?? '',
      model: process.env.AI_MODEL ?? '',
      /** Modèle économique pour les tâches courtes (§4). */
      fastModel: process.env.AI_FAST_MODEL ?? '',
      /** Modèle de raisonnement pour les analyses (§4). */
      reasoningModel: process.env.AI_REASONING_MODEL ?? '',
      embeddingModel: process.env.AI_EMBEDDING_MODEL ?? '',
      /** §68 : au-delà, la réponse vient du repli plutôt que de faire attendre. */
      timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 20_000),

      /**
       * Plafonds de coût (§5). Exprimés en **appels** et en dollars estimés.
       * Le compte d'appels borne l'abus même avec un fournisseur gratuit, où un
       * plafond en dollars ne borne rien du tout.
       */
      limits: {
        perUserPerDay: Number(process.env.AI_LIMIT_USER_DAY ?? 200),
        perUserPerMonth: Number(process.env.AI_LIMIT_USER_MONTH ?? 3000),
        perScopePerDay: Number(process.env.AI_LIMIT_SCOPE_DAY ?? 1000),
        platformPerDay: Number(process.env.AI_LIMIT_PLATFORM_DAY ?? 20_000),
        /** Dépense estimée maximale par jour, toutes fonctionnalités. */
        platformCostPerDay: Number(process.env.AI_LIMIT_PLATFORM_COST_DAY ?? 25),
      },

      /** Bornes de boucle d'outil (§45). */
      maxToolCalls: Number(process.env.AI_MAX_TOOL_CALLS ?? 8),
      maxToolDepth: Number(process.env.AI_MAX_TOOL_DEPTH ?? 3),
      maxRunMs: Number(process.env.AI_MAX_RUN_MS ?? 30_000),

      /** Durée de vie d'une demande de confirmation (§42), en minutes. */
      confirmationTtlMinutes: Number(process.env.AI_CONFIRMATION_TTL_MINUTES ?? 15),
      /** Expiration de la mémoire, par type (§35), en jours. */
      memorySessionDays: Number(process.env.AI_MEMORY_SESSION_DAYS ?? 1),
      memoryPreferenceDays: Number(process.env.AI_MEMORY_PREFERENCE_DAYS ?? 180),
      memoryTaskDays: Number(process.env.AI_MEMORY_TASK_DAYS ?? 30),
    },

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

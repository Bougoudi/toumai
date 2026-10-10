// Environment configuration. Secrets are read here and never sent to the browser.
const path = require("path");

const bool = (v) => String(v || "").toLowerCase() === "true";
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

function validTimezone(tz) {
  if (!tz) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return null; }
}

function load(env = process.env) {
  const root = path.join(__dirname, "..");
  return {
    port: num(env.PORT, 3000),
    production: env.NODE_ENV === "production",
    trustProxy: bool(env.TRUST_PROXY),
    publicUrl: String(env.PUBLIC_URL || "").replace(/\/$/, ""),
    dbPath: env.DB_PATH || path.join(root, "data", "havenlume.sqlite"),
    backupDir: env.BACKUP_DIR || path.join(path.dirname(env.DB_PATH || path.join(root, "data", "x")), "backups"),
    backupKeep: num(env.BACKUP_KEEP, 14),

    storeName: env.STORE_NAME || "HavenLume",
    supportEmail: env.STORE_SUPPORT_EMAIL || "",
    businessName: env.STORE_BUSINESS_NAME || "",
    businessAddress: env.STORE_BUSINESS_ADDRESS || "",
    currency: "USD",
    priceUsd: num(env.STORE_PRICE_USD, 74.99),
    shippingUsd: num(env.STORE_SHIPPING_USD, 0),
    returnWindowDays: num(env.RETURN_WINDOW_DAYS, 30),
    deliveryMinDays: num(env.SUPPLIER_MIN_DELIVERY_DAYS, 2),
    deliveryMaxDays: num(env.SUPPLIER_MAX_DELIVERY_DAYS, 8),
    deliveryVerified: bool(env.DELIVERY_ESTIMATE_VERIFIED),

    adminUsername: env.ADMIN_USERNAME || "admin",
    adminPasswordHash: env.ADMIN_PASSWORD_HASH || "",
    sessionHours: num(env.ADMIN_SESSION_HOURS, 8),

    livePaymentsEnabled: bool(env.LIVE_PAYMENTS_ENABLED),
    productComplianceVerified: bool(env.PRODUCT_COMPLIANCE_VERIFIED),
    iyzico: {
      apiKey: env.IYZICO_API_KEY || "",
      secretKey: env.IYZICO_SECRET_KEY || "",
      uri: env.IYZICO_URI || "https://sandbox-api.iyzipay.com",
      buyerIdentityNumber: env.IYZICO_BUYER_IDENTITY_NUMBER || "11111111111",
      // iyzico only sends X-IYZ-SIGNATURE-V3 once signatures are enabled on the merchant
      // account. Keep this true so unsigned webhooks are rejected.
      requireWebhookSignature: env.IYZICO_REQUIRE_WEBHOOK_SIGNATURE !== "false",
    },

    email: {
      resendApiKey: env.RESEND_API_KEY || "",
      from: env.EMAIL_FROM || "",
      adminNotifyEmail: env.ADMIN_NOTIFY_EMAIL || "",
    },
    adminNotifyWebhookUrl: env.ADMIN_NOTIFY_WEBHOOK_URL || "",

    analytics: {
      enabled: env.ANALYTICS_ENABLED !== "false",
      // "opt-out": collected unless the visitor declines (or sends GPC / Do Not Track).
      // "opt-in": nothing is collected until the visitor accepts in the banner.
      consentMode: env.ANALYTICS_CONSENT_MODE === "opt-in" ? "opt-in" : "opt-out",
      timezone: validTimezone(env.ANALYTICS_TIMEZONE) || "America/New_York",
      retentionDays: Math.max(30, Math.min(800, num(env.ANALYTICS_RETENTION_DAYS, 395))),
      allowHeadlessForTests: env.ANALYTICS_ALLOW_HEADLESS === "true",
    },
    geoip: {
      path: env.GEOIP_DB_PATH || path.join(path.dirname(env.DB_PATH || path.join(root, "data", "x")), "geoip", "dbip-country-lite.csv.gz"),
      autoDownload: env.GEOIP_AUTO_DOWNLOAD !== "false",
    },

    supplierInstructions: env.SUPPLIER_INSTRUCTIONS ||
      "Please ship directly to the customer. Do not include invoices, prices or promotional material in the parcel. Reply with the carrier name and tracking number as soon as it is available.",
  };
}

module.exports = { load };

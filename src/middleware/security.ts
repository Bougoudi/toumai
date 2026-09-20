import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

/**
 * En-têtes de sécurité HTTP (Helmet) + politique de sécurité de contenu (CSP).
 * La CSP restreint les sources : scripts et styles de l'app uniquement (aucun
 * inline), images depuis l'app / HTTPS / data-URI, connexions vers l'app.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Scripts strictement limités à l'app (protection clé contre l'injection de code).
      scriptSrc: ["'self'"],
      // Styles en ligne autorisés (couleurs/marges générées par l'UI) — sans risque d'exécution.
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'https:', 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"], // empêche le clickjacking
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' },
});

/**
 * En suite de tests automatisés (NODE_ENV=test) la limitation de débit est
 * neutralisée : elle fausserait les scénarios qui enchaînent des dizaines de
 * connexions. Elle reste **toujours active** en développement et en production.
 */
const skipInTests = () => process.env.NODE_ENV === 'test';

/** Limite globale de l'API : protège contre l'abus / le déni de service léger. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  /**
   * 300 requêtes par minute et par IP. Configurable : un poste de
   * développement qui rejoue un parcours navigateur complet dépasse ce seuil
   * sans rien abuser. La valeur par défaut, elle, ne bouge pas.
   */
  limit: Number(process.env.TOUMA_API_RATE_LIMIT ?? 300),
  skip: skipInTests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans un instant.' },
});

/**
 * Limite stricte de l'authentification : anti-force brute sur login/register.
 *
 * Réglable, comme la limite générale, et pour la même raison. Le parcours
 * navigateur ouvre une session par rôle ; rejoué deux fois dans le même quart
 * d'heure, il épuise légitimement le quota et **échoue en accusant le
 * produit** — « connexion impossible » quinze étapes plus loin, sans que rien
 * ne dise que la protection a simplement fait son travail.
 *
 * La valeur par défaut reste celle de la production. La relever est un geste
 * explicite, réservé à une machine de test.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: Number(process.env.TOUMA_AUTH_RATE_LIMIT ?? 10),
  skip: skipInTests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
});

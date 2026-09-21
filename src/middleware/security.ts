import type { Request, Response } from 'express';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requestIdCourant } from './request-context.js';

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
 *
 * `TOUMA_RATE_LIMIT_IN_TESTS=true` la rallume, et n'existe que pour une
 * raison : une protection qu'aucun test ne peut exercer est une protection
 * dont personne ne sait si elle marche. Le fichier qui l'emploie la rallume
 * pour lui seul — chaque fichier de test tourne dans son propre processus —
 * et la rend à son état d'origine ensuite.
 */
const skipInTests = () =>
  process.env.NODE_ENV === 'test' && process.env.TOUMA_RATE_LIMIT_IN_TESTS !== 'true';

/**
 * LIMITES DE DÉBIT PAR COMPTE (V25 §22).
 *
 * Les limites existantes ne comptaient que par adresse IP. Deux défauts, et
 * ils tombent tous les deux du mauvais côté :
 *
 * 1. **Une IP partagée punit tout le monde.** Un cybercafé de N'Djamena, une
 *    connexion partagée, un opérateur mobile derrière une passerelle : tous
 *    les clients y tombent dans le même seau. Un seul abuseur ferme la porte
 *    aux autres — et ceux-là ne comprennent pas pourquoi.
 * 2. **Un compte change d'IP quand il veut.** Une limite par IP seule
 *    n'arrête pas ce qu'elle vise, puisque ce qu'elle vise en change.
 *
 * La clé est donc le **compte** quand la requête est authentifiée, et l'IP
 * sinon. Les deux espaces sont préfixés pour ne pas se confondre.
 *
 * `ipKeyGenerator` vient de la bibliothèque : une adresse IPv6 brute donnerait
 * une clé par adresse alors qu'un fournisseur en attribue des milliards à un
 * même abonné, ce qui reviendrait à n'avoir aucune limite.
 */
/**
 * Plafond courant d'un limiteur.
 *
 * Une valeur d'environnement illisible ou absurde retombe sur le défaut
 * plutôt que de produire `NaN` — `limit: NaN` désactive silencieusement la
 * protection, ce qui est la pire issue possible pour une faute de frappe.
 */
function plafond(variable: string | undefined, defaut: number): number {
  if (!variable) return defaut;
  const brut = process.env[variable];
  if (!brut) return defaut;
  const valeur = Number(brut);
  return Number.isFinite(valeur) && valeur > 0 ? Math.floor(valeur) : defaut;
}

export function cleParCompteOuIp(req: Request): string {
  const compte = req.toumaUser?.id;
  return compte ? `u:${compte}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

/**
 * Réponse 429 au même format que toutes les autres erreurs (§20).
 *
 * Sans cela, un dépassement de limite rendait `{ error }` seul, sans code ni
 * identifiant de requête — c'est-à-dire la seule erreur qu'un client ne
 * pouvait pas traiter comme les autres, et la seule qu'on ne pouvait pas
 * retrouver dans le journal.
 */
function reponse429(message: string) {
  return (_req: Request, res: Response) => {
    const requestId = requestIdCourant();
    res.status(429).json({ error: message, code: 'SYSTEM_RATE_LIMITED', ...(requestId ? { requestId } : {}) });
  };
}

/**
 * Fabrique une limite pour un usage sensible.
 *
 * Chaque appel crée son propre compteur : partager un seau entre le paiement
 * et la messagerie ferait qu'une conversation animée empêcherait de payer.
 */
export function limiteSensible(options: { windowMs: number; limit: number; message: string; env?: string }) {
  return rateLimit({
    windowMs: options.windowMs,
    /**
     * Lue **à chaque requête**, pas une fois au chargement du module.
     *
     * La première version évaluait `process.env` à la construction du
     * limiteur. Une valeur posée après le démarrage — ce que fait un test,
     * et ce qu'on tente quand on veut ajuster un seuil — n'avait aucun
     * effet, en silence. Une fonction lit la valeur du moment.
     */
    limit: () => plafond(options.env, options.limit),
    skip: skipInTests,
    keyGenerator: cleParCompteOuIp,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: reponse429(options.message),
  });
}

/** Limite globale de l'API : protège contre l'abus / le déni de service léger. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  /**
   * 300 requêtes par minute et par IP. Configurable : un poste de
   * développement qui rejoue un parcours navigateur complet dépasse ce seuil
   * sans rien abuser. La valeur par défaut, elle, ne bouge pas.
   */
  limit: () => plafond('TOUMA_API_RATE_LIMIT', 300),
  skip: skipInTests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: cleParCompteOuIp,
  handler: reponse429('Trop de requêtes, réessayez dans un instant.'),
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
  limit: () => plafond('TOUMA_AUTH_RATE_LIMIT', 10),
  skip: skipInTests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  /**
   * Ici, et seulement ici, la clé reste l'**adresse IP**.
   *
   * C'est la limite anti-force brute : au moment où elle sert, l'attaquant
   * n'est précisément pas authentifié, et une clé par compte ne compterait
   * rien. Elle porte donc la charge du défaut connu — une IP partagée punit
   * tout le monde —, et c'est le prix à payer pour que deviner des mots de
   * passe reste coûteux.
   */
  handler: reponse429('Trop de tentatives de connexion. Réessayez dans 15 minutes.'),
});

/** Création de paiement et remboursement : rares, coûteux, et visés par la fraude. */
export const paymentLimiter = limiteSensible({
  windowMs: 60_000,
  limit: 10,
  env: 'TOUMA_PAYMENT_RATE_LIMIT',
  message: 'Trop d’opérations de paiement en peu de temps. Réessayez dans une minute.',
});

/**
 * Codes promotionnels : la limite **est** la protection.
 *
 * Sans elle, essayer des codes au hasard jusqu'à en trouver un valide ne coûte
 * rien. C'est l'abus de coupon que §23 nomme.
 */
export const couponLimiter = limiteSensible({
  windowMs: 10 * 60_000,
  limit: 20,
  env: 'TOUMA_COUPON_RATE_LIMIT',
  message: 'Trop de codes essayés. Réessayez dans quelques minutes.',
});

/** Assistance IA : chaque appel a un coût réel chez un prestataire. */
export const aiLimiter = limiteSensible({
  windowMs: 60_000,
  limit: 20,
  env: 'TOUMA_AI_RATE_LIMIT',
  message: 'Trop de demandes à l’assistance. Réessayez dans une minute.',
});

/** Messagerie : freine le démarchage en masse sans gêner une conversation. */
export const messagingLimiter = limiteSensible({
  windowMs: 60_000,
  limit: 30,
  env: 'TOUMA_MESSAGING_RATE_LIMIT',
  message: 'Trop de messages envoyés en peu de temps. Réessayez dans une minute.',
});

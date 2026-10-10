import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger as journal } from '../utils/logger.js';

/**
 * CONTEXTE DE REQUÊTE (V25 §19).
 *
 * Un identifiant par requête, propagé sans être passé de main en main.
 *
 * Le besoin est concret : un acheteur signale « mon paiement n'est jamais
 * arrivé ». Le parcours traverse le panier, la commande, le prestataire, un
 * webhook, l'expédition — et jusqu'ici rien ne reliait ces lignes de journal
 * entre elles. Il fallait recouper des horodatages à la main, sur un serveur
 * qui sert d'autres acheteurs à la même seconde.
 *
 * `AsyncLocalStorage` porte le contexte à travers les `await` sans qu'aucune
 * signature de fonction ne change. C'est ce qui permet au journal de porter
 * l'identifiant partout, y compris dans du code métier qui ignore
 * qu'une requête HTTP existe.
 *
 * Limite assumée : un travail lancé sans requête — une tâche planifiée — n'a
 * pas de contexte. Il en reçoit un propre (voir `avecContexte`), plutôt que
 * d'emprunter celui d'une requête qui passait par là.
 */

export interface RequestContext {
  requestId: string;
  /** Renseigné après authentification. Absent pour un visiteur. */
  userId?: string;
  /** Gabarit de route (`/api/v1/products/:id`), jamais l'URL réelle. */
  route?: string;
  /**
   * Marché du lecteur : son pays, son fuseau, sa langue (V26 §18, §19).
   *
   * Portés ici pour la même raison que l'identifiant de requête — les rendre
   * disponibles au fond du code métier sans changer une seule signature. Une
   * date affichée dans le fuseau du serveur est fausse pour celui qui attend
   * le colis, et faire descendre le fuseau de main en main jusqu'au composeur
   * de réponses aurait demandé de modifier des dizaines de fonctions pures.
   */
  countryCode?: string;
  timezone?: string;
  locale?: string;
}

const stockage = new AsyncLocalStorage<RequestContext>();

/** Contexte de la requête en cours, s'il y en a une. */
export function contexteCourant(): RequestContext | undefined {
  return stockage.getStore();
}

/**
 * Fuseau du lecteur, ou `UTC`.
 *
 * `UTC` n'est pas un défaut confortable : c'est l'aveu qu'on ne sait pas d'où
 * lit la personne. Il vaut mieux que l'ancien comportement, qui rendait
 * l'heure du serveur en la faisant passer pour l'heure locale.
 */
export function fuseauCourant(): string {
  return stockage.getStore()?.timezone ?? 'UTC';
}

/** Étiquette de langue du lecteur, ou le français. */
export function localeCourante(): string {
  return stockage.getStore()?.locale ?? 'fr-FR';
}

/** Identifiant de la requête en cours, ou `null` hors requête. */
export function requestIdCourant(): string | null {
  return stockage.getStore()?.requestId ?? null;
}

/**
 * Exécute un traitement sous un contexte neuf.
 *
 * Pour tout ce qui ne naît pas d'une requête HTTP : tâches planifiées,
 * traitements d'arrière-plan. Le préfixe dit d'où vient le travail, ce qui
 * évite de chercher une requête HTTP qui n'a jamais existé.
 */
export function avecContexte<T>(origine: string, action: () => T): T {
  return stockage.run({ requestId: `${origine}-${randomUUID()}` }, action);
}

/** Complète le contexte courant (après authentification, par exemple). */
export function enrichirContexte(champs: Partial<RequestContext>): void {
  const contexte = stockage.getStore();
  if (!contexte) return;
  Object.assign(contexte, champs);
}

/**
 * Format accepté pour un identifiant fourni par l'appelant.
 *
 * Un identifiant venu de l'extérieur finit dans les journaux : sans contrainte,
 * il permettrait d'y injecter des retours à la ligne et d'y fabriquer de
 * fausses entrées. On n'accepte donc que des caractères inoffensifs, et une
 * longueur bornée.
 */
const FORMAT_ACCEPTABLE = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Attribue un identifiant à chaque requête et le renvoie dans la réponse.
 *
 * Un `x-request-id` entrant est **conservé** quand il est propre : il vient
 * d'un proxy ou d'un client qui trace déjà, et le remplacer couperait la
 * trace en deux. Sinon, on en crée un.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const fourni = req.get('x-request-id');
  const requestId = fourni && FORMAT_ACCEPTABLE.test(fourni) ? fourni : randomUUID();

  // Renvoyé à l'appelant : c'est ce numéro qu'une personne citera au support,
  // et le seul moyen de retrouver sa requête parmi celles des autres.
  res.setHeader('x-request-id', requestId);
  stockage.run({ requestId }, () => next());
}

/**
 * Journal d'accès (V25 §18).
 *
 * Une ligne par requête terminée : méthode, gabarit de route, statut, durée.
 * Le gabarit (`/api/v1/products/:id`) et non l'URL réelle — une URL contient
 * des identifiants de commande et de compte, et un journal d'accès n'a pas
 * besoin de les porter pour dire ce qui est lent ou ce qui échoue.
 *
 * Les sondes de disponibilité sont tues : interrogées toutes les trente
 * secondes par l'orchestrateur, elles noieraient tout le reste.
 */
const CHEMINS_SILENCIEUX = new Set(['/health', '/ready', '/api/v1/health', '/api/v1/ready']);

/**
 * Gabarit de route d'une requête : `/api/v1/products/:id`.
 *
 * Le chemin réel porte des identifiants de commande, de compte, de paiement.
 * Un journal d'accès n'en a pas besoin pour dire ce qui est lent ou ce qui
 * échoue, et les y laisser reviendrait à semer des identifiants dans chaque
 * ligne, chez tous ceux qui lisent les journaux.
 *
 * La reconstruction passe par les valeurs de paramètres plutôt que par
 * `req.baseUrl` : pour un routeur monté, Express a déjà restauré `baseUrl`
 * quand la réponse se termine, et le gabarit ressortait amputé de son préfixe
 * (`/:provider` au lieu de `/api/v1/payments/webhook/:provider`) — de quoi
 * confondre deux routes différentes dans un tableau de latences.
 *
 * Portée exacte, vérifiée en exécution plutôt que supposée :
 *
 * - route **reconnue**, même imbriquée : les paramètres sont remplacés
 *   (`/api/v1/products/:id`, `/api/v1/trade/corridors/:code`) ;
 * - chemin **non reconnu** (404) : le segment reste brut, parce qu'aucun
 *   gabarit n'existe. Aucune ressource autorisée n'y fuit pour autant — un
 *   identifiant qui appartient à quelqu'un d'autre correspond bien à une
 *   route (la réponse 404 est celle de l'anti-IDOR) et est donc masqué. Ce
 *   qui reste en clair, ce sont les chemins que personne ne sert : des
 *   balayages, qu'on veut justement voir.
 */
export function gabaritDeRoute(req: Request): string {
  const chemin = (req.originalUrl ?? req.url).split('?')[0];
  let gabarit = chemin;
  for (const [nom, valeur] of Object.entries(req.params ?? {})) {
    if (typeof valeur !== 'string' || valeur.length === 0) continue;
    gabarit = gabarit.split(`/${valeur}`).join(`/:${nom}`);
  }
  return gabarit;
}

export function accessLog(req: Request, res: Response, next: NextFunction): void {
  if (CHEMINS_SILENCIEUX.has(req.path)) return next();
  const debut = process.hrtime.bigint();

  res.on('finish', () => {
    const dureeMs = Number(process.hrtime.bigint() - debut) / 1e6;
    const contexte = contexteCourant();
    const gabarit = gabaritDeRoute(req);
    if (contexte) contexte.route = gabarit;

    journal[res.statusCode >= 500 ? 'error' : 'info']('requête', {
      method: req.method,
      route: gabarit,
      statusCode: res.statusCode,
      durationMs: Math.round(dureeMs * 10) / 10,
    });
  });

  next();
}

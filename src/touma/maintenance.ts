import cron from 'node-cron';
import { privacyService } from './auth/privacy.service.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { expireStaleReservations } from './orders/reservation.js';
import { refreshEligibility } from './finance/settlement.service.js';
import { sweepDisputes } from './disputes/escalation.js';
import { purgeExpiredKeys } from './lib/idempotency.js';
import { purgeWebhookDeliveries } from './payments/webhook-log.js';
import { processTrustEvents } from './trust/events.js';
import { flashSaleService } from './growth/flash-sale.service.js';
import { runAiJobsOnce } from './ai/jobs.js';

/**
 * Entretien périodique du domaine TOUMA.
 *
 * **Le manque comblé.** Les balayages étaient *opportunistes* : déclenchés par
 * le trafic, avec un verrou de fréquence en mémoire. Cela marche très bien la
 * journée et pas du tout la nuit — or c'est précisément quand personne ne
 * navigue que les délais expirent :
 *
 * - le stock réservé d'un panier abandonné reste hors catalogue jusqu'au
 *   premier visiteur du matin ;
 * - une part de règlement dont la fenêtre de protection s'achève à 3 h du matin
 *   n'est éligible qu'au réveil de la place de marché ;
 * - un litige dont le délai de réponse expire la nuit n'est porté devant
 *   l'assistance que le lendemain.
 *
 * Aucun de ces retards ne perd de l'argent, mais tous font mentir une promesse
 * affichée — « réglable le 12 » qui ne l'est que le 13.
 *
 * **Deux purges qui n'existaient que sur le papier.** `purgeExpiredKeys` et
 * `purgeWebhookDeliveries` étaient écrites, exportées, et **appelées nulle
 * part**. Les clés d'idempotence grossissent à chaque requête qui touche à
 * l'argent ; la table des webhooks grossit de ce qu'un tiers **non
 * authentifié** y poste. Écrire une purge pour une table qu'un inconnu peut
 * faire enfler, puis ne pas la brancher, revient à ne pas l'avoir écrite.
 *
 * **Ce que ce n'est pas.** Ni une file de travaux, ni un verrou distribué. Deux
 * instances qui balaient en même temps ne se gênent pas — chaque opération est
 * conditionnée à l'état qu'elle corrige (`updateMany` avec garde de statut,
 * création idempotente), donc la seconde ne trouve simplement rien à faire.
 * Mais il n'y a **ni reprise après échec, ni garantie d'exécution** : un travail
 * qui a besoin de cela (envoi d'un courriel, génération d'un document) demande
 * une vraie file, et elle n'est pas là.
 */

let started = false;

/** Exécute un balayage en capturant l'erreur : une panne n'arrête pas le cron. */
function safe(nom: string, fn: () => Promise<unknown>) {
  return async () => {
    try {
      const resultat = await fn();
      if (resultat && typeof resultat === 'object') {
        // Ne journaliser que ce qui a réellement changé : un balayage qui ne
        // trouve rien est le cas normal, et l'écrire toutes les minutes noierait
        // les lignes qui comptent.
        const valeurs = Object.values(resultat as Record<string, unknown>).filter((v) => typeof v === 'number') as number[];
        if (valeurs.some((v) => v > 0)) logger.info(`Entretien TOUMA : ${nom}`, resultat as Record<string, unknown>);
      } else if (typeof resultat === 'number' && resultat > 0) {
        logger.info(`Entretien TOUMA : ${nom}`, { count: resultat });
      }
    } catch (err) {
      logger.error(`Entretien TOUMA « ${nom} » a échoué`, { err: err instanceof Error ? err.message : String(err) });
    }
  };
}

/**
 * Les cinq travaux d'entretien, exposés pour pouvoir être joués à la main et
 * vérifiés par un test — un planificateur qu'on ne peut pas exécuter hors cron
 * ne se teste pas.
 */
export const maintenanceJobs = {
  /** Rend au catalogue le stock des paniers abandonnés. */
  reservations: () => expireStaleReservations(),
  /** Fait passer les parts de règlement à « réglable » quand leurs trois conditions sont réunies. */
  settlements: () => refreshEligibility(),
  /** Porte devant l'assistance les litiges dont le délai a expiré — sans rien trancher. */
  disputes: () => sweepDisputes(),
  /** Retire les clés d'idempotence périmées. */
  idempotency: () => purgeExpiredKeys(),
  /** Retire les traces de webhook au-delà de la durée de conservation. */
  webhooks: () => purgeWebhookDeliveries(env.touma.webhookRetentionDays),
  /**
   * Recalcule la confiance des entités touchées depuis le dernier passage.
   *
   * Hors du chemin critique : un acheteur qui confirme sa réception n'a pas à
   * attendre l'agrégat de réputation de son vendeur. Et comme chaque score se
   * recalcule depuis des faits en base plutôt que depuis un cumul d'incréments,
   * un événement perdu ne corrompt rien — il retarde.
   */
  trust: () => processTrustEvents(),
  /**
   * Clôt les ventes flash dont la fenêtre est passée.
   *
   * Sans effet sur ce qui se vend — les lectures filtrent déjà par date —
   * mais une vente laissée « active » encombre les écrans et fausse les
   * décomptes du vendeur.
   */
  flashSales: () => flashSaleService.closeExpired(),
  /**
   * Travaux d'intelligence (V23) : expiration des confirmations, purge des
   * mémoires, observations de stock. Idempotents par fenêtre — deux passages
   * sur la même heure ne produisent rien la seconde fois.
   */
  intelligence: async () => {
    await runAiJobsOnce();
    return 0;
  },
  /**
   * Suppressions de compte arrivées à échéance (V25 §68).
   *
   * Les blocages sont revérifiés à l'exécution : une commande a pu naître
   * pendant le délai de réflexion, et anonymiser l'acheteur rendrait sa
   * livraison impossible. Une demande bloquée reste en attente avec son
   * motif — elle n'est ni exécutée, ni silencieusement abandonnée.
   */
  accountDeletions: () => privacyService.runDueDeletions(),
};

/** Joue tous les travaux une fois. Employé au démarrage et par les tests. */
export async function runMaintenanceOnce(): Promise<void> {
  for (const [nom, job] of Object.entries(maintenanceJobs)) {
    await safe(nom, job)();
  }
}

export function startToumaMaintenance(): void {
  if (started) return;
  if (!env.touma.maintenanceEnabled) {
    logger.info('Entretien TOUMA désactivé (TOUMA_MAINTENANCE_ENABLED=false)');
    return;
  }
  started = true;
  const c = env.touma.maintenanceCron;

  cron.schedule(c.reservations, safe('réservations', maintenanceJobs.reservations));
  cron.schedule(c.settlements, safe('règlements', maintenanceJobs.settlements));
  cron.schedule(c.disputes, safe('litiges', maintenanceJobs.disputes));
  cron.schedule(c.trust, safe('confiance', maintenanceJobs.trust));
  cron.schedule(c.flashSales, safe('ventes flash', maintenanceJobs.flashSales));
  cron.schedule(c.intelligence, safe('intelligence', maintenanceJobs.intelligence));
  cron.schedule(c.purges, safe('purges', async () => {
    const cles = await maintenanceJobs.idempotency();
    const webhooks = await maintenanceJobs.webhooks();
    return { idempotencyKeys: cles, webhookDeliveries: webhooks };
  }));

  logger.info('Entretien TOUMA démarré', c);
}

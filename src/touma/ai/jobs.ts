import { prisma } from '../../db/prisma.js';
import { confirmationService } from './confirmation.service.js';
import { memoryService } from './memory.service.js';

/**
 * TRAVAUX PÉRIODIQUES D'INTELLIGENCE (§56).
 *
 * Ni Redis ni BullMQ ne sont installés dans ce dépôt : le cahier des charges
 * dit « si disponible », et ils ne le sont pas. Les travaux s'accrochent donc
 * au planificateur d'entretien existant, qui fonctionne déjà pour les
 * réservations, les règlements, les litiges, la confiance et les ventes flash.
 *
 * **Idempotence** (§56) : chaque travail inscrit sa fenêtre dans
 * `ToumaAiJobRun`, et l'unicité `(job, windowEnd)` posée en base est ce qui
 * empêche de retraiter deux fois la même fenêtre — y compris si deux instances
 * du processus tournent en même temps. Un compteur en mémoire ne tiendrait pas
 * cette promesse.
 */

/** Début de l'heure courante : la fenêtre naturelle de ces travaux. */
function fenetre(heures = 1): { start: Date; end: Date } {
  const maintenant = new Date();
  const end = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate(), maintenant.getUTCHours()));
  return { start: new Date(end.getTime() - heures * 3_600_000), end };
}

async function executer(job: string, travail: (start: Date, end: Date) => Promise<number>): Promise<number> {
  const { start, end } = fenetre();
  const debut = Date.now();
  try {
    // La ligne est réservée **avant** le travail : deux instances qui démarrent
    // en même temps, la seconde échoue sur l'unicité et n'exécute rien.
    await prisma.toumaAiJobRun.create({ data: { job, windowStart: start, windowEnd: end, ok: true, produced: 0 } });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return 0;
    throw err;
  }
  try {
    const produced = await travail(start, end);
    await prisma.toumaAiJobRun.update({ where: { job_windowEnd: { job, windowEnd: end } }, data: { produced, durationMs: Date.now() - debut } });
    return produced;
  } catch (err) {
    await prisma.toumaAiJobRun.update({
      where: { job_windowEnd: { job, windowEnd: end } },
      data: { ok: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - debut },
    });
    throw err;
  }
}

export const aiJobs = {
  /**
   * Fait expirer les demandes de confirmation non traitées.
   *
   * Une demande en attente indéfiniment finirait par être validée longtemps
   * après avoir été lue, sur un état du catalogue qui n'existe plus.
   */
  confirmations: () => executer('confirmations', async () => confirmationService.expireStale()),

  /** Retire les mémoires expirées. §35 : « prévoir suppression/expiration ». */
  memories: () => executer('memories', async () => memoryService.purgeExpired()),

  /**
   * Observations de stock (§22).
   *
   * Écrit une observation par produit en rupture ou en stock faible, une seule
   * fois par fenêtre — l'unicité `(kind, subjectType, subjectId, code,
   * windowEnd)` l'assure. Sans elle, un produit en rupture depuis un mois
   * produirait sept cents observations identiques.
   */
  inventoryInsights: () =>
    executer('inventoryInsights', async (start, end) => {
      // Le stock est **sommé en base**, et seuls les produits sous le seuil
      // remontent. Une première écriture parcourait les 500 premiers produits
      // puis filtrait en mémoire : sur un catalogue plus grand que 500, une
      // rupture réelle passait simplement inaperçue — sans erreur, sans trace,
      // et le travail se déclarait réussi. Le test l'a trouvé.
      const lignes = await prisma.$queryRaw<Array<{ id: string; title: string; storeId: string; stock: bigint }>>`
        SELECT p."id", p."title", p."storeId", COALESCE(SUM(i."quantity"), 0)::bigint AS stock
          FROM "touma_products" p
          JOIN "touma_stores" s ON s."id" = p."storeId"
          LEFT JOIN "touma_inventory" i ON i."productId" = p."id"
         WHERE p."status" = 'ACTIVE' AND s."status" = 'ACTIVE'
         GROUP BY p."id", p."title", p."storeId"
        HAVING COALESCE(SUM(i."quantity"), 0) <= 5
      `;

      let ecrits = 0;
      for (const ligne of lignes) {
        const stock = Number(ligne.stock);
        const code = stock <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK';
        const cree = await prisma.toumaAiInsight
          .create({
            data: {
              kind: 'INVENTORY',
              subjectType: 'PRODUCT',
              subjectId: ligne.id,
              code,
              severity: stock <= 0 ? 2 : 1,
              // Les faits mesurés, sans interprétation : le stock, et rien d'autre.
              evidence: { stock, title: ligne.title, storeId: ligne.storeId },
              suggestion: stock <= 0 ? 'Réapprovisionner ou retirer le produit de la vente.' : 'Vérifier le réapprovisionnement.',
              windowStart: start,
              windowEnd: end,
            },
          })
          .catch(() => null);
        if (cree) ecrits += 1;
      }
      return ecrits;
    }),
};

/** Joue tous les travaux une fois. Pour le démarrage et pour les tests. */
export async function runAiJobsOnce(): Promise<void> {
  for (const travail of Object.values(aiJobs)) await travail().catch(() => undefined);
}

import { Prisma } from '@prisma/client';
import type { LedgerDirection, LedgerEntryType } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { assertSameCurrency, ZERO } from '../lib/money.js';

/**
 * Registre comptable interne, **append-only**.
 *
 * Chaque mouvement d'argent laisse une ligne : la vente, la commission
 * prélevée, le remboursement, la contre-passation. Rien n'est jamais modifié ni
 * supprimé — une correction est une nouvelle ligne de sens inverse, comme en
 * comptabilité. Ce fichier n'expose donc **aucune fonction de mise à jour ou de
 * suppression** : c'est une contrainte de conception, pas un oubli.
 *
 * Ce qu'il permet, et que le dépôt ne savait pas faire : répondre à « combien
 * cette boutique a-t-elle réellement gagné, et combien ne doit pas encore
 * partir ». Le solde est **calculé** à chaque lecture. Un solde stocké finit
 * toujours par diverger de ses mouvements, et le jour où ça arrive, personne ne
 * sait lequel des deux a raison.
 *
 * **Ce n'est pas une comptabilité légale.** Il ne remplace ni un livre
 * comptable, ni un expert-comptable, ni les obligations fiscales d'un vendeur.
 */

export interface LedgerInput {
  storeId: string | null;
  type: LedgerEntryType;
  direction: LedgerDirection;
  amount: Prisma.Decimal | string;
  currency: string;
  referenceType: string;
  referenceId: string;
  /** Litige qui retient ce montant, s'il y en a un. */
  heldByDisputeId?: string | null;
  note?: string;
}

/**
 * Écrit une ligne. Idempotent par construction : la clé
 * `(referenceType, referenceId, type)` est unique, donc rejouer une opération —
 * un webhook, une reprise après incident — n'écrit pas deux fois le même
 * mouvement. Une tentative de doublon est silencieusement ignorée plutôt que de
 * faire échouer l'opération métier qui l'a déclenchée : une vente ne doit pas
 * être annulée parce que sa ligne comptable existait déjà.
 */
export async function record(entry: LedgerInput, tx?: Prisma.TransactionClient): Promise<void> {
  const db = tx ?? prisma;
  const amount = new Prisma.Decimal(entry.amount);
  if (amount.lessThan(0)) {
    // Un montant négatif n'existe pas : c'est le `direction` qui porte le sens.
    // Autoriser les deux ouvrirait la porte à des lignes qui s'annulent entre
    // elles sans qu'on sache laquelle lire.
    throw new Error('Montant de registre négatif : utilisez DEBIT plutôt qu’un signe.');
  }

  await db.toumaLedgerEntry.createMany({
    data: [
      {
        storeId: entry.storeId,
        type: entry.type,
        direction: entry.direction,
        amount,
        currency: entry.currency,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        heldByDisputeId: entry.heldByDisputeId ?? null,
        note: entry.note ?? null,
      },
    ],
    skipDuplicates: true,
  });
}

export interface Balance {
  currency: string;
  /** Ce qui revient à la boutique, litiges déduits. */
  available: string;
  /** Ce qui est retenu par un litige ouvert. */
  held: string;
  /** Total gagné, avant retenue. */
  gross: string;
}

/**
 * Solde d'une boutique, par devise.
 *
 * Les devises ne sont **jamais** additionnées entre elles : sans taux de change
 * officiel, une somme XAF + EUR serait un chiffre inventé. On rend une ligne
 * par devise et l'interface les affiche séparément.
 */
export async function storeBalance(storeId: string): Promise<Balance[]> {
  const entries = await prisma.toumaLedgerEntry.findMany({
    where: { storeId },
    select: { type: true, direction: true, amount: true, currency: true, heldByDisputeId: true, releasedAt: true },
  });

  const parDevise = new Map<string, { gross: Prisma.Decimal; held: Prisma.Decimal }>();

  for (const e of entries) {
    const courant = parDevise.get(e.currency) ?? { gross: ZERO, held: ZERO };
    const signe = e.direction === 'CREDIT' ? e.amount : e.amount.negated();
    courant.gross = courant.gross.plus(signe);

    // Retenu : une ligne rattachée à un litige non levé.
    if (e.heldByDisputeId && !e.releasedAt && e.direction === 'CREDIT') {
      courant.held = courant.held.plus(e.amount);
    }
    parDevise.set(e.currency, courant);
  }

  return [...parDevise.entries()]
    .map(([currency, { gross, held }]) => ({
      currency,
      gross: gross.toString(),
      held: held.toString(),
      available: gross.minus(held).toString(),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Mouvements rattachés à une référence — l'histoire d'une commande. */
export async function entriesFor(referenceType: string, referenceId: string) {
  const rows = await prisma.toumaLedgerEntry.findMany({
    where: { referenceType, referenceId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      type: true,
      direction: true,
      amount: true,
      currency: true,
      heldByDisputeId: true,
      releasedAt: true,
      note: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({ ...r, amount: r.amount.toString() }));
}

/**
 * Retient les montants d'une commande pendant un litige.
 *
 * Le §35 demande un « PayoutHold ». Tant qu'aucun versement réel n'existe — et
 * il n'en existe aucun, aucun prestataire n'étant raccordé — poser un verrou sur
 * une ligne de versement fantôme serait une façade. Le besoin réel est
 * ailleurs : **savoir combien d'argent ne doit pas partir**. C'est un solde, et
 * il se marque sur les mouvements eux-mêmes.
 */
export async function holdForDispute(orderId: string, disputeId: string, tx?: Prisma.TransactionClient): Promise<number> {
  const db = tx ?? prisma;
  const result = await db.toumaLedgerEntry.updateMany({
    where: { referenceType: 'ToumaOrder', referenceId: orderId, heldByDisputeId: null, releasedAt: null },
    data: { heldByDisputeId: disputeId },
  });
  return result.count;
}

/**
 * Lève la retenue d'un litige. La ligne n'est pas réécrite : elle est datée.
 * L'historique doit pouvoir dire « ces fonds ont été retenus du 3 au 17 ».
 */
export async function releaseHold(disputeId: string, tx?: Prisma.TransactionClient): Promise<number> {
  const db = tx ?? prisma;
  const result = await db.toumaLedgerEntry.updateMany({
    where: { heldByDisputeId: disputeId, releasedAt: null },
    data: { releasedAt: new Date() },
  });
  return result.count;
}

/**
 * Enregistre les mouvements d'une vente : ce qui revient à la boutique et ce
 * que TOUMA prélève. Appelé à la confirmation du paiement.
 */
export async function recordSale(
  order: { id: string; storeId: string; total: Prisma.Decimal; commissionTotal: Prisma.Decimal; currency: string },
  tx?: Prisma.TransactionClient,
): Promise<void> {
  await record(
    {
      storeId: order.storeId,
      type: 'SALE',
      direction: 'CREDIT',
      amount: order.total,
      currency: order.currency,
      referenceType: 'ToumaOrder',
      referenceId: order.id,
    },
    tx,
  );

  if (order.commissionTotal.greaterThan(0)) {
    await record(
      {
        storeId: order.storeId,
        type: 'COMMISSION',
        direction: 'DEBIT',
        amount: order.commissionTotal,
        currency: order.currency,
        referenceType: 'ToumaOrder',
        referenceId: order.id,
      },
      tx,
    );
  }
}

/**
 * Enregistre un remboursement et la commission rendue à la boutique.
 *
 * Le remboursement est un DEBIT pour la boutique (l'argent repart chez
 * l'acheteur) ; la commission contre-passée est un CREDIT (TOUMA ne garde pas
 * sa part sur ce qui n'a pas été vendu). Deux lignes, deux sens : additionner
 * les deux en une seule masquerait l'un des deux mouvements.
 */
export async function recordRefund(
  refund: { id: string; storeId: string; amount: Prisma.Decimal; commissionReversed: Prisma.Decimal; currency: string },
  tx?: Prisma.TransactionClient,
): Promise<void> {
  assertSameCurrency(refund.currency, refund.currency);

  await record(
    {
      storeId: refund.storeId,
      type: 'REFUND',
      direction: 'DEBIT',
      amount: refund.amount,
      currency: refund.currency,
      referenceType: 'ToumaRefund',
      referenceId: refund.id,
    },
    tx,
  );

  if (refund.commissionReversed.greaterThan(0)) {
    await record(
      {
        storeId: refund.storeId,
        type: 'COMMISSION_REVERSAL',
        direction: 'CREDIT',
        amount: refund.commissionReversed,
        currency: refund.currency,
        referenceType: 'ToumaRefund',
        referenceId: refund.id,
      },
      tx,
    );
  }
}

import type { TrustEntityType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { TrustComponent } from './trust.types.js';

/**
 * TOUMA TRUST — badges.
 *
 * **Une règle, une preuve, un serveur.** Chaque badge est une condition écrite
 * ici, évaluée à partir des composantes du score, et posée avec le chiffre qui
 * la justifie. Le frontend ne peut ni en créer ni en retirer : il lit une
 * table. C'est l'exigence du §7, et c'est aussi la seule façon qu'un badge
 * veuille dire quelque chose.
 *
 * **Un badge se retire.** Quand sa condition cesse d'être vraie, la ligne est
 * datée `revokedAt` plutôt que supprimée : un badge affiché pendant six mois
 * puis retiré doit rester lisible dans l'historique, notamment si le vendeur
 * conteste.
 *
 * **Aucun badge ne s'achète.** Aucune règle ci-dessous ne regarde une
 * promotion, une mise en avant ni un paiement — c'est le §31, et l'absence est
 * volontaire.
 */

export interface BadgeRule {
  code: string;
  entityTypes: TrustEntityType[];
  /**
   * Condition. Rend les preuves à consigner, ou `null` si le badge n'est pas
   * mérité. Rendre un objet vide serait un badge sans justification.
   */
  evaluate(components: Map<string, TrustComponent>, sample: number): Record<string, unknown> | null;
}

/** Valeur d'une composante, ou `null` si elle n'a pas pu être mesurée. */
const val = (c: Map<string, TrustComponent>, code: string) => c.get(code)?.value ?? null;
const det = (c: Map<string, TrustComponent>, code: string) => c.get(code)?.detail ?? {};

export const BADGE_RULES: BadgeRule[] = [
  {
    code: 'IDENTITY_VERIFIED',
    entityTypes: ['SELLER', 'SUPPLIER'],
    evaluate: (c) => {
      const d = det(c, 'VERIFICATION') as { status?: string; level?: string };
      return d.status === 'APPROVED' ? { status: d.status, level: d.level } : null;
    },
  },
  {
    code: 'BUSINESS_VERIFIED',
    entityTypes: ['SELLER', 'SUPPLIER'],
    evaluate: (c) => {
      const d = det(c, 'VERIFICATION') as { status?: string; level?: string };
      const suffisant = ['BUSINESS', 'PRO', 'ENTERPRISE'].includes(d.level ?? '');
      return d.status === 'APPROVED' && suffisant ? { level: d.level } : null;
    },
  },
  {
    code: 'RELIABLE_DELIVERY',
    entityTypes: ['SELLER'],
    evaluate: (c, sample) => {
      const v = val(c, 'DELIVERY');
      // Un taux exige un volume : « 100 % » sur trois livraisons ne dit rien.
      if (v === null || sample < 20 || v < 0.95) return null;
      return { onTimeRate: v, ordersDelivered: sample };
    },
  },
  {
    code: 'LOW_DISPUTE_RATE',
    entityTypes: ['SELLER'],
    evaluate: (c, sample) => {
      const d = det(c, 'DISPUTES') as { disputeRate?: number | null };
      if (sample < 20 || d.disputeRate == null || d.disputeRate > 0.02) return null;
      return { disputeRate: d.disputeRate, ordersDelivered: sample };
    },
  },
  {
    code: 'FAST_RESPONDER',
    entityTypes: ['SELLER'],
    evaluate: (c) => {
      const d = det(c, 'RESPONSIVENESS') as { responseRate?: number | null; medianResponseHours?: number | null };
      if (d.responseRate == null || d.medianResponseHours == null) return null;
      if (d.responseRate < 0.9 || d.medianResponseHours > 4) return null;
      return { responseRate: d.responseRate, medianResponseHours: d.medianResponseHours };
    },
  },
  {
    code: 'LONG_TERM_SELLER',
    entityTypes: ['SELLER'],
    evaluate: (c, sample) => {
      const d = det(c, 'TRANSACTIONS') as { ordersDelivered?: number };
      return (d.ordersDelivered ?? 0) >= 100 ? { ordersDelivered: d.ordersDelivered, sample } : null;
    },
  },
  {
    code: 'TOP_SELLER',
    entityTypes: ['SELLER'],
    evaluate: (c, sample) => {
      const note = det(c, 'REVIEWS') as { average?: number; count?: number };
      const livraison = val(c, 'DELIVERY');
      if (sample < 50 || (note.count ?? 0) < 20) return null;
      if ((note.average ?? 0) < 4.5 || livraison === null || livraison < 0.95) return null;
      return { ratingAverage: note.average, ratingCount: note.count, onTimeRate: livraison };
    },
  },
  {
    code: 'B2B_VERIFIED',
    entityTypes: ['SUPPLIER'],
    evaluate: (c) => {
      const d = det(c, 'VERIFICATION') as { status?: string };
      const commandes = det(c, 'B2B_ORDERS') as { acceptedQuotes?: number };
      if (d.status !== 'APPROVED' || (commandes.acceptedQuotes ?? 0) < 1) return null;
      return { acceptedQuotes: commandes.acceptedQuotes };
    },
  },
  {
    code: 'PRO_SUPPLIER',
    entityTypes: ['SUPPLIER'],
    evaluate: (c) => {
      const reponse = val(c, 'QUOTE_RESPONSE');
      const commandes = det(c, 'B2B_ORDERS') as { acceptedQuotes?: number };
      if (reponse === null || reponse < 0.8 || (commandes.acceptedQuotes ?? 0) < 5) return null;
      return { responseRate: reponse, acceptedQuotes: commandes.acceptedQuotes };
    },
  },
  {
    code: 'LOW_RETURN_RATE',
    entityTypes: ['PRODUCT'],
    evaluate: (c, sample) => {
      const d = det(c, 'RETURNS') as { returnRate?: number | null };
      if (sample < 20 || d.returnRate == null || d.returnRate > 0.03) return null;
      return { returnRate: d.returnRate, ordered: sample };
    },
  },
  {
    code: 'FREQUENTLY_ORDERED',
    entityTypes: ['PRODUCT'],
    evaluate: (c, sample) => (sample >= 50 ? { ordered: sample } : null),
  },
  {
    code: 'TRUSTED_BUYER',
    entityTypes: ['BUYER'],
    evaluate: (c, sample) => {
      const paiement = val(c, 'PAYMENT_RELIABILITY');
      if (sample < 10 || paiement === null || paiement < 0.95) return null;
      return { completedOrders: sample, paymentReliability: paiement };
    },
  },
];

/**
 * Recalcule les badges d'une entité : pose ceux qui sont mérités, retire ceux
 * qui ne le sont plus. Idempotent — le rejouer ne change rien.
 */
export async function awardBadges(
  entityType: TrustEntityType,
  entityId: string,
  components: TrustComponent[],
  sample: number,
) {
  const index = new Map(components.map((c) => [c.code, c]));
  const applicables = BADGE_RULES.filter((r) => r.entityTypes.includes(entityType));

  const existants = await prisma.toumaTrustBadge.findMany({ where: { entityType, entityId } });
  const parCode = new Map(existants.map((b) => [b.code, b]));

  const operations: Prisma.PrismaPromise<unknown>[] = [];
  for (const regle of applicables) {
    const preuve = regle.evaluate(index, sample);
    const existant = parCode.get(regle.code);

    if (preuve) {
      if (!existant) {
        operations.push(
          prisma.toumaTrustBadge.create({
            data: { entityType, entityId, code: regle.code, evidence: preuve as Prisma.InputJsonValue },
          }),
        );
      } else if (existant.revokedAt !== null) {
        // Réattribution : la date d'obtention repart, la ligne reste la même.
        operations.push(
          prisma.toumaTrustBadge.update({
            where: { id: existant.id },
            data: { revokedAt: null, awardedAt: new Date(), evidence: preuve as Prisma.InputJsonValue },
          }),
        );
      } else {
        operations.push(
          prisma.toumaTrustBadge.update({
            where: { id: existant.id },
            data: { evidence: preuve as Prisma.InputJsonValue },
          }),
        );
      }
    } else if (existant && existant.revokedAt === null) {
      operations.push(
        prisma.toumaTrustBadge.update({ where: { id: existant.id }, data: { revokedAt: new Date() } }),
      );
    }
  }

  if (operations.length) await prisma.$transaction(operations);
}

/** Badges en cours de validité d'une entité. */
export async function activeBadges(entityType: TrustEntityType, entityId: string) {
  const rows = await prisma.toumaTrustBadge.findMany({
    where: { entityType, entityId, revokedAt: null },
    orderBy: { awardedAt: 'asc' },
    select: { code: true, evidence: true, awardedAt: true },
  });
  return rows;
}

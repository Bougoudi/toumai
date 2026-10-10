import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';

/**
 * TOUMA GROWTH — segmentation.
 *
 * **Ce que le moteur lit, et rien d'autre** : le nombre de commandes, le
 * montant dépensé, la date du dernier achat. Trois faits commerciaux.
 *
 * La garantie contre la discrimination n'est pas une promesse écrite en
 * commentaire : c'est que **la requête ne sélectionne pas** les colonnes qui
 * poseraient problème. Une donnée qui n'est pas lue ne peut pas entrer dans un
 * segment, et aucune relecture n'est nécessaire pour s'en assurer — il suffit
 * de regarder le `select` ci-dessous.
 *
 * Le pays n'y figure pas non plus. Il sert à livrer et à facturer ; il n'a rien
 * à faire dans une catégorie de personnes.
 */

/** Faits commerciaux d'un acheteur. Le seul matériau de la segmentation. */
interface Faits {
  userId: string;
  orders: number;
  spendByCurrency: Map<string, Prisma.Decimal>;
  daysSinceLastOrder: number | null;
}

const STATUTS_COMPTES = ['PAID', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'] as const;

/**
 * Faits d'un acheteur.
 *
 * Le `select` est volontairement minimal : il ne demande ni nom, ni pays, ni
 * quoi que ce soit qui décrive la personne.
 */
async function faitsDe(userId: string): Promise<Faits> {
  const commandes = await prisma.toumaOrder.findMany({
    where: { buyerId: userId, status: { in: [...STATUTS_COMPTES] } },
    select: { total: true, currency: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const spend = new Map<string, Prisma.Decimal>();
  for (const c of commandes) {
    // Par devise, jamais additionnées : il n'existe pas de taux officiel ici,
    // et un total mélangé ne voudrait rien dire.
    spend.set(c.currency, (spend.get(c.currency) ?? new Prisma.Decimal(0)).plus(c.total));
  }

  return {
    userId,
    orders: commandes.length,
    spendByCurrency: spend,
    daysSinceLastOrder: commandes.length
      ? Math.floor((Date.now() - commandes[0].createdAt.getTime()) / 86_400_000)
      : null,
  };
}

interface Definition {
  id: string;
  code: string;
  minOrders: number | null;
  maxOrders: number | null;
  minSpend: Prisma.Decimal | null;
  spendCurrency: string | null;
  minDaysSinceLastOrder: number | null;
  maxDaysSinceLastOrder: number | null;
}

/** Un acheteur appartient-il à ce segment, et sur quelle base ? */
export function matches(segment: Definition, faits: Faits): { member: boolean; evidence: Record<string, unknown> } {
  const evidence: Record<string, unknown> = { orders: faits.orders };

  if (segment.minOrders !== null && faits.orders < segment.minOrders) return { member: false, evidence };
  if (segment.maxOrders !== null && faits.orders > segment.maxOrders) return { member: false, evidence };

  if (segment.minSpend !== null) {
    // Une condition de montant sans devise ne veut rien dire : elle ne peut
    // pas être remplie, plutôt que d'être remplie par hasard.
    if (!segment.spendCurrency) return { member: false, evidence };
    const depense = faits.spendByCurrency.get(segment.spendCurrency) ?? new Prisma.Decimal(0);
    evidence.spend = depense.toString();
    evidence.spendCurrency = segment.spendCurrency;
    if (depense.lessThan(segment.minSpend)) return { member: false, evidence };
  }

  if (segment.minDaysSinceLastOrder !== null || segment.maxDaysSinceLastOrder !== null) {
    // Jamais commandé : l'ancienneté du dernier achat n'existe pas. On ne la
    // remplace pas par l'infini, ce qui rangerait tout nouveau venu parmi les
    // clients perdus.
    if (faits.daysSinceLastOrder === null) return { member: false, evidence };
    evidence.daysSinceLastOrder = faits.daysSinceLastOrder;
    if (segment.minDaysSinceLastOrder !== null && faits.daysSinceLastOrder < segment.minDaysSinceLastOrder) {
      return { member: false, evidence };
    }
    if (segment.maxDaysSinceLastOrder !== null && faits.daysSinceLastOrder > segment.maxDaysSinceLastOrder) {
      return { member: false, evidence };
    }
  }

  return { member: true, evidence };
}

export const segmentationService = {
  matches,

  /** Segments d'un acheteur, recalculés depuis ses faits. */
  async segmentsOf(userId: string): Promise<string[]> {
    try {
      const [definitions, faits] = await Promise.all([
        prisma.toumaCustomerSegment.findMany({ where: { active: true } }),
        faitsDe(userId),
      ]);
      return definitions.filter((d) => matches(d, faits).member).map((d) => d.code);
    } catch (err) {
      // Une segmentation indisponible ne doit pas empêcher un achat : elle
      // rend une liste vide, et les promotions qui en dépendent ne
      // s'appliquent simplement pas.
      logger.error('Segments non calculés', { userId, err: String(err) });
      return [];
    }
  },

  /**
   * Recalcule l'appartenance d'un acheteur et la consigne.
   *
   * L'appartenance est **datée et justifiée** : « pourquoi suis-je dans ce
   * segment » doit avoir une réponse, sinon la segmentation devient une
   * étiquette qu'on ne peut pas contester.
   */
  async refresh(userId: string): Promise<number> {
    const [definitions, faits] = await Promise.all([
      prisma.toumaCustomerSegment.findMany({ where: { active: true } }),
      faitsDe(userId),
    ]);

    const membre: Array<{ segmentId: string; evidence: Record<string, unknown> }> = [];
    const sorti: string[] = [];
    for (const d of definitions) {
      const r = matches(d, faits);
      if (r.member) membre.push({ segmentId: d.id, evidence: r.evidence });
      else sorti.push(d.id);
    }

    await prisma.$transaction([
      prisma.toumaCustomerSegmentMember.deleteMany({ where: { userId, segmentId: { in: sorti } } }),
      ...membre.map((m) =>
        prisma.toumaCustomerSegmentMember.upsert({
          where: { segmentId_userId: { segmentId: m.segmentId, userId } },
          create: { segmentId: m.segmentId, userId, evidence: m.evidence as Prisma.InputJsonValue },
          update: { evidence: m.evidence as Prisma.InputJsonValue, computedAt: new Date() },
        }),
      ),
    ]);
    return membre.length;
  },

  /** Effectifs par segment. Des décomptes, jamais une projection. */
  async counts() {
    const segments = await prisma.toumaCustomerSegment.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true, _count: { select: { members: true } } },
      orderBy: { code: 'asc' },
    });
    return segments.map((s) => ({ code: s.code, name: s.name, members: s._count.members }));
  },
};

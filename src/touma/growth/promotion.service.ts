import { Prisma } from '@prisma/client';
import type { PromotionFunding, ToumaPromotion, ToumaPromotionRule } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { roundTo, ZERO } from '../lib/money.js';
import { evaluate, type Rule, type RuleContext, type RuleFailure } from './rules.js';
import { cap, select, type Candidate } from './stacking.js';

/**
 * TOUMA GROWTH — promotions automatiques.
 *
 * **Ce qu'une promotion est, et qu'un coupon n'est pas.** Un coupon s'applique
 * parce qu'on a tapé un mot ; une promotion s'applique parce que le panier
 * remplit des conditions. L'acheteur n'a rien à savoir pour en bénéficier —
 * c'est précisément ce qui la rend utile, et aussi ce qui la rend dangereuse
 * si elle s'applique là où elle ne devrait pas.
 *
 * **Ce que ce service ne fait pas.** Il ne remplace pas `coupon.service.ts`,
 * qui porte déjà un moteur de remise éprouvé : financement tracé, répartition
 * au centime près, plafond, limites par acheteur. Les deux se rencontrent au
 * checkout, et c'est `stacking.ts` qui les départage.
 */

export interface PromotionContext {
  userId: string;
  /** Lignes du panier, agrégées par boutique. */
  lines: Array<{
    storeId: string;
    subtotal: Prisma.Decimal;
    shipping: Prisma.Decimal;
    productIds: string[];
    categoryIds: string[];
    quantity: number;
  }>;
  currency: string;
  destinationCountry: string;
  destinationProvinceId: string | null;
  previousOrders: number;
  segments: string[];
}

export interface AppliedPromotion {
  promotionId: string;
  name: string;
  type: string;
  funding: PromotionFunding;
  /** Remise accordée, dans la devise du panier. */
  amount: Prisma.Decimal;
  /** Part imputée à chaque boutique ; la somme vaut exactement `amount`. */
  byStore: Map<string, Prisma.Decimal>;
  onShipping: boolean;
}

export interface RejectedPromotion {
  promotionId: string;
  name: string;
  /** Codes de message, traduits à l'affichage. */
  reasons: string[];
}

export interface PromotionOutcome {
  applied: AppliedPromotion[];
  rejected: RejectedPromotion[];
  /** Remise totale sur la marchandise. */
  merchandiseDiscount: Prisma.Decimal;
  /** Remise totale sur la livraison. */
  shippingDiscount: Prisma.Decimal;
  /** `true` si une promotion exclusive interdit d'appliquer un code. */
  blocksCoupon: boolean;
}

type PromotionAvecRegles = ToumaPromotion & { rules: ToumaPromotionRule[]; budget: { total: Prisma.Decimal; spent: Prisma.Decimal; currency: string; stopWhenExhausted: boolean } | null };

const toRule = (r: ToumaPromotionRule): Rule => ({
  kind: r.kind,
  threshold: r.threshold,
  values: r.values,
  negated: r.negated,
});

/**
 * Montant qu'une promotion accorderait sur une base donnée.
 *
 * Le plafond `maxDiscountAmount` existe pour une raison précise : un −20 % sur
 * un panier de gros ne doit pas coûter une fortune parce que personne n'y avait
 * pensé le jour où la promotion a été écrite.
 */
function montant(promo: PromotionAvecRegles, base: Prisma.Decimal, currency: string): Prisma.Decimal {
  let brut: Prisma.Decimal;
  switch (promo.type) {
    case 'PERCENTAGE':
    case 'TIERED_DISCOUNT':
    case 'FIRST_ORDER':
      brut = roundTo(base.times(promo.value).dividedBy(100), currency);
      break;
    case 'FIXED_AMOUNT':
    case 'BUNDLE_DISCOUNT':
      // Une remise en montant fixe n'a de sens que dans sa propre devise.
      // Convertir sans taux officiel serait inventer un prix.
      if (promo.currency && promo.currency !== currency) return ZERO;
      brut = promo.value;
      break;
    case 'FREE_SHIPPING':
      brut = base;
      break;
    default:
      brut = ZERO;
  }
  if (promo.maxDiscountAmount && brut.greaterThan(promo.maxDiscountAmount)) return promo.maxDiscountAmount;
  return brut.lessThan(0) ? ZERO : brut;
}

/** Répartit un montant au prorata, sans perdre ni créer de centime. */
function repartir(
  amount: Prisma.Decimal,
  bases: Array<{ key: string; base: Prisma.Decimal }>,
  currency: string,
): Map<string, Prisma.Decimal> {
  const out = new Map<string, Prisma.Decimal>();
  const total = bases.reduce((acc, b) => acc.plus(b.base), ZERO);
  if (!total.greaterThan(0)) return out;
  const eligibles = bases.filter((b) => b.base.greaterThan(0));
  let distribue = ZERO;
  eligibles.forEach((entry, i) => {
    const part = i === eligibles.length - 1
      ? amount.minus(distribue)
      : roundTo(amount.times(entry.base).dividedBy(total), currency);
    distribue = distribue.plus(part);
    out.set(entry.key, part);
  });
  return out;
}

/** Stock disponible sur les produits visés par une promotion, ou `null`. */
async function stockVise(rules: ToumaPromotionRule[], productIds: string[]): Promise<number | null> {
  const besoin = rules.some((r) => r.kind === 'MIN_STOCK' || r.kind === 'MAX_STOCK');
  if (!besoin) return null;
  const cibles = rules.flatMap((r) => (r.kind === 'PRODUCT' ? r.values : []));
  const ids = cibles.length > 0 ? cibles.filter((id) => productIds.includes(id)) : productIds;
  if (ids.length === 0) return 0;
  const agg = await prisma.toumaInventory.aggregate({
    where: { productId: { in: ids } },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? 0;
}

export const promotionService = {
  /**
   * Promotions applicables à un panier.
   *
   * Rend **aussi** celles qui ne s'appliquent pas, avec leur raison : un
   * acheteur qui voit « −10 % dès 25 000 XAF » et ne l'obtient pas a droit de
   * savoir qu'il lui manque 2 000 XAF, plutôt que de croire à une panne.
   */
  async evaluateCart(ctx: PromotionContext): Promise<PromotionOutcome> {
    const vide: PromotionOutcome = {
      applied: [],
      rejected: [],
      merchandiseDiscount: ZERO,
      shippingDiscount: ZERO,
      blocksCoupon: false,
    };
    if (!env.touma.growth.promotionsEnabled || ctx.lines.length === 0) return vide;

    const maintenant = new Date();
    const storeIds = ctx.lines.map((l) => l.storeId);
    const productIds = ctx.lines.flatMap((l) => l.productIds);
    const categoryIds = [...new Set(ctx.lines.flatMap((l) => l.categoryIds))];

    const promotions = (await prisma.toumaPromotion.findMany({
      where: {
        status: 'ACTIVE',
        startsAt: { lte: maintenant },
        OR: [{ endsAt: null }, { endsAt: { gte: maintenant } }],
        // Une promotion de boutique ne concerne que les boutiques du panier ;
        // une promotion de la place de marché les concerne toutes.
        AND: [{ OR: [{ storeId: null }, { storeId: { in: storeIds } }] }],
      },
      include: { rules: true, budget: true },
    })) as PromotionAvecRegles[];

    if (promotions.length === 0) return vide;

    const sousTotal = ctx.lines.reduce((acc, l) => acc.plus(l.subtotal), ZERO);
    const livraison = ctx.lines.reduce((acc, l) => acc.plus(l.shipping), ZERO);
    const quantite = ctx.lines.reduce((acc, l) => acc + l.quantity, 0);

    const candidates: Array<Candidate<PromotionAvecRegles>> = [];
    const rejected: RejectedPromotion[] = [];

    for (const promo of promotions) {
      // Une promotion de boutique ne porte que sur cette boutique. Lui laisser
      // le panier entier ferait payer à un vendeur la remise d'un autre.
      const lignes = promo.storeId ? ctx.lines.filter((l) => l.storeId === promo.storeId) : ctx.lines;
      if (lignes.length === 0) continue;

      const baseMarchandise = lignes.reduce((acc, l) => acc.plus(l.subtotal), ZERO);
      const baseLivraison = lignes.reduce((acc, l) => acc.plus(l.shipping), ZERO);
      const surLivraison = promo.type === 'FREE_SHIPPING';
      const base = surLivraison ? baseLivraison : baseMarchandise;

      const contexte: RuleContext = {
        subtotal: baseMarchandise,
        quantity: lignes.reduce((acc, l) => acc + l.quantity, 0),
        currency: ctx.currency,
        productIds: lignes.flatMap((l) => l.productIds),
        categoryIds: [...new Set(lignes.flatMap((l) => l.categoryIds))],
        storeIds: lignes.map((l) => l.storeId),
        countryCode: ctx.destinationCountry,
        provinceId: ctx.destinationProvinceId,
        previousOrders: ctx.previousOrders,
        segments: ctx.segments,
        stock: await stockVise(promo.rules, productIds),
      };

      const echecs: RuleFailure[] = [];
      const { applicable, failures } = evaluate(promo.rules.map(toRule), contexte);
      echecs.push(...failures);

      // Budget épuisé : la promotion ne s'applique plus, et on le dit.
      if (promo.budget && promo.budget.stopWhenExhausted && promo.budget.spent.greaterThanOrEqualTo(promo.budget.total)) {
        echecs.push({ kind: 'MIN_ORDER_AMOUNT', reason: 'promo.fail.budgetExhausted', detail: {} });
      }

      if (echecs.length > 0 || !applicable) {
        rejected.push({
          promotionId: promo.id,
          name: promo.name,
          reasons: [...new Set(echecs.map((f) => f.reason))],
        });
        continue;
      }

      const brut = montant(promo, base, ctx.currency);
      if (!brut.greaterThan(0)) {
        rejected.push({ promotionId: promo.id, name: promo.name, reasons: ['promo.fail.noEffect'] });
        continue;
      }

      candidates.push({
        promotion: promo,
        stacking: promo.stacking,
        priority: promo.priority,
        amount: cap(brut, base),
      });
    }

    const choix = select(candidates);
    for (const ecartee of choix.excluded) {
      rejected.push({
        promotionId: ecartee.promotion.id,
        name: ecartee.promotion.name,
        reasons: [ecartee.reason],
      });
    }

    // Bornage global : le cumul de plusieurs promotions légitimes ne doit pas
    // dépasser ce sur quoi il porte.
    let marchandise = ZERO;
    let expedition = ZERO;
    const applied: AppliedPromotion[] = [];

    for (const c of choix.applied) {
      const promo = c.promotion;
      const surLivraison = promo.type === 'FREE_SHIPPING';
      const lignes = promo.storeId ? ctx.lines.filter((l) => l.storeId === promo.storeId) : ctx.lines;
      const base = surLivraison
        ? lignes.reduce((acc, l) => acc.plus(l.shipping), ZERO)
        : lignes.reduce((acc, l) => acc.plus(l.subtotal), ZERO);

      const dejaPris = surLivraison ? expedition : marchandise;
      const restant = (surLivraison ? livraison : sousTotal).minus(dejaPris);
      const accorde = cap(c.amount, restant.lessThan(base) ? restant : base);
      if (!accorde.greaterThan(0)) continue;

      if (surLivraison) expedition = expedition.plus(accorde);
      else marchandise = marchandise.plus(accorde);

      applied.push({
        promotionId: promo.id,
        name: promo.name,
        type: promo.type,
        funding: promo.funding,
        amount: accorde,
        byStore: repartir(
          accorde,
          lignes.map((l) => ({ key: l.storeId, base: surLivraison ? l.shipping : l.subtotal })),
          ctx.currency,
        ),
        onShipping: surLivraison,
      });
    }

    return {
      applied,
      rejected,
      merchandiseDiscount: marchandise,
      shippingDiscount: expedition,
      blocksCoupon: choix.blocksCoupon,
    };
  },

  /**
   * Consomme le budget d'une promotion et consigne son usage.
   *
   * **L'incrément est conditionnel en SQL**, pas une lecture suivie d'une
   * écriture : deux commandes simultanées ne peuvent pas faire déborder
   * l'enveloppe. Une campagne à fort trafic déborderait exactement au moment
   * où elle coûte le plus cher.
   *
   * Rend `false` si l'enveloppe ne permettait plus la dépense — l'appelant
   * décide alors quoi faire, plutôt que de découvrir un dépassement après coup.
   */
  async consume(promotionId: string, userId: string, orderId: string | null, amount: Prisma.Decimal, currency: string): Promise<boolean> {
    try {
      return await prisma.$transaction(async (tx) => {
        const budget = await tx.toumaPromotionBudget.findUnique({ where: { promotionId } });
        if (budget) {
          if (budget.currency !== currency) {
            logger.error('Budget de promotion dans une autre devise', { promotionId, currency });
            return false;
          }
          const maj = await tx.$executeRaw`
            UPDATE touma_promotion_budgets
               SET spent = spent + ${amount.toString()}::decimal, "updatedAt" = now()
             WHERE "promotionId" = ${promotionId}
               AND (spent + ${amount.toString()}::decimal) <= total`;
          if (maj === 0) {
            // L'enveloppe est épuisée. On suspend la promotion pour que le
            // prochain panier ne la propose même plus.
            if (budget.stopWhenExhausted) {
              await tx.toumaPromotion.updateMany({
                where: { id: promotionId, status: 'ACTIVE' },
                data: { status: 'PAUSED' },
              });
            }
            return false;
          }
        }
        await tx.toumaPromotionUsage.create({
          data: { promotionId, userId, orderId, amount, currency },
        });
        return true;
      });
    } catch (err) {
      logger.error('Budget de promotion non consommé', { promotionId, err: String(err) });
      return false;
    }
  },
};

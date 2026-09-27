import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { money, roundTo } from '../lib/money.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * Commission de la plateforme.
 *
 * **Le manque comblé.** Le taux était `TOUMA_COMMISSION_RATE` : une variable
 * d'environnement, une seule, pour tout le monde. Aucun moyen d'accorder un
 * taux négocié à un gros vendeur, d'abaisser celui d'une catégorie à faible
 * marge, ou d'ouvrir un pays avec un taux d'appel — sinon en redémarrant le
 * serveur et en changeant le taux de **tout le monde à la fois**, y compris
 * rétroactivement pour les factures pas encore émises.
 *
 * Quatre portées, précision croissante : globale, pays, catégorie, boutique. La
 * plus précise l'emporte ; à précision égale, la plus récemment entrée en
 * vigueur. Sans aucune règle, la variable d'environnement reste le repli —
 * l'absence de configuration ne doit pas faire tomber la commission à zéro.
 *
 * Deux règles de conception tiennent le reste :
 *
 * **Une règle qui a servi ne se modifie pas.** On la clôt (`effectiveUntil`) et
 * on en ouvre une autre. Une commande passée doit rester explicable par la
 * règle qui l'a produite ; réécrire un taux rendrait une facture d'hier
 * incompréhensible aujourd'hui.
 *
 * **Le taux retenu est figé sur la commande.** Sans cela, la commission
 * enregistrée à l'encaissement pourrait être calculée avec un taux différent de
 * celui qui a produit le montant à la validation du panier.
 */

/** Portée d'une règle, de la plus générale à la plus précise. */
export type CommissionScope = 'GLOBAL' | 'COUNTRY' | 'CATEGORY' | 'STORE';

export interface CommissionDecision {
  /** Taux appliqué, en décimal (0.05 = 5 %). */
  rate: Prisma.Decimal;
  scope: CommissionScope;
  /** Règle retenue, ou `null` quand c'est le repli de configuration. */
  ruleId: string | null;
  /** Comment la décision a été prise — affiché au vendeur, pas deviné. */
  explanation: string;
}

export interface CommissionContext {
  countryCode?: string | null;
  categoryIds?: string[];
  storeId?: string | null;
  /** Devise de la commande : une borne dans une autre devise est inapplicable. */
  currency: string;
  at?: Date;
}

function scopeOf(rule: { storeId: string | null; categoryId: string | null; countryCode: string | null }): CommissionScope {
  if (rule.storeId) return 'STORE';
  if (rule.categoryId) return 'CATEGORY';
  if (rule.countryCode) return 'COUNTRY';
  return 'GLOBAL';
}

const PRECISION: Record<CommissionScope, number> = { STORE: 3, CATEGORY: 2, COUNTRY: 1, GLOBAL: 0 };

/**
 * Règle applicable à ce contexte.
 *
 * Une règle dont les bornes sont libellées dans une **autre devise** que la
 * commande est écartée plutôt qu'appliquée de travers : convertir sans taux
 * officiel produirait un plafond inventé, et un plafond inventé sur une
 * commission est une erreur sur de l'argent réel.
 */
export async function resolveCommission(context: CommissionContext): Promise<CommissionDecision> {
  const at = context.at ?? new Date();
  const currency = context.currency.toUpperCase();

  const rules = await prisma.toumaCommissionRule.findMany({
    where: {
      active: true,
      effectiveFrom: { lte: at },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
      AND: [
        {
          OR: [
            { countryCode: null, categoryId: null, storeId: null },
            ...(context.countryCode ? [{ countryCode: context.countryCode.toUpperCase(), categoryId: null, storeId: null }] : []),
            ...(context.categoryIds?.length ? [{ categoryId: { in: context.categoryIds } }] : []),
            ...(context.storeId ? [{ storeId: context.storeId }] : []),
          ],
        },
      ],
    },
    orderBy: { effectiveFrom: 'desc' },
  });

  const applicables = rules.filter((r) => !r.feeCurrency || r.feeCurrency.toUpperCase() === currency);

  if (applicables.length === 0) {
    return {
      rate: new Prisma.Decimal(env.touma.commissionRate.toString()),
      scope: 'GLOBAL',
      ruleId: null,
      explanation: 'Taux par défaut de la plateforme : aucune règle de commission ne couvre cette commande.',
    };
  }

  // `findMany` a déjà trié par date décroissante : un tri stable sur la seule
  // précision laisse donc la plus récente en tête à précision égale.
  const retenue = applicables.slice().sort((a, b) => PRECISION[scopeOf(b)] - PRECISION[scopeOf(a)])[0];
  const scope = scopeOf(retenue);

  return {
    rate: retenue.rate,
    scope,
    ruleId: retenue.id,
    explanation:
      retenue.note ??
      {
        STORE: 'Taux négocié pour cette boutique.',
        CATEGORY: 'Taux propre à la catégorie du produit.',
        COUNTRY: 'Taux propre au pays de la boutique.',
        GLOBAL: 'Taux général de la plateforme.',
      }[scope],
  };
}

/**
 * Montant de commission pour une assiette donnée, bornes comprises.
 *
 * L'assiette est ce que le vendeur **encaisse réellement** : une remise qu'il
 * finance la réduit, une campagne TOUMA non. Cette règle-là existait déjà et ne
 * change pas.
 */
export async function commissionFor(
  base: Prisma.Decimal | string,
  context: CommissionContext,
): Promise<CommissionDecision & { amount: Prisma.Decimal }> {
  const decision = await resolveCommission(context);
  const currency = context.currency.toUpperCase();
  let amount = roundTo(money(base).times(decision.rate), currency);

  if (decision.ruleId) {
    const rule = await prisma.toumaCommissionRule.findUnique({ where: { id: decision.ruleId } });
    // Les bornes sont dans la même devise que la commande — les règles d'une
    // autre devise ont été écartées en amont.
    if (rule?.minFee && amount.lessThan(rule.minFee)) amount = roundTo(rule.minFee, currency);
    if (rule?.maxFee && amount.greaterThan(rule.maxFee)) amount = roundTo(rule.maxFee, currency);
  }

  // Une commission ne dépasse jamais l'assiette : la plateforme ne peut pas
  // prendre plus que ce que le vendeur encaisse.
  const assiette = money(base);
  if (amount.greaterThan(assiette)) amount = roundTo(assiette, currency);

  return { ...decision, amount };
}

// ── Administration ──────────────────────────────────────────────────────────

export interface CommissionRuleInput {
  countryCode?: string | null;
  categoryId?: string | null;
  storeId?: string | null;
  rate: string;
  minFee?: string | null;
  maxFee?: string | null;
  feeCurrency?: string | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  note?: string | null;
}

export const commissionService = {
  async list(includeExpired = false) {
    const now = new Date();
    const rules = await prisma.toumaCommissionRule.findMany({
      where: includeExpired ? {} : { active: true, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
      orderBy: [{ effectiveFrom: 'desc' }],
      include: {
        store: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    return {
      items: rules.map((r) => ({
        ...r,
        rate: r.rate.toString(),
        minFee: r.minFee?.toString() ?? null,
        maxFee: r.maxFee?.toString() ?? null,
        scope: scopeOf(r),
      })),
      /** Repli quand aucune règle ne couvre une commande. */
      fallbackRate: env.touma.commissionRate.toString(),
    };
  },

  async create(actor: ToumaRequestUser, input: CommissionRuleInput) {
    const rate = new Prisma.Decimal(input.rate);
    // Un taux négatif paierait le vendeur pour vendre ; au-delà de 100 %, la
    // plateforme prendrait plus que le prix. Les deux sont des fautes de
    // saisie, pas des politiques commerciales.
    if (rate.lessThan(0) || rate.greaterThan(1)) throw badRequest('Le taux doit être compris entre 0 et 1 (0.05 = 5 %).');

    const bornes = input.minFee ?? input.maxFee;
    if (bornes && !input.feeCurrency) throw badRequest('Une borne de commission exige la devise dans laquelle elle est exprimée.');
    if (input.minFee && input.maxFee && new Prisma.Decimal(input.minFee).greaterThan(input.maxFee)) {
      throw badRequest('Le plancher de commission dépasse le plafond.');
    }

    if (input.storeId) {
      const store = await prisma.toumaStore.findUnique({ where: { id: input.storeId }, select: { id: true } });
      if (!store) throw notFound('Boutique introuvable.');
    }
    if (input.categoryId) {
      const category = await prisma.toumaCategory.findUnique({ where: { id: input.categoryId }, select: { id: true } });
      if (!category) throw notFound('Catégorie introuvable.');
    }

    const rule = await prisma.toumaCommissionRule.create({
      data: {
        countryCode: input.countryCode?.toUpperCase() ?? null,
        categoryId: input.categoryId ?? null,
        storeId: input.storeId ?? null,
        rate,
        minFee: input.minFee ? new Prisma.Decimal(input.minFee) : null,
        maxFee: input.maxFee ? new Prisma.Decimal(input.maxFee) : null,
        feeCurrency: input.feeCurrency?.toUpperCase() ?? null,
        effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(),
        effectiveUntil: input.effectiveUntil ? new Date(input.effectiveUntil) : null,
        note: input.note ?? null,
        createdById: actor.id,
      },
    });

    await audit({
      actorId: actor.id,
      action: 'commission.rule.create',
      entity: 'ToumaCommissionRule',
      entityId: rule.id,
      metadata: { rate: rate.toString(), scope: scopeOf(rule), countryCode: rule.countryCode, storeId: rule.storeId, categoryId: rule.categoryId },
    });

    return { ...rule, rate: rule.rate.toString(), minFee: rule.minFee?.toString() ?? null, maxFee: rule.maxFee?.toString() ?? null, scope: scopeOf(rule) };
  },

  /**
   * Clôture d'une règle. Il n'existe **aucune** modification de taux et aucune
   * suppression : une commande passée doit rester explicable par la règle qui
   * l'a produite. Changer de taux, c'est clore puis ouvrir.
   */
  async close(actor: ToumaRequestUser, ruleId: string, reason: string) {
    const rule = await prisma.toumaCommissionRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw notFound('Règle introuvable.');

    const clos = await prisma.toumaCommissionRule.update({
      where: { id: ruleId },
      data: { active: false, effectiveUntil: rule.effectiveUntil ?? new Date() },
    });

    await audit({ actorId: actor.id, action: 'commission.rule.close', entity: 'ToumaCommissionRule', entityId: ruleId, metadata: { reason } });
    return { ...clos, rate: clos.rate.toString(), minFee: clos.minFee?.toString() ?? null, maxFee: clos.maxFee?.toString() ?? null, scope: scopeOf(clos) };
  },

  /**
   * Simulation : quel taux s'appliquerait, et pourquoi.
   *
   * Un vendeur qui conteste sa commission a droit à la réponse, et un
   * exploitant qui pose une règle a droit à la vérifier avant qu'elle ne
   * s'applique à de vraies commandes.
   */
  async simulate(context: CommissionContext & { base: string }) {
    const resultat = await commissionFor(context.base, context);
    return {
      base: money(context.base).toString(),
      currency: context.currency.toUpperCase(),
      rate: resultat.rate.toString(),
      amount: resultat.amount.toString(),
      scope: resultat.scope,
      ruleId: resultat.ruleId,
      explanation: resultat.explanation,
    };
  },
};

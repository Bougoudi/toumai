import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import type { AiTask } from './ai.types.js';

/**
 * Comptabilité et plafonds d'usage de l'IA (§5, §44).
 *
 * Le danger n'est pas qu'un utilisateur pose trop de questions : c'est qu'une
 * boucle — un agent qui s'appelle lui-même, un travail périodique qui repart en
 * erreur — consomme sans limite pendant une nuit. Les plafonds sont là pour
 * qu'un tel emballement s'arrête tout seul.
 *
 * **Ce que ces plafonds garantissent, et ce qu'ils ne garantissent pas.**
 * Le compte est lu puis comparé ; deux requêtes simultanées peuvent donc toutes
 * deux passer le dernier appel autorisé. Le dépassement est borné par le nombre
 * d'appels concurrents — quelques unités. C'est acceptable pour un frein
 * d'usage, et ce serait inacceptable pour un budget de promotion, qui est
 * pour cette raison écrit autrement (`UPDATE … WHERE spent + n <= total`).
 * Le dire est préférable à laisser croire à une exactitude qui n'existe pas.
 */

export interface UsageScope {
  userId: string | null;
  /** Boutique ou organisation, pour les plafonds par vendeur/entreprise. */
  scopeId?: string | null;
}

export type LimitCode = 'USER_DAY' | 'USER_MONTH' | 'SCOPE_DAY' | 'PLATFORM_DAY' | 'PLATFORM_COST_DAY';

export interface LimitVerdict {
  allowed: boolean;
  code: LimitCode | null;
  /** Message destiné à l'utilisateur, en français, sans chiffre interne. */
  message: string | null;
}

/** Début du jour courant en UTC — la clé de `ToumaAiUsage.day`. */
export function today(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function firstOfMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export const usageService = {
  /**
   * Les plafonds sont-ils atteints ?
   *
   * Un visiteur sans compte n'est pas compté par utilisateur — il n'y a pas
   * d'utilisateur. Il reste borné par le plafond de plateforme et par le
   * limiteur HTTP, qui est le bon outil pour ce cas.
   */
  async check(scope: UsageScope, now: Date = new Date()): Promise<LimitVerdict> {
    const l = env.touma.ai.limits;
    const jour = today(now);
    const mois = firstOfMonth(now);

    if (scope.userId) {
      const [jourCount, moisCount] = await Promise.all([
        prisma.toumaAiUsage.count({ where: { userId: scope.userId, day: jour } }),
        prisma.toumaAiUsage.count({ where: { userId: scope.userId, day: { gte: mois } } }),
      ]);
      if (jourCount >= l.perUserPerDay) return refus('USER_DAY', 'Vous avez atteint la limite quotidienne d’utilisation de l’assistant. Réessayez demain.');
      if (moisCount >= l.perUserPerMonth) return refus('USER_MONTH', 'Vous avez atteint la limite mensuelle d’utilisation de l’assistant.');
    }

    if (scope.scopeId) {
      const compte = await prisma.toumaAiUsage.count({ where: { scopeId: scope.scopeId, day: jour } });
      if (compte >= l.perScopePerDay) return refus('SCOPE_DAY', 'Cette boutique a atteint sa limite quotidienne d’utilisation de l’assistant.');
    }

    const [plateforme, cout] = await Promise.all([
      prisma.toumaAiUsage.count({ where: { day: jour } }),
      prisma.toumaAiUsage.aggregate({ where: { day: jour }, _sum: { estimatedCost: true } }),
    ]);
    if (plateforme >= l.platformPerDay) return refus('PLATFORM_DAY', 'L’assistant est momentanément indisponible (limite quotidienne de la plateforme atteinte).');
    const depense = cout._sum.estimatedCost ?? new Prisma.Decimal(0);
    if (depense.greaterThanOrEqualTo(l.platformCostPerDay)) {
      return refus('PLATFORM_COST_DAY', 'L’assistant est momentanément indisponible (budget quotidien atteint).');
    }

    return { allowed: true, code: null, message: null };
  },

  /** Inscrit une consommation. N'échoue jamais l'appel métier qui la porte. */
  async record(input: {
    scope: UsageScope;
    conversationId?: string | null;
    feature: string;
    task: AiTask;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    ok: boolean;
    latencyMs: number;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    await prisma.toumaAiUsage
      .create({
        data: {
          userId: input.scope.userId,
          scopeId: input.scope.scopeId ?? null,
          conversationId: input.conversationId ?? null,
          feature: input.feature,
          task: input.task,
          provider: input.provider,
          model: input.model,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          estimatedCost: estimateCost(input.provider, input.model, input.inputTokens, input.outputTokens),
          ok: input.ok,
          latencyMs: input.latencyMs,
          day: today(now),
        },
      })
      // Une panne d'écriture de compteur ne doit pas faire échouer la réponse
      // déjà produite. Elle est en revanche visible : la ligne manque, donc le
      // tableau de bord sous-compte, ce qui est moins grave qu'une erreur 500
      // rendue à quelqu'un dont la question a pourtant reçu une réponse.
      .catch(() => undefined);
  },

  /** Agrégats pour `/admin/ai/usage` (§37). */
  async dashboard(days: number) {
    const depuis = new Date(Date.now() - days * 86_400_000);
    const [parJour, parFournisseur, parFonction, totaux] = await Promise.all([
      prisma.toumaAiUsage.groupBy({ by: ['day'], where: { createdAt: { gte: depuis } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true, estimatedCost: true }, orderBy: { day: 'asc' } }),
      prisma.toumaAiUsage.groupBy({ by: ['provider', 'model'], where: { createdAt: { gte: depuis } }, _count: { _all: true }, _sum: { estimatedCost: true } }),
      prisma.toumaAiUsage.groupBy({ by: ['feature'], where: { createdAt: { gte: depuis } }, _count: { _all: true }, _sum: { estimatedCost: true }, _avg: { latencyMs: true } }),
      prisma.toumaAiUsage.aggregate({ where: { createdAt: { gte: depuis } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true, estimatedCost: true }, _avg: { latencyMs: true } }),
    ]);
    const erreurs = await prisma.toumaAiUsage.count({ where: { createdAt: { gte: depuis }, ok: false } });
    return {
      days,
      totals: {
        requests: totaux._count._all,
        inputTokens: totaux._sum.inputTokens ?? 0,
        outputTokens: totaux._sum.outputTokens ?? 0,
        estimatedCost: (totaux._sum.estimatedCost ?? new Prisma.Decimal(0)).toString(),
        avgLatencyMs: Math.round(totaux._avg.latencyMs ?? 0),
        errors: erreurs,
      },
      byDay: parJour.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        requests: r._count._all,
        inputTokens: r._sum.inputTokens ?? 0,
        outputTokens: r._sum.outputTokens ?? 0,
        estimatedCost: (r._sum.estimatedCost ?? new Prisma.Decimal(0)).toString(),
      })),
      byModel: parFournisseur.map((r) => ({ provider: r.provider, model: r.model, requests: r._count._all, estimatedCost: (r._sum.estimatedCost ?? new Prisma.Decimal(0)).toString() })),
      byFeature: parFonction.map((r) => ({ feature: r.feature, requests: r._count._all, estimatedCost: (r._sum.estimatedCost ?? new Prisma.Decimal(0)).toString(), avgLatencyMs: Math.round(r._avg.latencyMs ?? 0) })),
      /**
       * Rappelé à chaque lecture : ces montants sont des **estimations**
       * calculées depuis une grille locale, jamais une facture. La facture du
       * fournisseur fait foi, et elle seule.
       */
      costDisclaimer: 'Coûts estimés à partir d’une grille tarifaire locale — la facture du fournisseur fait foi.',
    };
  },
};

function refus(code: LimitCode, message: string): LimitVerdict {
  return { allowed: false, code, message };
}

/**
 * Grille tarifaire locale, en dollars par million de jetons.
 *
 * Elle vieillit : les tarifs changent sans prévenir. C'est assumé — son rôle
 * est de détecter un emballement, pas de tenir une comptabilité. Un modèle
 * inconnu tombe sur un tarif prudent plutôt que sur zéro : un coût inconnu
 * compté comme nul rendrait le plafond de budget inopérant précisément le jour
 * où l'on change de modèle.
 */
const TARIFS: Record<string, { entree: number; sortie: number }> = {
  RULE_BASED: { entree: 0, sortie: 0 },
  DEFAUT: { entree: 3, sortie: 15 },
};

export function estimateCost(provider: string, _model: string, inputTokens: number, outputTokens: number): Prisma.Decimal {
  const tarif = TARIFS[provider.toUpperCase()] ?? TARIFS.DEFAUT;
  const cout = (inputTokens / 1_000_000) * tarif.entree + (outputTokens / 1_000_000) * tarif.sortie;
  return new Prisma.Decimal(cout.toFixed(6));
}

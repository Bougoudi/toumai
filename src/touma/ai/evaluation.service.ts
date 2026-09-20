import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

/**
 * QUALITÉ DE L'ASSISTANT (§38, §57).
 *
 * Ces mesures existent pour répondre à une question : faut-il laisser
 * l'assistant ouvert ? Un taux d'échec d'outil qui monte, des signalements
 * « prix faux » qui s'accumulent, et la réponse devient non.
 *
 * Rien n'est estimé ici : tout est compté sur des lignes réellement écrites.
 */

export const evaluationService = {
  async quality(days: number) {
    const depuis = new Date(Date.now() - days * 86_400_000);

    const [appels, echecs, parOutil, retours, messages, usage] = await Promise.all([
      prisma.toumaAiToolCall.count({ where: { createdAt: { gte: depuis } } }),
      prisma.toumaAiToolCall.count({ where: { createdAt: { gte: depuis }, ok: false } }),
      prisma.toumaAiToolCall.groupBy({ by: ['tool'], where: { createdAt: { gte: depuis } }, _count: { _all: true }, _avg: { latencyMs: true } }),
      prisma.toumaAiFeedback.groupBy({ by: ['verdict'], where: { createdAt: { gte: depuis } }, _count: { _all: true } }),
      prisma.toumaAiMessage.count({ where: { createdAt: { gte: depuis }, role: 'ASSISTANT' } }),
      prisma.toumaAiUsage.aggregate({ where: { createdAt: { gte: depuis } }, _count: { _all: true }, _sum: { estimatedCost: true }, _avg: { latencyMs: true } }),
    ]);

    const echecsParOutil = await prisma.toumaAiToolCall.groupBy({ by: ['tool'], where: { createdAt: { gte: depuis }, ok: false }, _count: { _all: true } });
    const echecPar = new Map(echecsParOutil.map((r) => [r.tool, r._count._all]));

    const parVerdict = Object.fromEntries(retours.map((r) => [r.verdict, r._count._all]));
    const signalements = ['INCORRECT', 'WRONG_PRICE', 'WRONG_PRODUCT', 'OUTDATED', 'UNSAFE'].reduce((a, v) => a + (parVerdict[v] ?? 0), 0);

    return {
      days,
      messages,
      toolCalls: { total: appels, failed: echecs, failureRate: appels > 0 ? Number(((echecs / appels) * 100).toFixed(1)) : null },
      byTool: parOutil
        .map((r) => ({ tool: r.tool, calls: r._count._all, failures: echecPar.get(r.tool) ?? 0, avgLatencyMs: Math.round(r._avg.latencyMs ?? 0) }))
        .sort((a, b) => b.calls - a.calls),
      feedback: {
        byVerdict: parVerdict,
        helpful: parVerdict.HELPFUL ?? 0,
        notHelpful: parVerdict.NOT_HELPFUL ?? 0,
        /** Signalements de contenu faux : la mesure qui compte le plus (§71). */
        factualReports: signalements,
        /**
         * Rapporté au nombre de réponses, pas en valeur absolue : dix
         * signalements sur dix mille réponses et dix sur vingt ne disent pas
         * la même chose.
         */
        reportRate: messages > 0 ? Number(((signalements / messages) * 100).toFixed(2)) : null,
      },
      cost: { requests: usage._count._all, estimatedCost: (usage._sum.estimatedCost ?? new Prisma.Decimal(0)).toString(), avgLatencyMs: Math.round(usage._avg.latencyMs ?? 0) },
    };
  },

  /** File des signalements non traités, la plus ancienne d'abord. */
  async feedbackQueue(days: number) {
    const depuis = new Date(Date.now() - days * 86_400_000);
    const items = await prisma.toumaAiFeedback.findMany({
      where: { createdAt: { gte: depuis }, handledAt: null, verdict: { in: ['INCORRECT', 'WRONG_PRICE', 'WRONG_PRODUCT', 'OUTDATED', 'UNSAFE'] } },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: {
        id: true,
        verdict: true,
        comment: true,
        createdAt: true,
        message: { select: { id: true, content: true, createdAt: true } },
      },
    });
    return { days, pending: items.length, items };
  },
};

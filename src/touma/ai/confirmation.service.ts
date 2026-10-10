import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { AiRisk } from './ai.types.js';

/**
 * CONFIRMATION D'ACTION (§42).
 *
 * L'IA ne fait rien de sensible. Elle dépose ici ce qu'elle propose, avec les
 * paramètres exacts qui seront exécutés, et attend qu'un humain valide.
 *
 * Les paramètres sont figés à la création et **relus depuis la base** au moment
 * d'exécuter — jamais repris de la requête de confirmation. Sans cela, il
 * suffirait de confirmer une action en renvoyant d'autres paramètres que ceux
 * lus à l'écran : faire signer un texte et en exécuter un autre.
 */

export interface ConfirmationInput {
  userId: string;
  conversationId?: string | null;
  tool: string;
  riskLevel: AiRisk;
  parameters: Record<string, unknown>;
  /** Résumé lisible, en français : c'est ce que l'humain lit avant de valider. */
  summary: string;
}

export const confirmationService = {
  async create(input: ConfirmationInput) {
    const expiresAt = new Date(Date.now() + env.touma.ai.confirmationTtlMinutes * 60_000);
    return prisma.toumaAiActionConfirmation.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId ?? null,
        tool: input.tool,
        riskLevel: input.riskLevel,
        parameters: input.parameters as object,
        summary: input.summary,
        expiresAt,
      },
      select: { id: true, tool: true, riskLevel: true, summary: true, parameters: true, status: true, expiresAt: true },
    });
  },

  /**
   * Relit une demande en attente et la marque confirmée.
   *
   * Trois refus distincts, et ils ne disent pas la même chose : une demande qui
   * n'est pas la vôtre est introuvable (jamais « interdite » — cela révélerait
   * son existence), une demande expirée est expirée, une demande déjà traitée
   * ne se rejoue pas. Ce dernier point est ce qui empêche qu'un même
   * remboursement soit exécuté deux fois en renvoyant la même confirmation.
   */
  async confirm(userId: string, id: string) {
    const demande = await prisma.toumaAiActionConfirmation.findFirst({ where: { id, userId } });
    if (!demande) throw notFound('Demande de confirmation introuvable.');
    if (demande.status !== 'PENDING') throw badRequest('Cette demande a déjà été traitée.');
    if (demande.expiresAt.getTime() <= Date.now()) {
      await prisma.toumaAiActionConfirmation.update({ where: { id }, data: { status: 'EXPIRED' } });
      throw badRequest('Cette demande a expiré. Relancez l’action pour en obtenir une nouvelle.');
    }
    // `updateMany` avec le statut dans la condition : deux confirmations
    // simultanées ne peuvent pas passer toutes les deux.
    const { count } = await prisma.toumaAiActionConfirmation.updateMany({
      where: { id, userId, status: 'PENDING' },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });
    if (count === 0) throw badRequest('Cette demande a déjà été traitée.');
    return prisma.toumaAiActionConfirmation.findUniqueOrThrow({ where: { id } });
  },

  async reject(userId: string, id: string) {
    const { count } = await prisma.toumaAiActionConfirmation.updateMany({
      where: { id, userId, status: 'PENDING' },
      data: { status: 'REJECTED', rejectedAt: new Date() },
    });
    if (count === 0) throw notFound('Demande de confirmation introuvable ou déjà traitée.');
    return { id, status: 'REJECTED' as const };
  },

  async list(userId: string) {
    return prisma.toumaAiActionConfirmation.findMany({
      where: { userId, status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, tool: true, riskLevel: true, summary: true, parameters: true, expiresAt: true, createdAt: true },
    });
  },

  /** Marque l'exécution effectuée, pour qu'elle ne puisse pas être rejouée. */
  async markExecuted(id: string, resultRef: string | null) {
    await prisma.toumaAiActionConfirmation.update({ where: { id }, data: { executedAt: new Date(), resultRef } });
  },

  /**
   * Vérifie qu'une confirmation autorise bien **cet** outil.
   *
   * Sans ce contrôle, une confirmation obtenue pour « créer un brouillon de
   * demande de devis » servirait à exécuter « rembourser » : l'humain aurait
   * validé une phrase, et le jeton de validation en couvrirait une autre.
   */
  async requireConfirmed(userId: string, id: string, tool: string) {
    const demande = await prisma.toumaAiActionConfirmation.findFirst({ where: { id, userId } });
    if (!demande) throw notFound('Demande de confirmation introuvable.');
    if (demande.tool !== tool) throw forbidden('Cette confirmation ne couvre pas cette action.');
    if (demande.status !== 'CONFIRMED') throw badRequest('Cette action n’a pas été confirmée.');
    if (demande.executedAt) throw badRequest('Cette action a déjà été exécutée.');
    return demande;
  },

  /** Balayage périodique des demandes non traitées. */
  async expireStale(): Promise<number> {
    const { count } = await prisma.toumaAiActionConfirmation.updateMany({
      where: { status: 'PENDING', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED' },
    });
    return count;
  },
};

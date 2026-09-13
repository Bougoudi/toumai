import type { MessageReportReason } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import { paginated, type PageParams } from '../lib/pagination.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * Signalement, blocage et suivi des signaux de risque.
 *
 * Un principe traverse ce fichier : **rien n'est automatique**. Un signalement
 * n'efface pas un message, un signal de risque ne bloque pas un compte, un
 * score ne bannit personne. Ces objets servent à porter une situation devant
 * un humain, qui décide.
 */
export const moderationService = {
  /** Signale un message. Un même utilisateur ne signale qu'une fois. */
  async reportMessage(user: ToumaRequestUser, messageId: string, input: { reason: MessageReportReason; details?: string }) {
    const message = await prisma.toumaMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { participants: { select: { userId: true } } } } },
    });
    // Anti-IDOR : un message hors de mes fils est « introuvable ».
    if (!message || !message.conversation.participants.some((p) => p.userId === user.id)) {
      throw notFound('Message introuvable.');
    }
    if (message.authorId === user.id) throw badRequest('Vous ne pouvez pas signaler votre propre message.');

    const existing = await prisma.toumaMessageReport.findUnique({
      where: { messageId_reporterId: { messageId, reporterId: user.id } },
    });
    if (existing) throw conflict('Ce message est déjà signalé.');

    const report = await prisma.toumaMessageReport.create({
      data: {
        conversationId: message.conversationId,
        messageId,
        reporterId: user.id,
        reason: input.reason,
        details: input.details?.slice(0, 1000) ?? '',
      },
    });
    await audit({
      actorId: user.id,
      action: 'message.report',
      entity: 'ToumaMessage',
      entityId: messageId,
      // Le motif suffit à l'administration ; le contenu du message n'a rien à
      // faire dans le journal.
      metadata: { reason: input.reason, conversationId: message.conversationId },
    });
    return { id: report.id, status: report.status, createdAt: report.createdAt };
  },

  /**
   * Bloque un utilisateur : plus aucun fil ne peut s'ouvrir ni s'alimenter
   * entre les deux comptes. Les fils existants deviennent lecture seule.
   */
  async blockUser(user: ToumaRequestUser, targetId: string, reason?: string) {
    if (targetId === user.id) throw badRequest('Vous ne pouvez pas vous bloquer vous-même.');
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) throw notFound('Utilisateur introuvable.');

    await prisma.toumaUserBlock.upsert({
      where: { blockerId_blockedId: { blockerId: user.id, blockedId: targetId } },
      update: { reason: reason?.slice(0, 300) ?? '' },
      create: { blockerId: user.id, blockedId: targetId, reason: reason?.slice(0, 300) ?? '' },
    });

    // Les conversations communes passent en lecture seule, sans rien effacer.
    const shared = await prisma.toumaConversation.findMany({
      where: {
        AND: [{ participants: { some: { userId: user.id } } }, { participants: { some: { userId: targetId } } }],
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (shared.length > 0) {
      await prisma.toumaConversation.updateMany({ where: { id: { in: shared.map((c) => c.id) } }, data: { status: 'BLOCKED' } });
    }

    await audit({ actorId: user.id, action: 'user.block', entity: 'User', entityId: targetId, metadata: { conversations: shared.length } });
    return { blocked: true, conversations: shared.length };
  },

  /** Lève un blocage ; les fils redeviennent actifs. */
  async unblockUser(user: ToumaRequestUser, targetId: string) {
    const deleted = await prisma.toumaUserBlock.deleteMany({ where: { blockerId: user.id, blockedId: targetId } });
    if (deleted.count === 0) return { blocked: false, restored: 0 };

    // On ne rouvre que si plus aucun blocage ne subsiste dans l'autre sens.
    const reverse = await prisma.toumaUserBlock.findFirst({ where: { blockerId: targetId, blockedId: user.id } });
    let restored = 0;
    if (!reverse) {
      const shared = await prisma.toumaConversation.findMany({
        where: {
          AND: [{ participants: { some: { userId: user.id } } }, { participants: { some: { userId: targetId } } }],
          status: 'BLOCKED',
        },
        select: { id: true },
      });
      if (shared.length > 0) {
        const result = await prisma.toumaConversation.updateMany({ where: { id: { in: shared.map((c) => c.id) } }, data: { status: 'ACTIVE' } });
        restored = result.count;
      }
    }
    await audit({ actorId: user.id, action: 'user.unblock', entity: 'User', entityId: targetId });
    return { blocked: false, restored };
  },

  /** Comptes bloqués par l'utilisateur courant. */
  async listBlocks(userId: string) {
    const blocks = await prisma.toumaUserBlock.findMany({
      where: { blockerId: userId },
      include: { blocked: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { items: blocks.map((b) => ({ id: b.id, user: b.blocked, reason: b.reason, createdAt: b.createdAt })) };
  },

  // ── Administration ────────────────────────────────────────────────────────
  /** File des signalements (administration uniquement). */
  async listReports(user: ToumaRequestUser, query: { status?: 'OPEN' | 'REVIEWED' | 'ACTIONED' | 'DISMISSED'; page: number; limit: number }) {
    if (user.role !== 'ADMIN') throw forbidden('Réservé à l’administration.');
    const page: PageParams = { page: query.page, limit: query.limit, skip: (query.page - 1) * query.limit };
    const where = query.status ? { status: query.status } : {};

    const [rows, total] = await Promise.all([
      prisma.toumaMessageReport.findMany({
        where,
        include: {
          reporter: { select: { id: true, name: true } },
          message: { select: { id: true, body: true, type: true, createdAt: true, author: { select: { id: true, name: true } } } },
          conversation: { select: { id: true, kind: true, subject: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaMessageReport.count({ where }),
    ]);

    return paginated(
      rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        reporter: r.reporter,
        conversation: r.conversation,
        message: { id: r.message.id, type: r.message.type, author: r.message.author, excerpt: r.message.body.slice(0, 280), createdAt: r.message.createdAt },
        createdAt: r.createdAt,
      })),
      total,
      page,
    );
  },

  /** Décision de l'administration sur un signalement. */
  async resolveReport(user: ToumaRequestUser, reportId: string, input: { status: 'REVIEWED' | 'ACTIONED' | 'DISMISSED'; resolution?: string; closeConversation?: boolean }) {
    if (user.role !== 'ADMIN') throw forbidden('Réservé à l’administration.');
    const report = await prisma.toumaMessageReport.findUnique({ where: { id: reportId } });
    if (!report) throw notFound('Signalement introuvable.');

    const updated = await prisma.toumaMessageReport.update({
      where: { id: report.id },
      data: { status: input.status, resolution: input.resolution?.slice(0, 1000) ?? null, reviewedById: user.id, reviewedAt: new Date() },
    });

    if (input.closeConversation) {
      await prisma.toumaConversation.update({ where: { id: report.conversationId }, data: { status: 'BLOCKED' } });
    }

    await audit({
      actorId: user.id,
      action: 'moderation.resolve',
      entity: 'ToumaMessageReport',
      entityId: report.id,
      metadata: { status: input.status, closed: Boolean(input.closeConversation) },
    });
    await notify({
      userId: report.reporterId,
      type: 'MESSAGE_RECEIVED',
      title: 'Votre signalement a été traité',
      body: input.status === 'DISMISSED' ? 'Aucune infraction retenue.' : 'Le signalement a été pris en compte.',
      data: { reportId: report.id },
    });
    return { id: updated.id, status: updated.status };
  },

  /** Signaux de risque ouverts (administration). */
  async listRiskFlags(user: ToumaRequestUser, query: { status?: 'OPEN' | 'CLEARED' | 'CONFIRMED'; page: number; limit: number }) {
    if (user.role !== 'ADMIN') throw forbidden('Réservé à l’administration.');
    const page: PageParams = { page: query.page, limit: query.limit, skip: (query.page - 1) * query.limit };
    const where = { status: query.status ?? 'OPEN' };

    const [rows, total] = await Promise.all([
      prisma.toumaRiskFlag.findMany({
        where,
        include: { conversation: { select: { id: true, kind: true, subject: true } } },
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaRiskFlag.count({ where }),
    ]);

    return paginated(
      rows.map((f) => ({
        id: f.id,
        category: f.category,
        score: f.score,
        excerpt: f.excerpt,
        status: f.status,
        conversation: f.conversation,
        createdAt: f.createdAt,
      })),
      total,
      page,
    );
  },

  /** Classement d'un signal de risque par l'administration. */
  async resolveRiskFlag(user: ToumaRequestUser, flagId: string, status: 'CLEARED' | 'CONFIRMED') {
    if (user.role !== 'ADMIN') throw forbidden('Réservé à l’administration.');
    const flag = await prisma.toumaRiskFlag.findUnique({ where: { id: flagId } });
    if (!flag) throw notFound('Signal introuvable.');
    const updated = await prisma.toumaRiskFlag.update({ where: { id: flag.id }, data: { status } });
    await audit({ actorId: user.id, action: 'moderation.risk_flag', entity: 'ToumaRiskFlag', entityId: flag.id, metadata: { status } });
    return { id: updated.id, status: updated.status };
  },
};

import type { AccountStandingStatus, TrustAppealStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * TOUMA TRUST — sanctions et recours.
 *
 * **Aucune sanction n'est automatique.** Le moteur de confiance signale ; un
 * administrateur décide, et sa décision porte son nom, son horodatage, son
 * motif interne et un motif communiqué à l'intéressé. Une sanction qu'on ne
 * peut pas expliquer est une sanction qu'on ne peut pas contester, et une
 * plateforme qui sanctionne sans recours n'a pas d'infrastructure de confiance :
 * elle a un pouvoir arbitraire.
 *
 * **Le recours est le pendant obligé de la sanction.** Il existe pour tout ce
 * que la confiance décide : un refus de vérification, une restriction, un avis
 * masqué, un score contesté.
 */

/**
 * Actions qu'une sanction peut retirer. Une union fermée plutôt que des
 * chaînes libres : une faute de frappe dans un appel à `can()` rendrait
 * silencieusement « autorisé » quelque chose qui ne l'est pas.
 */
export type StandingAction = 'SELL' | 'PUBLISH_PRODUCT' | 'SUBMIT_QUOTE' | 'BUY' | 'MESSAGE' | 'LOGIN';

/** Ce qu'un statut retire réellement. Publié : l'intéressé doit le savoir. */
export const STANDING_EFFECTS: Record<AccountStandingStatus, StandingAction[]> = {
  ACTIVE: [],
  // Un compte restreint continue d'acheter : le priver de tout punirait
  // l'acheteur pour ce qu'a fait le vendeur qu'il est par ailleurs.
  RESTRICTED: ['SELL', 'PUBLISH_PRODUCT', 'SUBMIT_QUOTE'],
  SUSPENDED: ['SELL', 'PUBLISH_PRODUCT', 'SUBMIT_QUOTE', 'BUY', 'MESSAGE'],
  BANNED: ['SELL', 'PUBLISH_PRODUCT', 'SUBMIT_QUOTE', 'BUY', 'MESSAGE', 'LOGIN'],
};

export const standingService = {
  /** État de confiance d'un compte. `ACTIVE` par défaut : l'absence de sanction. */
  async get(userId: string) {
    const row = await prisma.toumaAccountStanding.findUnique({ where: { userId } });
    if (!row) {
      return {
        status: 'ACTIVE' as AccountStandingStatus,
        publicReason: null,
        expiresAt: null,
        decidedAt: null as Date | null,
        effects: [] as StandingAction[],
      };
    }
    // Une restriction temporaire échue ne restreint plus rien. On le calcule à
    // la lecture plutôt que d'attendre un balayage : un vendeur dont la
    // sanction expire à minuit ne doit pas attendre le réveil d'un cron.
    const echue = row.expiresAt !== null && row.expiresAt.getTime() <= Date.now();
    const status = echue ? ('ACTIVE' as AccountStandingStatus) : row.status;
    return {
      status,
      publicReason: echue ? null : row.publicReason,
      expiresAt: row.expiresAt,
      decidedAt: row.decidedAt,
      effects: STANDING_EFFECTS[status],
    };
  },

  /** `true` si le compte peut faire l'action demandée. */
  async can(userId: string, action: StandingAction) {
    const standing = await this.get(userId);
    return !standing.effects.includes(action);
  },

  /**
   * Décision d'administration. Le motif public est **obligatoire** dès qu'on
   * sort de `ACTIVE` : sans lui, l'intéressé ne peut ni comprendre ni contester.
   */
  async decide(
    admin: ToumaRequestUser,
    userId: string,
    input: {
      status: AccountStandingStatus;
      reason?: string;
      publicReason?: string;
      evidence?: Record<string, unknown>;
      expiresAt?: Date | null;
    },
  ) {
    if (admin.role !== 'ADMIN') throw forbidden('Décision réservée à l’administration TOUMA.');
    if (admin.id === userId) throw badRequest('Un administrateur ne peut pas se sanctionner lui-même.');
    if (input.status !== 'ACTIVE' && !input.publicReason?.trim()) {
      throw badRequest('Un motif communiqué à l’intéressé est obligatoire : sans lui, la décision n’est pas contestable.');
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, toumaRole: true } });
    if (!user) throw notFound('Compte introuvable.');

    const data = {
      status: input.status,
      reason: input.reason ?? null,
      publicReason: input.publicReason ?? null,
      evidence: (input.evidence ?? {}) as Prisma.InputJsonValue,
      actorId: admin.id,
      expiresAt: input.expiresAt ?? null,
      decidedAt: new Date(),
    };

    const row = await prisma.toumaAccountStanding.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    await Promise.all([
      audit({
        actorId: admin.id,
        action: `trust.standing.${input.status.toLowerCase()}`,
        entity: 'ToumaAccountStanding',
        entityId: row.id,
        metadata: { userId, reason: input.reason ?? null, expiresAt: input.expiresAt ?? null },
      }),
      notify({
        userId,
        type: input.status === 'ACTIVE' ? 'TRUST_STANDING_RESTORED' : 'TRUST_STANDING_CHANGED',
        title: input.status === 'ACTIVE' ? 'Votre compte est rétabli' : 'Votre compte est restreint',
        body:
          input.status === 'ACTIVE'
            ? 'Les restrictions sur votre compte ont été levées.'
            : `${input.publicReason} — vous pouvez contester cette décision depuis votre espace.`,
        data: { status: input.status },
      }),
    ]);

    return { status: row.status, publicReason: row.publicReason, expiresAt: row.expiresAt, effects: STANDING_EFFECTS[row.status] };
  },
};

export const appealService = {
  /** Dépôt d'un recours. Un seul en cours par sujet, pour éviter le harcèlement de file. */
  async submit(
    user: ToumaRequestUser,
    input: { subjectType: string; subjectId?: string; message: string; evidence?: Array<{ kind: string; url: string }> },
  ) {
    const ouvert = await prisma.toumaTrustAppeal.findFirst({
      where: {
        userId: user.id,
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
      },
    });
    if (ouvert) throw conflict('Un recours est déjà en cours d’examen sur ce sujet.');

    const appeal = await prisma.toumaTrustAppeal.create({
      data: {
        userId: user.id,
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        message: input.message,
        evidence: (input.evidence ?? []) as unknown as Prisma.InputJsonValue,
      },
    });
    await audit({
      actorId: user.id,
      action: 'trust.appeal.submit',
      entity: 'ToumaTrustAppeal',
      entityId: appeal.id,
      metadata: { subjectType: input.subjectType },
    });
    return { id: appeal.id, status: appeal.status, createdAt: appeal.createdAt };
  },

  /** Recours du compte connecté. */
  async mine(user: ToumaRequestUser) {
    const items = await prisma.toumaTrustAppeal.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        subjectType: true,
        subjectId: true,
        status: true,
        message: true,
        resolution: true,
        createdAt: true,
        resolvedAt: true,
      },
    });
    return { items };
  },

  /** File des recours (administration). */
  async queue(status: TrustAppealStatus | undefined, page: { skip: number; take: number }) {
    const where: Prisma.ToumaTrustAppealWhereInput = status
      ? { status }
      : { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } };
    const [items, total] = await Promise.all([
      prisma.toumaTrustAppeal.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
        skip: page.skip,
        take: page.take,
      }),
      prisma.toumaTrustAppeal.count({ where }),
    ]);
    return { items, total };
  },

  /**
   * Décision sur un recours. Toujours motivée : un recours rejeté sans un mot
   * vaut moins qu'un recours impossible — il fait croire à un examen.
   */
  async decide(admin: ToumaRequestUser, appealId: string, decision: 'APPROVED' | 'REJECTED', resolution: string) {
    if (admin.role !== 'ADMIN') throw forbidden('Décision réservée à l’administration TOUMA.');
    if (!resolution.trim()) throw badRequest('Une décision sur un recours doit être motivée.');

    const appeal = await prisma.toumaTrustAppeal.findUnique({ where: { id: appealId } });
    if (!appeal) throw notFound('Recours introuvable.');
    if (appeal.status === 'APPROVED' || appeal.status === 'REJECTED') throw conflict('Ce recours a déjà été tranché.');

    const updated = await prisma.toumaTrustAppeal.update({
      where: { id: appealId },
      data: { status: decision, reviewerId: admin.id, resolution, resolvedAt: new Date() },
    });

    await Promise.all([
      audit({
        actorId: admin.id,
        action: `trust.appeal.${decision.toLowerCase()}`,
        entity: 'ToumaTrustAppeal',
        entityId: appealId,
        metadata: { subjectType: appeal.subjectType, subjectId: appeal.subjectId },
      }),
      notify({
        userId: appeal.userId,
        type: decision === 'APPROVED' ? 'TRUST_APPEAL_APPROVED' : 'TRUST_APPEAL_REJECTED',
        title: decision === 'APPROVED' ? 'Votre recours est accepté' : 'Votre recours est rejeté',
        body: resolution,
        data: { appealId },
      }),
    ]);
    return { id: updated.id, status: updated.status, resolution: updated.resolution, resolvedAt: updated.resolvedAt };
  },
};

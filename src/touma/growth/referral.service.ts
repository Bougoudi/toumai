import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { riskService } from '../risk/risk.service.js';

/**
 * TOUMA GROWTH — parrainage.
 *
 * **Un programme de parrainage est une machine à fabriquer de la fraude**
 * s'il récompense la simple inscription : il suffit alors de créer des comptes.
 * Trois choix structurent ce module :
 *
 * 1. **La récompense suit une commande terminée**, pas une inscription. Un
 *    faux compte ne rapporte rien tant qu'il n'a pas acheté, reçu et payé.
 * 2. **Un compte n'est parrainé qu'une fois**, et la contrainte est en base.
 *    Dans le service seul, elle ne tiendrait pas sous deux inscriptions
 *    simultanées.
 * 3. **Les liens évidents sont refusés** — soi-même, un téléphone partagé —
 *    et un signal est consigné pour le moteur de risque V21, qui décide. Le
 *    parrainage ne prononce aucune sanction : il signale.
 *
 * **Fermé par défaut.** `TOUMA_GROWTH_REFERRALS_ENABLED` vaut `false` tant que
 * personne n'a décidé de l'exploiter : un levier de croissance dont le mode
 * d'échec est la fraude ne s'ouvre pas parce qu'il a été écrit.
 */

/** Alphabet sans caractères confondables : ni O/0, ni I/1/L. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function tirerCode(longueur = 8): string {
  let out = '';
  const octets = new Uint8Array(longueur);
  globalThis.crypto.getRandomValues(octets);
  for (const o of octets) out += ALPHABET[o % ALPHABET.length];
  return out;
}

export const referralService = {
  /** Code du compte, créé à la première demande. Stable ensuite. */
  async myCode(userId: string) {
    if (!env.touma.growth.referralsEnabled) {
      throw badRequest('Le parrainage n’est pas activé sur cette place de marché.');
    }
    const existant = await prisma.toumaReferralCode.findUnique({ where: { userId } });
    if (existant) return existant;

    // Collision possible mais improbable ; on réessaie plutôt que d'échouer.
    for (let essai = 0; essai < 5; essai += 1) {
      try {
        return await prisma.toumaReferralCode.create({ data: { userId, code: tirerCode() } });
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002') throw err;
      }
    }
    throw badRequest('Code de parrainage indisponible. Réessayez.');
  },

  /**
   * Enregistre un parrainage à l'inscription.
   *
   * Ne lève jamais : un code de parrainage erroné ne doit pas empêcher
   * quelqu'un de créer son compte. Le parrainage échoue, l'inscription non.
   */
  async register(refereeId: string, code: string | undefined): Promise<void> {
    if (!env.touma.growth.referralsEnabled || !code) return;
    try {
      const parrainage = await prisma.toumaReferralCode.findUnique({
        where: { code: code.trim().toUpperCase() },
        select: { userId: true },
      });
      if (!parrainage) return;

      // Auto-parrainage : refusé, et consigné. Le consigner permet de voir
      // qu'on a essayé, ce qu'un simple refus silencieux perdrait.
      if (parrainage.userId === refereeId) {
        await riskService.recordSignal(refereeId, 'REFERRAL_SELF', {}).catch(() => undefined);
        return;
      }

      const [parrain, filleul] = await Promise.all([
        prisma.user.findUnique({ where: { id: parrainage.userId }, select: { phone: true } }),
        prisma.user.findUnique({ where: { id: refereeId }, select: { phone: true } }),
      ]);

      // Téléphone partagé : le seul lien que TOUMA connaisse de façon fiable.
      // Ni IP ni empreinte d'appareil — ils ne sont pas collectés, et la
      // minimisation des données tranche dans ce sens.
      const lienEvident = Boolean(parrain?.phone && filleul?.phone && parrain.phone === filleul.phone);

      await prisma.toumaReferral.create({
        data: {
          referrerId: parrainage.userId,
          refereeId,
          status: lienEvident ? 'REJECTED' : 'REGISTERED',
          rejectionReason: lienEvident ? 'SHARED_PHONE' : null,
        },
      });

      if (lienEvident) {
        await riskService.recordSignal(refereeId, 'REFERRAL_LINKED_ACCOUNTS', { referrerId: parrainage.userId }).catch(() => undefined);
      }
    } catch (err) {
      // Y compris une violation d'unicité : ce compte était déjà parrainé.
      logger.warn('Parrainage non enregistré', { refereeId, err: String(err) });
    }
  },

  /**
   * Qualifie un parrainage quand le filleul termine sa première commande.
   *
   * `QUALIFIED`, pas `REWARDED` : la récompense reste une décision
   * d'exploitation. Verser automatiquement des points supposerait un barème
   * que personne n'a arrêté, et un barème inventé coûte de l'argent réel.
   */
  async qualifyFromOrder(orderId: string, buyerId: string): Promise<void> {
    if (!env.touma.growth.referralsEnabled) return;
    try {
      const parrainage = await prisma.toumaReferral.findUnique({ where: { refereeId: buyerId } });
      if (!parrainage || parrainage.status !== 'REGISTERED') return;

      // Une seule commande terminée suffit, mais elle doit être **terminée** :
      // une commande payée puis annulée ne qualifie personne.
      const commande = await prisma.toumaOrder.findFirst({
        where: { id: orderId, buyerId, status: 'COMPLETED' },
        select: { id: true },
      });
      if (!commande) return;

      await prisma.toumaReferral.updateMany({
        where: { id: parrainage.id, status: 'REGISTERED' },
        data: { status: 'QUALIFIED', qualifyingOrderId: orderId, qualifiedAt: new Date() },
      });
      await audit({
        actorId: buyerId,
        action: 'referral.qualified',
        entity: 'ToumaReferral',
        entityId: parrainage.id,
        metadata: { orderId },
      });
    } catch (err) {
      logger.error('Parrainage non qualifié', { orderId, err: String(err) });
    }
  },

  /**
   * Vue du parrain.
   *
   * **Aucune donnée personnelle du filleul.** Ni nom, ni adresse électronique,
   * ni ce qu'il a acheté : quelqu'un qui a accepté une invitation n'a pas
   * accepté d'être suivi. Le parrain voit un décompte et un statut.
   */
  async mine(userId: string) {
    if (!env.touma.growth.referralsEnabled) {
      return { enabled: false as const, code: null, invited: 0, qualified: 0, rewarded: 0, rejected: 0 };
    }
    const [code, parrainages] = await Promise.all([
      prisma.toumaReferralCode.findUnique({ where: { userId }, select: { code: true } }),
      prisma.toumaReferral.groupBy({ by: ['status'], where: { referrerId: userId }, _count: true }),
    ]);
    const compte = (statut: string) => parrainages.find((p) => p.status === statut)?._count ?? 0;
    return {
      enabled: true as const,
      code: code?.code ?? null,
      invited: parrainages.reduce((acc, p) => acc + p._count, 0),
      qualified: compte('QUALIFIED'),
      rewarded: compte('REWARDED'),
      // Le motif d'écartement n'est pas rendu : il dirait au parrain quelle
      // tentative a été repérée, donc comment la déguiser la prochaine fois.
      rejected: compte('REJECTED'),
    };
  },

  /** File des parrainages qualifiés en attente de décision (administration). */
  async pendingRewards(page: { skip: number; take: number }) {
    const where = { status: 'QUALIFIED' as const };
    const [items, total] = await Promise.all([
      prisma.toumaReferral.findMany({
        where,
        include: {
          referrer: { select: { id: true, name: true, email: true } },
          referee: { select: { id: true, name: true } },
        },
        orderBy: { qualifiedAt: 'asc' },
        skip: page.skip,
        take: page.take,
      }),
      prisma.toumaReferral.count({ where }),
    ]);
    return { items, total };
  },

  /** Marque un parrainage comme récompensé. Audité, jamais automatique. */
  async markRewarded(adminId: string, referralId: string, note: string) {
    const parrainage = await prisma.toumaReferral.findUnique({ where: { id: referralId } });
    if (!parrainage) throw notFound('Parrainage introuvable.');
    if (parrainage.status !== 'QUALIFIED') throw badRequest('Seul un parrainage qualifié peut être récompensé.');

    const updated = await prisma.toumaReferral.update({
      where: { id: referralId },
      data: { status: 'REWARDED', rewardedAt: new Date() },
    });
    await audit({
      actorId: adminId,
      action: 'referral.rewarded',
      entity: 'ToumaReferral',
      entityId: referralId,
      metadata: { note },
    });
    return updated;
  },
};

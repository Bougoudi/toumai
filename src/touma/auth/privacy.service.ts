import { prisma } from '../../db/prisma.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

/**
 * EXPORT ET SUPPRESSION DE COMPTE (V25 §66-68).
 *
 * Deux principes gouvernent ce fichier, et ils se contredisent en apparence :
 * une personne doit pouvoir récupérer ses données et faire effacer son compte ;
 * une place de marché doit conserver ce que la comptabilité, la fiscalité et
 * les litiges exigent. La consigne tranche explicitement : « Ne jamais
 * supprimer automatiquement les données financières/audit légalement
 * nécessaires », « Ne pas supprimer aveuglément toutes les données ».
 *
 * La réponse n'est donc pas la suppression mais **l'anonymisation** : les
 * commandes, paiements, écritures et documents restent, détachés de l'identité.
 * Un vendeur gardera la preuve de ce qu'il a vendu et à quelles conditions ;
 * il n'aura plus le nom de l'acheteur.
 *
 * Ce que ce module ne fait pas, et qui reste à décider : la durée de
 * conservation légale au Tchad. Elle n'est pas codée ici parce que personne
 * dans ce dépôt ne la connaît, et un délai inventé serait pire qu'un délai
 * absent.
 */

/** Délai de réflexion avant exécution, en jours. */
export const DELAI_REFLEXION_JOURS = 30;

/** Statuts de commande considérés comme « en cours ». */
const COMMANDES_EN_COURS = ['PENDING', 'PAID', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED'] as const;

/**
 * Ce qui empêche une suppression, avec le motif.
 *
 * Chaque blocage est une obligation réelle, pas une précaution : effacer
 * l'identité d'un acheteur dont le colis est en route rendrait la livraison
 * impossible, et celle d'un vendeur en attente de versement effacerait le
 * destinataire de l'argent.
 */
export async function blocages(userId: string): Promise<string[]> {
  const motifs: string[] = [];

  const commandes = await prisma.toumaOrder.count({
    where: { buyerId: userId, status: { in: [...COMMANDES_EN_COURS] } },
  });
  if (commandes > 0) motifs.push(`${commandes} commande(s) en cours : attendez leur livraison ou leur annulation.`);

  const boutiques = await prisma.toumaStore.findMany({ where: { ownerId: userId }, select: { id: true } });
  if (boutiques.length > 0) {
    const ventes = await prisma.toumaOrder.count({
      where: { storeId: { in: boutiques.map((b) => b.id) }, status: { in: [...COMMANDES_EN_COURS] } },
    });
    if (ventes > 0) motifs.push(`${ventes} vente(s) en cours dans vos boutiques : elles doivent être honorées ou annulées.`);

    const versements = await prisma.toumaSellerPayout.count({
      where: { storeId: { in: boutiques.map((b) => b.id) }, status: { in: ['PENDING', 'PROCESSING'] } },
    });
    if (versements > 0) motifs.push(`${versements} versement(s) en attente : effacer le compte effacerait le destinataire des fonds.`);
  }

  const litiges = await prisma.toumaDispute.count({
    where: { openedById: userId, status: { notIn: ['RESOLVED_BUYER', 'RESOLVED_SELLER', 'REJECTED', 'CLOSED'] } },
  });
  if (litiges > 0) motifs.push(`${litiges} litige(s) ouvert(s) : leur instruction a besoin des parties.`);

  return motifs;
}

/**
 * Données personnelles d'un compte, rendues telles qu'elles sont détenues.
 *
 * Aucune donnée d'autrui n'y figure : les messages reçus, par exemple, sont
 * rendus sans l'identité de leur auteur. Un export ne doit pas devenir un
 * moyen commode d'obtenir les coordonnées des personnes avec qui on a échangé.
 */
export const privacyService = {
  async export(userId: string) {
    const compte = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, phone: true, countryCode: true, locale: true,
        toumaRole: true, status: true, createdAt: true,
      },
    });
    if (!compte) throw notFound('Compte introuvable.');

    const [adresses, commandes, avis, boutiques, fidelite, preferences, demandes] = await Promise.all([
      prisma.toumaAddress.findMany({
        where: { userId },
        select: { fullName: true, phone: true, line1: true, line2: true, city: true, province: true, countryCode: true, createdAt: true },
      }),
      prisma.toumaOrder.findMany({
        where: { buyerId: userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, status: true, currency: true, subtotal: true, shippingTotal: true, total: true, createdAt: true,
          items: { select: { titleSnapshot: true, quantity: true, unitPrice: true } },
        },
      }),
      prisma.toumaReview.findMany({
        where: { authorId: userId },
        select: { rating: true, comment: true, createdAt: true, productId: true },
      }),
      prisma.toumaStore.findMany({
        where: { ownerId: userId },
        select: { id: true, name: true, slug: true, countryCode: true, status: true, createdAt: true },
      }),
      prisma.toumaLoyaltyAccount.findMany({ where: { userId }, select: { balance: true, lifetimePoints: true, tier: true } }),
      prisma.toumaNotificationPreference.findMany({ where: { userId }, select: { category: true, inApp: true, email: true } }),
      prisma.toumaAccountDeletionRequest.findMany({
        where: { userId },
        select: { status: true, requestedAt: true, scheduledFor: true, cancelledAt: true, completedAt: true },
      }),
    ]);

    await audit({ actorId: userId, action: 'privacy.export', entity: 'User', entityId: userId });

    return {
      generatedAt: new Date().toISOString(),
      account: compte,
      addresses: adresses,
      orders: commandes.map((c) => ({
        ...c,
        subtotal: c.subtotal.toString(),
        shippingTotal: c.shippingTotal.toString(),
        total: c.total.toString(),
        items: c.items.map((i) => ({ ...i, unitPrice: i.unitPrice.toString() })),
      })),
      reviews: avis,
      stores: boutiques,
      loyalty: fidelite,
      notificationPreferences: preferences,
      deletionRequests: demandes,
      /**
       * Dire ce qui n'est **pas** dans l'export vaut autant que ce qui y est.
       * Un export muet sur ses limites laisse croire qu'il est exhaustif.
       */
      notIncluded: [
        'Les messages reçus d’autres personnes : ils appartiennent aussi à leur auteur.',
        'Les journaux techniques et d’audit, conservés pour la sécurité et la comptabilité.',
        'Les pièces de vérification d’identité, conservées sous obligation réglementaire.',
      ],
    };
  },

  /** Demande de suppression : vérifiée, différée, annulable. */
  async requestDeletion(userId: string, input: { reason?: string }, ctx: { ip?: string | null; userAgent?: string | null }) {
    const existante = await prisma.toumaAccountDeletionRequest.findFirst({ where: { userId, status: 'PENDING' } });
    if (existante) throw conflict('Une demande de suppression est déjà en cours.');

    const motifs = await blocages(userId);
    if (motifs.length > 0) {
      // La demande refusée est enregistrée : savoir que quelqu'un a essayé de
      // partir, et ce qui l'en a empêché, vaut mieux qu'un refus sans trace.
      await prisma.toumaAccountDeletionRequest.create({
        data: { userId, status: 'CANCELLED', scheduledFor: new Date(), cancelledAt: new Date(), blockers: motifs, reason: input.reason ?? null, ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
      });
      throw conflict(`Suppression impossible pour l’instant : ${motifs.join(' ')}`);
    }

    const echeance = new Date(Date.now() + DELAI_REFLEXION_JOURS * 24 * 3600 * 1000);
    const demande = await prisma.toumaAccountDeletionRequest.create({
      data: { userId, scheduledFor: echeance, reason: input.reason ?? null, ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
    });

    await audit({ actorId: userId, action: 'privacy.deletion_requested', entity: 'User', entityId: userId, ip: ctx.ip, metadata: { scheduledFor: echeance.toISOString() } });

    return {
      id: demande.id,
      scheduledFor: echeance.toISOString(),
      cancellable: true,
      note:
        `Votre compte sera anonymisé le ${echeance.toISOString().slice(0, 10)}. Vous pouvez annuler jusque-là. ` +
        'Vos commandes, paiements et écritures comptables sont conservés sans votre identité : la loi et la comptabilité l’exigent, et vos vendeurs en ont besoin.',
    };
  },

  async cancelDeletion(userId: string) {
    const demande = await prisma.toumaAccountDeletionRequest.findFirst({ where: { userId, status: 'PENDING' } });
    if (!demande) throw notFound('Aucune demande de suppression en cours.');
    await prisma.toumaAccountDeletionRequest.update({
      where: { id: demande.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await audit({ actorId: userId, action: 'privacy.deletion_cancelled', entity: 'User', entityId: userId });
    return { cancelled: true };
  },

  async pendingDeletion(userId: string) {
    const demande = await prisma.toumaAccountDeletionRequest.findFirst({
      where: { userId, status: 'PENDING' },
      select: { id: true, requestedAt: true, scheduledFor: true },
    });
    return demande ? { ...demande, cancellable: true } : null;
  },

  /**
   * Anonymise un compte dont le délai est écoulé.
   *
   * Ce qui **reste** : commandes, paiements, écritures, documents, journal
   * d'audit. Ce sont des faits commerciaux et comptables ; ils ne
   * disparaissent pas parce qu'une des parties s'en va.
   *
   * Ce qui **part** : l'identité (nom, courriel, téléphone), les adresses, le
   * panier, les favoris, les préférences, les mémoires d'assistance. Et toutes
   * les sessions, immédiatement.
   *
   * L'identifiant du compte est conservé. Le remplacer casserait chaque
   * référence `SetNull` déjà posée et transformerait une anonymisation en
   * perte de données pour les autres.
   */
  async anonymise(userId: string): Promise<void> {
    const marque = `supprime-${userId.slice(-8)}`;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          name: 'Compte supprimé',
          email: `${marque}@supprime.invalid`,
          phone: null,
          status: 'DELETED',
          // Coupe immédiatement tout jeton d'accès déjà émis.
          tokenVersion: { increment: 1 },
        },
      });

      await tx.toumaRefreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.toumaAddress.deleteMany({ where: { userId } });
      await tx.toumaCart.deleteMany({ where: { userId } });
      await tx.toumaFavorite.deleteMany({ where: { userId } });
      await tx.toumaNotification.deleteMany({ where: { userId } });
      await tx.toumaNotificationPreference.deleteMany({ where: { userId } });
      await tx.toumaAiMemory.deleteMany({ where: { userId } });
      await tx.toumaSavedReply.deleteMany({ where: { ownerId: userId } });

      await tx.toumaAccountDeletionRequest.updateMany({
        where: { userId, status: 'PENDING' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    });

    await audit({ actorId: null, action: 'privacy.deletion_completed', entity: 'User', entityId: userId });
  },

  /**
   * Exécute les suppressions arrivées à échéance.
   *
   * Appelée par l'entretien périodique. Les blocages sont **revérifiés** : une
   * commande a pu naître pendant le délai de réflexion, et l'anonymiser
   * rendrait sa livraison impossible.
   */
  async runDueDeletions(maintenant = new Date()): Promise<number> {
    const dues = await prisma.toumaAccountDeletionRequest.findMany({
      where: { status: 'PENDING', scheduledFor: { lte: maintenant } },
      select: { id: true, userId: true },
      take: 100,
    });

    let faites = 0;
    for (const demande of dues) {
      const motifs = await blocages(demande.userId);
      if (motifs.length > 0) {
        // On ne supprime pas, et on ne fait pas non plus semblant : la demande
        // reste en attente avec ce qui la bloque.
        await prisma.toumaAccountDeletionRequest.update({ where: { id: demande.id }, data: { blockers: motifs } });
        continue;
      }
      await this.anonymise(demande.userId);
      faites += 1;
    }
    return faites;
  },
};

export { badRequest };

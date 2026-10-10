import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

/**
 * TOUMA GROWTH — ventes flash.
 *
 * **Le seul risque qui compte ici est la survente.** Annoncer cent unités à
 * prix cassé et en vendre cent trente, c'est devoir annuler trente commandes
 * déjà payées — et perdre trente acheteurs qui avaient eu raison de faire
 * confiance. Une vente flash ratée coûte plus cher que pas de vente flash.
 *
 * Trois protections, et aucune n'est une vérification dans le service :
 *
 * 1. **La réservation est un `UPDATE` conditionnel.** `reserved` n'est jamais
 *    lu puis réécrit : la condition `reserved + q <= quantityLimit` est dans la
 *    requête. Zéro ligne modifiée signifie « il n'en reste pas assez », et deux
 *    acheteurs simultanés ne peuvent pas prendre la même dernière unité.
 * 2. **La limite par acheteur est une contrainte d'unicité en base.** Dans un
 *    service, elle ne tiendrait pas quand le même acheteur ouvre deux onglets.
 * 3. **Le stock réel est décrémenté par le tunnel de commande existant**, qui
 *    porte déjà sa propre garde `quantity >= q`. La vente flash borne ce qui
 *    est *offert au prix réduit* ; elle ne remplace pas le stock.
 *
 * **Fermé par défaut** (`TOUMA_GROWTH_FLASH_SALES_ENABLED`). Un levier dont le
 * mode d'échec est d'annuler des commandes payées ne s'ouvre pas parce qu'il a
 * été écrit.
 */

export interface FlashSaleView {
  id: string;
  name: string;
  productId: string;
  price: string;
  currency: string;
  startsAt: Date;
  endsAt: Date;
  quantityLimit: number;
  /** Unités encore disponibles à ce prix. Jamais négatif. */
  remaining: number;
  perUserLimit: number;
}

function vue(sale: {
  id: string;
  name: string;
  productId: string;
  price: Prisma.Decimal;
  currency: string;
  startsAt: Date;
  endsAt: Date;
  quantityLimit: number;
  reserved: number;
  perUserLimit: number;
}): FlashSaleView {
  return {
    id: sale.id,
    name: sale.name,
    productId: sale.productId,
    price: sale.price.toString(),
    currency: sale.currency,
    startsAt: sale.startsAt,
    endsAt: sale.endsAt,
    quantityLimit: sale.quantityLimit,
    remaining: Math.max(0, sale.quantityLimit - sale.reserved),
    perUserLimit: sale.perUserLimit,
  };
}

export const flashSaleService = {
  /** Ventes flash en cours sur un produit. Lecture publique. */
  async activeFor(productId: string): Promise<FlashSaleView | null> {
    if (!env.touma.growth.flashSalesEnabled) return null;
    const maintenant = new Date();
    const sale = await prisma.toumaFlashSale.findFirst({
      where: {
        productId,
        status: 'ACTIVE',
        startsAt: { lte: maintenant },
        endsAt: { gte: maintenant },
      },
      orderBy: { price: 'asc' },
    });
    if (!sale) return null;
    // Une vente épuisée n'est plus une offre : la rendre laisserait croire à
    // un prix qu'on ne peut plus obtenir.
    if (sale.reserved >= sale.quantityLimit) return null;
    return vue(sale);
  },

  /**
   * Réserve des unités pour un acheteur.
   *
   * Rend `null` quand la réservation n'a pas pu être faite — épuisée, limite
   * atteinte, vente terminée. L'appelant traite alors la commande au prix
   * normal plutôt que d'échouer : un acheteur arrivé trop tard doit pouvoir
   * acheter, simplement pas à ce prix.
   */
  async reserve(
    flashSaleId: string,
    userId: string,
    quantity: number,
  ): Promise<{ price: Prisma.Decimal; currency: string } | null> {
    if (!env.touma.growth.flashSalesEnabled || quantity <= 0) return null;
    try {
      return await prisma.$transaction(async (tx) => {
        const maintenant = new Date();
        const sale = await tx.toumaFlashSale.findUnique({ where: { id: flashSaleId } });
        if (!sale) return null;
        if (sale.status !== 'ACTIVE' || sale.startsAt > maintenant || sale.endsAt < maintenant) return null;
        if (sale.perUserLimit > 0 && quantity > sale.perUserLimit) return null;

        // 1. Réservation conditionnelle. La condition est dans le SQL : deux
        //    acheteurs simultanés ne peuvent pas prendre la même dernière unité.
        const pris = await tx.$executeRaw`
          UPDATE touma_flash_sales
             SET reserved = reserved + ${quantity}, "updatedAt" = now()
           WHERE id = ${flashSaleId}
             AND status = 'ACTIVE'
             AND (reserved + ${quantity}) <= "quantityLimit"`;
        if (pris === 0) return null;

        // 2. Limite par acheteur : l'unicité en base tranche, y compris entre
        //    deux onglets du même acheteur. L'échec annule la transaction,
        //    donc la réservation faite juste au-dessus.
        await tx.toumaFlashSaleClaim.create({ data: { flashSaleId, userId, quantity } });

        return { price: sale.price, currency: sale.currency };
      });
    } catch (err) {
      // P2002 : ce compte a déjà réservé. Ce n'est pas une panne, c'est la
      // limite qui fonctionne — et l'annulation de la transaction a rendu
      // l'unité réservée juste au-dessus.
      if ((err as { code?: string }).code !== 'P2002') {
        logger.error('Réservation de vente flash impossible', { flashSaleId, err: String(err) });
      }
      return null;
    }
  },

  /**
   * Libère une réservation quand la commande ne s'est pas faite.
   *
   * Sans cela, un panier abandonné retirerait des unités de la vente pour
   * toujours — et la vente afficherait « épuisée » alors qu'il reste du stock.
   */
  async release(flashSaleId: string, userId: string): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        const claim = await tx.toumaFlashSaleClaim.findUnique({
          where: { flashSaleId_userId: { flashSaleId, userId } },
        });
        if (!claim || claim.orderId) return;
        await tx.toumaFlashSaleClaim.delete({ where: { id: claim.id } });
        // `GREATEST(0, …)` : même si un décompte avait dérivé, on ne descend
        // jamais sous zéro — une réservation négative ferait vendre plus que
        // la limite, exactement ce qu'on cherche à empêcher.
        await tx.$executeRaw`
          UPDATE touma_flash_sales
             SET reserved = GREATEST(0, reserved - ${claim.quantity}), "updatedAt" = now()
           WHERE id = ${flashSaleId}`;
      });
    } catch (err) {
      logger.error('Réservation de vente flash non libérée', { flashSaleId, err: String(err) });
    }
  },

  /** Rattache une réservation à la commande qui l'a consommée. */
  async attachOrder(flashSaleId: string, userId: string, orderId: string): Promise<void> {
    await prisma.toumaFlashSaleClaim
      .updateMany({ where: { flashSaleId, userId, orderId: null }, data: { orderId } })
      .catch((err) => logger.error('Réservation non rattachée', { flashSaleId, err: String(err) }));
  },

  /** Création par un vendeur. En brouillon : publier est un second geste. */
  async create(
    userId: string,
    role: string,
    input: {
      storeId: string;
      productId: string;
      name: string;
      price: string;
      startsAt: Date;
      endsAt: Date;
      quantityLimit: number;
      perUserLimit: number;
    },
  ) {
    if (!env.touma.growth.flashSalesEnabled) {
      throw badRequest('Les ventes flash ne sont pas activées sur cette place de marché.');
    }
    const store = await prisma.toumaStore.findUnique({
      where: { id: input.storeId },
      select: { id: true, ownerId: true },
    });
    if (!store) throw notFound('Boutique introuvable.');
    if (store.ownerId !== userId && role !== 'ADMIN') throw notFound('Boutique introuvable.');

    const produit = await prisma.toumaProduct.findFirst({
      where: { id: input.productId, storeId: input.storeId },
      select: { id: true, price: true, currency: true },
    });
    if (!produit) throw notFound('Produit introuvable dans cette boutique.');

    const prix = new Prisma.Decimal(input.price);
    // Une « vente flash » au prix normal ou supérieur n'est pas une vente
    // flash : c'est une annonce trompeuse.
    if (prix.greaterThanOrEqualTo(produit.price)) {
      throw badRequest('Le prix d’une vente flash doit être inférieur au prix courant du produit.');
    }
    if (input.endsAt <= input.startsAt) throw badRequest('La fin d’une vente flash doit suivre son début.');
    if (input.quantityLimit <= 0) throw badRequest('Une vente flash porte sur au moins une unité.');

    const chevauche = await prisma.toumaFlashSale.findFirst({
      where: {
        productId: input.productId,
        status: { in: ['SCHEDULED', 'ACTIVE'] },
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
      },
      select: { id: true },
    });
    // Deux ventes qui se chevauchent sur le même produit donneraient deux prix
    // différents au même instant.
    if (chevauche) throw conflict('Une vente flash couvre déjà cette période pour ce produit.');

    const sale = await prisma.toumaFlashSale.create({
      data: {
        storeId: input.storeId,
        productId: input.productId,
        name: input.name,
        price: prix,
        currency: produit.currency,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        quantityLimit: input.quantityLimit,
        perUserLimit: input.perUserLimit,
        status: 'DRAFT',
        createdById: userId,
      },
    });
    await audit({
      actorId: userId,
      action: 'flashSale.create',
      entity: 'ToumaFlashSale',
      entityId: sale.id,
      metadata: { productId: input.productId, quantityLimit: input.quantityLimit },
    });
    return vue(sale);
  },

  /**
   * Clôt les ventes dont la fenêtre est passée.
   *
   * Appelé par l'entretien périodique. Une vente laissée `ACTIVE` après sa fin
   * ne vend plus rien — les lectures la filtrent par date — mais elle
   * encombrerait les écrans et fausserait les décomptes.
   */
  async closeExpired(): Promise<number> {
    const { count } = await prisma.toumaFlashSale.updateMany({
      where: { status: 'ACTIVE', endsAt: { lt: new Date() } },
      data: { status: 'ENDED' },
    });
    return count;
  },
};

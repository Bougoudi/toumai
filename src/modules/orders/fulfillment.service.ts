import type { Order } from '@prisma/client';
import type { FulfillmentConnector } from '../../automation/connectors/fulfillment/base.fulfillment.connector.js';
import { MockFulfillmentConnector } from '../../automation/connectors/fulfillment/mock.fulfillment.connector.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { parseList, scoreSupplier, type SearchCriteria } from '../../utils/scoring.js';

/** Connecteur d'exécution actif (remplaçable par une intégration réelle). */
const connector: FulfillmentConnector = new MockFulfillmentConnector();

/** Sélectionne le meilleur couple (fournisseur, offre) pour un produit donné. */
async function pickBestSupplierOffer(productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return null;

  const criteria: SearchCriteria = {
    query: product.name,
    category: product.category,
    keywords: parseList(product.keywords),
    targetUnitPrice: product.targetUnitPrice ?? product.costPrice ?? null,
    targetQuantity: product.targetQuantity ?? null,
    region: product.region ?? null,
    requiredCertifications: parseList(product.requiredCertifications),
  };

  const suppliers = await prisma.supplier.findMany({
    where: { offers: { some: { category: { contains: product.category } } } },
    include: { offers: true },
  });

  let best: { supplierId: string; offerId: string; unitPrice: number; score: number } | null = null;
  for (const supplier of suppliers) {
    for (const offer of supplier.offers) {
      if (!offer.inStock) continue;
      const score = scoreSupplier(criteria, supplier, offer).total;
      if (!best || score > best.score) {
        best = { supplierId: supplier.id, offerId: offer.id, unitPrice: offer.unitPrice ?? 0, score };
      }
    }
  }
  return best;
}

export const fulfillmentService = {
  /**
   * Pilier 3 : honore automatiquement une commande payée.
   * Pour chaque article : choisit le meilleur fournisseur, crée un bon d'achat
   * et le passe via le connecteur d'exécution.
   */
  async fulfillOrder(order: Order) {
    await prisma.order.update({ where: { id: order.id }, data: { status: 'FULFILLING' } });

    const full = await prisma.order.findUnique({
      where: { id: order.id },
      include: { items: true, customer: true },
    });
    if (!full) throw new HttpError(404, 'Commande introuvable');

    let allShipped = true;

    for (const item of full.items) {
      const pick = await pickBestSupplierOffer(item.productId);
      if (!pick) {
        allShipped = false;
        logger.warn('Aucun fournisseur trouvé pour l’article', { orderId: order.id, productId: item.productId });
        continue;
      }

      const po = await prisma.purchaseOrder.create({
        data: {
          orderId: order.id,
          supplierId: pick.supplierId,
          offerId: pick.offerId,
          status: 'CREATED',
          cost: Number((pick.unitPrice * item.quantity).toFixed(2)),
        },
      });

      const result = await connector.placeOrder({
        purchaseOrderId: po.id,
        supplierId: pick.supplierId,
        offerId: pick.offerId,
        quantity: item.quantity,
        shipTo: {
          name: full.customer.name,
          address: full.customer.address,
          city: full.customer.city,
          country: full.customer.country,
          zip: full.customer.zip,
        },
      });

      if (result.accepted) {
        await prisma.purchaseOrder.update({
          where: { id: po.id },
          data: {
            status: 'SHIPPED',
            trackingNumber: result.trackingNumber,
            carrier: result.carrier,
            cost: result.cost ?? po.cost,
            placedAt: new Date(),
            shippedAt: new Date(),
          },
        });
      } else {
        allShipped = false;
        await prisma.purchaseOrder.update({
          where: { id: po.id },
          data: { status: 'FAILED', error: result.error, placedAt: new Date() },
        });
        logger.warn('Bon d’achat refusé', { orderId: order.id, poId: po.id, error: result.error });
      }
    }

    const finalStatus = allShipped ? 'SHIPPED' : 'FULFILLING';
    await prisma.order.update({ where: { id: order.id }, data: { status: finalStatus } });
    logger.info('Commande traitée', { orderId: order.id, status: finalStatus });
    return finalStatus;
  },

  /** Traite un lot de commandes payées en attente d'exécution. */
  async fulfillPaidOrders(batchSize = 20) {
    const orders = await prisma.order.findMany({
      where: { status: 'PAID' },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });
    for (const order of orders) {
      try {
        await this.fulfillOrder(order);
      } catch (err) {
        logger.error('Échec exécution commande', {
          orderId: order.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return orders.length;
  },
};

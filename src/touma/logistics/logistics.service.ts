import { Prisma, type ShipmentStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import { MockLogisticsProvider } from './providers/mock.provider.js';
import type { LogisticsProvider, QuoteRequest, ShippingQuoteResult } from './logistics.types.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * Registre des transporteurs. Ajouter un transporteur réel = enregistrer un
 * adaptateur ici (ou au démarrage), sans modifier le checkout ni les commandes.
 */
const providers = new Map<string, LogisticsProvider>();

export function registerLogisticsProvider(provider: LogisticsProvider): void {
  providers.set(provider.code, provider);
}

registerLogisticsProvider(new MockLogisticsProvider());

/**
 * Transporteur configuré. Aucun repli silencieux : un code inconnu lève une
 * erreur explicite plutôt que d'expédier via un adaptateur inattendu.
 */
function defaultProvider(): LogisticsProvider {
  const provider = providers.get(env.touma.logisticsProvider);
  if (!provider) throw new Error(`Transporteur inconnu : « ${env.touma.logisticsProvider} ».`);
  return provider;
}

export const logisticsService = {
  listProviders() {
    return [...providers.values()].map((p) => ({ code: p.code, name: p.name }));
  },

  /** Devis multi-transporteurs pour un trajet donné (tarifs persistés + expirants). */
  async quote(request: QuoteRequest, orderId?: string) {
    const candidates = [...providers.values()].filter((p) => p.supports(request));
    if (candidates.length === 0) throw badRequest('Aucun transporteur ne dessert ce trajet pour l’instant.');

    const results: ShippingQuoteResult[] = [];
    for (const provider of candidates) {
      try {
        results.push(...(await provider.getQuote(request)));
      } catch (err) {
        logger.error('Devis transporteur en échec', { provider: provider.code, err: err instanceof Error ? err.message : String(err) });
      }
    }
    if (results.length === 0) throw badRequest('Aucun tarif disponible pour ce trajet.');

    const saved = await prisma.$transaction(
      results.map((q) =>
        prisma.toumaShippingQuote.create({
          data: {
            providerCode: q.providerCode,
            serviceName: q.serviceName,
            orderId: orderId ?? null,
            originCountry: request.origin.countryCode,
            originCity: request.origin.city ?? null,
            destinationCountry: request.destination.countryCode,
            destinationCity: request.destination.city ?? null,
            weightGrams: request.parcel.weightGrams,
            dimensions: {
              length: request.parcel.lengthCm ?? null,
              width: request.parcel.widthCm ?? null,
              height: request.parcel.heightCm ?? null,
            } as object,
            amount: new Prisma.Decimal(q.amount),
            currency: q.currency,
            etaMinDays: q.etaMinDays,
            etaMaxDays: q.etaMaxDays,
            expiresAt: new Date(Date.now() + q.ttlSeconds * 1000),
          },
        }),
      ),
    );

    return saved.map((q) => ({
      id: q.id,
      providerCode: q.providerCode,
      serviceName: q.serviceName,
      amount: q.amount.toString(),
      currency: q.currency,
      etaMinDays: q.etaMinDays,
      etaMaxDays: q.etaMaxDays,
      expiresAt: q.expiresAt,
    }));
  },

  /**
   * Crée l'expédition d'une commande payée. Seul le vendeur (ou un
   * administrateur) peut expédier ; l'acheteur ne fait que suivre.
   */
  async createShipment(user: ToumaRequestUser, input: { orderId: string; quoteId?: string }) {
    const order = await prisma.toumaOrder.findUnique({
      where: { id: input.orderId },
      include: { store: true, items: { include: { product: true } }, shipments: true },
    });
    if (!order) throw notFound('Commande introuvable.');
    if (order.store.ownerId !== user.id && user.role !== 'ADMIN') throw forbidden('Seul le vendeur peut expédier cette commande.');
    if (!['PAID', 'CONFIRMED', 'PROCESSING'].includes(order.status)) {
      throw conflict(`Une commande au statut ${order.status} ne peut pas être expédiée.`);
    }
    if (order.shipments.some((s) => !['CANCELLED', 'FAILED'].includes(s.status))) {
      throw conflict('Une expédition est déjà en cours pour cette commande.');
    }

    const shipping = order.shippingSnapshot as { countryCode?: string; city?: string } | null;
    const destination = { countryCode: shipping?.countryCode ?? order.buyerCountry ?? order.store.countryCode, city: shipping?.city ?? null };
    const origin = { countryCode: order.store.countryCode, city: order.store.city };
    const weightGrams = order.items.reduce((acc, i) => acc + (i.product?.weightGrams ?? 500) * i.quantity, 0);

    let quote = input.quoteId ? await prisma.toumaShippingQuote.findUnique({ where: { id: input.quoteId } }) : null;
    if (quote && quote.expiresAt.getTime() < Date.now()) {
      throw conflict('Ce tarif de transport a expiré : demandez un nouveau devis.');
    }
    if (!quote) {
      const [fresh] = await this.quote({ origin, destination, parcel: { weightGrams }, currency: order.currency }, order.id);
      quote = await prisma.toumaShippingQuote.findUnique({ where: { id: fresh.id } });
    }
    if (!quote) throw badRequest('Impossible d’obtenir un tarif de transport.');

    const provider = providers.get(quote.providerCode) ?? defaultProvider();
    const created = await provider.createShipment({
      quote: {
        providerCode: quote.providerCode,
        serviceName: quote.serviceName,
        amount: quote.amount.toString(),
        currency: quote.currency,
        etaMinDays: quote.etaMinDays,
        etaMaxDays: quote.etaMaxDays,
        ttlSeconds: 0,
      },
      origin,
      destination,
      parcel: { weightGrams },
      reference: order.orderNumber,
    });

    const shipment = await prisma.$transaction(async (tx) => {
      const created$ = await tx.toumaShipment.create({
        data: {
          orderId: order.id,
          quoteId: quote.id,
          providerCode: created.providerCode,
          trackingNumber: created.trackingNumber,
          labelUrl: created.labelUrl,
          status: created.status as ShipmentStatus,
          amount: quote.amount,
          currency: quote.currency,
          etaMinDays: quote.etaMinDays,
          etaMaxDays: quote.etaMaxDays,
          originCountry: origin.countryCode,
          destinationCountry: destination.countryCode,
        },
      });
      await tx.toumaTrackingEvent.create({
        data: { shipmentId: created$.id, status: created.status as ShipmentStatus, label: 'Étiquette créée, colis en attente d’enlèvement.' },
      });
      await tx.toumaOrder.update({ where: { id: order.id }, data: { status: 'PROCESSING' } });
      return created$;
    });

    await notify({
      userId: order.buyerId,
      type: 'SHIPMENT_CREATED',
      title: 'Votre commande est préparée',
      body: `Expédition ${shipment.trackingNumber} créée pour la commande ${order.orderNumber}.`,
      data: { orderId: order.id, shipmentId: shipment.id, trackingNumber: shipment.trackingNumber },
    });
    return shipment;
  },

  /** Détail d'une expédition — accessible à l'acheteur, au vendeur et à l'admin. */
  async get(user: ToumaRequestUser, shipmentId: string) {
    const shipment = await prisma.toumaShipment.findFirst({
      where: { OR: [{ id: shipmentId }, { trackingNumber: shipmentId }] },
      include: { order: { include: { store: true } }, events: { orderBy: { occurredAt: 'desc' } } },
    });
    if (!shipment) throw notFound('Expédition introuvable.');
    const allowed = shipment.order.buyerId === user.id || shipment.order.store.ownerId === user.id || user.role === 'ADMIN';
    if (!allowed) throw notFound('Expédition introuvable.');
    return shipment;
  },

  async tracking(user: ToumaRequestUser, shipmentId: string) {
    const shipment = await this.get(user, shipmentId);
    return {
      trackingNumber: shipment.trackingNumber,
      providerCode: shipment.providerCode,
      status: shipment.status,
      etaMinDays: shipment.etaMinDays,
      etaMaxDays: shipment.etaMaxDays,
      events: shipment.events.map((e) => ({ status: e.status, label: e.label, location: e.location, occurredAt: e.occurredAt })),
    };
  },

  /**
   * Avance le statut d'une expédition (vendeur/admin, ou webhook transporteur
   * plus tard). Met la commande en cohérence : expédiée → en transit → livrée.
   */
  async updateStatus(user: ToumaRequestUser, shipmentId: string, status: ShipmentStatus, label?: string, location?: string) {
    const shipment = await prisma.toumaShipment.findUnique({ where: { id: shipmentId }, include: { order: { include: { store: true } } } });
    if (!shipment) throw notFound('Expédition introuvable.');
    if (shipment.order.store.ownerId !== user.id && user.role !== 'ADMIN') {
      throw forbidden('Seul le vendeur peut mettre à jour cette expédition.');
    }

    const orderStatus =
      status === 'SHIPPED' ? 'SHIPPED' : status === 'IN_TRANSIT' ? 'IN_TRANSIT' : status === 'DELIVERED' ? 'DELIVERED' : null;

    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.toumaShipment.update({
        where: { id: shipment.id },
        data: {
          status,
          shippedAt: status === 'SHIPPED' ? new Date() : shipment.shippedAt,
          deliveredAt: status === 'DELIVERED' ? new Date() : shipment.deliveredAt,
        },
      });
      await tx.toumaTrackingEvent.create({
        data: { shipmentId: shipment.id, status, label: label ?? `Statut : ${status}`, location: location ?? null },
      });
      if (orderStatus) {
        await tx.toumaOrder.update({
          where: { id: shipment.orderId },
          data: {
            status: orderStatus,
            shippedAt: orderStatus === 'SHIPPED' ? new Date() : undefined,
            deliveredAt: orderStatus === 'DELIVERED' ? new Date() : undefined,
          },
        });
      }
      return s;
    });

    await notify({
      userId: shipment.order.buyerId,
      type: 'SHIPMENT_UPDATED',
      title: 'Suivi de votre commande',
      body: label ?? `Votre colis ${shipment.trackingNumber} : ${status}.`,
      data: { orderId: shipment.orderId, shipmentId: shipment.id, status },
    });
    return updated;
  },

  async cancel(user: ToumaRequestUser, shipmentId: string) {
    const shipment = await prisma.toumaShipment.findUnique({ where: { id: shipmentId }, include: { order: { include: { store: true } } } });
    if (!shipment) throw notFound('Expédition introuvable.');
    if (shipment.order.store.ownerId !== user.id && user.role !== 'ADMIN') throw forbidden('Action réservée au vendeur.');
    if (['DELIVERED', 'RETURNED'].includes(shipment.status)) throw conflict('Cette expédition ne peut plus être annulée.');

    const provider = providers.get(shipment.providerCode) ?? defaultProvider();
    await provider.cancelShipment(shipment.trackingNumber);
    return prisma.$transaction(async (tx) => {
      const s = await tx.toumaShipment.update({ where: { id: shipment.id }, data: { status: 'CANCELLED' } });
      await tx.toumaTrackingEvent.create({ data: { shipmentId: shipment.id, status: 'CANCELLED', label: 'Expédition annulée.' } });
      return s;
    });
  },
};

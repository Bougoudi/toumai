import type { SalesChannel } from '@prisma/client';
import {
  getChannelConnector,
  listChannelTypes,
} from '../../automation/connectors/channels/registry.js';
import type { NormalizedChannelOrder } from '../../automation/connectors/channels/base.channel.connector.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { computeSalePrice } from '../../utils/pricing.js';
import { decryptJson, encryptJson } from '../../utils/crypto.js';

function connectorFor(type: string) {
  const c = getChannelConnector(type);
  if (!c) throw new HttpError(400, `Canal inconnu : ${type}`);
  return c;
}

/** Masque les valeurs secrètes de la config avant de la renvoyer. */
function maskConfig(type: string, configJson: string) {
  const connector = getChannelConnector(type);
  const config = decryptJson<Record<string, string>>(configJson);
  const out: Record<string, string> = {};
  for (const field of connector?.configFields ?? []) {
    const val = config[field.key];
    out[field.key] = field.secret && val ? '••••••' : (val ?? '');
  }
  return out;
}

function publicChannel(ch: SalesChannel) {
  return {
    id: ch.id,
    type: ch.type,
    name: ch.name,
    status: ch.status,
    error: ch.error,
    lastSyncAt: ch.lastSyncAt,
    config: maskConfig(ch.type, ch.config),
    createdAt: ch.createdAt,
  };
}

export const channelService = {
  /** Types de canaux disponibles + champs de configuration. */
  types() {
    return listChannelTypes();
  },

  async list() {
    const items = await prisma.salesChannel.findMany({ orderBy: { createdAt: 'desc' } });
    return items.map(publicChannel);
  },

  async getRaw(id: string) {
    const ch = await prisma.salesChannel.findUnique({ where: { id } });
    if (!ch) throw new HttpError(404, 'Canal introuvable');
    return ch;
  },

  async get(id: string) {
    return publicChannel(await this.getRaw(id));
  },

  /** Connecte un canal : teste les identifiants puis enregistre. */
  async connect(input: { type: string; name: string; config: Record<string, string> }) {
    const connector = connectorFor(input.type);
    let status = 'DISCONNECTED';
    let error: string | null = null;
    try {
      const info = await connector.testConnection(input.config);
      status = info.ok ? 'CONNECTED' : 'ERROR';
      if (!info.ok) error = info.detail ?? 'Connexion refusée';
    } catch (err) {
      status = 'ERROR';
      error = err instanceof Error ? err.message : 'Échec de connexion';
    }
    const ch = await prisma.salesChannel.create({
      data: { type: input.type, name: input.name, config: encryptJson(input.config), status, error },
    });
    return publicChannel(ch);
  },

  /** Met à jour la configuration (fusion) et re-teste. */
  async update(id: string, config: Record<string, string>) {
    const ch = await this.getRaw(id);
    const merged = { ...decryptJson(ch.config), ...config };
    const connector = connectorFor(ch.type);
    let status = 'DISCONNECTED';
    let error: string | null = null;
    try {
      const info = await connector.testConnection(merged);
      status = info.ok ? 'CONNECTED' : 'ERROR';
      if (!info.ok) error = info.detail ?? 'Connexion refusée';
    } catch (err) {
      status = 'ERROR';
      error = err instanceof Error ? err.message : 'Échec';
    }
    const updated = await prisma.salesChannel.update({
      where: { id },
      data: { config: encryptJson(merged), status, error },
    });
    return publicChannel(updated);
  },

  async test(id: string) {
    const ch = await this.getRaw(id);
    const connector = connectorFor(ch.type);
    try {
      const info = await connector.testConnection(decryptJson(ch.config));
      await prisma.salesChannel.update({
        where: { id },
        data: { status: info.ok ? 'CONNECTED' : 'ERROR', error: info.ok ? null : info.detail },
      });
      return info;
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Échec';
      await prisma.salesChannel.update({ where: { id }, data: { status: 'ERROR', error: detail } });
      return { ok: false, detail };
    }
  },

  async remove(id: string) {
    await this.getRaw(id);
    await prisma.salesChannel.delete({ where: { id } });
  },

  /** Publie un produit du catalogue en annonce sur le canal. */
  async publishProduct(channelId: string, productId: string) {
    const ch = await this.getRaw(channelId);
    const connector = connectorFor(ch.type);
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new HttpError(404, 'Produit introuvable');

    const listing = await prisma.channelListing.upsert({
      where: { channelId_productId: { channelId, productId } },
      create: { channelId, productId, status: 'DRAFT' },
      update: { status: 'DRAFT', error: null },
    });

    try {
      const res = await connector.publishListing(decryptJson(ch.config), {
        sku: product.sku,
        name: product.name,
        description: product.description,
        price: product.salePrice ?? 0,
        currency: product.currency,
        quantity: 100,
        images: (product.images || '').split(',').filter(Boolean),
        category: product.category,
      });
      return prisma.channelListing.update({
        where: { id: listing.id },
        data: { status: 'PUBLISHED', externalId: res.externalId, url: res.url ?? null, error: null },
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Échec de publication';
      await prisma.channelListing.update({ where: { id: listing.id }, data: { status: 'ERROR', error } });
      throw new HttpError(502, error);
    }
  },

  /** Importe les commandes d'un canal dans Toumai (dédupliquées). */
  async syncOrders(channelId: string) {
    const ch = await this.getRaw(channelId);
    const connector = connectorFor(ch.type);
    const orders = await connector.fetchOrders(decryptJson(ch.config), ch.lastSyncAt ?? undefined);
    let imported = 0;
    for (const o of orders) {
      const created = await this.importOrder(ch.type, o);
      if (created) imported += 1;
    }
    await prisma.salesChannel.update({ where: { id: channelId }, data: { lastSyncAt: new Date(), error: null } });
    logger.info('Commandes importées', { channel: ch.type, imported });
    return { imported, fetched: orders.length };
  },

  /** Crée une commande Toumai à partir d'une commande marketplace (idempotent). */
  async importOrder(channelType: string, o: NormalizedChannelOrder): Promise<boolean> {
    const exists = await prisma.order.findUnique({
      where: { channel_externalId: { channel: channelType, externalId: o.externalId } },
    });
    if (exists) return false;

    // Client (réutilisé par email).
    const customer =
      (await prisma.customer.findFirst({ where: { email: o.customer.email } })) ??
      (await prisma.customer.create({
        data: {
          name: o.customer.name,
          email: o.customer.email,
          city: o.customer.city ?? null,
          country: o.customer.country ?? null,
          zip: o.customer.zip ?? null,
        },
      }));

    // Résout chaque article vers un produit (par SKU) ou crée un produit importé.
    const items = [];
    for (const it of o.items) {
      let product = it.sku ? await prisma.product.findUnique({ where: { sku: it.sku } }) : null;
      if (!product) {
        const cost = Number((it.unitPrice * 0.4).toFixed(2));
        product = await prisma.product.create({
          data: {
            sku: it.sku ?? `IMP-${channelType}-${Date.now()}-${items.length}`,
            name: it.title,
            category: 'divers',
            costPrice: cost,
            salePrice: it.unitPrice || computeSalePrice(cost),
            status: 'ACTIVE',
            source: 'imported',
          },
        });
      }
      items.push({ productId: product.id, quantity: it.quantity, unitSalePrice: it.unitPrice, unitCostPrice: product.costPrice });
    }
    if (items.length === 0) return false;

    const orderNumber = `${channelType.toUpperCase()}-${o.externalId}`;
    await prisma.order.create({
      data: {
        orderNumber,
        customerId: customer.id,
        channel: channelType,
        externalId: o.externalId,
        status: 'PAID', // payée sur le marketplace → déclenche l'expédition auto
        total: o.total,
        currency: o.currency,
        items: { create: items },
      },
    });
    return true;
  },

  /** Synchronise tous les canaux connectés (utilisé par le job cron). */
  async syncAllConnected() {
    const channels = await prisma.salesChannel.findMany({ where: { status: 'CONNECTED' } });
    let total = 0;
    for (const ch of channels) {
      try {
        const { imported } = await this.syncOrders(ch.id);
        total += imported;
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Échec sync';
        await prisma.salesChannel.update({ where: { id: ch.id }, data: { status: 'ERROR', error } });
        logger.error('Sync canal en échec', { channel: ch.type, error });
      }
    }
    return total;
  },
};

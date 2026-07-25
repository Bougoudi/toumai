import { getCompetitorConnector } from '../../automation/connectors/competitors/competitor.connector.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';

export const competitorService = {
  async list() {
    return prisma.competitor.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { products: true } } },
    });
  },

  async add(input: { platform: string; shopName: string; shopUrl?: string; followed?: boolean }) {
    return prisma.competitor.create({
      data: {
        platform: input.platform,
        shopName: input.shopName,
        shopUrl: input.shopUrl ?? null,
        followed: input.followed ?? false,
      },
    });
  },

  async remove(id: string) {
    await this.getById(id);
    await prisma.competitor.delete({ where: { id } });
  },

  async getById(id: string) {
    const c = await prisma.competitor.findUnique({ where: { id } });
    if (!c) throw new HttpError(404, 'Concurrent introuvable');
    return c;
  },

  async setFollowed(id: string, followed: boolean) {
    await this.getById(id);
    return prisma.competitor.update({ where: { id }, data: { followed } });
  },

  /** Scanne une boutique concurrente et enregistre ses produits gagnants. */
  async scan(id: string) {
    const c = await this.getById(id);
    const connector = getCompetitorConnector(c.platform);
    let found = 0;
    try {
      const items = await connector.scanShop(c.shopName, c.shopUrl ?? undefined);
      for (const it of items) {
        await prisma.competitorProduct.upsert({
          where: { competitorId_externalId: { competitorId: id, externalId: it.externalId } },
          create: {
            competitorId: id,
            externalId: it.externalId,
            title: it.title,
            category: it.category,
            price: it.price,
            currency: it.currency,
            soldCount: it.soldCount,
            imageUrl: it.imageUrl ?? null,
            url: it.url ?? null,
          },
          update: { soldCount: it.soldCount, price: it.price },
        });
        found += 1;
      }
      await prisma.competitor.update({ where: { id }, data: { lastScanAt: new Date(), status: 'ACTIVE' } });
    } catch (err) {
      await prisma.competitor.update({
        where: { id },
        data: { status: 'ERROR' },
      });
      throw new HttpError(502, err instanceof Error ? err.message : 'Échec du scan');
    }
    logger.info('Concurrent scanné', { competitor: c.shopName, found });
    return { found };
  },

  /** Produits gagnants (tous concurrents), triés par ventes. */
  async winningProducts(params: { competitorId?: string; take: number }) {
    return prisma.competitorProduct.findMany({
      where: params.competitorId ? { competitorId: params.competitorId } : {},
      orderBy: { soldCount: 'desc' },
      take: params.take,
      include: { competitor: { select: { shopName: true, platform: true } } },
    });
  },

  /** Ajoute un produit concurrent aux favoris (à sourcer/publier ensuite). */
  async favorite(productId: string) {
    const p = await prisma.competitorProduct.findUnique({ where: { id: productId } });
    if (!p) throw new HttpError(404, 'Produit introuvable');
    await prisma.competitorProduct.update({ where: { id: productId }, data: { favorited: true } });
    return prisma.favorite.create({
      data: {
        source: 'competitor',
        title: p.title,
        category: p.category,
        price: p.price,
        currency: p.currency,
        imageUrl: p.imageUrl,
        url: p.url,
        keywords: p.title.toLowerCase().split(' ').slice(0, 4).join(','),
      },
    });
  },

  /** Scanne tous les concurrents suivis (job cron). */
  async scanFollowed() {
    const followed = await prisma.competitor.findMany({ where: { followed: true } });
    let total = 0;
    for (const c of followed) {
      try {
        const { found } = await this.scan(c.id);
        total += found;
      } catch {
        /* déjà loggué */
      }
    }
    return total;
  },
};

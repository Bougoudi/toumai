import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import type {
  CreateSupplierInput,
  OfferInput,
  UpdateSupplierInput,
} from './supplier.schema.js';

export const supplierService = {
  async list(params: {
    region?: string;
    q?: string;
    minRating?: number;
    verified?: boolean;
    take: number;
    skip: number;
  }) {
    const where = {
      ...(params.region ? { region: params.region } : {}),
      ...(params.minRating != null ? { rating: { gte: params.minRating } } : {}),
      ...(params.verified != null ? { verified: params.verified } : {}),
      ...(params.q
        ? {
            OR: [
              { name: { contains: params.q } },
              { certifications: { contains: params.q } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        take: params.take,
        skip: params.skip,
        orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
        include: { _count: { select: { offers: true } } },
      }),
      prisma.supplier.count({ where }),
    ]);

    return { items, total, take: params.take, skip: params.skip };
  },

  async getById(id: string) {
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: { offers: true },
    });
    if (!supplier) throw new HttpError(404, 'Fournisseur introuvable');
    return supplier;
  },

  async create(input: CreateSupplierInput) {
    const { offers, ...supplier } = input;
    return prisma.supplier.create({
      data: {
        ...supplier,
        offers: offers.length ? { create: offers } : undefined,
      },
      include: { offers: true },
    });
  },

  async update(id: string, input: UpdateSupplierInput) {
    await this.getById(id);
    return prisma.supplier.update({ where: { id }, data: input, include: { offers: true } });
  },

  async remove(id: string) {
    await this.getById(id);
    await prisma.supplier.delete({ where: { id } });
  },

  async addOffer(supplierId: string, offer: OfferInput) {
    await this.getById(supplierId);
    return prisma.offer.create({ data: { ...offer, supplierId } });
  },
};

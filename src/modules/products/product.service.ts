import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { computeMargin, computeSalePrice } from '../../utils/pricing.js';
import type { CreateProductInput, UpdateProductInput } from './product.schema.js';

/** Complète prix de vente / marge à partir du prix d'achat si nécessaire. */
function withEconomics<T extends { costPrice?: number | null; salePrice?: number | null; margin?: number | null }>(
  input: T,
): T {
  const cost = input.costPrice ?? null;
  let sale = input.salePrice ?? null;
  if (cost != null && sale == null) sale = computeSalePrice(cost);
  const margin = cost != null && sale != null ? computeMargin(sale, cost) : null;
  return { ...input, costPrice: cost, salePrice: sale, margin };
}

export const productService = {
  async list(params: { category?: string; status?: string; q?: string; take: number; skip: number }) {
    const where = {
      ...(params.category ? { category: params.category } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.q
        ? {
            OR: [
              { name: { contains: params.q } },
              { keywords: { contains: params.q } },
              { description: { contains: params.q } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.product.findMany({ where, take: params.take, skip: params.skip, orderBy: { createdAt: 'desc' } }),
      prisma.product.count({ where }),
    ]);

    return { items, total, take: params.take, skip: params.skip };
  },

  async getById(id: string) {
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw new HttpError(404, 'Produit introuvable');
    return product;
  },

  async create(input: CreateProductInput) {
    return prisma.product.create({ data: withEconomics(input) });
  },

  async update(id: string, input: UpdateProductInput) {
    await this.getById(id);
    return prisma.product.update({ where: { id }, data: withEconomics(input) });
  },

  async remove(id: string) {
    await this.getById(id);
    await prisma.product.delete({ where: { id } });
  },
};

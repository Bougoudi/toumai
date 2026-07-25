import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';

const HEADLINES = [
  (n: string) => `${n} — l'indispensable du moment 🔥`,
  (n: string) => `Découvrez ${n} (offre limitée)`,
  (n: string) => `${n} : simplifiez votre quotidien`,
];
const BODIES = [
  'Qualité premium, livraison rapide, satisfait ou remboursé. Commandez maintenant !',
  'Des milliers de clients conquis. Stock limité — profitez-en aujourd’hui.',
  'Le petit plus qui change tout. Livré chez vous en quelques jours.',
];

export const adService = {
  list(productId?: string) {
    return prisma.ad.findMany({
      where: productId ? { productId } : {},
      orderBy: { createdAt: 'desc' },
      include: { product: { select: { name: true } } },
    });
  },

  /** Génère une publicité (accroche + texte) pour un produit. */
  async generate(input: { productId: string; platform?: string; budget?: number }) {
    const product = await prisma.product.findUnique({ where: { id: input.productId } });
    if (!product) throw new HttpError(404, 'Produit introuvable');
    const i = product.name.length % HEADLINES.length;
    return prisma.ad.create({
      data: {
        productId: product.id,
        platform: input.platform ?? 'meta',
        headline: HEADLINES[i](product.name),
        body: BODIES[i],
        budget: input.budget ?? 10,
        status: 'DRAFT',
      },
      include: { product: { select: { name: true } } },
    });
  },

  async setStatus(id: string, status: string) {
    const ad = await prisma.ad.findUnique({ where: { id } });
    if (!ad) throw new HttpError(404, 'Publicité introuvable');
    return prisma.ad.update({ where: { id }, data: { status } });
  },

  async remove(id: string) {
    await prisma.ad.delete({ where: { id } }).catch(() => {
      throw new HttpError(404, 'Publicité introuvable');
    });
  },
};

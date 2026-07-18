import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { computeSalePrice } from '../../utils/pricing.js';
import { parseList, scoreSupplier, type SearchCriteria } from '../../utils/scoring.js';
import { channelService } from '../channels/channel.service.js';

interface Idea {
  title: string;
  category: string;
  keywords: string;
  estimatedPrice: number;
  source: string;
  imageUrl?: string;
}

const IDEAS = [
  { title: 'Support téléphone magnétique', category: 'electronique', price: 14.99 },
  { title: 'Organiseur de sac à main', category: 'maison', price: 19.99 },
  { title: 'Gourde isotherme 750ml', category: 'sport', price: 24.99 },
  { title: 'Brosse anti-poils réutilisable', category: 'animalerie', price: 17.99 },
  { title: 'Rouleau de massage facial', category: 'beaute', price: 12.99 },
  { title: 'Lampe LED de bureau pliable', category: 'electronique', price: 29.99 },
  { title: 'Set de rangement modulable', category: 'maison', price: 22.99 },
];

function makeIdeas(query: string, source: string): Idea[] {
  const q = query.toLowerCase();
  const matched = IDEAS.filter((i) => !q || i.title.toLowerCase().includes(q) || i.category.includes(q));
  const base = matched.length ? matched : IDEAS;
  return base.slice(0, 8).map((i) => ({
    title: i.title,
    category: i.category,
    keywords: i.title.toLowerCase().split(' ').slice(0, 4).join(','),
    estimatedPrice: i.price,
    source,
    imageUrl: `https://picsum.photos/seed/${encodeURIComponent(i.title)}/300/300`,
  }));
}

export const discoveryService = {
  /** Recherche par écriture (texte). */
  searchText(query: string): Idea[] {
    return makeIdeas(query, 'search-text');
  },

  /**
   * Recherche par photo. Sans service de vision branché, on s'appuie sur un
   * indice textuel (`hint`) décrivant l'image. Branchez ici une API de vision
   * (labels) puis réutilisez `makeIdeas(label)`.
   */
  searchPhoto(hint: string): Idea[] {
    if (!hint) throw new HttpError(400, 'Fournissez un indice décrivant la photo (ex: "gourde", "lampe").');
    return makeIdeas(hint, 'search-photo');
  },

  /** Recherche par code-barres (EAN/UPC). Mock : renvoie un produit dérivé du code. */
  searchBarcode(code: string): Idea[] {
    if (!/^\d{6,14}$/.test(code)) throw new HttpError(400, 'Code-barres invalide (6 à 14 chiffres).');
    const idx = Number(code.slice(-1)) % IDEAS.length;
    const base = IDEAS[idx];
    return [
      {
        title: `${base.title} (réf. ${code})`,
        category: base.category,
        keywords: base.title.toLowerCase().split(' ').slice(0, 4).join(','),
        estimatedPrice: base.price,
        source: 'search-barcode',
        imageUrl: `https://picsum.photos/seed/${code}/300/300`,
      },
    ];
  },

  // ── Favoris ──────────────────────────────────────────────
  listFavorites() {
    return prisma.favorite.findMany({ orderBy: { createdAt: 'desc' } });
  },

  addFavorite(input: {
    source?: string;
    title: string;
    category?: string;
    keywords?: string;
    price?: number;
    imageUrl?: string;
    url?: string;
  }) {
    return prisma.favorite.create({
      data: {
        source: input.source ?? 'manual',
        title: input.title,
        category: input.category ?? 'divers',
        keywords: input.keywords ?? '',
        price: input.price ?? null,
        imageUrl: input.imageUrl ?? null,
        url: input.url ?? null,
      },
    });
  },

  async removeFavorite(id: string) {
    await prisma.favorite.delete({ where: { id } }).catch(() => {
      throw new HttpError(404, 'Favori introuvable');
    });
  },

  async getFavorite(id: string) {
    const f = await prisma.favorite.findUnique({ where: { id } });
    if (!f) throw new HttpError(404, 'Favori introuvable');
    return f;
  },

  /** Transforme un favori en produit du catalogue et cherche le meilleur fournisseur. */
  async sourceFavorite(id: string) {
    const fav = await this.getFavorite(id);
    let product;
    if (fav.productId) {
      product = await prisma.product.findUnique({ where: { id: fav.productId } });
    }
    if (!product) {
      const cost = fav.price ? Number((fav.price * 0.4).toFixed(2)) : 9.99;
      product = await prisma.product.create({
        data: {
          name: fav.title,
          category: fav.category,
          keywords: fav.keywords,
          costPrice: cost,
          salePrice: fav.price ?? computeSalePrice(cost),
          status: 'ACTIVE',
          source: 'sourced',
          images: fav.imageUrl ?? '',
        },
      });
      await prisma.favorite.update({ where: { id }, data: { productId: product.id } });
    }

    // Meilleur fournisseur pour ce produit.
    const criteria: SearchCriteria = {
      query: product.name,
      category: product.category,
      keywords: parseList(product.keywords),
      targetUnitPrice: product.costPrice,
      targetQuantity: null,
      region: null,
      requiredCertifications: [],
    };
    const suppliers = await prisma.supplier.findMany({ include: { offers: true } });
    let best: { name: string; score: number; offer?: string } | null = null;
    for (const s of suppliers) {
      for (const o of s.offers) {
        const score = scoreSupplier(criteria, s, o).total;
        if (!best || score > best.score) best = { name: s.name, score, offer: o.title };
      }
    }
    return { product, bestSupplier: best };
  },

  /** Source le favori puis le publie sur un canal de vente. */
  async publishFavorite(id: string, channelId: string) {
    const { product } = await this.sourceFavorite(id);
    const listing = await channelService.publishProduct(channelId, product.id);
    return { product, listing };
  },
};

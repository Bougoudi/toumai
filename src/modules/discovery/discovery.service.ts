import { getBarcodeConnector, getProductConnector, getVisionConnector } from '../../automation/connectors/registry.js';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
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
  const q = query.toLowerCase().trim();
  const matched = IDEAS.filter((i) => !q || i.title.toLowerCase().includes(q) || i.category.includes(q));
  // Avec un mot-clé : uniquement les correspondances (liste vide si aucune) —
  // on n'affiche PAS tout le catalogue quand rien ne correspond. Sans mot-clé
  // (parcours) : le catalogue de démonstration.
  const base = q ? matched : IDEAS;
  return base.slice(0, 8).map((i) => ({
    title: i.title,
    category: i.category,
    keywords: i.title.toLowerCase().split(' ').slice(0, 4).join(','),
    estimatedPrice: i.price,
    source,
    imageUrl: `https://picsum.photos/seed/${encodeURIComponent(i.title)}/300/300`,
  }));
}

/**
 * Résout une recherche de produits par mots-clés : source réelle (AliExpress)
 * si configurée, sinon catalogue de démonstration (mode démo uniquement).
 * En production sans source configurée : liste vide (aucun produit inventé).
 */
async function resolveProducts(query: string, source: string): Promise<Idea[]> {
  const connector = await getProductConnector();
  if (connector) {
    const results = await connector.search(query, { limit: 40 });
    return results.map((r) => ({
      title: r.title,
      category: r.category,
      keywords: r.keywords,
      estimatedPrice: r.estimatedPrice,
      source: r.source,
      imageUrl: r.imageUrl,
    }));
  }
  if (env.demoMode) return makeIdeas(query, source);
  return [];
}

export const discoveryService = {
  /** Recherche par écriture (texte). */
  searchText(query: string): Promise<Idea[]> {
    return resolveProducts(query, 'search-text');
  },

  /**
   * Recherche par photo.
   *
   * Si une image est fournie ET qu'un service de vision est configuré, on
   * reconnaît le contenu de l'image (étiquettes) puis on cherche les produits
   * correspondants. Sinon on retombe sur le mot-clé (`hint`) — aucune
   * reconnaissance n'est inventée en l'absence de service de vision.
   *
   * Retourne aussi les étiquettes détectées (pour l'affichage) et le mode utilisé.
   */
  async searchPhoto(input: { hint?: string; image?: string }): Promise<{
    results: Idea[];
    detectedLabels: string[];
    mode: 'ai' | 'keyword';
  }> {
    const vision = await getVisionConnector();
    let query = (input.hint ?? '').trim();
    let detectedLabels: string[] = [];
    let mode: 'ai' | 'keyword' = 'keyword';

    if (input.image && vision) {
      try {
        const labels = await vision.detectLabels(input.image);
        detectedLabels = labels.slice(0, 5).map((l) => l.label);
      } catch (e) {
        // La reconnaissance a échoué : on retombe sur le mot-clé s'il y en a un.
        logger.warn('Reconnaissance photo échouée', { err: String(e).slice(0, 160) });
      }
      if (detectedLabels.length) {
        // Les 3 meilleures étiquettes forment la requête (complétée par le mot-clé).
        query = [detectedLabels.slice(0, 3).join(' '), query].filter(Boolean).join(' ').trim();
        mode = 'ai';
      }
    }

    if (!query) {
      throw new HttpError(
        400,
        input.image
          ? vision
            ? 'Produit non reconnu sur la photo. Réessaie avec une photo plus nette et rapprochée (bon éclairage), ou ajoute un mot-clé.'
            : 'Reconnaissance d’image non activée : ajoute un mot-clé, ou active l’assistant IA (clé Gemini) dans les Réglages.'
          : 'Fournissez une photo ou un indice (ex: "gourde", "lampe").',
      );
    }
    const results = await resolveProducts(query, mode === 'ai' ? 'search-photo-ai' : 'search-photo');
    return { results, detectedLabels, mode };
  },

  /**
   * Recherche par code-barres (EAN/UPC).
   *
   * Si une base de données de codes-barres est configurée, on retrouve le vrai
   * produit ; sinon on retombe sur un produit dérivé du code (démonstration).
   * Renvoie aussi le mode utilisé (`real` | `demo`).
   */
  async searchBarcode(code: string): Promise<{ results: Idea[]; mode: 'real' | 'demo' }> {
    if (!/^\d{6,14}$/.test(code)) throw new HttpError(400, 'Code-barres invalide (6 à 14 chiffres).');

    const connector = getBarcodeConnector();
    if (connector) {
      const product = await connector.lookup(code);
      if (product) {
        const title = product.brand ? `${product.brand} ${product.title}` : product.title;
        return {
          mode: 'real',
          results: [
            {
              title,
              category: product.category ?? 'divers',
              keywords: title.toLowerCase().split(/\s+/).slice(0, 5).join(','),
              estimatedPrice: product.price ?? 0,
              source: 'search-barcode-db',
              imageUrl: product.imageUrl,
            },
          ],
        };
      }
      // Base configurée mais code inconnu : on informe plutôt que d'inventer.
      throw new HttpError(404, `Aucun produit trouvé pour le code-barres ${code}.`);
    }

    // Démonstration : produit dérivé du code (aucune base branchée).
    const base = IDEAS[Number(code.slice(-1)) % IDEAS.length];
    return {
      mode: 'demo',
      results: [
        {
          title: `${base.title} (réf. ${code})`,
          category: base.category,
          keywords: base.title.toLowerCase().split(' ').slice(0, 4).join(','),
          estimatedPrice: base.price,
          source: 'search-barcode',
          imageUrl: `https://picsum.photos/seed/${code}/300/300`,
        },
      ],
    };
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

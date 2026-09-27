import { z } from 'zod';
import { prisma } from '../../../db/prisma.js';
import { redactForPublic, trustService } from '../../trust/trust.service.js';
import { registerTool, type ToolResult } from './registry.js';

/**
 * Outils de confiance (§27).
 *
 * L'assistant peut **expliquer** un niveau de confiance ; il ne peut ni le
 * calculer, ni le nuancer, ni en inventer la raison. La ventilation vient du
 * moteur de confiance et elle est rédigée pour le public avant de sortir —
 * `redactForPublic` retire les composantes internes, notamment le signal de
 * fraude, qui a fuité une fois et ne doit plus.
 */

const INDISPONIBLE = 'Information non disponible.';

registerTool({
  name: 'getSellerTrust',
  description:
    'Niveau de confiance d’un vendeur, avec la ventilation publique des facteurs qui le composent. Les explications viennent du moteur de confiance Touma ; aucune raison n’est inventée. Les composantes internes ne sont pas exposées.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SELLER', 'BUSINESS', 'ADMIN', 'SUPPORT'],
  roles: ['BUYER', 'SELLER', 'ADMIN', null],
  inputSchema: z.object({ storeId: z.string().trim().min(1).max(120) }),
  async handler(input): Promise<ToolResult> {
    const boutique = await prisma.toumaStore.findFirst({
      where: { OR: [{ id: input.storeId }, { slug: input.storeId }], status: 'ACTIVE' },
      select: { id: true, name: true, countryCode: true, verificationStatus: true, createdAt: true },
    });
    if (!boutique) return { data: null, summary: `${INDISPONIBLE} Boutique introuvable.` };

    const confiance = await trustService.get('SELLER', boutique.id).catch(() => null);
    if (!confiance) {
      // Un vendeur trop récent n'a pas de score publiable (seuil de volume
      // V21). Dire « pas encore de score » est exact ; afficher un score
      // calculé sur trois commandes le serait beaucoup moins.
      return {
        data: { store: boutique, trust: null },
        summary: `${INDISPONIBLE} Ce vendeur n’a pas encore assez d’historique pour qu’un niveau de confiance soit publié.`,
      };
    }

    return {
      data: {
        store: { id: boutique.id, name: boutique.name, countryCode: boutique.countryCode },
        /**
         * « Vérifié » ne se dit que si une vérification a réellement eu lieu
         * (V17 §80). Le statut vient de la base, pas d'une formule.
         */
        verified: boutique.verificationStatus === 'APPROVED',
        verificationStatus: boutique.verificationStatus,
        trust: { score: confiance.score, level: confiance.level, components: redactForPublic(confiance.components), computedAt: confiance.computedAt },
      },
      summary: `Confiance du vendeur « ${boutique.name} » : niveau ${confiance.level}.`,
      cards: [
        {
          type: 'SELLER',
          id: boutique.id,
          name: boutique.name,
          countryCode: boutique.countryCode,
          verified: boutique.verificationStatus === 'APPROVED',
          trustLevel: confiance.level,
          trustScore: confiance.score,
        },
      ],
    };
  },
});

registerTool({
  name: 'getProductReviews',
  description:
    'Avis publiés sur un produit : notes réelles et commentaires modérés. Ne renvoie aucun avis si le produit n’en a pas — aucun avis n’est produit ni résumé à partir de rien.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'BUSINESS', 'SUPPORT'],
  roles: ['BUYER', 'SELLER', 'ADMIN', null],
  inputSchema: z.object({ productId: z.string().trim().min(1).max(120), limit: z.number().int().min(1).max(10).optional() }),
  async handler(input): Promise<ToolResult> {
    const produit = await prisma.toumaProduct.findFirst({
      where: { OR: [{ id: input.productId }, { slug: input.productId }], status: 'ACTIVE' },
      select: { id: true, title: true, ratingAverage: true, ratingCount: true },
    });
    if (!produit) return { data: null, summary: `${INDISPONIBLE} Produit introuvable.` };

    const avis = await prisma.toumaReview.findMany({
      where: { productId: produit.id, status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
      take: input.limit ?? 5,
      select: { rating: true, comment: true, createdAt: true, orderId: true },
    });

    if (avis.length === 0) {
      return {
        data: { product: { id: produit.id, title: produit.title }, rating: null, ratingCount: 0, reviews: [] },
        summary: `${INDISPONIBLE} Aucun avis publié sur ce produit.`,
      };
    }
    return {
      data: {
        product: { id: produit.id, title: produit.title },
        // La note moyenne n'a de sens qu'avec au moins un avis : la rendre à
        // zéro avis afficherait « 0/5 » pour un produit que personne n'a noté.
        rating: Number(produit.ratingAverage),
        ratingCount: produit.ratingCount,
        // Chaque avis Touma est rattaché à une commande : l'achat vérifié
        // n'est pas un champ à cocher, c'est une propriété du schéma. Le dire
        // vaut mieux qu'ajouter un drapeau qui pourrait un jour mentir.
        reviews: avis.map((a) => ({ rating: a.rating, comment: a.comment, createdAt: a.createdAt, verifiedPurchase: true })),
      },
      summary: `${avis.length} avis publié(s), note moyenne ${Number(produit.ratingAverage).toFixed(1)}/5 sur ${produit.ratingCount} avis.`,
    };
  },
});

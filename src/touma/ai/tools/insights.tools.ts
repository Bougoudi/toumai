import { z } from 'zod';
import { prisma } from '../../../db/prisma.js';
import { forbidden } from '../../lib/errors.js';
import { briefService } from '../insights/brief.service.js';
import { demandIntelligence } from '../insights/demand.service.js';
import { priceIntelligence } from '../insights/price.service.js';
import { registerTool, type ToolContext, type ToolResult } from './registry.js';

/**
 * Outils d'intelligence de prix, de demande et de bilan (§20, §21, §52).
 *
 * Tous en lecture seule et tous calculés en base. Aucun ne propose de changer
 * un prix : un prix est une décision commerciale, et une machine qui
 * recommande « alignez-vous sur la médiane » pousse tout un marché vers le
 * même chiffre sans jamais avoir vu un seul produit.
 */

const INDISPONIBLE = 'Information non disponible.';

async function boutiqueDuVendeur(ctx: ToolContext, storeId: string) {
  if (!ctx.user) throw forbidden('Cet outil demande un compte vendeur.');
  const boutique = await prisma.toumaStore.findUnique({ where: { id: storeId }, select: { id: true, name: true, ownerId: true } });
  if (!boutique || (boutique.ownerId !== ctx.user.id && ctx.user.role !== 'ADMIN')) {
    throw forbidden('Boutique introuvable ou appartenant à un autre vendeur.');
  }
  return boutique;
}

registerTool({
  name: 'getPriceIntelligence',
  description:
    'Situe le prix d’un produit dans sa catégorie : fourchette réellement pratiquée par les autres vendeurs, écart à la médiane, historique de ses propres changements de prix. Ne dit jamais ce que le produit vaut et ne recommande aucun prix.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SELLER', 'BUSINESS', 'ADMIN'],
  roles: ['BUYER', 'SELLER', 'ADMIN', null],
  inputSchema: z.object({ productId: z.string().trim().min(1).max(120), days: z.number().int().min(7).max(365).optional() }),
  async handler(input): Promise<ToolResult> {
    const position = await priceIntelligence.positionAndAnomaly(input.productId);
    if (!position) return { data: null, summary: `${INDISPONIBLE} Produit introuvable.` };
    const variation = await priceIntelligence.ownVariation(input.productId, input.days ?? 90);
    const historique = await priceIntelligence.history(input.productId, 10);
    return {
      data: {
        ...position,
        ownVariation: variation,
        history: historique.entries,
        disclaimer:
          'La fourchette rassemble des prix **affichés** par d’autres vendeurs, pas des prix payés, et ne constitue pas une valeur de marché.',
      },
      summary: position.position
        ? position.position.statement
        : `${INDISPONIBLE} ${position.note ?? 'Pas assez de produits comparables.'}`,
    };
  },
});

registerTool({
  name: 'getDemandIntelligence',
  description:
    'Signaux de demande mesurés : recherches sur un terme, unités commandées d’un produit, et comparaison avec la période précédente. N’annonce une hausse que si le volume est suffisant pour qu’elle veuille dire quelque chose.',
  risk: 'READ_ONLY',
  surfaces: ['SELLER', 'BUSINESS', 'ADMIN'],
  roles: ['SELLER', 'ADMIN'],
  inputSchema: z.object({
    term: z.string().trim().min(2).max(120).optional(),
    productId: z.string().trim().max(120).optional(),
    days: z.number().int().min(7).max(365).optional(),
  }),
  async handler(input): Promise<ToolResult> {
    const jours = input.days ?? 30;
    if (input.productId) {
      const r = await demandIntelligence.forProduct(input.productId, jours);
      if (!r) return { data: null, summary: `${INDISPONIBLE} Produit introuvable.` };
      return { data: r, summary: r.unitsOrdered.statement };
    }
    if (input.term) {
      const r = await demandIntelligence.forTerm(input.term, jours);
      return { data: r, summary: r.searches.statement };
    }
    const r = await demandIntelligence.topTerms(jours, 10);
    return { data: r, summary: r.note ?? `${r.items.length} terme(s) les plus cherchés sur ${jours} jours.` };
  },
});

registerTool({
  name: 'getSellerBrief',
  description:
    'Bilan d’activité d’une boutique du vendeur connecté : données observées, variations, anomalies chiffrées, et ce qu’il faudrait aller vérifier. N’avance aucune cause.',
  risk: 'READ_ONLY',
  surfaces: ['SELLER', 'ADMIN'],
  roles: ['SELLER', 'ADMIN'],
  inputSchema: z.object({ storeId: z.string().trim().min(1).max(120), days: z.number().int().min(1).max(90).optional() }),
  async handler(input, ctx): Promise<ToolResult> {
    const boutique = await boutiqueDuVendeur(ctx, input.storeId);
    const bilan = await briefService.seller(boutique.id, input.days ?? 7);
    return {
      data: { store: { id: boutique.id, name: boutique.name }, ...bilan },
      summary: `Bilan de « ${boutique.name} » sur ${bilan.periodDays} jour(s) : ${bilan.observed.orders} commande(s), ${bilan.anomalies.length} anomalie(s).`,
    };
  },
});

registerTool({
  name: 'getPlatformBrief',
  description:
    'Bilan d’activité de la plateforme : données observées, variations, anomalies chiffrées, et ce qu’il faudrait aller vérifier. N’avance aucune cause et n’applique aucune action.',
  risk: 'READ_ONLY',
  surfaces: ['ADMIN'],
  roles: ['ADMIN'],
  inputSchema: z.object({ days: z.number().int().min(1).max(90).optional() }),
  async handler(input, ctx): Promise<ToolResult> {
    if (!ctx.user || ctx.user.role !== 'ADMIN') throw forbidden('Outil réservé à l’administration.');
    const bilan = await briefService.platform(input.days ?? 1);
    return {
      data: bilan,
      summary: `Bilan sur ${bilan.periodDays} jour(s) : ${bilan.observed.orders} commande(s), ${bilan.anomalies.length} anomalie(s), ${bilan.questions.length} point(s) à vérifier.`,
    };
  },
});

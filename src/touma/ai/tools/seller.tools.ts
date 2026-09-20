import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../db/prisma.js';
import { analyticsService } from '../../admin/analytics.service.js';
import { forbidden } from '../../lib/errors.js';
import { registerTool, type ToolContext, type ToolResult } from './registry.js';

/**
 * Outils du copilote vendeur (§13, §22, §23).
 *
 * La règle de §23 structure les réponses : **DONNÉES**, puis
 * **INTERPRÉTATION**, puis **RECOMMANDATION**, dans des champs distincts.
 * Fondre les trois dans une phrase ferait passer une hypothèse pour un
 * constat — « vos ventes ont baissé parce que vos prix sont trop élevés » dit
 * un fait et une supposition sur le même ton.
 */

const INDISPONIBLE = 'Information non disponible.';

/** Boutique du vendeur, ou refus. C'est ici que l'appartenance est vérifiée. */
async function boutiqueDuVendeur(ctx: ToolContext, storeId: string) {
  if (!ctx.user) throw forbidden('Cet outil demande un compte vendeur.');
  const boutique = await prisma.toumaStore.findUnique({ where: { id: storeId }, select: { id: true, name: true, ownerId: true, countryCode: true } });
  // Même réponse pour « n'existe pas » et « appartient à un autre » : un
  // vendeur ne doit pas pouvoir découvrir l'existence des boutiques voisines
  // en interrogeant l'assistant.
  if (!boutique || (boutique.ownerId !== ctx.user.id && ctx.user.role !== 'ADMIN')) throw forbidden('Boutique introuvable ou appartenant à un autre vendeur.');
  return boutique;
}

registerTool({
  name: 'getSalesAnalytics',
  description:
    'Chiffres de vente d’une boutique du vendeur connecté sur une période : commandes, chiffre d’affaires par devise, panier moyen, taux d’annulation. Renvoie les données brutes, séparées de toute interprétation.',
  risk: 'READ_ONLY',
  surfaces: ['SELLER', 'ADMIN'],
  roles: ['SELLER', 'ADMIN'],
  inputSchema: z.object({ storeId: z.string().trim().min(1).max(120), days: z.number().int().min(1).max(365).optional() }),
  async handler(input, ctx): Promise<ToolResult> {
    const boutique = await boutiqueDuVendeur(ctx, input.storeId);
    const jours = input.days ?? 30;
    const depuis = new Date(Date.now() - jours * 86_400_000);
    const precedent = new Date(depuis.getTime() - jours * 86_400_000);

    const periode = async (debut: Date, fin: Date) => {
      const commandes = await prisma.toumaOrder.findMany({
        where: { storeId: boutique.id, createdAt: { gte: debut, lt: fin } },
        select: { total: true, currency: true, status: true },
      });
      // Les devises ne se somment pas sans taux officiel (V20) : un total par
      // devise, jamais un total unique.
      const parDevise = new Map<string, { total: Prisma.Decimal; commandes: number }>();
      let annulees = 0;
      for (const c of commandes) {
        if (c.status === 'CANCELLED') annulees += 1;
        const e = parDevise.get(c.currency) ?? { total: new Prisma.Decimal(0), commandes: 0 };
        e.total = e.total.plus(c.total);
        e.commandes += 1;
        parDevise.set(c.currency, e);
      }
      return {
        orders: commandes.length,
        cancelled: annulees,
        byCurrency: [...parDevise.entries()].map(([devise, e]) => ({
          currency: devise,
          revenue: e.total.toString(),
          orders: e.commandes,
          averageOrderValue: e.commandes > 0 ? e.total.dividedBy(e.commandes).toFixed(2) : null,
        })),
      };
    };

    const actuel = await periode(depuis, new Date());
    const avant = await periode(precedent, depuis);

    if (actuel.orders === 0 && avant.orders === 0) {
      return { data: { data: actuel, previous: avant, interpretation: [], recommendation: [] }, summary: `${INDISPONIBLE} Aucune commande sur la période ni sur la précédente.` };
    }

    /**
     * L'interprétation est **séparée** et se limite à décrire une variation
     * mesurée. Elle ne propose jamais de cause : la cause demanderait de savoir
     * ce qui s'est passé hors de la base — une rupture d'approvisionnement, un
     * concurrent, une saison — et la base ne le sait pas.
     */
    const interpretation: string[] = [];
    if (avant.orders > 0) {
      const variation = ((actuel.orders - avant.orders) / avant.orders) * 100;
      if (Math.abs(variation) >= 10) {
        interpretation.push(`Le nombre de commandes a ${variation > 0 ? 'augmenté' : 'diminué'} de ${Math.abs(variation).toFixed(0)} % par rapport aux ${jours} jours précédents (${avant.orders} → ${actuel.orders}).`);
      } else {
        interpretation.push(`Le nombre de commandes est stable par rapport aux ${jours} jours précédents (${avant.orders} → ${actuel.orders}).`);
      }
    } else {
      interpretation.push('Aucune commande sur la période précédente : aucune comparaison possible.');
    }
    if (actuel.orders > 0 && actuel.cancelled / actuel.orders > 0.15) {
      interpretation.push(`${actuel.cancelled} commande(s) annulée(s) sur ${actuel.orders}, soit ${((actuel.cancelled / actuel.orders) * 100).toFixed(0)} %.`);
    }

    return {
      data: {
        store: { id: boutique.id, name: boutique.name },
        periodDays: jours,
        data: actuel,
        previous: avant,
        interpretation,
        recommendation: [],
        note: 'Données mesurées en base. L’interprétation décrit une variation constatée et n’en propose aucune cause.',
      },
      summary: `${actuel.orders} commande(s) sur ${jours} jours pour « ${boutique.name} ».`,
    };
  },
});

registerTool({
  name: 'getInventory',
  description:
    'État du stock d’une boutique du vendeur connecté : ruptures, stock faible, articles sans mouvement. Fondé sur les quantités réelles et les commandes réellement passées.',
  risk: 'READ_ONLY',
  surfaces: ['SELLER', 'ADMIN'],
  roles: ['SELLER', 'ADMIN'],
  inputSchema: z.object({ storeId: z.string().trim().min(1).max(120), lowStockThreshold: z.number().int().min(1).max(100).optional() }),
  async handler(input, ctx): Promise<ToolResult> {
    const boutique = await boutiqueDuVendeur(ctx, input.storeId);
    const seuil = input.lowStockThreshold ?? 5;
    const produits = await prisma.toumaProduct.findMany({
      where: { storeId: boutique.id, status: { in: ['ACTIVE', 'DRAFT'] } },
      select: {
        id: true,
        title: true,
        status: true,
        price: true,
        currency: true,
        inventory: { select: { quantity: true } },
        orderItems: { select: { quantity: true, order: { select: { createdAt: true } } } },
      },
    });

    const il_y_a_60 = new Date(Date.now() - 60 * 86_400_000);
    const lignes = produits.map((p) => {
      const stock = p.inventory.reduce((a, i) => a + i.quantity, 0);
      const vendus60 = p.orderItems.filter((oi) => oi.order.createdAt >= il_y_a_60).reduce((a, oi) => a + oi.quantity, 0);
      return { productId: p.id, title: p.title, status: p.status, stock, soldLast60Days: vendus60, price: p.price.toString(), currency: p.currency };
    });

    const ruptures = lignes.filter((l) => l.stock <= 0 && l.status === 'ACTIVE');
    const faibles = lignes.filter((l) => l.stock > 0 && l.stock <= seuil);
    const rapides = lignes.filter((l) => l.soldLast60Days >= 10).sort((a, b) => b.soldLast60Days - a.soldLast60Days).slice(0, 5);
    // « Dormant » se dit d'un produit qui a eu sa chance : actif, en stock, et
    // sans une seule vente en soixante jours. Le dire d'un produit publié hier
    // serait un reproche fait à un produit qui n'a pas encore été vu.
    const dormants = lignes.filter((l) => l.status === 'ACTIVE' && l.stock > 0 && l.soldLast60Days === 0);

    if (lignes.length === 0) return { data: { items: [] }, summary: `${INDISPONIBLE} Aucun produit dans cette boutique.` };

    return {
      data: {
        store: { id: boutique.id, name: boutique.name },
        totals: { products: lignes.length, outOfStock: ruptures.length, lowStock: faibles.length, dormant: dormants.length },
        outOfStock: ruptures,
        lowStock: faibles,
        fastMoving: rapides,
        dormant: dormants.slice(0, 10),
        recommendation: [],
        note: 'Aucune action n’est appliquée : réapprovisionnement, promotion et lot restent des décisions du vendeur.',
      },
      summary: `${lignes.length} produit(s) : ${ruptures.length} en rupture, ${faibles.length} en stock faible, ${dormants.length} sans vente sur 60 jours.`,
    };
  },
});

registerTool({
  name: 'getStoreOverview',
  description: 'Vue d’ensemble d’une boutique du vendeur connecté : statut, vérification, agrégats de vente.',
  risk: 'READ_ONLY',
  surfaces: ['SELLER', 'ADMIN'],
  roles: ['SELLER', 'ADMIN'],
  inputSchema: z.object({ storeId: z.string().trim().min(1).max(120) }),
  async handler(input, ctx): Promise<ToolResult> {
    const boutique = await boutiqueDuVendeur(ctx, input.storeId);
    const stats = await analyticsService.storeStats(boutique.id).catch(() => null);
    if (!stats) return { data: null, summary: `${INDISPONIBLE} Statistiques indisponibles.` };
    return { data: { store: boutique, stats }, summary: `Vue d’ensemble de « ${boutique.name} ».` };
  },
});

/**
 * Brouillon de fiche produit (§14).
 *
 * `LOW_RISK` : rien n'est publié. Le brouillon est rendu au vendeur, qui
 * l'édite et le publie lui-même. La publication, elle, serait `MEDIUM_RISK` et
 * passerait par une confirmation.
 */
registerTool({
  name: 'createDraftListing',
  description:
    'Prépare un brouillon de fiche produit à partir des seules informations fournies par le vendeur. Ne publie rien. N’invente ni matière, ni certification, ni garantie, ni caractéristique technique.',
  risk: 'LOW_RISK',
  surfaces: ['SELLER'],
  roles: ['SELLER', 'ADMIN'],
  inputSchema: z.object({
    title: z.string().trim().min(2).max(200),
    category: z.string().trim().max(120).optional(),
    brand: z.string().trim().max(120).optional(),
    price: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
    currency: z.string().length(3).optional(),
    details: z.string().trim().max(1500).optional(),
  }),
  async handler(input): Promise<ToolResult> {
    const fournis = Object.entries(input).filter(([, v]) => v !== undefined && v !== '');
    const manquants = ['category', 'brand', 'price', 'details'].filter((c) => !(c in input) || !input[c as keyof typeof input]);
    return {
      data: {
        draft: {
          title: input.title,
          category: input.category ?? null,
          brand: input.brand ?? null,
          price: input.price ?? null,
          currency: input.currency ?? null,
          description: input.details ?? null,
        },
        providedFields: fournis.map(([k]) => k),
        /**
         * Nommer ce qui manque plutôt que de le combler. Un vendeur qui publie
         * une fiche portant « matière : coton » qu'il n'a jamais saisie répond
         * en son nom d'une information qu'il n'a pas donnée.
         */
        missingFields: manquants,
        published: false,
        note: 'Brouillon. Rien n’est publié. Les champs manquants ne sont pas comblés : complétez-les avant publication.',
      },
      summary: `Brouillon préparé pour « ${input.title} » ; ${manquants.length} champ(s) à compléter.`,
    };
  },
});

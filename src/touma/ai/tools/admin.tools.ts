import { z } from 'zod';
import { prisma } from '../../../db/prisma.js';
import { forbidden } from '../../lib/errors.js';
import { analyticsService } from '../../admin/analytics.service.js';
import { intelligenceService } from '../../admin/intelligence.service.js';
import { supportService } from '../../support/support.service.js';
import { registerTool, type ToolContext, type ToolResult } from './registry.js';

/**
 * Outils d'administration (§50, §51).
 *
 * Lecture prioritaire, comme demandé. Aucun de ces outils ne suspend un
 * vendeur, ne rembourse, ne modifie une commande : l'agent administratif
 * **prépare** un constat et laisse la décision à l'administrateur.
 *
 * Le contrôle de rôle est doublé — `roles: ['ADMIN']` au registre, puis
 * `requireAdmin` à l'exécution. Non par méfiance envers le registre, mais
 * parce que ces outils lisent des données de toute la plateforme : la
 * conséquence d'un oubli est ici sans commune mesure avec ailleurs.
 */

const INDISPONIBLE = 'Information non disponible.';

function requireAdmin(ctx: ToolContext) {
  if (!ctx.user || ctx.user.role !== 'ADMIN') throw forbidden('Outil réservé à l’administration.');
  return ctx.user;
}

registerTool({
  name: 'getPlatformOverview',
  description: 'Chiffres de la plateforme : commandes, utilisateurs, boutiques, produits, chiffre d’affaires par devise. Données mesurées, jamais estimées.',
  risk: 'READ_ONLY',
  surfaces: ['ADMIN'],
  roles: ['ADMIN'],
  inputSchema: z.object({}),
  async handler(_input, ctx): Promise<ToolResult> {
    requireAdmin(ctx);
    const tableau = await analyticsService.dashboard();
    return { data: tableau, summary: 'Vue d’ensemble de la plateforme.' };
  },
});

registerTool({
  name: 'getOrdersByProvince',
  description: 'Répartition réelle des commandes par province de livraison, sur une période. Les provinces viennent de la base géographique Touma.',
  risk: 'READ_ONLY',
  surfaces: ['ADMIN'],
  roles: ['ADMIN'],
  inputSchema: z.object({ days: z.number().int().min(1).max(365).optional() }),
  async handler(input, ctx): Promise<ToolResult> {
    requireAdmin(ctx);
    const corridors = await intelligenceService.corridors(input.days ?? 30);
    const lignes = (corridors as { rows?: unknown[] }).rows ?? corridors;
    return {
      data: corridors,
      summary: Array.isArray(lignes) && lignes.length > 0 ? `${lignes.length} corridor(s) observé(s).` : `${INDISPONIBLE} Aucune commande sur la période.`,
    };
  },
});

registerTool({
  name: 'getPaymentReliability',
  description: 'Taux d’échec de paiement par méthode et par prestataire, sur une période. Utile pour savoir quel moyen de paiement pose problème.',
  risk: 'READ_ONLY',
  surfaces: ['ADMIN'],
  roles: ['ADMIN'],
  inputSchema: z.object({ days: z.number().int().min(1).max(365).optional() }),
  async handler(input, ctx): Promise<ToolResult> {
    requireAdmin(ctx);
    const fiabilite = await intelligenceService.paymentReliability(input.days ?? 30);
    return { data: fiabilite, summary: 'Fiabilité des paiements sur la période.' };
  },
});

registerTool({
  name: 'getStockTension',
  description: 'Produits en tension : ruptures et stocks faibles face à la demande constatée, sur une période.',
  risk: 'READ_ONLY',
  surfaces: ['ADMIN'],
  roles: ['ADMIN'],
  inputSchema: z.object({ days: z.number().int().min(1).max(365).optional() }),
  async handler(input, ctx): Promise<ToolResult> {
    requireAdmin(ctx);
    const tension = await intelligenceService.stockTension(input.days ?? 30);
    return { data: tension, summary: 'Tension de stock sur la période.' };
  },
});

registerTool({
  name: 'getUnmetDemand',
  description: 'Recherches d’acheteurs restées sans résultat, sur une période : ce que des gens ont cherché et que le catalogue n’a pas.',
  risk: 'READ_ONLY',
  surfaces: ['ADMIN'],
  roles: ['ADMIN'],
  inputSchema: z.object({ days: z.number().int().min(1).max(365).optional() }),
  async handler(input, ctx): Promise<ToolResult> {
    requireAdmin(ctx);
    const demande = await intelligenceService.unmetDemand(input.days ?? 30);
    return { data: demande, summary: 'Demande non satisfaite sur la période.' };
  },
});

/**
 * Vendeurs ayant des difficultés de livraison.
 *
 * Un constat, pas une sanction. Le seuil est affiché avec le résultat, et le
 * volume minimal aussi : sans lui, un vendeur ayant eu une commande annulée
 * sur une commande apparaîtrait à 100 % d'échec et figurerait en tête d'une
 * liste de mauvais élèves.
 */
registerTool({
  name: 'getSellersWithDeliveryIssues',
  description:
    'Vendeurs dont le taux d’annulation ou de litige dépasse un seuil, sur une période, au-dessus d’un volume minimal de commandes. Constat chiffré ; aucune sanction n’est appliquée.',
  risk: 'READ_ONLY',
  surfaces: ['ADMIN'],
  roles: ['ADMIN'],
  inputSchema: z.object({
    days: z.number().int().min(1).max(365).optional(),
    minOrders: z.number().int().min(1).max(1000).optional(),
    thresholdPercent: z.number().int().min(1).max(100).optional(),
  }),
  async handler(input, ctx): Promise<ToolResult> {
    requireAdmin(ctx);
    const jours = input.days ?? 30;
    const volumeMin = input.minOrders ?? 5;
    const seuil = input.thresholdPercent ?? 20;
    const depuis = new Date(Date.now() - jours * 86_400_000);

    const commandes = await prisma.toumaOrder.groupBy({ by: ['storeId', 'status'], where: { createdAt: { gte: depuis } }, _count: { _all: true } });
    const parBoutique = new Map<string, { total: number; annulees: number }>();
    for (const c of commandes) {
      const e = parBoutique.get(c.storeId) ?? { total: 0, annulees: 0 };
      e.total += c._count._all;
      if (c.status === 'CANCELLED') e.annulees += c._count._all;
      parBoutique.set(c.storeId, e);
    }

    const candidats = [...parBoutique.entries()].filter(([, e]) => e.total >= volumeMin && (e.annulees / e.total) * 100 >= seuil);
    if (candidats.length === 0) {
      return {
        data: { sellers: [], criteria: { days: jours, minOrders: volumeMin, thresholdPercent: seuil } },
        summary: `Aucun vendeur au-dessus de ${seuil} % d’annulation sur ${jours} jours (au moins ${volumeMin} commandes).`,
      };
    }

    const boutiques = await prisma.toumaStore.findMany({ where: { id: { in: candidats.map(([id]) => id) } }, select: { id: true, name: true, countryCode: true } });
    const nomPar = new Map(boutiques.map((b) => [b.id, b]));

    return {
      data: {
        criteria: { days: jours, minOrders: volumeMin, thresholdPercent: seuil },
        sellers: candidats
          .map(([id, e]) => ({
            storeId: id,
            name: nomPar.get(id)?.name ?? null,
            countryCode: nomPar.get(id)?.countryCode ?? null,
            orders: e.total,
            cancelled: e.annulees,
            cancellationRate: Number(((e.annulees / e.total) * 100).toFixed(1)),
          }))
          .sort((a, b) => b.cancellationRate - a.cancellationRate),
        note: 'Constat chiffré. Une annulation peut venir de l’acheteur, d’une rupture ou d’un incident de transport : l’outil ne l’attribue à personne.',
      },
      summary: `${candidats.length} vendeur(s) au-dessus du seuil.`,
    };
  },
});

/**
 * Escalade vers un humain (§25).
 *
 * `LOW_RISK` : ouvrir un ticket n'engage rien et son absence engage beaucoup —
 * un acheteur laissé sans réponse par un assistant qui ne sait pas répondre.
 * Exiger une confirmation pour demander de l'aide serait une porte fermée au
 * moment précis où elle doit s'ouvrir.
 */
registerTool({
  name: 'escalateToHuman',
  description:
    'Ouvre un ticket de support et passe la main à un humain lorsque l’assistant ne peut pas répondre. Décrit la demande sans rien promettre : ni remboursement, ni délai, ni geste commercial.',
  risk: 'LOW_RISK',
  surfaces: ['BUYER', 'SELLER', 'BUSINESS', 'SUPPORT'],
  roles: ['BUYER', 'SELLER', 'ADMIN'],
  inputSchema: z.object({
    subject: z.string().trim().min(3).max(160),
    body: z.string().trim().min(10).max(4000),
    orderId: z.string().trim().max(120).optional(),
    category: z.enum(['ORDER', 'PAYMENT', 'DELIVERY', 'RETURN', 'ACCOUNT', 'STORE', 'VERIFICATION', 'OTHER']).optional(),
  }),
  async handler(input, ctx): Promise<ToolResult> {
    if (!ctx.user) throw forbidden('Ouvrir un ticket demande un compte connecté.');
    const ticket = await supportService.create(ctx.user, {
      subject: input.subject,
      // La conversation est résumée dans le message, et la provenance est dite :
      // l'agent qui prendra le ticket doit savoir qu'un assistant a déjà essayé.
      message: `${input.body}\n\n— Ticket ouvert depuis l’assistant Touma, faute d’avoir pu répondre.`,
      category: input.category ?? 'OTHER',
      orderId: input.orderId,
      attachments: [],
    });
    return {
      data: { ticket, escalated: true },
      summary: `Ticket de support ouvert : « ${input.subject} ».`,
    };
  },
});

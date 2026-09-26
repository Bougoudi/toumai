import { z } from 'zod';
import { prisma } from '../../../db/prisma.js';
import { forbidden } from '../../lib/errors.js';
import { corridorService } from '../../trade/corridor.service.js';
import { costService } from '../../trade/cost.service.js';
import { eligibilityService } from '../../trade/eligibility.service.js';
import { fxService } from '../../trade/fx.service.js';
import { tradeRiskService } from '../../trade/risk.service.js';
import { tradeShippingService } from '../../trade/shipping.service.js';
import { timelineService } from '../../trade/timeline.service.js';
import { registerTool, type ToolContext, type ToolResult } from './registry.js';

/**
 * Outils commerce transfrontalier pour l'assistant (§44).
 *
 * La liste des interdits du §44 est exactement ce que ces outils ne peuvent
 * pas faire, **par construction** : ils n'ont aucun moyen d'inventer une taxe,
 * un tarif, un document, une réglementation ou un taux de change, parce qu'ils
 * appellent les services qui refusent déjà de les inventer.
 *
 * L'assistant peut donc expliquer un état, comparer des coûts connus, préparer
 * une liste de contrôle. Il ne peut pas remplir les cases vides.
 */

const INDISPONIBLE = 'Information non disponible.';

registerTool({
  name: 'checkTradeEligibility',
  description:
    'Vérifie si une vente entre deux pays est possible : corridor, devise, moyen de paiement, transport, vendeur, restrictions produit. Rend le motif de chaque critère. N’invente aucune réglementation.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SELLER', 'BUSINESS', 'ADMIN'],
  roles: ['BUYER', 'SELLER', 'ADMIN', null],
  inputSchema: z.object({
    buyerCountry: z.string().length(2),
    sellerCountry: z.string().length(2),
    productId: z.string().trim().max(120).optional(),
    currency: z.string().length(3).optional(),
  }),
  async handler(input, ctx): Promise<ToolResult> {
    const r = await eligibilityService.check({ ...input, userId: ctx.user?.id ?? null });
    return { data: r, summary: `${r.verdict} — ${r.reason}` };
  },
});

registerTool({
  name: 'getTradeCorridors',
  description:
    'Liste les corridors commerciaux, avec le statut déclaré et la capacité réellement opérationnelle. Un corridor déclaré actif mais sans transporteur est rendu comme non opérationnel.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SELLER', 'BUSINESS', 'ADMIN'],
  roles: ['BUYER', 'SELLER', 'ADMIN', null],
  inputSchema: z.object({}),
  async handler(): Promise<ToolResult> {
    const corridors = await corridorService.list();
    if (corridors.length === 0) return { data: { items: [] }, summary: `${INDISPONIBLE} Aucun corridor configuré.` };
    return {
      data: {
        items: corridors.map((c) => ({
          code: c.code,
          origin: c.originCountry,
          destination: c.destinationCountry,
          declaredStatus: c.status,
          operational: c.capability.operational,
          missing: c.capability.missing,
          blockers: c.capability.blockers,
          paymentMethods: c.capability.paymentMethods,
          shippingProviders: c.capability.shippingProviders,
        })),
      },
      summary: `${corridors.length} corridor(s), dont ${corridors.filter((c) => c.capability.operational).length} réellement opérationnel(s).`,
    };
  },
});

registerTool({
  name: 'getTradeCostEstimate',
  description:
    'Coût rendu d’une vente transfrontalière : marchandises, transport, commission, frais et droits **lorsqu’ils sont connus**. Ce qui n’est pas connu est rendu comme inconnu, jamais chiffré. Touma ne calcule aucun droit de douane.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SELLER', 'BUSINESS', 'ADMIN'],
  roles: ['BUYER', 'SELLER', 'ADMIN', null],
  inputSchema: z.object({
    currency: z.string().length(3),
    productAmount: z.string().regex(/^\d+(\.\d{1,4})?$/),
    shippingAmount: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
    sellerCountry: z.string().length(2),
    buyerCountry: z.string().length(2),
  }),
  async handler(input): Promise<ToolResult> {
    const c = await costService.estimate(input);
    return {
      data: c,
      summary: c.complete
        ? `Coût rendu : ${c.total} ${c.currency} (dont ${c.estimatedTotal} estimé).`
        : `Estimation incomplète : ${c.unknownComponents.length} composant(s) inconnu(s). Aucun total n’est annoncé.`,
    };
  },
});

registerTool({
  name: 'getTradeShippingQuote',
  description:
    'Demande un tarif de transport transfrontalier aux transporteurs configurés. Rend « indisponible » si aucun ne répond. N’invente jamais un tarif ni un délai.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SELLER', 'BUSINESS'],
  roles: ['BUYER', 'SELLER', 'ADMIN', null],
  inputSchema: z.object({
    originCountry: z.string().length(2),
    destinationCountry: z.string().length(2),
    weightGrams: z.number().int().min(1).max(500_000),
    currency: z.string().length(3).optional(),
  }),
  async handler(input): Promise<ToolResult> {
    const d = await tradeShippingService.quote({ ...input, currency: input.currency ?? 'XAF' });
    return {
      data: d,
      summary: d.status === 'available' ? `${d.quotes.length} option(s) de transport.` : `${INDISPONIBLE} ${d.reason ?? ''}`.trim(),
    };
  },
});

registerTool({
  name: 'getFxRate',
  description:
    'Taux de change entre deux devises, avec sa source et son horodatage. Rend « indisponible » si aucune source n’est configurée — aucun taux n’est inventé.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SELLER', 'BUSINESS', 'ADMIN'],
  roles: ['BUYER', 'SELLER', 'ADMIN', null],
  inputSchema: z.object({ base: z.string().length(3), quote: z.string().length(3) }),
  async handler(input): Promise<ToolResult> {
    const taux = await fxService.getRate(input.base, input.quote);
    if (!taux) {
      const statut = fxService.status();
      return { data: { available: false, provider: statut.provider }, summary: `${INDISPONIBLE} ${statut.message ?? 'Aucun taux disponible.'}` };
    }
    return { data: { available: true, rate: taux }, summary: `1 ${taux.baseCurrency} = ${taux.rate} ${taux.quoteCurrency} (source : ${taux.sourceName ?? taux.source}).` };
  },
});

registerTool({
  name: 'getTradeOrderStatus',
  description:
    'État d’une commande transfrontalière : chronologie réelle, liste de contrôle, incidents. Les événements viennent des systèmes réels ; aucun n’est complété par interpolation.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SELLER', 'BUSINESS', 'SUPPORT'],
  roles: ['BUYER', 'SELLER', 'ADMIN'],
  inputSchema: z.object({ tradeOrderId: z.string().trim().min(1).max(120) }),
  async handler(input, ctx): Promise<ToolResult> {
    if (!ctx.user) throw forbidden('Cet outil demande un compte connecté.');
    const [chronologie, controle, incidents] = await Promise.all([
      timelineService.forTradeOrder(ctx.user, input.tradeOrderId),
      timelineService.checklist(ctx.user, input.tradeOrderId),
      tradeShippingService.listExceptions(ctx.user, input.tradeOrderId),
    ]);
    return {
      data: { timeline: chronologie, checklist: controle, exceptions: incidents },
      summary: chronologie.currentStage
        ? `Étape actuelle : ${chronologie.currentStage.label}. ${controle.remaining} point(s) de contrôle restant(s).`
        : `${INDISPONIBLE} Aucun événement enregistré sur cette commande.`,
    };
  },
});

registerTool({
  name: 'getTradeRiskAssessment',
  description:
    'Évaluation de risque d’une commande transfrontalière : chaque signal porte son poids et le fait qui l’a produit. C’est une recommandation, jamais une décision.',
  risk: 'READ_ONLY',
  surfaces: ['ADMIN'],
  roles: ['ADMIN'],
  inputSchema: z.object({ tradeOrderId: z.string().trim().min(1).max(120) }),
  async handler(input, ctx): Promise<ToolResult> {
    if (!ctx.user || ctx.user.role !== 'ADMIN') throw forbidden('Outil réservé à l’administration.');
    const r = await tradeRiskService.assess(input.tradeOrderId);
    return { data: { ...r, model: tradeRiskService.explainModel() }, summary: `${r.score}/100 — action recommandée : ${r.recommendedAction}.` };
  },
});

registerTool({
  name: 'getTradeChecklist',
  description:
    'Liste de contrôle d’une opération transfrontalière. Chaque ligne vient d’un fait vérifiable : un document existe ou non, un paiement est confirmé ou non. Aucune case n’est cochée par principe.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SELLER', 'BUSINESS'],
  roles: ['BUYER', 'SELLER', 'ADMIN'],
  inputSchema: z.object({ tradeOrderId: z.string().trim().min(1).max(120) }),
  async handler(input, ctx): Promise<ToolResult> {
    if (!ctx.user) throw forbidden('Cet outil demande un compte connecté.');
    const c = await timelineService.checklist(ctx.user, input.tradeOrderId);
    return { data: c, summary: c.complete ? 'Tous les points de contrôle sont satisfaits.' : `${c.remaining} point(s) restant(s).` };
  },
});

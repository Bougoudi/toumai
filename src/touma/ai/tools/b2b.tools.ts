import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../db/prisma.js';
import { b2bService } from '../../b2b/b2b.service.js';
import { trustService } from '../../trust/trust.service.js';
import { forbidden } from '../../lib/errors.js';
import { registerTool, type ToolContext, type ToolResult } from './registry.js';

/**
 * Outils B2B (§17, §18, §19).
 *
 * Trois interdits structurent ce fichier :
 *
 * - une demande de devis n'est jamais **envoyée** par l'assistant : il prépare
 *   un brouillon, l'acheteur l'envoie ;
 * - aucun fournisseur n'est inventé : le rapprochement ne rend que des
 *   fournisseurs existants, avec les facteurs utilisés ;
 * - aucun devis n'est déclaré « meilleur » : l'outil rend des différences
 *   factuelles, et l'acheteur arbitre. « Meilleur » suppose un critère, et le
 *   critère appartient à celui qui achète.
 */

const INDISPONIBLE = 'Information non disponible.';

function requireUser(ctx: ToolContext) {
  if (!ctx.user) throw forbidden('Cet outil demande un compte connecté.');
  return ctx.user;
}

registerTool({
  name: 'createDraftRFQ',
  description:
    'Prépare un brouillon de demande de devis (RFQ) à partir des informations fournies : quantité, catégorie, destination, échéance. N’envoie rien : l’envoi aux fournisseurs demande une confirmation explicite.',
  risk: 'LOW_RISK',
  surfaces: ['BUSINESS'],
  roles: ['BUYER', 'SELLER', 'ADMIN'],
  inputSchema: z.object({
    title: z.string().trim().min(3).max(200),
    quantity: z.number().int().min(1).max(10_000_000),
    unit: z.string().trim().max(40).optional(),
    category: z.string().trim().max(120).optional(),
    destinationCountry: z.string().length(2).optional(),
    targetPrice: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
    currency: z.string().length(3).optional(),
    deadlineDays: z.number().int().min(1).max(365).optional(),
    details: z.string().trim().max(2000).optional(),
  }),
  async handler(input): Promise<ToolResult> {
    const manquants = ['category', 'destinationCountry', 'deadlineDays', 'details'].filter((c) => !input[c as keyof typeof input]);
    return {
      data: {
        draft: {
          title: input.title,
          quantity: input.quantity,
          unit: input.unit ?? null,
          category: input.category ?? null,
          destinationCountry: input.destinationCountry ?? null,
          targetPrice: input.targetPrice ?? null,
          currency: input.currency ?? null,
          deadline: input.deadlineDays ? new Date(Date.now() + input.deadlineDays * 86_400_000) : null,
          details: input.details ?? null,
        },
        missingFields: manquants,
        sent: false,
        note: 'Brouillon. Aucun fournisseur n’a été contacté. L’envoi demande une confirmation explicite.',
      },
      summary: `Brouillon de demande de devis pour ${input.quantity} × « ${input.title} » ; ${manquants.length} champ(s) à compléter.`,
    };
  },
});

registerTool({
  name: 'listMyRFQs',
  description: 'Liste les demandes de devis de l’utilisateur connecté, avec leur statut et le nombre de devis reçus.',
  risk: 'READ_ONLY',
  surfaces: ['BUSINESS', 'ADMIN'],
  roles: ['BUYER', 'SELLER', 'ADMIN'],
  inputSchema: z.object({ limit: z.number().int().min(1).max(20).optional() }),
  async handler(input, ctx): Promise<ToolResult> {
    const user = requireUser(ctx);
    const page = await b2bService.listRfqs(user, { scope: 'mine', page: 1, limit: input.limit ?? 10 } as Parameters<typeof b2bService.listRfqs>[1]);
    const items = (page as { items?: unknown[] }).items ?? [];
    return { data: page, summary: items.length === 0 ? `${INDISPONIBLE} Aucune demande de devis.` : `${items.length} demande(s) de devis.` };
  },
});

/**
 * Rapprochement de fournisseurs (§18).
 *
 * Les facteurs utilisés sont **affichés** avec le résultat. Un score sans ses
 * facteurs est une opinion présentée comme un calcul, et un acheteur qui
 * engage une commande en gros a le droit de savoir sur quoi il s'appuie.
 *
 * Le pays n'est utilisé que pour ce qu'il détermine réellement — livraison,
 * devise, passage de frontière — jamais comme indice de fiabilité (V21 §38).
 */
registerTool({
  name: 'searchSuppliers',
  description:
    'Recherche des fournisseurs réels sur Touma par catégorie, pays et quantité minimale. Renvoie les facteurs utilisés pour le classement. N’invente aucun fournisseur et ne garantit aucune capacité de production.',
  risk: 'READ_ONLY',
  surfaces: ['BUSINESS', 'ADMIN'],
  roles: ['BUYER', 'SELLER', 'ADMIN'],
  inputSchema: z.object({
    category: z.string().trim().max(120).optional(),
    countryCode: z.string().length(2).optional(),
    minQuantity: z.number().int().min(1).max(10_000_000).optional(),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  async handler(input): Promise<ToolResult> {
    const limite = input.limit ?? 5;
    const boutiques = await prisma.toumaStore.findMany({
      where: {
        status: 'ACTIVE',
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        ...(input.category ? { products: { some: { status: 'ACTIVE', category: { OR: [{ id: input.category }, { slug: input.category }, { name: { contains: input.category, mode: 'insensitive' } }] } } } } : {}),
        ...(input.minQuantity ? { products: { some: { status: 'ACTIVE', minOrderQty: { lte: input.minQuantity } } } } : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        countryCode: true,
        verificationStatus: true,
        createdAt: true,
        _count: { select: { products: true, orders: true } },
        products: { where: { status: 'ACTIVE' }, select: { minOrderQty: true, price: true, currency: true }, take: 50 },
      },
      take: limite * 3,
    });

    if (boutiques.length === 0) {
      return { data: { suppliers: [], factors: [] }, summary: `${INDISPONIBLE} Aucun fournisseur ne correspond à ces critères.` };
    }

    const notes = await Promise.all(boutiques.map((b) => trustService.get('SELLER', b.id).catch(() => null)));

    const lignes = boutiques.map((b, i) => {
      const moq = b.products.length > 0 ? Math.min(...b.products.map((p) => p.minOrderQty)) : null;
      const prix = b.products.map((p) => p.price);
      const devises = new Set(b.products.map((p) => p.currency));
      const confiance = notes[i];
      // Un score de rapprochement, et les faits qui le composent, côte à côte.
      const facteurs = {
        verified: b.verificationStatus === 'APPROVED',
        trustLevel: confiance?.level ?? null,
        trustScore: confiance?.score ?? null,
        activeProducts: b._count.products,
        completedOrders: b._count.orders,
        minOrderQuantity: moq,
        priceRange: prix.length > 0 && devises.size === 1 ? { min: Prisma.Decimal.min(...prix).toString(), max: Prisma.Decimal.max(...prix).toString(), currency: [...devises][0] } : null,
      };
      const score =
        (facteurs.verified ? 0.3 : 0) +
        (confiance?.score != null ? Math.min(0.3, (confiance.score / 100) * 0.3) : 0) +
        Math.min(0.2, b._count.orders / 50) +
        Math.min(0.2, b._count.products / 50);
      return {
        supplierId: b.id,
        name: b.name,
        slug: b.slug,
        countryCode: b.countryCode,
        matchScore: Number(score.toFixed(3)),
        factors: facteurs,
        unavailable: [
          ...(confiance ? [] : ['niveau de confiance (historique insuffisant)']),
          ...(moq === null ? ['quantité minimale de commande'] : []),
          'délai de production',
          'taux de réponse aux demandes de devis',
        ],
      };
    });

    lignes.sort((a, b) => b.matchScore - a.matchScore);

    return {
      data: {
        suppliers: lignes.slice(0, limite),
        /** §18 : « afficher les facteurs utilisés ». Ils sont nommés, pas résumés. */
        factors: ['vérification de la boutique', 'niveau de confiance Touma', 'commandes honorées', 'nombre de produits actifs', 'quantité minimale de commande'],
        excludedFactors: ['nationalité', 'origine', 'religion', 'appartenance politique du dirigeant'],
        note: 'Le pays sert uniquement à la livraison, à la devise et au passage de frontière — jamais comme indice de fiabilité.',
      },
      summary: `${Math.min(limite, lignes.length)} fournisseur(s) correspondant(s).`,
      cards: lignes.slice(0, limite).map((l) => ({
        type: 'SUPPLIER',
        id: l.supplierId,
        name: l.name,
        countryCode: l.countryCode,
        verified: l.factors.verified,
        trustLevel: l.factors.trustLevel,
        minOrderQuantity: l.factors.minOrderQuantity,
        activeProducts: l.factors.activeProducts,
      })),
    };
  },
});

/**
 * Comparaison de devis (§19).
 *
 * Le coût total est calculé **uniquement** quand tous les devis sont dans la
 * même devise. Convertir au taux du jour pour pouvoir classer produirait un
 * écart chiffré qui n'existe pas au moment de payer.
 */
registerTool({
  name: 'compareQuotes',
  description:
    'Compare les devis reçus sur une demande de devis : prix unitaire, quantité minimale, transport, délai, confiance du fournisseur, coût total estimé. Ne désigne aucun devis comme meilleur.',
  risk: 'READ_ONLY',
  surfaces: ['BUSINESS', 'ADMIN'],
  roles: ['BUYER', 'SELLER', 'ADMIN'],
  inputSchema: z.object({ rfqId: z.string().trim().min(1).max(120) }),
  async handler(input, ctx): Promise<ToolResult> {
    const user = requireUser(ctx);
    // `getRfq` applique la visibilité B2B : l'auteur de la demande et les
    // fournisseurs invités. Elle n'est pas réécrite ici.
    const rfq = (await b2bService.getRfq(user, input.rfqId).catch(() => null)) as Record<string, any> | null;
    if (!rfq) return { data: null, summary: `${INDISPONIBLE} Demande de devis introuvable.` };

    const devis = (rfq.quotes ?? []) as Array<Record<string, any>>;
    if (devis.length === 0) return { data: { quotes: [] }, summary: `${INDISPONIBLE} Aucun devis reçu sur cette demande.` };

    const lignes = devis.map((q) => {
      const unitaire = q.unitPrice ? new Prisma.Decimal(String(q.unitPrice)) : null;
      const quantite = Number(q.quantity ?? rfq.quantity ?? 0);
      const transport = q.shippingCost ? new Prisma.Decimal(String(q.shippingCost)) : null;
      const total = q.total ? new Prisma.Decimal(String(q.total)) : unitaire && quantite > 0 ? unitaire.mul(quantite).plus(transport ?? 0) : null;
      return {
        quoteId: q.id,
        supplier: q.supplier?.name ?? q.store?.name ?? null,
        unitPrice: unitaire?.toString() ?? null,
        quantity: quantite || null,
        minOrderQuantity: q.minOrderQty ?? null,
        shippingCost: transport?.toString() ?? null,
        leadTimeDays: q.leadTimeDays ?? null,
        currency: q.currency ?? null,
        estimatedTotal: total?.toString() ?? null,
        status: q.status ?? null,
        unavailable: [
          ...(unitaire ? [] : ['prix unitaire']),
          ...(transport ? [] : ['coût de transport']),
          ...(q.leadTimeDays ? [] : ['délai de production']),
        ],
      };
    });

    const devises = new Set(lignes.map((l) => l.currency).filter(Boolean));
    return {
      data: {
        rfq: { id: rfq.id, title: rfq.title ?? null, quantity: rfq.quantity ?? null },
        quotes: lignes,
        comparableOnTotal: devises.size === 1,
        ...(devises.size > 1 ? { currencyWarning: 'Les devis sont exprimés dans des devises différentes : les totaux ne sont pas comparables sans taux de change officiel.' } : {}),
        note: 'Différences factuelles. Aucun devis n’est désigné comme meilleur : le critère d’arbitrage appartient à l’acheteur.',
      },
      summary: `${lignes.length} devis comparé(s).`,
    };
  },
});

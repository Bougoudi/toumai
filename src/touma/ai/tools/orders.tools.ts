import { z } from 'zod';
import { prisma } from '../../../db/prisma.js';
import { cartService } from '../../cart/cart.service.js';
import { orderService } from '../../orders/order.service.js';
import { logisticsService } from '../../logistics/logistics.service.js';
import { registerTool, type ToolContext, type ToolResult } from './registry.js';

/**
 * Outils de commande, panier et livraison.
 *
 * Chacun appelle le service métier avec l'utilisateur courant. `orderService`
 * rend `notFound` pour la commande d'un autre — c'est lui qui refuse, pas un
 * contrôle réécrit ici. Le test de sécurité vérifie qu'un acheteur A ne peut
 * pas lire la commande d'un acheteur B *par l'assistant*.
 */

const INDISPONIBLE = 'Information non disponible.';

function requireUser(ctx: ToolContext) {
  if (!ctx.user) throw new Error('Cet outil demande un compte connecté.');
  return ctx.user;
}

/** Carte commande : jamais l'adresse complète du destinataire (V17). */
function carteCommande(o: Record<string, any>) {
  return {
    type: 'ORDER',
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    total: o.total,
    currency: o.currency,
    itemCount: Array.isArray(o.items) ? o.items.reduce((a: number, i: { quantity: number }) => a + i.quantity, 0) : null,
    createdAt: o.createdAt,
    store: o.store ? { id: o.store.id, name: o.store.name } : null,
  };
}

registerTool({
  name: 'listMyOrders',
  description: 'Liste les commandes de l’utilisateur connecté (les siennes uniquement). Statut, montant, devise, date. Ne renvoie jamais la commande d’un autre.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SUPPORT', 'BUSINESS'],
  roles: ['BUYER', 'SELLER', 'ADMIN'],
  inputSchema: z.object({
    status: z.string().trim().max(40).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  async handler(input, ctx): Promise<ToolResult> {
    const user = requireUser(ctx);
    const page = await orderService.list(user, { status: input.status, page: 1, limit: input.limit ?? 10 } as Parameters<typeof orderService.list>[1]);
    const cards = (page.items as Array<Record<string, any>>).map(carteCommande);
    return {
      data: { total: page.total, items: cards },
      summary: cards.length === 0 ? `${INDISPONIBLE} Aucune commande.` : `${page.total} commande(s).`,
      cards,
    };
  },
});

registerTool({
  name: 'getOrder',
  description: 'Détail d’une commande de l’utilisateur connecté : statut, articles, montants, paiement. Refuse la commande d’un autre utilisateur.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SUPPORT', 'BUSINESS'],
  roles: ['BUYER', 'SELLER', 'ADMIN'],
  inputSchema: z.object({ orderId: z.string().trim().min(1).max(120) }),
  async handler(input, ctx): Promise<ToolResult> {
    const user = requireUser(ctx);
    // `orderService.get` lève `notFound` aussi bien pour une commande
    // inexistante que pour celle d'un autre : la même réponse dans les deux cas
    // est ce qui empêche de deviner l'existence d'une commande (anti-IDOR).
    const commande = await orderService.get(user, input.orderId).catch(() => null);
    if (!commande) return { data: null, summary: `${INDISPONIBLE} Commande introuvable.` };
    return { data: commande, summary: `Commande ${(commande as { orderNumber: string }).orderNumber}.`, cards: [carteCommande(commande as Record<string, any>)] };
  },
});

registerTool({
  name: 'getOrderTracking',
  description: 'Suivi réel d’une commande : étapes enregistrées par le transporteur. N’invente aucun événement ni aucune date d’arrivée.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SUPPORT'],
  roles: ['BUYER', 'SELLER', 'ADMIN'],
  inputSchema: z.object({ orderId: z.string().trim().min(1).max(120) }),
  async handler(input, ctx): Promise<ToolResult> {
    const user = requireUser(ctx);
    const suivi = await orderService.tracking(user, input.orderId).catch(() => null);
    if (!suivi) return { data: null, summary: `${INDISPONIBLE} Aucun suivi pour cette commande.` };
    const evenements = (suivi as { events?: unknown[] }).events ?? [];
    return {
      data: suivi,
      summary:
        evenements.length === 0
          ? 'Aucun événement de suivi enregistré pour l’instant — ce n’est pas un retard constaté, c’est une absence d’information.'
          : `${evenements.length} événement(s) de suivi.`,
    };
  },
});

registerTool({
  name: 'getMyCart',
  description: 'Contenu du panier de l’utilisateur connecté : articles, quantités, sous-totaux par devise. Ne modifie rien.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER'],
  roles: ['BUYER', 'SELLER', 'ADMIN'],
  inputSchema: z.object({}),
  async handler(_input, ctx): Promise<ToolResult> {
    const user = requireUser(ctx);
    const panier = await cartService.get(user.id);
    const articles = (panier as { items?: unknown[] }).items ?? [];
    return { data: panier, summary: articles.length === 0 ? 'Panier vide.' : `${articles.length} ligne(s) au panier.` };
  },
});

/**
 * Devis de transport (§28).
 *
 * Sans transporteur réel branché, `logisticsService.quote` ne fabrique pas un
 * délai plausible : il n'en rend aucun. L'outil relaie ce vide tel quel —
 * « estimation indisponible » — parce qu'un délai inventé se transforme en
 * promesse faite à un acheteur (V17).
 */
registerTool({
  name: 'getShippingQuote',
  description:
    'Demande un tarif et un délai de livraison aux transporteurs configurés. Si aucun transporteur ne peut répondre, renvoie « Estimation indisponible » et n’invente ni prix ni délai.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SELLER', 'BUSINESS', 'SUPPORT'],
  roles: ['BUYER', 'SELLER', 'ADMIN', null],
  inputSchema: z.object({
    originCountry: z.string().length(2),
    destinationCountry: z.string().length(2),
    destinationProvinceId: z.string().trim().max(120).optional(),
    weightGrams: z.number().int().min(1).max(200_000),
    currency: z.string().length(3).optional(),
  }),
  async handler(input): Promise<ToolResult> {
    const devis = await logisticsService
      .quote({
        origin: { countryCode: input.originCountry },
        destination: { countryCode: input.destinationCountry, provinceId: input.destinationProvinceId ?? null },
        parcel: { weightGrams: input.weightGrams },
        currency: input.currency ?? 'XAF',
      })
      .catch(() => null);

    const options = Array.isArray(devis) ? devis : ((devis as { quotes?: unknown[] } | null)?.quotes ?? []);
    if (!devis || options.length === 0) {
      return {
        data: { available: false, quotes: [] },
        summary: 'Estimation indisponible : aucun transporteur configuré ne dessert cette destination.',
      };
    }
    return { data: { available: true, quotes: options }, summary: `${options.length} option(s) de livraison.` };
  },
});

/**
 * Réachat (§30).
 *
 * L'outil identifie des produits déjà commandés plusieurs fois et l'intervalle
 * moyen constaté. Il **prépare** ; il ne commande pas. Passer commande reste
 * `HIGH_RISK` et demande une confirmation.
 */
registerTool({
  name: 'suggestReorder',
  description:
    'Identifie les produits que l’utilisateur a commandés plusieurs fois et l’intervalle moyen réellement constaté entre ses commandes. Ne passe aucune commande.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER'],
  roles: ['BUYER', 'SELLER', 'ADMIN'],
  inputSchema: z.object({ limit: z.number().int().min(1).max(10).optional() }),
  async handler(input, ctx): Promise<ToolResult> {
    const user = requireUser(ctx);
    const lignes = await prisma.toumaOrderItem.findMany({
      where: { order: { buyerId: user.id, status: { in: ['DELIVERED', 'COMPLETED'] } } },
      select: { productId: true, quantity: true, order: { select: { createdAt: true } }, product: { select: { title: true, status: true, price: true, currency: true } } },
      orderBy: { order: { createdAt: 'asc' } },
    });

    const parProduit = new Map<string, { titre: string; dates: Date[]; quantite: number; actif: boolean; prix: string; devise: string }>();
    for (const l of lignes) {
      if (!l.productId || !l.product) continue;
      const e = parProduit.get(l.productId) ?? { titre: l.product.title, dates: [], quantite: 0, actif: l.product.status === 'ACTIVE', prix: l.product.price.toString(), devise: l.product.currency };
      e.dates.push(l.order.createdAt);
      e.quantite += l.quantity;
      parProduit.set(l.productId, e);
    }

    const suggestions = [...parProduit.entries()]
      // Deux achats au minimum : une seule commande ne dit rien d'une habitude.
      .filter(([, e]) => e.dates.length >= 2 && e.actif)
      .map(([id, e]) => {
        const ecarts: number[] = [];
        for (let i = 1; i < e.dates.length; i += 1) ecarts.push((e.dates[i].getTime() - e.dates[i - 1].getTime()) / 86_400_000);
        const moyen = ecarts.reduce((a, b) => a + b, 0) / ecarts.length;
        const dernier = e.dates.at(-1)!;
        return {
          productId: id,
          title: e.titre,
          price: e.prix,
          currency: e.devise,
          purchases: e.dates.length,
          averageIntervalDays: Math.round(moyen),
          lastPurchasedAt: dernier,
          daysSinceLast: Math.floor((Date.now() - dernier.getTime()) / 86_400_000),
        };
      })
      .sort((a, b) => b.daysSinceLast / Math.max(1, b.averageIntervalDays) - a.daysSinceLast / Math.max(1, a.averageIntervalDays))
      .slice(0, input.limit ?? 5);

    if (suggestions.length === 0) {
      return { data: { items: [] }, summary: `${INDISPONIBLE} Aucun produit n’a été commandé plus d’une fois.` };
    }
    return {
      data: { items: suggestions, note: 'Intervalles calculés sur les commandes livrées de l’utilisateur. Aucun stock domestique n’est estimé.' },
      summary: `${suggestions.length} produit(s) régulièrement commandé(s).`,
    };
  },
});

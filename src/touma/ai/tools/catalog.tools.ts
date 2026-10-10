import { z } from 'zod';
import { prisma } from '../../../db/prisma.js';
import { productService } from '../../catalog/product.service.js';
import { geoService } from '../../geo/geo.service.js';
import { trustService, redactForPublic } from '../../trust/trust.service.js';
import { parseShoppingIntent } from '../providers/rule-based.provider.js';
import { registerTool, type ToolResult } from './registry.js';

/**
 * Outils de catalogue : recherche, fiche produit, comparaison, disponibilité.
 *
 * Tous en lecture seule et tous adossés à `productService`. Ce que l'assistant
 * affiche est ce que la fiche produit affiche — même filtrage des brouillons,
 * même exclusion des boutiques fermées, même prix de référence vérifié.
 */

const INDISPONIBLE = 'Information non disponible.';

/** Carte produit (§63) : uniquement des champs rendus par le service. */
function carteProduit(p: Record<string, any>) {
  return {
    type: 'PRODUCT',
    id: p.id,
    title: p.title,
    slug: p.slug,
    price: p.price,
    currency: p.currency,
    image: p.image ?? null,
    store: p.store ? { id: p.store.id, name: p.store.name, verified: p.store.verificationStatus === 'APPROVED' } : null,
    category: p.category ?? null,
    inStock: p.inStock ?? null,
    stock: p.stock ?? null,
    rating: p.ratingCount > 0 ? p.rating : null,
    ratingCount: p.ratingCount ?? 0,
  };
}

registerTool({
  name: 'searchProducts',
  description:
    'Recherche des produits actifs du catalogue Touma par mots-clés, prix, catégorie, pays, disponibilité. Renvoie uniquement des produits réellement en base. Ne sait pas estimer un délai de livraison.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SELLER', 'BUSINESS', 'ADMIN', 'SUPPORT'],
  roles: ['BUYER', 'SELLER', 'ADMIN', null],
  inputSchema: z.object({
    query: z.string().trim().max(200).optional(),
    minPrice: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
    maxPrice: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
    category: z.string().trim().max(120).optional(),
    country: z.string().length(2).optional(),
    inStockOnly: z.boolean().optional(),
    verifiedOnly: z.boolean().optional(),
    sort: z.enum(['recent', 'price_asc', 'price_desc', 'popular']).optional(),
    limit: z.number().int().min(1).max(24).optional(),
  }),
  async handler(input): Promise<ToolResult> {
    const page = await productService.list({
      q: input.query,
      minPrice: input.minPrice,
      maxPrice: input.maxPrice,
      category: input.category,
      country: input.country,
      availability: input.inStockOnly ? 'in_stock' : undefined,
      verifiedOnly: input.verifiedOnly ? 'true' : undefined,
      sort: input.sort ?? 'recent',
      page: 1,
      limit: input.limit ?? 8,
    } as Parameters<typeof productService.list>[0]);

    const cards = page.items.map((p) => carteProduit(p as Record<string, any>));
    return {
      data: { total: page.total, items: cards },
      summary: cards.length === 0 ? `Aucun produit pour « ${input.query ?? 'ces critères'} ».` : `${page.total} produit(s) trouvé(s), ${cards.length} rendu(s).`,
      cards,
    };
  },
});

registerTool({
  name: 'getProduct',
  description:
    'Fiche complète d’un produit : prix, devise, stock, boutique, prix de référence vérifié, note. Ne renvoie jamais un brouillon ni un produit d’une boutique fermée.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SELLER', 'BUSINESS', 'ADMIN', 'SUPPORT'],
  roles: ['BUYER', 'SELLER', 'ADMIN', null],
  inputSchema: z.object({ productId: z.string().trim().min(1).max(120) }),
  async handler(input, ctx): Promise<ToolResult> {
    const produit = await productService.get(input.productId, ctx.user ?? undefined).catch(() => null);
    if (!produit) return { data: null, summary: `${INDISPONIBLE} Produit introuvable : ${input.productId}.` };
    const carte = carteProduit(produit as Record<string, any>);
    return { data: produit, summary: `Fiche du produit « ${(produit as { title: string }).title} ».`, cards: [carte] };
  },
});

/**
 * Comparaison de produits (§12).
 *
 * Les champs sont comparés un à un, et **ce qui manque est nommé comme
 * manquant**. C'est la règle entière de cet outil : un tableau comparatif dont
 * une case est comblée par une supposition est pire qu'un tableau troué, parce
 * qu'on ne voit plus où regarder.
 */
registerTool({
  name: 'compareProducts',
  description:
    'Compare 2 à 4 produits sur prix, devise, boutique, confiance du vendeur, note, disponibilité, pays d’expédition. Les caractéristiques absentes sont rendues comme « Information non disponible » et jamais devinées.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'BUSINESS', 'ADMIN'],
  roles: ['BUYER', 'SELLER', 'ADMIN', null],
  inputSchema: z.object({ productIds: z.array(z.string().trim().min(1).max(120)).min(2).max(4) }),
  async handler(input, ctx): Promise<ToolResult> {
    const fiches = await Promise.all(input.productIds.map((id: string) => productService.get(id, ctx.user ?? undefined).catch(() => null)));
    const trouvees = fiches.filter((f): f is NonNullable<typeof f> => f !== null) as Array<Record<string, any>>;
    if (trouvees.length < 2) {
      return { data: null, summary: `${INDISPONIBLE} Moins de deux produits comparables ont été trouvés.` };
    }

    const confiances = await Promise.all(
      trouvees.map(async (p) => {
        if (!p.store?.id) return null;
        // Convention V21 : la confiance d'un vendeur est portée par l'identifiant
        // de sa boutique sous le type `SELLER`. Suivre la convention existante
        // plutôt qu'en introduire une seconde.
        const t = await trustService.get('SELLER', p.store.id).catch(() => null);
        // La ventilation est rédigée pour le public : le score de fraude du
        // vendeur ne sort pas d'ici (correctif V21, conservé).
        return t ? { score: t.score, level: t.level, components: redactForPublic(t.components) } : null;
      }),
    );

    const lignes = trouvees.map((p, i) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      currency: p.currency,
      referencePrice: p.referencePrice ?? null,
      savings: p.savings ?? null,
      store: p.store ? { name: p.store.name, verified: p.store.verificationStatus === 'APPROVED' } : null,
      trust: confiances[i] ? { score: confiances[i]!.score, level: confiances[i]!.level } : null,
      rating: p.ratingCount > 0 ? p.rating : null,
      ratingCount: p.ratingCount ?? 0,
      inStock: p.inStock ?? null,
      shippedFrom: p.countryCode ?? null,
      /**
       * Deux prix en devises différentes ne se comparent pas sans taux officiel
       * (V20). L'outil le signale au lieu de convertir, parce qu'une conversion
       * au taux du jour affichée comme un écart de prix est un chiffre faux.
       */
      comparableOnPrice: p.currency === trouvees[0].currency,
    }));

    const devises = new Set(lignes.map((l) => l.currency));
    const manquants: string[] = [];
    for (const l of lignes) {
      if (l.trust === null) manquants.push(`confiance du vendeur de « ${l.title} »`);
      if (l.rating === null) manquants.push(`note de « ${l.title} » (aucun avis)`);
    }

    return {
      data: {
        rows: lignes,
        sameCurrency: devises.size === 1,
        ...(devises.size > 1 ? { priceWarning: 'Les prix sont exprimés dans des devises différentes : ils ne sont pas comparables sans taux de change officiel.' } : {}),
        unavailable: manquants,
        /** Aucun « meilleur » : des différences factuelles (§19, §33). */
        note: 'Comparaison factuelle. Aucun produit n’est désigné comme meilleur.',
      },
      summary: `Comparaison de ${lignes.length} produits.`,
      cards: trouvees.map((p) => carteProduit(p)),
    };
  },
});

/**
 * Disponibilité à une destination.
 *
 * L'outil ne calcule aucun délai : c'est `getShippingQuote` qui interroge les
 * transporteurs, et sans transporteur configuré il dit « estimation
 * indisponible » (V17). Ici on répond seulement à une question factuelle : la
 * destination existe-t-elle, et le produit part-il d'où.
 */
registerTool({
  name: 'checkProvinceAvailability',
  description:
    'Vérifie qu’une province ou localité existe dans la base géographique Touma et indique depuis quel pays un produit est expédié. Ne calcule aucun délai de livraison.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'SELLER', 'BUSINESS', 'ADMIN', 'SUPPORT'],
  roles: ['BUYER', 'SELLER', 'ADMIN', null],
  inputSchema: z.object({
    destination: z.string().trim().min(2).max(80),
    countryCode: z.string().length(2).optional(),
    productId: z.string().trim().max(120).optional(),
  }),
  async handler(input): Promise<ToolResult> {
    const pays = input.countryCode ?? 'TD';
    const { items: provinces } = await geoService.provinces(pays);
    const cible = normalise(input.destination);
    const province = provinces.find((p: { id: string; name: string }) => normalise(p.name) === cible || normalise(p.name).includes(cible) || cible.includes(normalise(p.name)));

    let localites: Array<{ id: string; name: string }> = [];
    if (!province) {
      // `searchLocalities` rend `{ items }`, pas un tableau. Traité comme un
      // tableau, `localites.length` valait `undefined` — et `undefined === 0`
      // étant faux, une ville inexistante était déclarée trouvée. Le test l'a
      // relevé : c'est exactement la localité inventée que V17 interdit.
      const trouvees = await geoService.searchLocalities(pays, input.destination, 5).catch(() => ({ items: [] }));
      localites = trouvees.items as Array<{ id: string; name: string }>;
    }

    if (!province && localites.length === 0) {
      // Ne jamais inventer une localité (V17). Si la base ne la connaît pas,
      // c'est cela qu'il faut dire, pas approcher au plus proche.
      return { data: { found: false }, summary: `${INDISPONIBLE} « ${input.destination} » ne correspond à aucune province ni localité connue en base pour ${pays}.` };
    }

    const produit = input.productId ? await prisma.toumaProduct.findFirst({ where: { id: input.productId, status: 'ACTIVE' }, select: { title: true, countryCode: true } }) : null;

    return {
      data: {
        found: true,
        province: province ? { id: province.id, name: province.name } : null,
        localities: localites.map((l) => ({ id: l.id, name: l.name })),
        product: produit ? { title: produit.title, shippedFrom: produit.countryCode } : null,
        crossBorder: produit ? produit.countryCode !== pays : null,
        deliveryEstimate: null,
        deliveryNote: 'Le délai de livraison se demande avec getShippingQuote : il dépend du transporteur, pas de la destination seule.',
      },
      summary: province ? `Province reconnue : ${province.name}.` : `${localites.length} localité(s) correspondante(s).`,
    };
  },
});

/**
 * Traduction d'une phrase d'achat en filtres.
 *
 * Utile même avec un modèle de langage branché : l'analyse est déterministe,
 * donc reproductible, et un budget mal lu coûte cher — on ne veut pas que la
 * même phrase donne deux filtres différents selon le jour.
 */
registerTool({
  name: 'parseShoppingQuery',
  description:
    'Traduit une phrase d’achat en français (« un téléphone à moins de 100 000 XAF livré à N’Djamena ») en filtres de recherche : termes, budget, devise, destination. Ce qui n’est pas exprimé reste vide.',
  risk: 'READ_ONLY',
  surfaces: ['BUYER', 'BUSINESS'],
  roles: ['BUYER', 'SELLER', 'ADMIN', null],
  inputSchema: z.object({ phrase: z.string().trim().min(2).max(300) }),
  async handler(input): Promise<ToolResult> {
    const intention = parseShoppingIntent(input.phrase);
    let destination: { id: string; name: string } | null = null;
    if (intention.destination) {
      const { items: provinces } = await geoService.provinces('TD');
      const cible = normalise(intention.destination);
      const p = provinces.find((pr: { id: string; name: string }) => normalise(pr.name) === cible || normalise(pr.name).includes(cible) || cible.includes(normalise(pr.name)));
      destination = p ? { id: p.id, name: p.name } : null;
    }
    return {
      data: {
        ...intention,
        // La destination mentionnée et la destination *reconnue* sont deux
        // choses : la seconde vient de la base géographique, la première du
        // texte. Les confondre ferait passer un lieu inventé pour une province.
        resolvedDestination: destination,
        destinationRecognised: intention.destination ? destination !== null : null,
      },
      summary: `Intention : ${intention.terms || '(aucun terme)'}${intention.maxPrice ? `, budget max ${intention.maxPrice}` : ''}${destination ? `, destination ${destination.name}` : ''}.`,
    };
  },
});

function normalise(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

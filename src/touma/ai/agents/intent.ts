import { elaguerMotsVides, parseShoppingIntent } from '../providers/rule-based.provider.js';
import type { ToolCallRequest } from '../tools/runner.js';
import type { ToolContext } from '../tools/registry.js';

/**
 * PLANIFICATEUR D'INTENTION.
 *
 * Sans modèle de langage configuré, c'est lui qui fait fonctionner
 * l'assistant — pas une maquette qui attendrait une clé d'API. Il lit une
 * phrase en français, en déduit une intention, et choisit les outils réels à
 * appeler. Avec un modèle branché, il reste utile : il sert de repli et de
 * garde-fou, et une intention lue deux fois de la même manière vaut mieux
 * qu'une intention devinée différemment selon le jour.
 *
 * Il ne répond jamais lui-même. Il dit **quoi aller chercher** ; ce sont les
 * outils qui rapportent les faits, et le rédacteur qui les met en phrases.
 */

export type Intent =
  | 'SEARCH_PRODUCTS'
  | 'COMPARE_PRODUCTS'
  | 'PRODUCT_DETAIL'
  | 'SELLER_TRUST'
  | 'DELIVERY_ESTIMATE'
  | 'ORDER_STATUS'
  | 'ORDER_LIST'
  | 'SPENDING'
  | 'CART_REVIEW'
  | 'REORDER'
  | 'SELLER_SALES'
  | 'SELLER_INVENTORY'
  | 'SELLER_LISTING'
  | 'SELLER_BRIEF'
  | 'PRICE_INTELLIGENCE'
  | 'DEMAND_INTELLIGENCE'
  | 'RFQ_DRAFT'
  | 'SUPPLIER_SEARCH'
  | 'QUOTE_COMPARE'
  | 'ADMIN_OVERVIEW'
  | 'ADMIN_PROVINCES'
  | 'ADMIN_PAYMENTS'
  | 'ADMIN_STOCK'
  | 'ADMIN_DELIVERY_ISSUES'
  | 'ADMIN_UNMET_DEMAND'
  | 'ADMIN_BRIEF'
  | 'HELP'
  | 'UNKNOWN';

export interface Plan {
  intent: Intent;
  calls: ToolCallRequest[];
  /** Ce que l'assistant a compris, en français, pour que l'utilisateur corrige. */
  understood: string;
  /** Mémoire à retenir de ce tour, si l'utilisateur a exprimé une préférence. */
  remember?: Array<{ key: string; value: string }>;
}

function normalise(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Un identifiant cuid cité dans la phrase (produit, commande, boutique). */
function identifiants(texte: string): string[] {
  return texte.match(/\bc[a-z0-9]{20,30}\b/g) ?? [];
}

const MOTS: Record<string, RegExp> = {
  recherche: /\b(cherche|trouve|montre|propose|besoin de|il me faut|je veux|recherche|acheter)\b/,
  comparer: /\b(compare|comparer|comparaison|difference entre|lequel|quel est le mieux)\b/,
  commande: /\b(commande|commandes|colis|livraison de ma|ou est ma|suivi)\b/,
  depense: /\b(depense|depense|combien ai je|combien j ai|total depense|mes achats)\b/,
  panier: /\b(panier|mon panier)\b/,
  reachat: /\b(racheter|reachat|recommander la meme|comme d habitude|renouveler)\b/,
  confiance: /\b(fiable|confiance|serieux|verifie|reputation|pourquoi ce vendeur|ce vendeur est il)\b/,
  livraison: /\b(livraison|livrer|delai|combien de temps|expedition|frais de port)\b/,
  ventes: /\b(ventes|chiffre d affaires|ca|mes ventes|revenus|pourquoi mes ventes|baisse)\b/,
  stock: /\b(stock|inventaire|rupture|reappro|invendu|dormant)\b/,
  fiche: /\b(description|fiche|annonce|redige|titre du produit|rediger)\b/,
  prix: /\b(prix|tarif|cher|chere|coute|coûte|marge|positionn|concurrent)\b/,
  demande: /\b(demande|recherche[nst]?|tendance|cherche[nt]|populaire|ce que les gens)\b/,
  bilan: /\b(bilan|resume|rapport|point|synthese|ce qui s est passe|comment ca va)\b/,
  devis: /\b(devis|rfq|demande de prix|appel d offre)\b/,
  fournisseur: /\b(fournisseur|fournisseurs|grossiste|en gros|sourcing)\b/,
  aide: /\b(aide|probleme|reclamation|remboursement|litige|parler a quelqu un|humain|conseiller)\b/,
};

/**
 * Déduit un plan à partir d'une phrase.
 *
 * L'ordre des tests n'est pas arbitraire : les intentions les plus spécifiques
 * passent avant les plus générales. « Compare ces deux produits » contient le
 * mot « produits » et déclencherait une recherche si la comparaison n'était pas
 * testée d'abord.
 */
export function planFromMessage(message: string, ctx: ToolContext, memoire: Record<string, string> = {}): Plan {
  const brut = message.trim();
  const texte = normalise(brut);
  const ids = identifiants(brut);

  if (ctx.surface === 'ADMIN') return planAdmin(texte);
  if (ctx.surface === 'SELLER') return planVendeur(texte, brut, memoire);
  if (ctx.surface === 'BUSINESS') return planBusiness(texte, brut, ids);

  // ── Espace acheteur ───────────────────────────────────────────────────────
  if (MOTS.aide.test(texte)) {
    return { intent: 'HELP', calls: [], understood: 'Vous avez besoin d’aide d’une personne.' };
  }

  if (MOTS.comparer.test(texte) && ids.length >= 2) {
    return { intent: 'COMPARE_PRODUCTS', calls: [{ tool: 'compareProducts', args: { productIds: ids.slice(0, 4) } }], understood: `Comparer ${ids.length} produits.` };
  }

  if (MOTS.confiance.test(texte) && ids.length >= 1) {
    return { intent: 'SELLER_TRUST', calls: [{ tool: 'getSellerTrust', args: { storeId: ids[0] } }], understood: 'Expliquer le niveau de confiance de ce vendeur.' };
  }

  if (MOTS.commande.test(texte)) {
    if (ids.length >= 1) {
      return {
        intent: 'ORDER_STATUS',
        calls: [
          { tool: 'getOrder', args: { orderId: ids[0] } },
          { tool: 'getOrderTracking', args: { orderId: ids[0] } },
        ],
        understood: 'Retrouver cette commande et son suivi.',
      };
    }
    return { intent: 'ORDER_LIST', calls: [{ tool: 'listMyOrders', args: { limit: 5 } }], understood: 'Lister vos dernières commandes.' };
  }

  if (MOTS.depense.test(texte)) {
    return { intent: 'SPENDING', calls: [{ tool: 'listMyOrders', args: { limit: 20 } }], understood: 'Calculer ce que vous avez dépensé, par devise.' };
  }

  if (MOTS.panier.test(texte)) {
    return { intent: 'CART_REVIEW', calls: [{ tool: 'getMyCart', args: {} }], understood: 'Examiner votre panier.' };
  }

  if (MOTS.reachat.test(texte)) {
    return { intent: 'REORDER', calls: [{ tool: 'suggestReorder', args: { limit: 5 } }], understood: 'Retrouver ce que vous commandez régulièrement.' };
  }

  if (MOTS.livraison.test(texte) && ids.length >= 1) {
    return {
      intent: 'ORDER_STATUS',
      calls: [{ tool: 'getOrderTracking', args: { orderId: ids[0] } }],
      understood: 'Vérifier le suivi de livraison de cette commande.',
    };
  }

  if (MOTS.prix.test(texte) && ids.length >= 1) {
    return {
      intent: 'PRICE_INTELLIGENCE',
      calls: [{ tool: 'getPriceIntelligence', args: { productId: ids[0] } }],
      understood: 'Situer ce prix par rapport aux autres produits de sa catégorie.',
    };
  }

  if (ids.length === 1 && !MOTS.recherche.test(texte)) {
    return { intent: 'PRODUCT_DETAIL', calls: [{ tool: 'getProduct', args: { productId: ids[0] } }], understood: 'Afficher la fiche de ce produit.' };
  }

  // Par défaut : une recherche. C'est de loin la demande la plus fréquente sur
  // une place de marché, et l'analyse de la phrase en extrait les filtres.
  const intention = parseShoppingIntent(brut);
  const filtres: Record<string, unknown> = { limit: 6 };
  if (intention.terms) filtres.query = intention.terms;
  if (intention.maxPrice) filtres.maxPrice = intention.maxPrice;
  if (intention.minPrice) filtres.minPrice = intention.minPrice;
  if (intention.inStockOnly) filtres.inStockOnly = true;
  if (intention.verifiedOnly) filtres.verifiedOnly = true;
  // Une préférence retenue n'écrase jamais ce que l'utilisateur vient de dire :
  // elle ne s'applique qu'à ce qu'il n'a pas précisé.
  if (!intention.maxPrice && memoire.budget_max) filtres.maxPrice = memoire.budget_max;

  const calls: ToolCallRequest[] = [{ tool: 'parseShoppingQuery', args: { phrase: brut.slice(0, 300) } }, { tool: 'searchProducts', args: filtres }];
  if (intention.destination) {
    calls.push({ tool: 'checkProvinceAvailability', args: { destination: intention.destination.slice(0, 80) } });
  }

  const retenir: Array<{ key: string; value: string }> = [];
  if (intention.maxPrice) retenir.push({ key: 'budget_max', value: intention.maxPrice });
  if (intention.currency) retenir.push({ key: 'devise', value: intention.currency });

  return {
    intent: 'SEARCH_PRODUCTS',
    calls,
    understood: `Rechercher ${intention.terms || 'des produits'}${intention.maxPrice ? ` à moins de ${intention.maxPrice}${intention.currency ? ` ${intention.currency}` : ''}` : ''}${intention.destination ? `, livrable à ${intention.destination}` : ''}.`,
    remember: retenir,
  };
}

function planVendeur(texte: string, brut: string, memoire: Record<string, string>): Plan {
  const boutique = memoire.boutique_active ?? null;
  const ids = identifiants(brut);
  const storeId = ids[0] ?? boutique;

  if (MOTS.bilan.test(texte)) {
    if (!storeId) return { intent: 'SELLER_BRIEF', calls: [], understood: 'Faire le bilan — il me faut savoir de quelle boutique il s’agit.' };
    const jours = /\b(30|mois)\b/.test(texte) ? 30 : /\b(aujourd hui|jour)\b/.test(texte) ? 1 : 7;
    return { intent: 'SELLER_BRIEF', calls: [{ tool: 'getSellerBrief', args: { storeId, days: jours } }], understood: `Faire le bilan de votre boutique sur ${jours} jour(s).` };
  }
  if (MOTS.prix.test(texte) && ids.length >= 1) {
    // Un identifiant sur une question de prix côté vendeur désigne un produit,
    // pas une boutique : c'est le prix d'un article qu'on situe, pas celui
    // d'un magasin.
    return { intent: 'PRICE_INTELLIGENCE', calls: [{ tool: 'getPriceIntelligence', args: { productId: ids[0] } }], understood: 'Situer ce prix dans sa catégorie.' };
  }
  if (MOTS.demande.test(texte)) {
    return {
      intent: 'DEMAND_INTELLIGENCE',
      calls: [{ tool: 'getDemandIntelligence', args: ids.length >= 1 ? { productId: ids[0] } : {} }],
      understood: ids.length >= 1 ? 'Mesurer la demande sur ce produit.' : 'Regarder ce que les acheteurs cherchent.',
    };
  }
  if (MOTS.stock.test(texte)) {
    if (!storeId) return { intent: 'SELLER_INVENTORY', calls: [], understood: 'Analyser votre stock — il me faut savoir de quelle boutique il s’agit.' };
    return { intent: 'SELLER_INVENTORY', calls: [{ tool: 'getInventory', args: { storeId } }], understood: 'Analyser le stock de votre boutique.' };
  }
  if (MOTS.ventes.test(texte)) {
    if (!storeId) return { intent: 'SELLER_SALES', calls: [], understood: 'Analyser vos ventes — il me faut savoir de quelle boutique il s’agit.' };
    const jours = /\b(90|trimestre)\b/.test(texte) ? 90 : /\b(7|semaine)\b/.test(texte) ? 7 : 30;
    return { intent: 'SELLER_SALES', calls: [{ tool: 'getSalesAnalytics', args: { storeId, days: jours } }], understood: `Analyser vos ventes sur ${jours} jours.` };
  }
  if (MOTS.fiche.test(texte)) {
    // Le titre proposé est ce que le vendeur a écrit, débarrassé des verbes de
    // commande. Rien n'est ajouté : c'est lui qui connaît son produit.
    const titre = elaguerMotsVides(
      brut.replace(/\b(rédige|redige|écris|ecris|prépare|prepare|crée|cree|description|fiche|annonce)\b/gi, ' ').replace(/\s+/g, ' ').trim(),
    );
    return {
      intent: 'SELLER_LISTING',
      calls: titre.length >= 2 ? [{ tool: 'createDraftListing', args: { title: titre.slice(0, 200) } }] : [],
      understood: titre.length >= 2 ? `Préparer un brouillon de fiche pour « ${titre} ».` : 'Préparer un brouillon de fiche — il me faut le nom du produit.',
    };
  }
  if (MOTS.aide.test(texte)) return { intent: 'HELP', calls: [], understood: 'Vous avez besoin d’aide d’une personne.' };
  if (storeId) return { intent: 'SELLER_SALES', calls: [{ tool: 'getStoreOverview', args: { storeId } }], understood: 'Vue d’ensemble de votre boutique.' };
  return { intent: 'UNKNOWN', calls: [], understood: '' };
}

function planBusiness(texte: string, brut: string, ids: string[]): Plan {
  if (MOTS.devis.test(texte) && ids.length >= 1) {
    return { intent: 'QUOTE_COMPARE', calls: [{ tool: 'compareQuotes', args: { rfqId: ids[0] } }], understood: 'Comparer les devis reçus sur cette demande.' };
  }
  if (MOTS.fournisseur.test(texte)) {
    const intention = parseShoppingIntent(brut);
    const quantite = /\b(\d[\d\s.]*)\b/.exec(brut.replace(/\D(\d{1,2})\D/g, ' '))?.[1]?.replace(/[\s.]/g, '');
    return {
      intent: 'SUPPLIER_SEARCH',
      calls: [{ tool: 'searchSuppliers', args: { ...(intention.terms ? { category: intention.terms.slice(0, 120) } : {}), ...(quantite && Number(quantite) > 0 ? { minQuantity: Math.min(Number(quantite), 10_000_000) } : {}), limit: 5 } }],
      understood: `Rechercher des fournisseurs${intention.terms ? ` pour « ${intention.terms} »` : ''}.`,
    };
  }
  if (MOTS.devis.test(texte)) {
    const intention = parseShoppingIntent(brut);
    const quantite = /(\d[\d\s.  ]*\d|\d+)/.exec(brut)?.[1]?.replace(/[\s.  ]/g, '');
    if (!quantite || !intention.terms) {
      return { intent: 'RFQ_DRAFT', calls: [], understood: 'Préparer une demande de devis — il me faut la quantité et ce que vous cherchez.' };
    }
    return {
      intent: 'RFQ_DRAFT',
      calls: [{ tool: 'createDraftRFQ', args: { title: intention.terms.slice(0, 200), quantity: Math.min(Number(quantite), 10_000_000), ...(intention.destination ? { destinationCountry: 'TD' } : {}) } }],
      understood: `Préparer un brouillon de demande de devis pour ${quantite} × « ${intention.terms} ».`,
    };
  }
  if (MOTS.aide.test(texte)) return { intent: 'HELP', calls: [], understood: 'Vous avez besoin d’aide d’une personne.' };
  return { intent: 'SUPPLIER_SEARCH', calls: [{ tool: 'searchSuppliers', args: { limit: 5 } }], understood: 'Lister des fournisseurs sur Touma.' };
}

function planAdmin(texte: string): Plan {
  const jours = /\b(90|trimestre)\b/.test(texte) ? 90 : /\b(7|semaine)\b/.test(texte) ? 7 : /\b(aujourd hui|today)\b/.test(texte) ? 1 : 30;
  if (/\bbilan|resume|rapport|synthese|point du jour|que s est il passe/.test(texte)) {
    return { intent: 'ADMIN_BRIEF', calls: [{ tool: 'getPlatformBrief', args: { days: jours <= 7 ? jours : 7 } }], understood: `Bilan de la plateforme sur ${jours <= 7 ? jours : 7} jour(s).` };
  }
  if (/\bprovince|region|corridor|ou sont|geographi/.test(texte)) {
    return { intent: 'ADMIN_PROVINCES', calls: [{ tool: 'getOrdersByProvince', args: { days: jours } }], understood: `Répartition des commandes par province sur ${jours} jours.` };
  }
  if (/\bpaiement|paie|echec de paiement|mobile money/.test(texte)) {
    return { intent: 'ADMIN_PAYMENTS', calls: [{ tool: 'getPaymentReliability', args: { days: jours } }], understood: `Fiabilité des paiements sur ${jours} jours.` };
  }
  if (/\brupture|stock|approvision/.test(texte)) {
    return { intent: 'ADMIN_STOCK', calls: [{ tool: 'getStockTension', args: { days: jours } }], understood: `Tension de stock sur ${jours} jours.` };
  }
  if (/\blivraison|retard|probleme de livraison|annulation/.test(texte)) {
    return { intent: 'ADMIN_DELIVERY_ISSUES', calls: [{ tool: 'getSellersWithDeliveryIssues', args: { days: jours } }], understood: `Vendeurs en difficulté de livraison sur ${jours} jours.` };
  }
  if (/\brecherche|demande non satisfaite|introuvable|manque/.test(texte)) {
    return { intent: 'ADMIN_UNMET_DEMAND', calls: [{ tool: 'getUnmetDemand', args: { days: jours } }], understood: `Recherches sans résultat sur ${jours} jours.` };
  }
  return { intent: 'ADMIN_OVERVIEW', calls: [{ tool: 'getPlatformOverview', args: {} }], understood: 'Vue d’ensemble de la plateforme.' };
}

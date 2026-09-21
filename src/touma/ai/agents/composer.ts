import { Prisma } from '@prisma/client';
import type { ToolCallOutcome } from '../tools/runner.js';
import type { Intent } from './intent.js';

/**
 * RÉDACTEUR DE RÉPONSE.
 *
 * Il met en phrases ce que les outils ont rapporté, et **rien d'autre**. Sa
 * règle tient en une ligne : toute valeur affichée doit provenir d'un résultat
 * d'outil. Pas de chiffre calculé de tête, pas de délai estimé, pas de
 * qualificatif — « bonne affaire », « vendeur sérieux », « livraison rapide »
 * sont des jugements que rien ne fonde.
 *
 * Quand les outils n'ont rien rapporté, la réponse est « Information non
 * disponible », suivie de ce qu'il manque. C'est §71 pris au mot : une réponse
 * vide est un résultat correct, une réponse comblée ne l'est jamais.
 *
 * Les seuls calculs faits ici sont des **sommes de valeurs rapportées**, par
 * devise, jamais entre devises.
 */

export const INDISPONIBLE = 'Information non disponible.';

export interface Reponse {
  text: string;
  cards: Array<Record<string, unknown>>;
  /** Ce que l'assistant n'a pas pu établir. Affiché, pas tu. */
  unavailable: string[];
  /** Suites proposées, en français, cliquables côté interface. */
  suggestions: string[];
}

function donnees<T = Record<string, any>>(resultats: ToolCallOutcome[], outil: string): T | null {
  const r = resultats.find((x) => x.tool === outil && x.ok);
  return (r?.data as T) ?? null;
}

function cartes(resultats: ToolCallOutcome[]): Array<Record<string, unknown>> {
  return resultats.flatMap((r) => r.cards ?? []);
}

/** Refus et échecs rencontrés : ils sont dits, pas dissimulés. */
function echecs(resultats: ToolCallOutcome[]): string[] {
  return resultats.filter((r) => !r.ok && r.error).map((r) => r.error!);
}

export function compose(intent: Intent, understood: string, resultats: ToolCallOutcome[], contexte: { fallback: boolean; providerMessage: string | null }): Reponse {
  const base = redigerSelonIntention(intent, resultats);
  const problemes = echecs(resultats);

  const lignes = [base.text];
  if (problemes.length > 0) lignes.push(problemes.map((p) => `• ${p}`).join('\n'));
  if (base.unavailable.length > 0) {
    lignes.push(`Ce que je n’ai pas pu établir : ${base.unavailable.join(' ; ')}.`);
  }

  return { ...base, text: lignes.filter(Boolean).join('\n\n'), suggestions: base.suggestions };
}

function redigerSelonIntention(intent: Intent, r: ToolCallOutcome[]): Reponse {
  switch (intent) {
    case 'SEARCH_PRODUCTS':
      return recherche(r);
    case 'COMPARE_PRODUCTS':
      return comparaison(r);
    case 'PRODUCT_DETAIL':
      return fiche(r);
    case 'SELLER_TRUST':
      return confiance(r);
    case 'ORDER_STATUS':
      return suiviCommande(r);
    case 'ORDER_LIST':
      return listeCommandes(r);
    case 'SPENDING':
      return depenses(r);
    case 'CART_REVIEW':
      return panier(r);
    case 'REORDER':
      return reachat(r);
    case 'SELLER_SALES':
      return ventes(r);
    case 'SELLER_INVENTORY':
      return stock(r);
    case 'SELLER_LISTING':
      return brouillonFiche(r);
    case 'RFQ_DRAFT':
      return brouillonDevis(r);
    case 'SUPPLIER_SEARCH':
      return fournisseurs(r);
    case 'QUOTE_COMPARE':
      return devis(r);
    case 'HELP':
      return {
        text: 'Je passe la main à une personne : décrivez votre problème et je crée un ticket de support. Je ne peux ni décider d’un remboursement, ni promettre un délai.',
        cards: [],
        unavailable: [],
        suggestions: ['Ouvrir un ticket de support'],
      };
    case 'ADMIN_OVERVIEW':
    case 'ADMIN_PROVINCES':
    case 'ADMIN_PAYMENTS':
    case 'ADMIN_STOCK':
    case 'ADMIN_DELIVERY_ISSUES':
    case 'ADMIN_UNMET_DEMAND':
      return administration(r);
    default:
      return {
        text: 'Je n’ai pas compris votre demande. Je sais chercher des produits, comparer des offres, retrouver vos commandes, expliquer un niveau de confiance et préparer une demande de devis.',
        cards: [],
        unavailable: [],
        suggestions: ['Chercher un produit', 'Voir mes commandes', 'Comparer deux produits'],
      };
  }
}

function recherche(r: ToolCallOutcome[]): Reponse {
  const resultat = donnees<{ total: number; items: Array<Record<string, any>> }>(r, 'searchProducts');
  const lieu = donnees<{ found: boolean; province: { name: string } | null }>(r, 'checkProvinceAvailability');
  const indisponibles: string[] = [];

  if (!resultat || resultat.items.length === 0) {
    if (lieu && !lieu.found) indisponibles.push('la destination demandée ne correspond à aucune province ni localité connue en base');
    return {
      text: `${INDISPONIBLE} Aucun produit du catalogue ne correspond à votre demande.`,
      cards: [],
      unavailable: indisponibles,
      suggestions: ['Élargir le budget', 'Retirer un filtre', 'Chercher une autre catégorie'],
    };
  }

  const lignes = resultat.items.map((p) => {
    const dispo = p.inStock === null ? 'disponibilité inconnue' : p.inStock ? 'en stock' : 'en rupture';
    const note = p.ratingCount > 0 ? `, ${Number(p.rating).toFixed(1)}/5 sur ${p.ratingCount} avis` : ', aucun avis';
    return `• ${p.title} — ${p.price} ${p.currency}, ${p.store?.name ?? 'vendeur inconnu'}${p.store?.verified ? ' (vérifié)' : ''}, ${dispo}${note}`;
  });

  // Le délai de livraison n'est jamais annoncé ici : il vient du transporteur.
  //
  // Il est dit **dès qu'une destination a été mentionnée**, reconnue ou non.
  // La première écriture ne le disait que pour une province reconnue : sur une
  // base sans référentiel géographique, un acheteur qui demandait une livraison
  // vers une ville inconnue ne voyait plus du tout la mise en garde sur le
  // délai — alors que le délai est inconnu dans les deux cas, et d'autant plus
  // dans celui-là. L'intégration continue l'a relevé ; le défaut était dans le
  // code, pas dans le test.
  if (lieu) {
    indisponibles.push(
      lieu.found && lieu.province
        ? `le délai de livraison vers ${lieu.province.name} (à demander au transporteur)`
        : 'le délai de livraison vers la destination demandée (à demander au transporteur)',
    );
    if (!lieu.found) indisponibles.push('la destination demandée ne correspond à aucune province ni localité connue en base');
  }

  return {
    text: [`${resultat.total} produit(s) correspondent. Voici les ${resultat.items.length} premiers :`, lignes.join('\n')].join('\n'),
    cards: cartes(r),
    unavailable: indisponibles,
    suggestions: ['Comparer deux de ces produits', 'Voir un produit en détail', 'Affiner le budget'],
  };
}

function comparaison(r: ToolCallOutcome[]): Reponse {
  const d = donnees<{ rows: Array<Record<string, any>>; sameCurrency: boolean; priceWarning?: string; unavailable: string[] }>(r, 'compareProducts');
  if (!d) return vide('Je n’ai pas pu récupérer au moins deux produits à comparer.');

  const lignes = d.rows.map((l) => {
    const morceaux = [`${l.title} : ${l.price} ${l.currency}`];
    if (l.store) morceaux.push(`vendeur ${l.store.name}${l.store.verified ? ' (vérifié)' : ' (non vérifié)'}`);
    morceaux.push(l.trust ? `confiance ${l.trust.level}` : 'confiance non publiée');
    morceaux.push(l.rating !== null ? `${Number(l.rating).toFixed(1)}/5 sur ${l.ratingCount} avis` : 'aucun avis');
    morceaux.push(l.inStock === null ? 'disponibilité inconnue' : l.inStock ? 'en stock' : 'en rupture');
    if (l.savings) morceaux.push(`économie vérifiée ${l.savings}`);
    return `• ${morceaux.join(' — ')}`;
  });

  const texte = [
    'Comparaison, sur les données réelles du catalogue :',
    lignes.join('\n'),
    d.priceWarning ?? '',
    'Je ne désigne pas de meilleur produit : le critère d’arbitrage vous appartient.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { text: texte, cards: cartes(r), unavailable: d.unavailable ?? [], suggestions: ['Voir le détail d’un produit', 'Vérifier la confiance d’un vendeur'] };
}

function fiche(r: ToolCallOutcome[]): Reponse {
  const p = donnees<Record<string, any>>(r, 'getProduct');
  if (!p) return vide('Ce produit est introuvable ou n’est plus en vente.');
  const lignes = [
    `${p.title} — ${p.price} ${p.currency}`,
    p.store ? `Vendeur : ${p.store.name}${p.store.verificationStatus === 'APPROVED' ? ' (vérifié)' : ' (non vérifié)'}` : '',
    p.inStock === null ? 'Disponibilité : inconnue' : p.inStock ? `En stock${p.stock ? ` (${p.stock})` : ''}` : 'En rupture',
    // Le prix barré n'est affiché que s'il est adossé à un historique de prix
    // réellement pratiqué (V22). `compareAtPrice` saisi par le vendeur ne suffit pas.
    p.referencePrice ? `Prix de référence vérifié : ${p.referencePrice} ${p.currency}` : '',
    p.ratingCount > 0 ? `Note : ${Number(p.rating).toFixed(1)}/5 sur ${p.ratingCount} avis` : 'Aucun avis publié',
  ].filter(Boolean);
  return { text: lignes.join('\n'), cards: cartes(r), unavailable: ['le délai de livraison (à demander au transporteur)'], suggestions: ['Comparer avec un autre produit', 'Voir la confiance du vendeur'] };
}

function confiance(r: ToolCallOutcome[]): Reponse {
  const d = donnees<Record<string, any>>(r, 'getSellerTrust');
  if (!d || !d.trust) {
    return {
      text: `${INDISPONIBLE} Ce vendeur n’a pas encore assez d’historique pour qu’un niveau de confiance soit publié. Ce n’est pas un mauvais signe : c’est une absence de données.`,
      cards: cartes(r),
      unavailable: ['le niveau de confiance (historique insuffisant)'],
      suggestions: ['Voir les avis sur un produit de ce vendeur'],
    };
  }
  const composantes = (d.trust.components as Array<Record<string, any>>)
    .filter((c) => c.value !== null)
    .map((c) => `• ${c.label ?? c.code} : ${c.value}`);
  return {
    text: [
      `Niveau de confiance : ${d.trust.level} (${d.trust.score}/100), calculé par Touma le ${new Date(d.trust.computedAt).toLocaleDateString('fr-FR')}.`,
      d.verified ? 'Cette boutique a passé une vérification Touma.' : 'Cette boutique n’a pas passé de vérification Touma.',
      composantes.length > 0 ? `Ce qui compose ce niveau :\n${composantes.join('\n')}` : '',
      'Ces éléments viennent du moteur de confiance. Je n’en ajoute aucun.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    cards: cartes(r),
    unavailable: [],
    suggestions: ['Voir les produits de ce vendeur'],
  };
}

function suiviCommande(r: ToolCallOutcome[]): Reponse {
  const commande = donnees<Record<string, any>>(r, 'getOrder');
  const suivi = donnees<Record<string, any>>(r, 'getOrderTracking');
  if (!commande && !suivi) return vide('Je ne trouve pas cette commande dans votre compte.');

  const lignes: string[] = [];
  if (commande) lignes.push(`Commande ${commande.orderNumber} : ${commande.status}, ${commande.total} ${commande.currency}.`);
  const evenements = (suivi?.events ?? []) as Array<Record<string, any>>;
  if (evenements.length === 0) {
    // Aucun événement ≠ retard. Dire « votre colis est en retard » sans donnée
    // serait exactement le délai inventé que V17 interdit.
    lignes.push('Aucun événement de suivi n’a encore été enregistré par le transporteur. C’est une absence d’information, pas un retard constaté.');
  } else {
    lignes.push(`Suivi (${evenements.length} événement(s)) :`);
    lignes.push(evenements.slice(-5).map((e) => `• ${new Date(e.occurredAt ?? e.createdAt).toLocaleDateString('fr-FR')} — ${e.label ?? e.status}${e.location ? ` (${e.location})` : ''}`).join('\n'));
  }
  return { text: lignes.join('\n'), cards: cartes(r), unavailable: evenements.length === 0 ? ['la date de livraison prévue'] : [], suggestions: ['Voir toutes mes commandes', 'Parler à une personne'] };
}

function listeCommandes(r: ToolCallOutcome[]): Reponse {
  const d = donnees<{ total: number; items: Array<Record<string, any>> }>(r, 'listMyOrders');
  if (!d || d.items.length === 0) return vide('Vous n’avez aucune commande enregistrée.');
  return {
    text: [`${d.total} commande(s) à votre compte. Les plus récentes :`, d.items.map((o) => `• ${o.orderNumber} — ${o.status}, ${o.total} ${o.currency}, ${new Date(o.createdAt).toLocaleDateString('fr-FR')}`).join('\n')].join('\n'),
    cards: cartes(r),
    unavailable: [],
    suggestions: ['Suivre une commande', 'Racheter un produit habituel'],
  };
}

/**
 * Dépenses.
 *
 * Somme **par devise**, jamais entre devises (V20). Un total unique supposerait
 * un taux de change, et un taux appliqué à des achats passés produirait un
 * chiffre que l'utilisateur n'a jamais payé.
 */
function depenses(r: ToolCallOutcome[]): Reponse {
  const d = donnees<{ items: Array<Record<string, any>> }>(r, 'listMyOrders');
  if (!d || d.items.length === 0) return vide('Vous n’avez aucune commande enregistrée.');

  const debutDuMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const parDevise = new Map<string, { total: Prisma.Decimal; commandes: number }>();
  for (const o of d.items) {
    if (new Date(o.createdAt) < debutDuMois) continue;
    if (o.status === 'CANCELLED') continue;
    const e = parDevise.get(o.currency) ?? { total: new Prisma.Decimal(0), commandes: 0 };
    e.total = e.total.plus(new Prisma.Decimal(String(o.total)));
    e.commandes += 1;
    parDevise.set(o.currency, e);
  }

  if (parDevise.size === 0) return vide('Aucune commande depuis le début du mois.');

  const lignes = [...parDevise.entries()].map(([devise, e]) => `• ${e.total.toString()} ${devise} sur ${e.commandes} commande(s)`);
  return {
    text: [
      'Depuis le début du mois, hors commandes annulées :',
      lignes.join('\n'),
      parDevise.size > 1 ? 'Les devises ne sont pas additionnées : il n’existe pas de taux de change officiel appliqué par Touma.' : '',
      // La liste est bornée par l'outil : le dire évite de laisser croire à un
      // total exhaustif quand il ne l'est pas.
      d.items.length >= 20 ? 'Calcul fait sur vos 20 dernières commandes.' : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    cards: [],
    unavailable: [],
    suggestions: ['Voir mes commandes'],
  };
}

function panier(r: ToolCallOutcome[]): Reponse {
  const d = donnees<Record<string, any>>(r, 'getMyCart');
  const articles = (d?.items ?? []) as Array<Record<string, any>>;
  if (articles.length === 0) return vide('Votre panier est vide.');
  return {
    text: [`${articles.length} ligne(s) au panier :`, articles.map((i) => `• ${i.title ?? i.product?.title ?? 'article'} × ${i.quantity} — ${i.unitPrice ?? i.price ?? '?'} ${i.currency ?? ''}`).join('\n'), 'Je ne modifie pas votre panier : ajout, retrait et quantité restent de votre main.'].join('\n\n'),
    cards: [],
    unavailable: [],
    suggestions: ['Chercher une alternative moins chère'],
  };
}

function reachat(r: ToolCallOutcome[]): Reponse {
  const d = donnees<{ items: Array<Record<string, any>> }>(r, 'suggestReorder');
  if (!d || d.items.length === 0) return vide('Aucun produit n’a été commandé plus d’une fois : je ne peux pas repérer d’habitude.');
  return {
    text: [
      'Produits que vous commandez régulièrement :',
      d.items.map((i) => `• ${i.title} — ${i.purchases} achats, environ tous les ${i.averageIntervalDays} jours, dernier il y a ${i.daysSinceLast} jours (${i.price} ${i.currency})`).join('\n'),
      'Je ne passe aucune commande : le réachat demande votre confirmation.',
    ].join('\n\n'),
    cards: [],
    unavailable: ['votre stock restant à domicile, que Touma ne connaît pas'],
    suggestions: ['Voir la fiche d’un de ces produits'],
  };
}

/** Ventes : DONNÉES, INTERPRÉTATION, RECOMMANDATION séparées (§23). */
function ventes(r: ToolCallOutcome[]): Reponse {
  const d = donnees<Record<string, any>>(r, 'getSalesAnalytics') ?? donnees<Record<string, any>>(r, 'getStoreOverview');
  if (!d) return vide('Je n’ai pas pu lire les ventes de cette boutique.');
  if (!d.data) return { text: `Vue d’ensemble de « ${d.store?.name ?? 'votre boutique'} ».`, cards: [], unavailable: [], suggestions: ['Analyser le stock'] };

  const parDevise = (d.data.byCurrency as Array<Record<string, any>>) ?? [];
  const lignes = [
    'DONNÉES',
    `• ${d.data.orders} commande(s) sur ${d.periodDays} jours, dont ${d.data.cancelled} annulée(s).`,
    ...parDevise.map((c) => `• ${c.revenue} ${c.currency} sur ${c.orders} commande(s), panier moyen ${c.averageOrderValue ?? '—'} ${c.currency}.`),
    '',
    'INTERPRÉTATION',
    ...((d.interpretation as string[]) ?? []).map((i) => `• ${i}`),
    '',
    'RECOMMANDATION',
    // Vide, et c'est dit. Recommander sans connaître la cause serait deviner ;
    // la cause d'une baisse est presque toujours hors de la base.
    '• Aucune recommandation automatique : je constate une variation, je n’en connais pas la cause. Une rupture, un concurrent, une saison ou un incident de livraison ne se lisent pas dans ces chiffres.',
  ];
  return { text: lignes.join('\n'), cards: [], unavailable: ['la cause des variations observées'], suggestions: ['Analyser mon stock', 'Voir les produits sans vente'] };
}

function stock(r: ToolCallOutcome[]): Reponse {
  const d = donnees<Record<string, any>>(r, 'getInventory');
  if (!d || !d.totals) return vide('Je n’ai pas pu lire le stock de cette boutique.');
  const t = d.totals;
  const lignes = [
    'DONNÉES',
    `• ${t.products} produit(s) : ${t.outOfStock} en rupture, ${t.lowStock} en stock faible, ${t.dormant} sans vente depuis 60 jours.`,
    ...(d.outOfStock as Array<Record<string, any>>).slice(0, 5).map((p) => `• Rupture : ${p.title}`),
    ...(d.lowStock as Array<Record<string, any>>).slice(0, 5).map((p) => `• Stock faible : ${p.title} (${p.stock} restant)`),
    ...(d.fastMoving as Array<Record<string, any>>).slice(0, 3).map((p) => `• Rotation rapide : ${p.title} (${p.soldLast60Days} vendus sur 60 jours)`),
    '',
    'RECOMMANDATION',
    '• Réapprovisionnement, promotion et mise en lot restent vos décisions : je n’applique rien.',
  ];
  return { text: lignes.join('\n'), cards: [], unavailable: [], suggestions: ['Analyser mes ventes'] };
}

function brouillonFiche(r: ToolCallOutcome[]): Reponse {
  const d = donnees<Record<string, any>>(r, 'createDraftListing');
  if (!d) return vide('Donnez-moi le nom du produit et je prépare un brouillon.');
  return {
    text: [
      `Brouillon préparé pour « ${d.draft.title} ». Rien n’est publié.`,
      d.missingFields.length > 0 ? `À compléter avant publication : ${d.missingFields.join(', ')}.` : '',
      'Je ne remplis pas ces champs à votre place : une fiche portant une matière ou une garantie que vous n’avez pas saisie vous engagerait, vous, auprès de l’acheteur.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    cards: [],
    unavailable: (d.missingFields as string[]) ?? [],
    suggestions: ['Compléter le prix', 'Compléter la catégorie'],
  };
}

function brouillonDevis(r: ToolCallOutcome[]): Reponse {
  const d = donnees<Record<string, any>>(r, 'createDraftRFQ');
  if (!d) return vide('Donnez-moi la quantité et ce que vous cherchez, et je prépare un brouillon de demande de devis.');
  return {
    text: [
      `Brouillon de demande de devis : ${d.draft.quantity} × « ${d.draft.title} ». Aucun fournisseur n’a été contacté.`,
      d.missingFields.length > 0 ? `À préciser : ${d.missingFields.join(', ')}.` : '',
      'L’envoi aux fournisseurs demandera votre confirmation.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    cards: [],
    unavailable: (d.missingFields as string[]) ?? [],
    suggestions: ['Chercher des fournisseurs', 'Préciser la destination'],
  };
}

function fournisseurs(r: ToolCallOutcome[]): Reponse {
  const d = donnees<{ suppliers: Array<Record<string, any>>; factors: string[] }>(r, 'searchSuppliers');
  if (!d || d.suppliers.length === 0) return vide('Aucun fournisseur du catalogue Touma ne correspond à ces critères.');
  return {
    text: [
      `${d.suppliers.length} fournisseur(s) :`,
      d.suppliers
        .map((s) => `• ${s.name} (${s.countryCode})${s.factors.verified ? ' — vérifié' : ' — non vérifié'}, ${s.factors.activeProducts} produits actifs, ${s.factors.completedOrders} commandes honorées${s.factors.minOrderQuantity ? `, quantité minimale ${s.factors.minOrderQuantity}` : ''}`)
        .join('\n'),
      `Facteurs utilisés pour le classement : ${d.factors.join(', ')}.`,
    ].join('\n\n'),
    cards: cartes(r),
    unavailable: ['le délai de production et le taux de réponse aux demandes de devis, que Touma ne mesure pas encore'],
    suggestions: ['Préparer une demande de devis', 'Voir la confiance d’un fournisseur'],
  };
}

function devis(r: ToolCallOutcome[]): Reponse {
  const d = donnees<Record<string, any>>(r, 'compareQuotes');
  if (!d || !d.quotes || d.quotes.length === 0) return vide('Aucun devis n’a encore été reçu sur cette demande.');
  const lignes = (d.quotes as Array<Record<string, any>>).map((q) => {
    const morceaux = [q.supplier ?? 'fournisseur'];
    if (q.unitPrice) morceaux.push(`${q.unitPrice} ${q.currency}/unité`);
    if (q.estimatedTotal) morceaux.push(`total estimé ${q.estimatedTotal} ${q.currency}`);
    if (q.leadTimeDays) morceaux.push(`délai ${q.leadTimeDays} j`);
    if (q.minOrderQuantity) morceaux.push(`quantité minimale ${q.minOrderQuantity}`);
    return `• ${morceaux.join(' — ')}${q.unavailable.length > 0 ? ` (non communiqué : ${q.unavailable.join(', ')})` : ''}`;
  });
  return {
    text: [`${d.quotes.length} devis reçus :`, lignes.join('\n'), d.currencyWarning ?? '', 'Je ne désigne pas de meilleur devis : le critère d’arbitrage vous appartient.'].filter(Boolean).join('\n\n'),
    cards: [],
    unavailable: [],
    suggestions: ['Voir le détail d’un devis'],
  };
}

function administration(r: ToolCallOutcome[]): Reponse {
  const reussis = r.filter((x) => x.ok && x.data !== undefined && x.data !== null);
  if (reussis.length === 0) return vide('Aucune donnée sur la période demandée.');
  return {
    text: [reussis.map((x) => `• ${x.summary}`).join('\n'), 'Chiffres calculés sur les données réelles de la plateforme. Aucune action n’est appliquée : les décisions restent humaines.'].join('\n\n'),
    // Les données brutes sont jointes : un administrateur doit pouvoir
    // regarder le détail, pas seulement un résumé écrit par une machine.
    cards: reussis.map((x) => ({ type: 'DATA', tool: x.tool, summary: x.summary, data: x.data })),
    unavailable: [],
    suggestions: ['Voir la répartition par province', 'Voir la fiabilité des paiements'],
  };
}

function vide(raison: string): Reponse {
  return { text: `${INDISPONIBLE} ${raison}`, cards: [], unavailable: [], suggestions: [] };
}

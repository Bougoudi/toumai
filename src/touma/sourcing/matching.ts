/**
 * POURQUOI CE FOURNISSEUR (V28 §4).
 *
 * **Le manque que cela comble.** La recherche fournisseurs filtrait et
 * classait déjà très correctement — capacité réelle, pays réellement
 * desservis, délais observés, réputation calculée. Mais elle ne disait jamais
 * *pourquoi*. L'acheteur recevait une liste ordonnée sans savoir ce qui avait
 * décidé de l'ordre, et les poids du classement vivaient dans une fonction de
 * tri que personne ne voit.
 *
 * Un classement dont les poids sont cachés est exactement ce que §4 met en
 * garde : « ne pas présenter une correspondance comme garantie ». Une liste
 * ordonnée sans justification *est* une garantie implicite — elle dit « le
 * premier est le meilleur » sans jamais l'écrire, donc sans jamais pouvoir
 * être contredite.
 *
 * Ce module rend les deux lisibles : les raisons, et le poids de chacune.
 *
 * **Deux règles le gouvernent.**
 *
 * 1. **On n'énonce que ce que l'acheteur a demandé.** Afficher « ✓ pays
 *    desservi » quand il n'a précisé aucun pays est un faux signal de
 *    pertinence : cela donne l'impression d'un critère satisfait là où aucun
 *    critère n'a été posé.
 * 2. **« Non mesuré » n'est pas « non satisfait ».** Un fournisseur qui n'a
 *    jamais expédié n'a pas échoué à desservir une destination : personne ne
 *    lui a encore rien demandé. Les deux se distinguent, ici comme partout
 *    ailleurs dans TOUMA.
 */

export type EtatCritere = 'MET' | 'NOT_MET' | 'NOT_MEASURED';

export interface Raison {
  code: 'CATEGORY' | 'COUNTRY' | 'DESTINATION' | 'QUANTITY' | 'VERIFIED' | 'REPUTATION' | 'TRUST' | 'SEARCH_TERMS';
  label: string;
  state: EtatCritere;
  /** Ce qui a été constaté, en toutes lettres. Jamais « OK ». */
  detail: string;
  /**
   * Poids de ce critère dans le classement par pertinence.
   *
   * Publié pour que l'ordre soit contestable. Un acheteur qui voit qu'un
   * fournisseur desservant sa destination passe devant un fournisseur mieux
   * noté peut au moins comprendre pourquoi, et changer de tri s'il n'est pas
   * d'accord.
   */
  weight: number;
}

/** Poids du tri par pertinence. Une seule table, lue par le tri et par l'affichage. */
export const POIDS = {
  DESTINATION: 4,
  QUANTITY: 3,
  VERIFIED: 2,
  /** Réputation et confiance comptent pour un point au plus, chacune. */
  REPUTATION: 1,
  TRUST: 1,
} as const;

export interface EntreeCorrespondance {
  /** Critères demandés par l'acheteur. `undefined` = non demandé. */
  demande: {
    q?: string;
    category?: string;
    country?: string;
    destination?: string;
    minQuantity?: number;
    verifiedOnly?: boolean;
  };
  /** Ce qu'on observe du fournisseur. */
  observe: {
    countryCode: string;
    verified: boolean;
    matchingProducts: number;
    capacity: number;
    servesDestination: boolean | null;
    servesRequestedQuantity: boolean | null;
    servedCountries: string[];
    reputationScore: number | null;
    trustScore: number | null;
    minOrderQty: number | null;
  };
}

/**
 * Les raisons pour lesquelles ce fournisseur figure dans les résultats.
 *
 * Rendues dans l'ordre où elles pèsent, pour que la première ligne lue soit
 * celle qui a le plus décidé.
 */
export function raisons(entree: EntreeCorrespondance): Raison[] {
  const { demande, observe } = entree;
  const sortie: Raison[] = [];

  if (demande.destination) {
    // Trois cas, et le troisième est celui qu'on rate facilement.
    //
    // Le service calcule `servesDestination` comme « la destination figure-t-elle
    // parmi les pays déjà desservis ? ». Pour un fournisseur qui n'a **jamais**
    // expédié, la liste est vide et la réponse est `false` — mécaniquement juste,
    // et trompeuse : elle le marque comme n'ayant pas satisfait un critère
    // auquel personne ne lui a encore donné l'occasion de répondre.
    //
    // Sans historique, l'état est « non mesuré ». C'est ce que l'affichage
    // disait déjà en toutes lettres pendant que la pastille disait le contraire.
    const etat: EtatCritere =
      observe.servesDestination === null || observe.servedCountries.length === 0
        ? 'NOT_MEASURED'
        : observe.servesDestination
          ? 'MET'
          : 'NOT_MET';
    sortie.push({
      code: 'DESTINATION',
      label: `Livre vers ${demande.destination}`,
      state: etat,
      detail:
        observe.servedCountries.length === 0
          ? 'Ce fournisseur n’a encore expédié nulle part : rien ne dit qu’il ne peut pas livrer là-bas, seulement qu’il ne l’a jamais fait.'
          : observe.servesDestination
            ? `A déjà expédié vers ${demande.destination} (pays desservis : ${observe.servedCountries.join(', ')}).`
            : `N’a jamais expédié vers ${demande.destination}. Pays desservis : ${observe.servedCountries.join(', ')}.`,
      weight: POIDS.DESTINATION,
    });
  }

  if (demande.minQuantity) {
    const etat: EtatCritere = observe.servesRequestedQuantity === null ? 'NOT_MEASURED' : observe.servesRequestedQuantity ? 'MET' : 'NOT_MET';
    sortie.push({
      code: 'QUANTITY',
      label: `Peut servir ${demande.minQuantity} unités`,
      state: etat,
      detail: observe.servesRequestedQuantity
        ? `Au moins une référence a ${demande.minQuantity} unités ou plus en stock. Capacité totale sur les références correspondantes : ${observe.capacity}.`
        : `Aucune référence n’atteint ${demande.minQuantity} unités en stock. Capacité totale : ${observe.capacity}.`,
      weight: POIDS.QUANTITY,
    });
  }

  if (demande.country) {
    const correspond = observe.countryCode === demande.country;
    sortie.push({
      code: 'COUNTRY',
      label: `Établi en ${demande.country}`,
      state: correspond ? 'MET' : 'NOT_MET',
      detail: correspond ? `Fournisseur établi en ${demande.country}.` : `Fournisseur établi en ${observe.countryCode}, pas en ${demande.country}.`,
      weight: 0,
    });
  }

  if (demande.category) {
    sortie.push({
      code: 'CATEGORY',
      label: 'Vend dans la catégorie demandée',
      state: observe.matchingProducts > 0 ? 'MET' : 'NOT_MET',
      detail: `${observe.matchingProducts} référence(s) en catalogue dans cette catégorie.`,
      weight: 0,
    });
  }

  if (demande.q) {
    sortie.push({
      code: 'SEARCH_TERMS',
      label: 'Correspond aux termes recherchés',
      state: observe.matchingProducts > 0 ? 'MET' : 'NOT_MET',
      detail: `${observe.matchingProducts} référence(s) correspondent à « ${demande.q} ».`,
      weight: 0,
    });
  }

  // La vérification est signalée dès qu'elle est acquise, même sans avoir été
  // demandée : c'est un fait sur le fournisseur, et il pèse dans le classement.
  // Son absence n'est signalée que si l'acheteur l'exigeait.
  if (observe.verified || demande.verifiedOnly) {
    sortie.push({
      code: 'VERIFIED',
      label: 'Vendeur vérifié par TOUMA',
      state: observe.verified ? 'MET' : 'NOT_MET',
      detail: observe.verified
        ? 'Ses pièces justificatives ont été contrôlées. Cette vérification ne garantit pas la transaction.'
        : 'Ce fournisseur n’a pas passé de vérification TOUMA.',
      weight: POIDS.VERIFIED,
    });
  }

  // Réputation et confiance : signalées uniquement quand elles existent.
  // Un fournisseur nouveau n'a pas une mauvaise note, il n'en a pas — et une
  // ligne « réputation : non mesurée » en tête de liste le ferait passer pour
  // un mauvais choix alors qu'il n'a simplement pas d'historique.
  if (observe.reputationScore !== null) {
    sortie.push({
      code: 'REPUTATION',
      label: 'Réputation mesurée',
      state: 'MET',
      detail: `Score de réputation ${observe.reputationScore}/100, calculé sur ses transactions réelles.`,
      weight: POIDS.REPUTATION,
    });
  }
  if (observe.trustScore !== null) {
    sortie.push({
      code: 'TRUST',
      label: 'Indice de confiance mesuré',
      state: 'MET',
      detail: `Indice de confiance ${observe.trustScore}/100.`,
      weight: POIDS.TRUST,
    });
  }

  return sortie.sort((a, b) => b.weight - a.weight);
}

/**
 * Score de pertinence, calculé depuis les mêmes poids que ceux publiés.
 *
 * Une seule table de poids, lue par le tri **et** par l'affichage : sans cela,
 * les deux divergeraient, et les raisons affichées finiraient par expliquer un
 * classement qui n'est plus celui qu'on applique.
 */
export function scorePertinence(observe: EntreeCorrespondance['observe']): number {
  return (
    (observe.servesDestination === true ? POIDS.DESTINATION : 0) +
    (observe.servesRequestedQuantity === true ? POIDS.QUANTITY : 0) +
    (observe.verified ? POIDS.VERIFIED : 0) +
    ((observe.reputationScore ?? 0) / 100) * POIDS.REPUTATION +
    ((observe.trustScore ?? 0) / 100) * POIDS.TRUST
  );
}

/** Ce qu'une correspondance n'est pas. Rendu avec chaque recherche. */
export const AVERTISSEMENT =
  'Une correspondance n’est pas une garantie. Elle dit ce que TOUMA observe — stock saisi, pays réellement ' +
  'desservis, transactions passées — et rien de ce que le fournisseur déclare sans preuve. Le classement par ' +
  'pertinence suit les poids publiés avec chaque résultat ; changez de tri si vos priorités diffèrent.';

/**
 * Motifs de blocage d'un corridor, sous forme de codes (§62).
 *
 * `CapaciteReelle.missing` était une liste de phrases françaises fabriquées à
 * la volée. Deux choses s'y cassaient, et aucune des deux n'était visible en
 * lisant le code.
 *
 * 1. **Rien n'était traduisible.** L'application est bilingue, la vitrine le
 *    devient ; mais la raison pour laquelle un corridor ne fonctionne pas
 *    arrivait en français depuis le serveur, et s'affichait telle quelle au
 *    milieu d'un écran arabe. Un arabophone lisait « ce corridor ne fonctionne
 *    pas » sans jamais pouvoir lire *pourquoi* — soit la seule information qui
 *    lui aurait servi.
 * 2. **Une décision métier reposait sur une recherche de sous-chaîne.**
 *    `updateCorridor` décidait si un blocage empêchait l'activation en
 *    cherchant « n’est pas encore ouvert » dans la phrase. Reformuler ce
 *    message — ou seulement remplacer l'apostrophe typographique par une
 *    apostrophe droite — aurait rendu bloquant un motif qui ne l'est pas, et
 *    laissé un corridor inactivable sans que rien ne le signale.
 *
 * Le code est donc la donnée, et la phrase française n'en est qu'un rendu parmi
 * d'autres. `missing` continue d'exister, calculé depuis les codes : les
 * clients existants ne voient aucun changement.
 */

/** Motifs connus. Toute valeur nouvelle doit être traduite dans les deux langues. */
export const CODES_BLOCAGE = [
  'CORRIDOR_NOT_CONFIGURED',
  'ORIGIN_TRADE_DISABLED',
  'DESTINATION_TRADE_DISABLED',
  'NO_SHARED_PAYMENT_METHOD',
  'NO_CARRIER_COVERING_BOTH',
  'ONLY_SIMULATED_CARRIER',
  'NO_DECLARED_CURRENCY',
  'CORRIDOR_SUSPENDED',
  'CORRIDOR_NOT_YET_OPEN',
] as const;

export type CodeBlocage = (typeof CODES_BLOCAGE)[number];

/**
 * Un motif de blocage.
 *
 * `params` porte les valeurs que la phrase intercale — un code pays, la liste
 * des adaptateurs de simulation enregistrés. Elles ne sont pas traduites :
 * `TD` s'écrit `TD` dans les deux langues.
 */
export interface Blocage {
  code: CodeBlocage;
  params?: Record<string, string>;
}

/**
 * Motifs qui n'empêchent pas une activation.
 *
 * Passer un corridor à `ACTIVE`, c'est précisément lever « suspendu » et « pas
 * encore ouvert » : les compter comme bloquants rendrait l'opération
 * impossible, puisque l'un des deux est toujours vrai avant elle.
 */
const NON_BLOQUANTS_A_L_ACTIVATION: ReadonlySet<CodeBlocage> = new Set<CodeBlocage>([
  'CORRIDOR_SUSPENDED',
  'CORRIDOR_NOT_YET_OPEN',
]);

/** Ce qui doit être levé avant de pouvoir activer le corridor. */
export function bloquantsALActivation(blocages: readonly Blocage[]): Blocage[] {
  return blocages.filter((b) => !NON_BLOQUANTS_A_L_ACTIVATION.has(b.code));
}

/** Rendu français d'un motif. C'est un rendu, pas la donnée. */
const PHRASES_FR: Record<CodeBlocage, (p: Record<string, string>) => string> = {
  CORRIDOR_NOT_CONFIGURED: (p) => `Aucun corridor configuré de ${p.origin} vers ${p.destination}.`,
  ORIGIN_TRADE_DISABLED: (p) => `Le pays ${p.country} n’est pas ouvert au commerce transfrontalier.`,
  DESTINATION_TRADE_DISABLED: (p) => `Le pays ${p.country} n’est pas ouvert au commerce transfrontalier.`,
  NO_SHARED_PAYMENT_METHOD: () => 'Aucun moyen de paiement n’est disponible des deux côtés de ce corridor.',
  NO_CARRIER_COVERING_BOTH: () => 'Aucun transporteur enregistré ne couvre les deux pays de ce corridor.',
  ONLY_SIMULATED_CARRIER: (p) =>
    `Aucun transporteur réel ne couvre les deux pays de ce corridor : seul un adaptateur de simulation est enregistré (${p.providers}), et une simulation n’achemine aucun colis.`,
  NO_DECLARED_CURRENCY: () => 'Aucune devise n’est déclarée pour ce corridor.',
  CORRIDOR_SUSPENDED: () => 'Le corridor est suspendu par l’exploitant.',
  CORRIDOR_NOT_YET_OPEN: () => 'Le corridor n’est pas encore ouvert.',
};

/** Rend un motif en français. */
export function phraseFr(blocage: Blocage): string {
  return PHRASES_FR[blocage.code](blocage.params ?? {});
}

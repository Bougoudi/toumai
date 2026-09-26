/**
 * Libellés des énumérations du commerce transfrontalier.
 *
 * Ces tables vivaient ici en français seulement. Elles sont maintenant dérivées
 * du dictionnaire bilingue : une seule source, et l'arabe garanti présent par
 * le typage de `i18n.ts`. Les deux constantes françaises restent exportées
 * parce qu'un test de la suite principale vérifie qu'elles couvrent **toutes**
 * les valeurs de l'énumération Prisma — ajouter un type de document sans
 * l'écrire ici fait échouer la compilation, pas la page.
 */
import { type Cle, type Langue, DICTIONNAIRES, t } from './i18n';

/** Projette les clés d'un préfixe en table `VALEUR → libellé`. */
function table(langue: Langue, prefixe: string): Record<string, string> {
  const sortie: Record<string, string> = {};
  for (const cle of Object.keys(DICTIONNAIRES[langue])) {
    if (cle.startsWith(prefixe)) sortie[cle.slice(prefixe.length)] = DICTIONNAIRES[langue][cle as Cle];
  }
  return sortie;
}

/** Types de documents commerciaux (`TradeDocumentKind`), en français. */
export const LIBELLES_DOCUMENT: Record<string, string> = table('fr', 'doc.');

/** Statuts déclarés d'un corridor (`TradeCorridorStatus`), en français. */
export const LIBELLES_STATUT_CORRIDOR: Record<string, string> = table('fr', 'statutCorridor.');

/**
 * Traduit une valeur d'énumération, ou la rend telle quelle.
 *
 * Rendre le code brut est volontaire : une valeur inconnue doit sauter aux yeux
 * plutôt que de disparaître derrière un libellé inventé.
 */
export function libelle(table: Record<string, string>, valeur: string): string {
  return table[valeur] ?? valeur;
}

/**
 * Libellé d'une valeur d'énumération dans la langue de lecture.
 *
 * Une valeur que le dictionnaire ne connaît pas est rendue telle quelle, dans
 * les deux langues : mieux vaut un code brut à l'écran qu'une traduction
 * inventée, parce que le premier se remarque et se corrige.
 */
export function libelleEnum(langue: Langue, prefixe: 'doc.' | 'statutCorridor.', valeur: string): string {
  const cle = `${prefixe}${valeur}` as Cle;
  return cle in DICTIONNAIRES[langue] ? t(langue, cle) : valeur;
}

/**
 * Motif de blocage d'un corridor, dans la langue de lecture.
 *
 * Le serveur envoie des codes et, pour les clients qui ne les connaissent pas
 * encore, leur rendu français. On lit les codes en priorité : c'est ce qui
 * permet à une page arabe d'expliquer *pourquoi* un corridor est fermé au lieu
 * d'intercaler une phrase française au milieu.
 */
export function motifsBlocage(
  langue: Langue,
  capacite: { blockers?: Array<{ code: string; params?: Record<string, string> }>; missing: string[] },
): string[] {
  if (!capacite.blockers || capacite.blockers.length === 0) return capacite.missing;
  return capacite.blockers.map((b) => {
    const cle = `blocage.${b.code}` as Cle;
    return cle in DICTIONNAIRES[langue] ? t(langue, cle, b.params ?? {}) : b.code;
  });
}

/**
 * Libellés français des énumérations du commerce transfrontalier.
 *
 * La vitrine ne partage pas le dictionnaire de l'application — celui-ci est un
 * module de navigateur servi depuis `public/`, que le rendu côté serveur ne
 * peut pas charger. Cette table le double donc pour les seules valeurs que les
 * pages publiques affichent.
 *
 * Un doublon se périme en silence : un test de la suite principale vérifie que
 * cette table couvre **toutes** les valeurs de l'énumération Prisma. Ajouter un
 * type de document sans l'écrire ici fait échouer la compilation, pas la page.
 *
 * Aucun import : ce fichier est lu par le contrôle de typage de la vitrine et
 * par les tests du serveur, deux contextes qui n'ont pas les mêmes modules.
 */

/** Types de documents commerciaux (`TradeDocumentKind`). */
export const LIBELLES_DOCUMENT: Record<string, string> = {
  COMMERCIAL_INVOICE: 'Facture commerciale',
  PROFORMA_INVOICE: 'Facture proforma',
  PACKING_LIST: 'Liste de colisage',
  PURCHASE_ORDER: 'Bon de commande',
  CERTIFICATE_OF_ORIGIN: 'Certificat d’origine',
  SHIPPING_DOCUMENT: 'Document de transport',
  OTHER: 'Autre document',
};

/** Statuts déclarés d'un corridor (`TradeCorridorStatus`). */
export const LIBELLES_STATUT_CORRIDOR: Record<string, string> = {
  ACTIVE: 'ouvert',
  LIMITED: 'ouvert avec restrictions',
  COMING_SOON: 'annoncé, pas encore ouvert',
  SUSPENDED: 'suspendu',
  CLOSED: 'fermé',
};

/**
 * Traduit une valeur d'énumération, ou la rend telle quelle.
 *
 * Rendre le code brut est volontaire : une valeur inconnue doit sauter aux yeux
 * plutôt que de disparaître derrière un libellé inventé.
 */
export function libelle(table: Record<string, string>, valeur: string): string {
  return table[valeur] ?? valeur;
}

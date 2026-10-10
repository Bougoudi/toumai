/**
 * Ce qu'on peut dire d'un corridor, et ce qu'on ne peut pas.
 *
 * L'application annonçait « Corridor ouvert : Cameroun ↔ Tchad » en haut de
 * chaque écran, et « 🇹🇩 Tchad ↔ 🇨🇲 Cameroun · corridor pilote ouvert » sur
 * l'accueil. La première phrase était construite en joignant les noms de
 * `/countries` : elle ne disait donc pas qu'un corridor fonctionnait, seulement
 * que deux pays figuraient au référentiel. La seconde était écrite en dur, donc
 * vraie à jamais, y compris suspendu. Mesuré sur l'instance de développement au
 * moment de la correction : deux corridors déclarés `COMING_SOON`, aucun
 * opérationnel, tous deux bloqués par `ONLY_SIMULATED_CARRIER` — et les deux
 * écrans annonçaient « ouvert ». La vitrine avait été corrigée du même mensonge
 * en V24 (§72) ; l'application ne l'avait pas été.
 *
 * Ce module ne fait **aucune requête** : il reçoit la liste et décide. C'est ce
 * qui permet de vérifier la décision elle-même, sans navigateur — et donc dans
 * la CI, qui n'exécute que les tests unitaires.
 *
 * Trois états, pas deux. `null` (l'API n'a pas répondu) et `[]` (elle a répondu
 * qu'aucun corridor n'est ouvert) ne sont pas la même chose : le premier
 * n'autorise aucune phrase, le second autorise de dire qu'aucun ne l'est. Les
 * confondre, c'est reprendre l'habitude qu'on corrige ici.
 */
import { t } from './i18n.js';

/**
 * Les corridors réellement opérationnels.
 *
 * `operational` est calculé par le serveur et n'est vrai que si un moyen de
 * paiement **et** un transporteur réel — pas un adaptateur de simulation —
 * couvrent les deux pays. Le statut déclaré par l'exploitant (`declaredStatus`)
 * n'entre pas dans ce filtre : c'est une intention, pas une capacité.
 *
 * @param {Array<{operational: boolean}> | null | undefined} items
 * @returns {Array<object> | null} `null` quand l'état est inconnu.
 */
export function operationnels(items) {
  if (!Array.isArray(items)) return null;
  return items.filter((c) => c.operational === true);
}

/**
 * Le libellé d'un corridor, lisible dans les deux langues.
 *
 * Les pays sont désignés par leur code ISO (`TD → CM`), comme le fait déjà la
 * fiche de corridor. Le référentiel ne porte pas de nom arabe fiable — le
 * `nativeName` du Cameroun vaut « Cameroun » — et un nom français au milieu
 * d'un écran arabe se lit mal ; un code se lit partout.
 */
export function libelleCorridor(c) {
  return `${c.originCountry} → ${c.destinationCountry}`;
}

/** Les corridors ouverts, en une chaîne, ou `null` s'il n'y en a aucun de sûr. */
export function corridorNomme(items) {
  const ouverts = operationnels(items);
  if (ouverts === null || ouverts.length === 0) return null;
  return ouverts.map(libelleCorridor).join(' · ');
}

/**
 * La phrase du bandeau, ou `null` quand il n'y a rien d'honnête à écrire.
 *
 * Le bandeau ne porte que la bonne nouvelle, quand elle est vraie. Écrire
 * « aucun corridor n'est ouvert » en haut de chaque écran serait exact mais
 * inutilement décourageant, et surtout redondant : la page Commerce
 * transfrontalier le dit déjà, avec les motifs de blocage.
 */
export function phraseBandeau(items) {
  const ouverts = operationnels(items);
  if (ouverts === null || ouverts.length === 0) return null;
  const names = ouverts.map(libelleCorridor).join(' · ');
  return t(ouverts.length > 1 ? 'sh.corridorsOpen' : 'sh.corridorOpen', { names });
}

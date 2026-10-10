import { LANGUES, NOM_NATIF, type Langue, chemin, t } from '../lib/i18n';

/**
 * Sélecteur de langue.
 *
 * Il renvoie vers la **même** page dans l'autre langue, jamais vers l'accueil :
 * renvoyer quelqu'un à la racine parce qu'il a changé de langue lui fait perdre
 * ce qu'il était en train de lire — et sur une fiche produit trouvée par un
 * moteur de recherche, c'est perdre la raison de sa visite.
 *
 * `cheminFr` est l'adresse française de la page courante ; `chemin()` en dérive
 * l'adresse dans l'autre langue. C'est la vue qui le fournit, parce qu'elle est
 * le seul endroit qui le connaisse sans rendre la page dynamique.
 */
export function BarreLangue({ langue, cheminFr }: { langue: Langue; cheminFr: string }) {
  return (
    <p className="meta" aria-label={t(langue, 'langue.aria')}>
      {LANGUES.filter((l) => l !== langue).map((autre) => (
        <a key={autre} href={chemin(autre, cheminFr)} hrefLang={autre} lang={autre}>
          {NOM_NATIF[autre]}
        </a>
      ))}
    </p>
  );
}

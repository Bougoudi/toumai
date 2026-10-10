import { APP_URL, ApiUnavailable, listCorridors } from '../lib/api';
import { DIRECTION, type Langue, chemin, nomPays, t } from '../lib/i18n';

/**
 * Ossature commune aux deux langues.
 *
 * Next.js ne permet pas à une disposition imbriquée de changer la balise
 * `<html>` : le sens d'écriture se décide donc à la racine, et c'est pourquoi
 * le français et l'arabe ont chacun leur propre disposition racine, toutes deux
 * construites à partir d'ici. Sans quoi une page arabe serait servie avec
 * `lang="fr" dir="ltr"` — un navigateur n'inverserait rien, et un lecteur
 * d'écran lirait le texte comme du français.
 */

/**
 * Bandeau de corridor.
 *
 * Il annonçait « Corridor ouvert : Tchad ↔ Cameroun », écrit en dur. C'était
 * faux dès que le corridor était suspendu, et faux depuis toujours tant
 * qu'aucun transporteur réel ne le couvrait : exactement l'affirmation que §72
 * interdit. Il lit maintenant l'état réel, et ne dit rien quand il ne sait pas.
 */
async function bandeauCorridors(langue: Langue): Promise<string | null> {
  try {
    const ouverts = (await listCorridors()).items.filter((c) => c.operational);
    if (ouverts.length === 0) return null;
    const liste = ouverts
      .map(
        (c) =>
          `${nomPays(langue, c.originCountry, c.originCountryName)} → ${nomPays(langue, c.destinationCountry, c.destinationCountryName)}`,
      )
      .join(' · ');
    return t(langue, ouverts.length > 1 ? 'banniere.plusieurs' : 'banniere.un', { liste });
  } catch (err) {
    // Une API muette n'autorise pas à annoncer un corridor ouvert.
    if (err instanceof ApiUnavailable) return null;
    throw err;
  }
}

/**
 * Enveloppe complète d'une page.
 *
 * Le sélecteur de langue n'est pas ici mais dans chaque vue : une disposition
 * racine ne connaît pas l'adresse de la page qu'elle enveloppe, et la lui faire
 * lire — par un en-tête posé par un intergiciel — rendrait dynamiques des pages
 * dont tout l'intérêt est d'être servies déjà écrites. Un lien « العربية » qui
 * renverrait à l'accueil ferait perdre sa page à qui change de langue ; il vaut
 * mieux que la vue, qui connaît son chemin, porte le lien juste.
 */
export async function Ossature({ langue, children }: { langue: Langue; children: React.ReactNode }) {
  const bandeau = await bandeauCorridors(langue);

  return (
    <html lang={langue} dir={DIRECTION[langue]}>
      <body>
        <header className="site-header">
          <div className="container">
            <a className="brand" href={chemin(langue, '/')}>
              <span className="brand-mark" aria-hidden="true">
                T
              </span>
              TOUMA
            </a>
            <nav aria-label={t(langue, 'nav.aria')}>
              <a href={chemin(langue, '/produits')}>{t(langue, 'nav.catalogue')}</a>
              <a href={chemin(langue, '/trade')}>{t(langue, 'nav.corridors')}</a>
              {/* Tout ce qui demande un compte vit dans l'application, pas ici. */}
              <a href={`${APP_URL}/touma/`}>{t(langue, 'nav.compte')}</a>
              <a href={`${APP_URL}/touma/inscription`}>{t(langue, 'nav.ouvrirBoutique')}</a>
            </nav>
          </div>
        </header>
        {bandeau ? <div className="corridor">{bandeau}</div> : null}
        <main>{children}</main>
        <footer className="site-footer">
          <div className="container">
            <p>{t(langue, 'pied.mention')}</p>
            <p>
              <a href={`${APP_URL}/touma/aide`}>{t(langue, 'pied.assistance')}</a> ·{' '}
              <a href={`${APP_URL}/api/v1/openapi.json`}>{t(langue, 'pied.api')}</a> ·{' '}
              <a href={`${APP_URL}/privacy.html`}>{t(langue, 'pied.confidentialite')}</a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

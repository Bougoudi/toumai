import type { Metadata } from 'next';
import { ListeProduits } from '../components/ListeProduits';
import { ApiUnavailable, listProducts, SITE_URL } from '../lib/api';
import { type Langue, alternatesLangues, chemin, t } from '../lib/i18n';
import { BarreLangue } from './BarreLangue';

export function metaCatalogue(langue: Langue): Metadata {
  return {
    title: t(langue, 'catalogue.titre'),
    description: t(langue, 'catalogue.description'),
    alternates: {
      canonical: `${SITE_URL}${chemin(langue, '/produits')}`,
      languages: alternatesLangues(SITE_URL, '/produits'),
    },
  };
}

export async function Catalogue({
  langue,
  searchParams,
}: {
  langue: Langue;
  searchParams: Promise<{ q?: string; page?: string; country?: string }>;
}) {
  const { q, page, country } = await searchParams;
  const numero = Number(page) > 0 ? Number(page) : 1;
  // Deux lettres, ou rien : un code pays libre irait chercher une erreur de
  // validation côté serveur et rendrait la page vide sans rien expliquer.
  const pays = typeof country === 'string' && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : undefined;
  const suffixe = `${q ? `&q=${encodeURIComponent(q)}` : ''}${pays ? `&country=${pays}` : ''}`;
  const base = chemin(langue, '/produits');

  try {
    const resultat = await listProducts({ q, country: pays, page: numero, limit: 24 });
    return (
      <div className="container">
        <BarreLangue langue={langue} cheminFr="/produits" />
        <h1>
          {q
            ? t(langue, 'catalogue.recherche', { q })
            : pays
              ? t(langue, 'catalogue.parPays', { pays })
              : t(langue, 'catalogue.titre')}
        </h1>
        <p className="lede">
          {t(langue, 'catalogue.compte', { total: resultat.total, page: resultat.page, pages: resultat.pages || 1 })}
        </p>
        <ListeProduits produits={resultat.items} langue={langue} />
        {/* Pagination en liens réels : indexable, et utilisable sans JavaScript. */}
        <nav style={{ marginTop: 24, display: 'flex', gap: 12 }} aria-label={t(langue, 'catalogue.pagination')}>
          {numero > 1 && (
            <a className="btn secondary" href={`${base}?page=${numero - 1}${suffixe}`}>
              {t(langue, 'catalogue.pagePrecedente')}
            </a>
          )}
          {resultat.hasNext && (
            <a className="btn secondary" href={`${base}?page=${numero + 1}${suffixe}`}>
              {t(langue, 'catalogue.pageSuivante')}
            </a>
          )}
        </nav>
      </div>
    );
  } catch (err) {
    if (!(err instanceof ApiUnavailable)) throw err;
    return (
      <div className="container">
        <BarreLangue langue={langue} cheminFr="/produits" />
        <h1>{t(langue, 'catalogue.titre')}</h1>
        <p className="empty">{t(langue, 'catalogue.indisponible')}</p>
      </div>
    );
  }
}

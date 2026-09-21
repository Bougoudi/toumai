import type { Metadata } from 'next';
import { ListeProduits } from '../../components/ListeProduits';
import { ApiUnavailable, listProducts } from '../../lib/api';

export const metadata: Metadata = {
  title: 'Catalogue',
  description: 'Tous les produits disponibles sur TOUMA : agroalimentaire, textile, matériaux et équipements.',
};

export const revalidate = 30;

export default async function Catalogue({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; country?: string }> }) {
  const { q, page, country } = await searchParams;
  const numero = Number(page) > 0 ? Number(page) : 1;
  // Deux lettres, ou rien : un code pays libre irait chercher une erreur de
  // validation côté serveur et rendrait la page vide sans rien expliquer.
  const pays = typeof country === 'string' && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : undefined;
  const suffixe = `${q ? `&q=${encodeURIComponent(q)}` : ''}${pays ? `&country=${pays}` : ''}`;

  try {
    const resultat = await listProducts({ q, country: pays, page: numero, limit: 24 });
    return (
      <div className="container">
        <h1>{q ? `Recherche : ${q}` : pays ? `Catalogue — ${pays}` : 'Catalogue'}</h1>
        <p className="lede">
          {resultat.total} produit{resultat.total > 1 ? 's' : ''} — page {resultat.page} sur {resultat.pages || 1}.
        </p>
        <ListeProduits produits={resultat.items} />
        {/* Pagination en liens réels : indexable, et utilisable sans JavaScript. */}
        <nav style={{ marginTop: 24, display: 'flex', gap: 12 }} aria-label="Pagination">
          {numero > 1 && (
            <a className="btn secondary" href={`/produits?page=${numero - 1}${suffixe}`}>
              Page précédente
            </a>
          )}
          {resultat.hasNext && (
            <a className="btn secondary" href={`/produits?page=${numero + 1}${suffixe}`}>
              Page suivante
            </a>
          )}
        </nav>
      </div>
    );
  } catch (err) {
    if (!(err instanceof ApiUnavailable)) throw err;
    return (
      <div className="container">
        <h1>Catalogue</h1>
        <p className="empty">Le catalogue est momentanément indisponible. Réessayez dans un instant.</p>
      </div>
    );
  }
}

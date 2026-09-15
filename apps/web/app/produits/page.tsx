import type { Metadata } from 'next';
import { ListeProduits } from '../../components/ListeProduits';
import { ApiUnavailable, listProducts } from '../../lib/api';

export const metadata: Metadata = {
  title: 'Catalogue',
  description: 'Tous les produits disponibles sur TOUMA : agroalimentaire, textile, matériaux et équipements.',
};

export const revalidate = 30;

export default async function Catalogue({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q, page } = await searchParams;
  const numero = Number(page) > 0 ? Number(page) : 1;

  try {
    const resultat = await listProducts({ q, page: numero, limit: 24 });
    return (
      <div className="container">
        <h1>{q ? `Recherche : ${q}` : 'Catalogue'}</h1>
        <p className="lede">
          {resultat.total} produit{resultat.total > 1 ? 's' : ''} — page {resultat.page} sur {resultat.pages || 1}.
        </p>
        <ListeProduits produits={resultat.items} />
        {/* Pagination en liens réels : indexable, et utilisable sans JavaScript. */}
        <nav style={{ marginTop: 24, display: 'flex', gap: 12 }} aria-label="Pagination">
          {numero > 1 && (
            <a className="btn secondary" href={`/produits?page=${numero - 1}${q ? `&q=${encodeURIComponent(q)}` : ''}`}>
              Page précédente
            </a>
          )}
          {resultat.hasNext && (
            <a className="btn secondary" href={`/produits?page=${numero + 1}${q ? `&q=${encodeURIComponent(q)}` : ''}`}>
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

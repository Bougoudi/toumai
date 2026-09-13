import { ENDPOINTS, type Country, type Paginated, type Product, type ProductSummary } from '@touma/contracts';

/**
 * Accès à l'API TOUMA depuis le serveur de rendu.
 *
 * Tout passe par ce fichier, pour une raison : les types viennent du paquet de
 * contrats, pas d'une description recopiée ici. Si le serveur change une forme,
 * le contrôle de typage échoue de ce côté aussi.
 */

/** Adresse de l'API. En développement, l'application Express sur le port 3000. */
const API_URL = (process.env.TOUMA_API_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');

/** Adresse publique de l'application authentifiée, vers laquelle on renvoie. */
export const APP_URL = (process.env.TOUMA_APP_URL ?? API_URL).replace(/\/+$/, '');

export class ApiUnavailable extends Error {}

/**
 * Lit l'API. Aucune donnée n'est mise en cache plus de quelques secondes : un
 * prix ou un stock affichés à un acheteur doivent être ceux du moment, et la
 * vitrine n'a pas à réinventer une vérité que le serveur détient déjà.
 */
async function read<T>(path: string, revalidate = 30): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { next: { revalidate }, headers: { accept: 'application/json' } });
  } catch (cause) {
    throw new ApiUnavailable(`API injoignable : ${path}`, { cause });
  }
  if (!response.ok) throw new ApiUnavailable(`API en erreur (${response.status}) : ${path}`);
  return (await response.json()) as T;
}

export function listProducts(params: { page?: number; limit?: number; q?: string } = {}): Promise<Paginated<ProductSummary>> {
  const query = new URLSearchParams();
  query.set('limit', String(params.limit ?? 24));
  if (params.page) query.set('page', String(params.page));
  if (params.q) query.set('q', params.q);
  return read<Paginated<ProductSummary>>(`${ENDPOINTS.products}?${query}`);
}

export function getProduct(slug: string): Promise<Product> {
  return read<Product>(ENDPOINTS.product(slug));
}

export function listCountries(): Promise<{ items: Country[] }> {
  // Le référentiel bouge rarement : une heure suffit.
  return read<{ items: Country[] }>(ENDPOINTS.countries, 3600);
}

/**
 * Met en forme un montant **sans jamais le convertir en nombre**.
 *
 * `Intl.NumberFormat.format` accepte une chaîne décimale de précision
 * arbitraire (vérifié : `format('123456789012345678901234')` rend le nombre
 * entier, exact). On lui passe donc la chaîne telle qu'elle arrive du serveur.
 * Faire `Number('145000')` marcherait aujourd'hui et mentirait le jour où un
 * montant dépassera la précision d'un flottant — le jour d'une grosse commande.
 *
 * La conversion de type est là parce que la bibliothèque standard visée
 * (ES2022) ne déclare pas encore la surcharge « chaîne », arrivée avec ES2023.
 */
export function formatMoney(amount: string, currency: string, locale = 'fr-FR'): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount as unknown as number);
  } catch {
    return `${amount} ${currency}`;
  }
}

/**
 * Contrats de l'API TOUMA — les formes que le serveur promet et que les
 * interfaces attendent.
 *
 * Pourquoi un paquet plutôt qu'un fichier de types recopié : parce qu'une
 * interface et un serveur qui décrivent séparément la même réponse finissent
 * toujours par ne plus décrire la même chose, et personne ne s'en aperçoit
 * avant l'écran blanc. Ici, la description est unique ; si le serveur change de
 * forme, le contrôle de typage échoue des deux côtés à la fois.
 *
 * **Aucune dépendance d'exécution.** Ce paquet ne contient que des types : il
 * disparaît à la compilation et n'ajoute pas un octet au navigateur.
 *
 * **Les montants sont des chaînes.** `"145000"`, jamais `145000`. Un nombre
 * flottant JavaScript ne représente pas fidèlement une somme d'argent ; le
 * serveur travaille en décimal exact et transmet du texte. Toute interface qui
 * reconvertit en `number` pour additionner réintroduit le défaut que la base a
 * justement évité.
 */

/** Code ISO 3166-1 alpha-2 (« TD », « CM »). */
export type CountryCode = string;

/** Code ISO 4217 (« XAF »). */
export type CurrencyCode = string;

/** Montant décimal exact, transporté en texte. Jamais un `number`. */
export type MoneyString = string;

/** Date ISO 8601 en UTC. */
export type IsoDate = string;

// ── Pagination ───────────────────────────────────────────────────────────────

/** Enveloppe des listes paginées par page (catalogue, boutiques, commandes). */
export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasNext: boolean;
}

/** Enveloppe des listes paginées par curseur (messages d'une conversation). */
export interface Cursored<T> {
  items: T[];
  hasMore: boolean;
  olderCursor: string | null;
}

// ── Référentiel ──────────────────────────────────────────────────────────────

export interface Country {
  code: CountryCode;
  name: string;
  currency: CurrencyCode;
  dialCode: string;
  /** Un pays peut être ouvert à l'achat sans l'être à la vente, et l'inverse. */
  buyingEnabled: boolean;
  sellingEnabled: boolean;
  active: boolean;
}

// ── Boutiques ────────────────────────────────────────────────────────────────

export type StoreVerificationStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

/** Boutique telle qu'elle apparaît à côté d'un produit. */
export interface StoreSummary {
  id: string;
  name: string;
  slug: string;
  countryCode: CountryCode;
  /**
   * « Vérifiée » signifie que des pièces ont été contrôlées, pas que la
   * transaction est garantie — l'interface doit le dire aussi clairement.
   */
  verificationStatus: StoreVerificationStatus;
  ratingAverage: MoneyString;
}

export interface Store extends StoreSummary {
  city: string | null;
  status: string;
  ratingCount: number;
}

// ── Catalogue ────────────────────────────────────────────────────────────────

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
}

export interface ProductImage {
  id: string;
  url: string;
  alt: string | null;
  position: number;
}

/** Produit tel qu'il apparaît dans une liste. */
export interface ProductSummary {
  id: string;
  title: string;
  slug: string;
  price: MoneyString;
  /** Prix barré, quand il y en a un — jamais inventé pour faire une remise. */
  compareAtPrice: MoneyString | null;
  currency: CurrencyCode;
  /** Quantité minimale de commande : le B2B en vit. */
  minOrderQty: number;
  countryCode: CountryCode;
  status: string;
  rating: number;
  /** Sans avis, `rating` vaut 0 : c'est `ratingCount` qui dit s'il veut dire quelque chose. */
  ratingCount: number;
  image: string | null;
  store: StoreSummary;
  category: CategorySummary | null;
  stock: number;
  inStock: boolean;
  createdAt: IsoDate;
}

/** Produit complet, sur sa fiche. */
export interface Product extends Omit<ProductSummary, 'image' | 'store'> {
  description: string;
  brand: string | null;
  sku: string | null;
  weightGrams: number | null;
  store: Store;
  images: ProductImage[];
  variants: ProductVariant[];
  reviews: ProductReview[];
  publishedAt: IsoDate | null;
}

export interface ProductVariant {
  id: string;
  name: string;
  price: MoneyString;
  stock: number;
}

export interface ProductReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: IsoDate;
  author: { name: string } | null;
}

// ── Erreurs ──────────────────────────────────────────────────────────────────

/**
 * Toute erreur de l'API a cette forme. Une ressource qui appartient à quelqu'un
 * d'autre répond « introuvable », jamais « interdit » : répondre 403 confirmerait
 * son existence.
 */
export interface ApiError {
  error: string;
  details?: unknown;
}

// ── Chemins ──────────────────────────────────────────────────────────────────

/** Racine de l'API versionnée. Un client n'a pas à la recomposer à la main. */
export const API_BASE = '/api/v1' as const;

export const ENDPOINTS = {
  countries: `${API_BASE}/countries`,
  products: `${API_BASE}/products`,
  product: (slug: string) => `${API_BASE}/products/${encodeURIComponent(slug)}`,
  stores: `${API_BASE}/stores`,
  store: (slug: string) => `${API_BASE}/stores/${encodeURIComponent(slug)}`,
} as const;

/**
 * Contrat commun à tout canal de vente (Etsy, eBay, Amazon...).
 *
 * Un connecteur de canal encapsule l'accès à l'API du marketplace :
 *  - publier un produit en annonce,
 *  - importer les commandes clients,
 *  - (option) mettre à jour le stock.
 *
 * Les identifiants (clés API / jetons OAuth) sont fournis via `config`
 * (propre à chaque canal, stocké chiffré côté SalesChannel.config).
 */
export interface ChannelProduct {
  sku?: string | null;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  quantity: number;
  images: string[];
  category: string;
}

export interface NormalizedChannelOrder {
  externalId: string;
  customer: { name: string; email: string; city?: string; country?: string; zip?: string };
  items: Array<{ sku?: string; title: string; quantity: number; unitPrice: number }>;
  currency: string;
  total: number;
  placedAt?: string;
}

export interface PublishResult {
  externalId: string;
  url?: string;
}

export interface ConnectionInfo {
  ok: boolean;
  account?: string; // nom de boutique / vendeur
  detail?: string;
}

export interface SalesChannelConnector {
  /** etsy | ebay | amazon */
  readonly type: string;
  /** Libellé lisible. */
  readonly label: string;
  /** Champs de configuration attendus (pour l'UI de connexion). */
  readonly configFields: Array<{ key: string; label: string; secret?: boolean; help?: string }>;

  /** Vérifie que les identifiants fonctionnent. */
  testConnection(config: Record<string, string>): Promise<ConnectionInfo>;
  /** Publie un produit en annonce sur le canal. */
  publishListing(config: Record<string, string>, product: ChannelProduct): Promise<PublishResult>;
  /** Importe les commandes depuis une date. */
  fetchOrders(config: Record<string, string>, since?: Date): Promise<NormalizedChannelOrder[]>;
}

/** Erreur « canal non configuré » (identifiants manquants). */
export class ChannelNotConfiguredError extends Error {
  constructor(type: string, missing: string[]) {
    super(`Canal ${type} non configuré : champs manquants (${missing.join(', ')}).`);
  }
}

/** Vérifie que tous les champs requis sont présents, sinon lève une erreur. */
export function requireConfig(type: string, config: Record<string, string>, keys: string[]) {
  const missing = keys.filter((k) => !config[k]);
  if (missing.length) throw new ChannelNotConfiguredError(type, missing);
}

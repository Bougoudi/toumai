import type { SalesChannelConnector } from './base.channel.connector.js';
import { AmazonChannelConnector } from './amazon.channel.connector.js';
import { EbayChannelConnector } from './ebay.channel.connector.js';
import { EtsyChannelConnector } from './etsy.channel.connector.js';

const connectors: Record<string, SalesChannelConnector> = {
  etsy: new EtsyChannelConnector(),
  ebay: new EbayChannelConnector(),
  amazon: new AmazonChannelConnector(),
};

/** Renvoie le connecteur d'un type de canal, ou null si inconnu. */
export function getChannelConnector(type: string): SalesChannelConnector | null {
  return connectors[type] ?? null;
}

/** Liste des canaux disponibles + champs de configuration (pour l'UI). */
export function listChannelTypes() {
  return Object.values(connectors).map((c) => ({
    type: c.type,
    label: c.label,
    configFields: c.configFields,
    oauth: !!c.oauth,
  }));
}

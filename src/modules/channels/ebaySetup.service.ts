import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { decryptJson } from '../../utils/crypto.js';
import { channelService } from './channel.service.js';
import { oauthService } from './oauth.service.js';

/**
 * Configuration « prête à vendre » d'un canal eBay.
 *
 * Pour publier une annonce, eBay exige des « business policies » (livraison,
 * paiement, retour) et une adresse d'entrepôt (merchant location). Ce service :
 *   1. récupère les règles déjà présentes sur le compte (cas fréquent) ;
 *   2. crée des règles par défaut si aucune n'existe ;
 *   3. enregistre les identifiants obtenus dans la config du canal.
 *
 * Les erreurs eBay (compte non vendeur, paiements non configurés…) sont
 * remontées telles quelles pour guider l'utilisateur — rien n'est inventé.
 */

const ACCOUNT = 'https://api.ebay.com/sell/account/v1';
const INVENTORY = 'https://api.ebay.com/sell/inventory/v1';
const MARKETPLACE = 'EBAY_FR';

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Content-Language': 'fr-FR',
    'Accept-Language': 'fr-FR',
  };
}

interface SetupReport {
  merchantLocationKey?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  created: string[];
  reused: string[];
  warnings: string[];
  ready: boolean;
}

async function callEbay(
  token: string,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(url, { method, headers: headers(token), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

/** Extrait un message d'erreur lisible d'une réponse eBay. */
function ebayError(data: any): string {
  const err = data?.errors?.[0];
  if (err) return `${err.message ?? ''}${err.longMessage ? ' — ' + err.longMessage : ''}`.trim();
  if (data?.raw) return String(data.raw).slice(0, 160);
  return 'erreur eBay inconnue';
}

export const ebaySetupService = {
  async autoConfigure(channelId: string): Promise<SetupReport> {
    const ch = await prisma.salesChannel.findUnique({ where: { id: channelId } });
    if (!ch) throw new HttpError(404, 'Canal introuvable');
    if (ch.type !== 'ebay') throw new HttpError(400, 'Configuration réservée aux canaux eBay.');

    const config = await oauthService.ensureToken(ch.id, decryptJson<Record<string, string>>(ch.config));
    const token = config.accessToken;
    if (!token) throw new HttpError(400, 'Canal eBay non autorisé : lancez d’abord « Autoriser ».');

    const report: SetupReport = { created: [], reused: [], warnings: [], ready: false };

    // ── 0. Inscription au « Gestionnaire des conditions de vente » ──
    // Requis avant de pouvoir créer des business policies. Idempotent : si le
    // vendeur y est déjà inscrit, eBay renvoie une erreur qu'on ignore.
    await this.optInBusinessPolicies(token, report);

    // ── 1. Politique de paiement ─────────────────────────────
    report.paymentPolicyId = await this.ensurePolicy(token, report, {
      kind: 'paiement',
      listUrl: `${ACCOUNT}/payment_policy?marketplace_id=${MARKETPLACE}`,
      listKey: 'paymentPolicies',
      idKey: 'paymentPolicyId',
      createUrl: `${ACCOUNT}/payment_policy`,
      createBody: {
        name: 'Toumai Paiement',
        marketplaceId: MARKETPLACE,
        categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
        immediatePay: true,
      },
    });

    // ── 2. Politique de retour ───────────────────────────────
    report.returnPolicyId = await this.ensurePolicy(token, report, {
      kind: 'retour',
      listUrl: `${ACCOUNT}/return_policy?marketplace_id=${MARKETPLACE}`,
      listKey: 'returnPolicies',
      idKey: 'returnPolicyId',
      createUrl: `${ACCOUNT}/return_policy`,
      createBody: {
        name: 'Toumai Retours',
        marketplaceId: MARKETPLACE,
        categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
        returnsAccepted: true,
        returnPeriod: { value: 14, unit: 'DAY' },
        refundMethod: 'MONEY_BACK',
        returnShippingCostPayer: 'SELLER',
      },
    });

    // ── 3. Politique de livraison ────────────────────────────
    // Transporteur configurable : par défaut un service international générique
    // (le vendeur expédie souvent depuis un autre pays que la marketplace).
    const shipType = (config.shippingOptionType || 'INTERNATIONAL').toUpperCase();
    const shipCode = config.shippingServiceCode || 'OtherInternationalShipping';
    report.fulfillmentPolicyId = await this.ensurePolicy(token, report, {
      kind: 'livraison',
      listUrl: `${ACCOUNT}/fulfillment_policy?marketplace_id=${MARKETPLACE}`,
      listKey: 'fulfillmentPolicies',
      idKey: 'fulfillmentPolicyId',
      createUrl: `${ACCOUNT}/fulfillment_policy`,
      createBody: {
        name: 'Toumai Livraison',
        marketplaceId: MARKETPLACE,
        categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
        handlingTime: { value: 3, unit: 'DAY' },
        shippingOptions: [
          {
            optionType: shipType,
            costType: 'FLAT_RATE',
            shippingServices: [{ sortOrder: 1, shippingServiceCode: shipCode, freeShipping: true }],
          },
        ],
      },
    });

    // ── 4. Adresse d'entrepôt (merchant location) ────────────
    report.merchantLocationKey = await this.ensureLocation(token, config, report);

    // ── 5. Enregistre les identifiants dans la config ────────
    const patch: Record<string, string> = {};
    if (report.paymentPolicyId) patch.paymentPolicyId = report.paymentPolicyId;
    if (report.returnPolicyId) patch.returnPolicyId = report.returnPolicyId;
    if (report.fulfillmentPolicyId) patch.fulfillmentPolicyId = report.fulfillmentPolicyId;
    if (report.merchantLocationKey) patch.merchantLocationKey = report.merchantLocationKey;
    if (Object.keys(patch).length) await channelService.update(channelId, patch);

    report.ready = Boolean(
      report.paymentPolicyId && report.returnPolicyId && report.fulfillmentPolicyId && report.merchantLocationKey,
    );
    logger.info('Configuration vente eBay', { channelId, ready: report.ready, created: report.created });
    return report;
  },

  /** Inscrit le vendeur au programme « business policies » (idempotent). */
  async optInBusinessPolicies(token: string, report: SetupReport): Promise<void> {
    const res = await callEbay(token, 'POST', `${ACCOUNT}/program/opt_in`, {
      programType: 'SELLING_POLICY_MANAGEMENT',
    });
    if (res.ok || res.status === 200 || res.status === 204) {
      report.created.push('inscription règles de vente');
      return;
    }
    // Déjà inscrit → eBay renvoie une erreur « already opted in » : on l'ignore.
    const msg = ebayError(res.data).toLowerCase();
    if (msg.includes('already') || msg.includes('déjà') || res.status === 409) {
      report.reused.push('inscription règles de vente');
      return;
    }
    report.warnings.push(`Inscription règles de vente : ${ebayError(res.data)}`);
  },

  /** Récupère la première règle existante, sinon tente d'en créer une. */
  async ensurePolicy(
    token: string,
    report: SetupReport,
    p: { kind: string; listUrl: string; listKey: string; idKey: string; createUrl: string; createBody: unknown },
  ): Promise<string | undefined> {
    const list = await callEbay(token, 'GET', p.listUrl);
    if (list.ok && Array.isArray(list.data?.[p.listKey]) && list.data[p.listKey].length) {
      report.reused.push(p.kind);
      return list.data[p.listKey][0][p.idKey];
    }
    // Aucune règle : on en crée une par défaut.
    const created = await callEbay(token, 'POST', p.createUrl, p.createBody);
    if (created.ok && created.data?.[p.idKey]) {
      report.created.push(p.kind);
      return created.data[p.idKey];
    }
    report.warnings.push(`Politique ${p.kind} : ${ebayError(created.data)}`);
    return undefined;
  },

  /** Récupère l'entrepôt existant, sinon en crée un à l'adresse du vendeur. */
  async ensureLocation(
    token: string,
    config: Record<string, string>,
    report: SetupReport,
  ): Promise<string | undefined> {
    const list = await callEbay(token, 'GET', `${INVENTORY}/location`);
    if (list.ok && Array.isArray(list.data?.locations) && list.data.locations.length) {
      report.reused.push('entrepôt');
      return list.data.locations[0].merchantLocationKey;
    }
    const key = 'TOUMAI_MAIN';
    const address: Record<string, string> = { country: (config.locationCountry || 'FR').toUpperCase() };
    if (config.locationPostalCode) address.postalCode = config.locationPostalCode;
    if (config.locationCity) address.city = config.locationCity;
    if (config.locationAddress) address.addressLine1 = config.locationAddress;
    if (config.locationState) address.stateOrProvince = config.locationState;
    const created = await callEbay(token, 'POST', `${INVENTORY}/location/${key}`, {
      location: { address },
      name: 'Toumai',
      merchantLocationStatus: 'ENABLED',
      locationTypes: ['WAREHOUSE'],
    });
    // 204 = créé (corps vide) ; 200 aussi accepté.
    if (created.ok || created.status === 204) {
      report.created.push('entrepôt');
      return key;
    }
    report.warnings.push(`Entrepôt : ${ebayError(created.data)}`);
    return undefined;
  },
};

import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { computeMargin, computeSalePrice, toCharmPrice } from '../../utils/pricing.js';
import { getCjApiKey, getSettings } from '../settings/settings.service.js';

/**
 * Import de produits CJdropshipping par lien.
 *
 * Les pages produit de cjdropshipping.com sont protégées par une vérification
 * « humaine » (captcha) : on ne les lit donc pas, on passe par l'API officielle
 * CJ (developers.cjdropshipping.com, v2.0) avec la clé API du vendeur.
 */
const CJ_API = 'https://developers.cjdropshipping.com/api2.0/v1';

/** Jeton d'accès CJ en mémoire (valable ~15 jours ; CJ limite sa régénération). */
let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

/** Extrait l'identifiant produit (pid) d'un lien CJ ou d'un pid brut. */
/** SKU produit CJ (ex. « CJWY281211301AZ ») : interrogé via `productSku` au lieu du pid. */
export function parseCjSku(input: string): string | null {
  const s = input.trim().toUpperCase();
  return /^CJ[A-Z]{2}\d{6,}[A-Z]{0,4}$/.test(s) ? s : null;
}

export function parseCjProductId(input: string): string | null {
  const s = input.trim();
  if (parseCjSku(s)) return null;
  if (/^[0-9A-Za-z-]{10,40}$/.test(s) && !s.includes('/')) return s;
  const m =
    s.match(/.*-p-([0-9A-Za-z-]+)\.html/i) ?? // /product/nom-du-produit-p-<pid>.html
    s.match(/[?&](?:id|pid)=([0-9A-Za-z-]+)/i); // product-detail.html?id=<pid>
  return m ? m[1] : null;
}

async function cjFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(CJ_API + path, { ...init, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as { result?: boolean; code?: number; message?: string; data?: unknown };
  if (!res.ok || body.result === false) {
    throw new HttpError(502, `CJdropshipping : ${body.message || `erreur ${res.status}`}`);
  }
  return body.data;
}

async function accessToken(): Promise<string> {
  const apiKey = await getCjApiKey();
  if (!apiKey) {
    throw new HttpError(
      400,
      'Clé API CJdropshipping manquante : Paramètres → Boutique en ligne → « Clé API CJ » (cjdropshipping.com → My CJ → Authorization → API).',
    );
  }
  if (tokenCache && tokenCache.key === apiKey && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const data = (await cjFetch('/authentication/getAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })) as { accessToken?: string; accessTokenExpiryDate?: string };
  if (!data?.accessToken) throw new HttpError(502, 'CJdropshipping : jeton d’accès non reçu.');
  const exp = data.accessTokenExpiryDate ? Date.parse(data.accessTokenExpiryDate) : NaN;
  tokenCache = {
    key: apiKey,
    token: data.accessToken,
    expiresAt: Number.isFinite(exp) ? exp : Date.now() + 14 * 24 * 3600_000,
  };
  return data.accessToken;
}

interface CjVariant {
  variantNameEn?: string;
  variantSellPrice?: number | string;
  variantImage?: string;
}

interface CjProduct {
  pid?: string;
  productNameEn?: string;
  productName?: string;
  productSku?: string;
  productImage?: string;
  productImageSet?: string[] | string;
  sellPrice?: number | string;
  description?: string;
  categoryName?: string;
  productKeyEn?: string;
  variants?: CjVariant[];
}

/** CJ renvoie parfois des listes sérialisées en JSON (« ["a","b"] »). */
function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== 'string' || !v.trim()) return [];
  const t = v.trim();
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) return arr.map(String);
    } catch {
      /* chaîne simple */
    }
  }
  return t.split(',').map((x) => x.trim()).filter(Boolean);
}

/** Prix CJ : nombre, « 12.5 » ou fourchette « 3.20 -- 5.80 » → prix le plus bas. */
function lowestPrice(v: unknown): number | null {
  const nums = String(v ?? '')
    .split(/[^0-9.]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? Math.min(...nums) : null;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/** Description HTML fournisseur → texte brut (paragraphes), + images intégrées. */
export function cleanDescription(html: string): { text: string; images: string[] } {
  const images = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]).filter((u) => u.startsWith('http'));
  const text = decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return { text, images };
}

export interface CjImportInput {
  url: string;
  /** Taux 1 USD = X devise de la boutique (obligatoire si la boutique n'est pas en USD). */
  exchangeRate?: number;
  /** Coefficient prix d'achat → prix de vente (défaut : réglage de l'application). */
  markup?: number;
  /** Prix de vente imposé (devise de la boutique). */
  salePrice?: number;
  /** Publier directement sur la boutique (ACTIVE) ou garder en brouillon. */
  publish?: boolean;
}

export const cjService = {
  /** Importe (ou met à jour) un produit CJ dans le catalogue, prêt à vendre sur la boutique. */
  async importFromUrl(input: CjImportInput) {
    const cjSku = parseCjSku(input.url);
    const pidFromUrl = cjSku ? null : parseCjProductId(input.url);
    if (!cjSku && !pidFromUrl) {
      throw new HttpError(400, 'Lien ou SKU CJdropshipping invalide (attendu : …-p-<identifiant>.html ou CJ…).');
    }

    const currency = getSettings().currency.toUpperCase();
    const rate = currency === 'USD' ? 1 : input.exchangeRate;
    if (!rate || rate <= 0) {
      throw new HttpError(400, `Les prix CJ sont en USD : indique le taux de change (1 USD = ? ${currency}).`);
    }

    const token = await accessToken();
    const query = cjSku ? `productSku=${encodeURIComponent(cjSku)}` : `pid=${encodeURIComponent(pidFromUrl!)}`;
    const p = (await cjFetch(`/product/query?${query}`, {
      headers: { 'CJ-Access-Token': token },
    })) as CjProduct | null;
    if (!p) throw new HttpError(404, 'Produit CJ introuvable.');
    const pid = p.pid || pidFromUrl || cjSku!;

    const name = (p.productNameEn || asList(p.productName)[0] || `Produit CJ ${pid}`).trim().slice(0, 190);
    const { text, images: descImages } = cleanDescription(p.description ?? '');
    const variantImages = (p.variants ?? []).map((v) => v.variantImage).filter((u): u is string => !!u);
    const images = [...new Set([...asList(p.productImageSet), ...asList(p.productImage), ...variantImages, ...descImages])]
      .filter((u) => /^https?:\/\//.test(u))
      .map((u) => u.replace(/^http:/, 'https:'))
      .slice(0, 12);

    const costUsd =
      lowestPrice(p.sellPrice) ??
      (p.variants ?? []).map((v) => lowestPrice(v.variantSellPrice)).filter((n): n is number => n != null).sort((a, b) => a - b)[0] ??
      null;
    if (costUsd == null) throw new HttpError(502, 'CJdropshipping : prix du produit indisponible.');

    const costPrice = Number((costUsd * rate).toFixed(2));
    const salePrice = input.salePrice ?? (input.markup ? toCharmPrice(costPrice * input.markup) : computeSalePrice(costPrice));
    const keywords = [p.productKeyEn, p.categoryName]
      .filter(Boolean)
      .join(',')
      .toLowerCase();

    const data = {
      name,
      description: text.slice(0, 8000) || null,
      category: (p.categoryName || 'divers').trim().slice(0, 80),
      keywords,
      currency,
      costPrice,
      salePrice,
      margin: computeMargin(salePrice, costPrice),
      images: images.join(','),
      source: 'cj',
      status: input.publish === false ? 'DRAFT' : 'ACTIVE',
    };
    // Déjà au catalogue (import précédent par lien ou par SKU) : on rafraîchit les
    // photos et le prix d'achat, mais on garde les textes et le prix de vente du vendeur.
    const keys = [`CJ-${pid}`, ...(p.productSku ? [`CJ-${p.productSku.toUpperCase()}`] : []), ...(cjSku ? [`CJ-${cjSku}`] : [])];
    const existing = await prisma.product.findFirst({ where: { sku: { in: keys } } });
    let product;
    if (existing) {
      const kept = existing.images.split(',').map((u) => u.trim()).filter(Boolean);
      const sale = input.salePrice ?? existing.salePrice ?? salePrice;
      product = await prisma.product.update({
        where: { id: existing.id },
        data: {
          images: [...new Set([...images, ...kept])].slice(0, 16).join(','),
          costPrice,
          salePrice: sale,
          margin: computeMargin(sale, costPrice),
          ...(existing.description ? {} : { description: data.description }),
          ...(input.publish === false ? { status: 'DRAFT' } : {}),
        },
      });
    } else {
      const sku = `CJ-${pid}`;
      product = await prisma.product.create({ data: { sku, ...data } });
    }
    logger.info('Produit CJ importé', { pid, productId: product.id, cjSku: p.productSku, updated: !!existing });
    return product;
  },
};

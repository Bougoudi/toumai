import { readFileSync } from 'node:fs';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.js';
import { env, isProd } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * RÉFÉRENCEMENT (SEO) de la place de marché.
 *
 * L'interface est une application monopage : sans traitement particulier, un
 * moteur de recherche ne verrait qu'une coquille vide et une seule URL. Trois
 * mécanismes corrigent cela, sans dépendre d'un framework de rendu serveur :
 *
 *  1. des URLs réelles (`/touma/produits/<slug>`) servies par le serveur ;
 *  2. les métadonnées (titre, description, Open Graph, données structurées)
 *     injectées **côté serveur** dans le HTML envoyé, page par page ;
 *  3. `sitemap.xml` et `robots.txt` générés depuis la base.
 */

interface PageMeta {
  title: string;
  description: string;
  /** Données structurées schema.org, sérialisées en JSON-LD. */
  jsonLd?: object;
  canonical: string;
  image?: string | null;
  noIndex?: boolean;
}

const SITE_NAME = 'TOUMA';
const TAGLINE = 'Connecter le commerce africain';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Coupe proprement une description à la longueur utile pour les moteurs. */
function summarize(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Métadonnées par défaut : page d'accueil de la place de marché. */
function defaultMeta(canonical: string): PageMeta {
  return {
    title: `${SITE_NAME} — ${TAGLINE}`,
    description:
      "TOUMA connecte fournisseurs, commerçants et acheteurs d'un pays africain à l'autre : catalogue, paiement, transport et suivi de bout en bout. Corridor pilote Tchad ↔ Cameroun.",
    canonical,
  };
}

/** Métadonnées propres à la route demandée (produit, boutique, catalogue…). */
async function metaForPath(pathname: string, canonical: string): Promise<PageMeta> {
  const segments = pathname.replace(/^\/touma\/?/, '').split('/').filter(Boolean);

  // Les espaces privés ne doivent jamais être indexés.
  if (
    ['panier', 'checkout', 'commandes', 'compte', 'vendeur', 'admin', 'connexion', 'inscription', 'messages', 'retours', 'aide', 'promotions'].includes(
      segments[0] ?? '',
    )
  ) {
    return { ...defaultMeta(canonical), noIndex: true, title: `${SITE_NAME} — espace personnel` };
  }

  if (segments[0] === 'produits' && segments[1]) {
    const product = await prisma.toumaProduct.findFirst({
      where: { slug: segments[1], status: 'ACTIVE', store: { status: 'ACTIVE' } },
      include: { store: { select: { name: true, countryCode: true } }, images: { orderBy: { position: 'asc' }, take: 1 }, category: true },
    });
    if (product) {
      const image = product.images[0]?.url ?? null;
      return {
        title: `${product.title} — ${product.store.name} | ${SITE_NAME}`,
        description: summarize(
          product.description ||
            `${product.title} proposé par ${product.store.name} (${product.countryCode}) sur TOUMA, la place de marché du commerce africain.`,
        ),
        canonical,
        image,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: product.title,
          description: summarize(product.description || product.title, 300),
          sku: product.sku ?? undefined,
          brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
          image: image ? [image] : undefined,
          category: product.category?.name,
          aggregateRating:
            product.ratingCount > 0
              ? { '@type': 'AggregateRating', ratingValue: Number(product.ratingAverage), reviewCount: product.ratingCount }
              : undefined,
          offers: {
            '@type': 'Offer',
            price: product.price.toString(),
            priceCurrency: product.currency,
            availability: 'https://schema.org/InStock',
            seller: { '@type': 'Organization', name: product.store.name },
            url: canonical,
          },
        },
      };
    }
  }

  if (segments[0] === 'boutiques' && segments[1]) {
    const store = await prisma.toumaStore.findFirst({ where: { slug: segments[1], status: 'ACTIVE' } });
    if (store) {
      return {
        title: `${store.name} — boutique ${store.countryCode} | ${SITE_NAME}`,
        description: summarize(store.description || `Découvrez les produits de ${store.name} sur TOUMA.`),
        canonical,
        image: store.logoUrl,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'Store',
          name: store.name,
          description: summarize(store.description ?? '', 300) || undefined,
          address: { '@type': 'PostalAddress', addressLocality: store.city ?? undefined, addressCountry: store.countryCode },
          aggregateRating:
            store.ratingCount > 0
              ? { '@type': 'AggregateRating', ratingValue: Number(store.ratingAverage), reviewCount: store.ratingCount }
              : undefined,
        },
      };
    }
  }

  if (segments[0] === 'produits') {
    return {
      title: `Catalogue — produits d'Afrique centrale | ${SITE_NAME}`,
      description:
        'Parcourez le catalogue TOUMA : produits agricoles, emballage, textile, beauté et accessoires proposés par des vendeurs du Tchad et du Cameroun.',
      canonical,
    };
  }

  if (segments[0] === 'boutiques') {
    return {
      title: `Boutiques vérifiées | ${SITE_NAME}`,
      description: 'Découvrez les boutiques actives sur TOUMA, leur pays, leur note et leur statut de vérification.',
      canonical,
    };
  }

  return defaultMeta(canonical);
}

/** Construit les balises `<head>` à injecter. */
function renderMetaTags(meta: PageMeta): string {
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`,
    meta.noIndex ? '<meta name="robots" content="noindex, nofollow" />' : '<meta name="robots" content="index, follow" />',
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.canonical)}" />`,
    `<meta property="og:locale" content="fr_FR" />`,
    `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
  ];
  if (meta.image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(meta.image)}" />`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(meta.image)}" />`);
  }
  if (meta.jsonLd) {
    tags.push(`<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c')}</script>`);
  }
  return tags.join('\n    ');
}

/**
 * Sert la coquille de l'application avec les métadonnées de la page demandée.
 * Le fichier est mis en cache en production ; en développement il est relu à
 * chaque requête pour que les modifications soient visibles sans redémarrage.
 */
let shellCache: string | null = null;

export function createMarketplaceHandler(shellPath: string) {
  return async function marketplaceHandler(req: Request, res: Response) {
    try {
      if (!isProd) shellCache = null;
      shellCache = shellCache ?? readFileSync(shellPath, 'utf8');
      const canonical = `${env.publicUrl}${req.originalUrl.split('?')[0]}`;
      const meta = await metaForPath(req.path, canonical);
      // Le gabarit contient le repère <!--touma:meta--> à l'emplacement des balises.
      const html = shellCache.replace('<!--touma:meta-->', renderMetaTags(meta));
      res.type('html').send(html);
    } catch (err) {
      logger.error('Rendu de la coquille impossible', { err: err instanceof Error ? err.message : String(err) });
      res.status(500).type('html').send('<h1>Erreur temporaire</h1>');
    }
  };
}

/** `robots.txt` : les espaces privés sont exclus de l'exploration. */
export function robotsTxt(_req: Request, res: Response) {
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Allow: /touma/',
      'Allow: /touma/produits',
      'Allow: /touma/boutiques',
      'Disallow: /touma/panier',
      'Disallow: /touma/checkout',
      'Disallow: /touma/commandes',
      'Disallow: /touma/compte',
      'Disallow: /touma/vendeur',
      'Disallow: /touma/admin',
      'Disallow: /api/',
      '',
      `Sitemap: ${env.publicUrl}/sitemap.xml`,
      '',
    ].join('\n'),
  );
}

/** `sitemap.xml` généré depuis le catalogue réel (produits et boutiques actifs). */
export async function sitemapXml(_req: Request, res: Response) {
  const base = env.publicUrl;
  const [products, stores, categories] = await Promise.all([
    prisma.toumaProduct.findMany({
      where: { status: 'ACTIVE', store: { status: 'ACTIVE' } },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
    }),
    prisma.toumaStore.findMany({ where: { status: 'ACTIVE' }, select: { slug: true, updatedAt: true }, take: 1000 }),
    prisma.toumaCategory.findMany({ where: { active: true }, select: { slug: true, updatedAt: true } }),
  ]);

  const url = (loc: string, lastmod?: Date, priority = '0.6', changefreq = 'weekly') =>
    `  <url><loc>${escapeHtml(loc)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}` +
    `<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    url(`${base}/touma/`, undefined, '1.0', 'daily'),
    url(`${base}/touma/produits`, undefined, '0.9', 'daily'),
    url(`${base}/touma/boutiques`, undefined, '0.8', 'weekly'),
    ...categories.map((c) => url(`${base}/touma/produits?category=${c.slug}`, c.updatedAt, '0.7')),
    ...stores.map((s) => url(`${base}/touma/boutiques/${s.slug}`, s.updatedAt, '0.7')),
    ...products.map((p) => url(`${base}/touma/produits/${p.slug}`, p.updatedAt, '0.8', 'daily')),
    '</urlset>',
    '',
  ].join('\n');

  res.type('application/xml').send(body);
}

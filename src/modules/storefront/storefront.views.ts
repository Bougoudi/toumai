import type { Product } from '@prisma/client';
import { env } from '../../config/env.js';
import type { AppSettings } from '../settings/settings.service.js';
import { categoryPath, productImages, productPath } from './storefront.service.js';

/**
 * Rendu HTML de la boutique publique.
 *
 * Tout est rendu côté serveur (Google lit le contenu sans exécuter de JS), sans
 * script ni police externe (chargement très rapide → bon score PageSpeed / Core
 * Web Vitals), avec balises title/description/canonical, Open Graph et données
 * structurées schema.org (Product, Offer, BreadcrumbList, OnlineStore / LocalBusiness,
 * FAQPage) pour les extraits enrichis.
 */

type Category = { name: string; slug: string; count: number };

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const abs = (path: string) => env.publicUrl.replace(/\/+$/, '') + path;

export function money(n: number | null | undefined, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(n ?? 0);
  } catch {
    return `${(n ?? 0).toFixed(2)} ${currency}`;
  }
}

/** Tronque proprement à la fin d'un mot (meta description ≈ 155 caractères). */
function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, t.lastIndexOf(' ', max - 1) > max * 0.6 ? t.lastIndexOf(' ', max - 1) : max - 1).trim() + '…';
}

/** JSON-LD sûr à insérer dans une balise <script> (pas de fermeture prématurée). */
const ld = (data: object) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

function faq(shop: AppSettings): { q: string; a: string }[] {
  const out = [
    {
      q: 'Quels sont les délais de livraison ?',
      a: `Votre commande est expédiée sous 1 à 3 jours ouvrés, puis livrée en ${shop.shopDeliveryMinDays} à ${shop.shopDeliveryMaxDays} jours ouvrés. Un numéro de suivi vous est communiqué dès l'expédition.`,
    },
    {
      q: 'Puis-je retourner un article ?',
      a:
        shop.shopReturnDays > 0
          ? `Oui : vous disposez de ${shop.shopReturnDays} jours après réception pour nous retourner un article et être remboursé.`
          : 'Contactez-nous : nous étudions chaque demande de retour.',
    },
    {
      q: 'Le paiement est-il sécurisé ?',
      a: 'Oui. Le paiement par carte est traité sur la page chiffrée de notre prestataire de paiement : nous ne voyons jamais vos données bancaires.',
    },
  ];
  if (shop.shopEmail) out.push({ q: 'Comment vous contacter ?', a: `Écrivez-nous à ${shop.shopEmail}, nous répondons sous 24 h.` });
  return out;
}

/** Données structurées de la boutique (entité locale si une adresse est renseignée). */
function storeLd(shop: AppSettings) {
  const hasAddress = !!(shop.shopAddress && shop.shopCity);
  return {
    '@context': 'https://schema.org',
    '@type': hasAddress ? ['OnlineStore', 'LocalBusiness'] : 'OnlineStore',
    '@id': abs('/boutique#store'),
    name: shop.shopName,
    url: abs('/boutique'),
    logo: abs('/icons/icon-512.png'),
    image: abs('/icons/icon-512.png'),
    ...(shop.shopDescription || shop.shopTagline ? { description: shop.shopDescription || shop.shopTagline } : {}),
    ...(shop.shopEmail ? { email: shop.shopEmail } : {}),
    ...(shop.shopPhone ? { telephone: shop.shopPhone } : {}),
    ...(hasAddress
      ? {
          address: {
            '@type': 'PostalAddress',
            streetAddress: shop.shopAddress,
            addressLocality: shop.shopCity,
            ...(shop.shopZip ? { postalCode: shop.shopZip } : {}),
            ...(shop.shopCountry ? { addressCountry: shop.shopCountry.toUpperCase() } : {}),
          },
        }
      : {}),
    ...(shop.googleBusinessUrl ? { sameAs: [shop.googleBusinessUrl] } : {}),
  };
}

const CSS = `
:root{--bg:#fff;--fg:#14161a;--muted:#5d6470;--line:#e6e8ec;--brand:#e8590c;--brand-d:#c94a06;--card:#f7f8fa;--ok:#1f8a4c}
@media (prefers-color-scheme:dark){:root{--bg:#101215;--fg:#eef0f3;--muted:#a3aab5;--line:#262a31;--card:#181b20;--brand:#ff7a2e;--brand-d:#ff9150;--ok:#4cc27f}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:inherit}img{max-width:100%;height:auto;display:block}
.wrap{max-width:1120px;margin:0 auto;padding:0 16px}
header.top{border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
header.top .wrap{display:flex;align-items:center;gap:16px;min-height:60px;flex-wrap:wrap}
.logo{font-weight:800;font-size:20px;text-decoration:none;letter-spacing:-.02em}
.logo span{color:var(--brand)}
nav.cats{display:flex;gap:14px;overflow-x:auto;font-size:14px;flex:1;scrollbar-width:none}
nav.cats a{text-decoration:none;color:var(--muted);white-space:nowrap}nav.cats a:hover{color:var(--fg)}
.hero{padding:40px 0 24px}.hero h1{font-size:clamp(26px,4vw,40px);line-height:1.15;margin:0 0 8px;letter-spacing:-.02em}
.hero p{color:var(--muted);margin:0;font-size:18px}
.trust{display:flex;flex-wrap:wrap;gap:8px 20px;margin:18px 0 0;padding:0;list-style:none;font-size:14px;color:var(--muted)}
.trust li::before{content:"✓ ";color:var(--ok);font-weight:700}
h2{font-size:22px;margin:36px 0 14px;letter-spacing:-.01em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:18px}
.card{text-decoration:none;display:block;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--bg);transition:border-color .15s}
.card:hover{border-color:var(--brand)}
.thumb{aspect-ratio:1/1;background:var(--card);overflow:hidden}.thumb img{width:100%;height:100%;object-fit:cover}
.card .info{padding:12px 14px}.card h3{font-size:15px;font-weight:600;margin:0 0 6px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.price{font-weight:800;font-size:18px}.price.big{font-size:28px}
.crumbs{font-size:13px;color:var(--muted);margin:18px 0}.crumbs ol{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:6px}
.crumbs li+li::before{content:"›";margin-right:6px}.crumbs a{text-decoration:none}
.pdp{display:grid;grid-template-columns:1fr;gap:28px}@media(min-width:860px){.pdp{grid-template-columns:1.1fr 1fr}}
.gallery .main{aspect-ratio:1/1;border-radius:14px;overflow:hidden;background:var(--card)}.gallery .main img{width:100%;height:100%;object-fit:contain}
.gallery .more{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:8px;margin-top:8px}
.gallery .more img{aspect-ratio:1/1;object-fit:cover;border-radius:8px;border:1px solid var(--line);width:100%}
.pdp h1{font-size:clamp(22px,3vw,30px);line-height:1.2;margin:0 0 10px;letter-spacing:-.01em}
.ship{background:var(--card);border-radius:12px;padding:12px 14px;font-size:14px;margin:16px 0}
.ship b{color:var(--ok)}
form.buy{border:1px solid var(--line);border-radius:14px;padding:16px;display:grid;gap:10px}
form.buy .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
label{font-size:13px;color:var(--muted);display:grid;gap:4px}
input,select{font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg);width:100%}
.btn{display:inline-block;text-align:center;background:var(--brand);color:#fff;border:0;border-radius:12px;padding:14px 20px;font:inherit;font-weight:700;font-size:17px;cursor:pointer;text-decoration:none}
.btn:hover{background:var(--brand-d)}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.desc{white-space:pre-line;color:var(--fg)}
details{border-bottom:1px solid var(--line);padding:12px 0}summary{cursor:pointer;font-weight:600}
details p{color:var(--muted);margin:8px 0 0}
.notice{background:var(--card);border-radius:14px;padding:24px;margin:32px 0}
footer.bot{border-top:1px solid var(--line);margin-top:56px;padding:28px 0;color:var(--muted);font-size:14px}
footer.bot .cols{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
footer.bot a{text-decoration:none}footer.bot p{margin:4px 0}
.empty{color:var(--muted);padding:40px 0}
`;

interface LayoutOpts {
  shop: AppSettings;
  categories: Category[];
  title: string;
  description: string;
  path: string;
  body: string;
  jsonLd?: object[];
  ogImage?: string;
  ogType?: 'website' | 'product';
  noindex?: boolean;
}

export function layout(o: LayoutOpts): string {
  const { shop } = o;
  const canonical = abs(o.path);
  const nap = [shop.shopAddress, [shop.shopZip, shop.shopCity].filter(Boolean).join(' '), shop.shopCountry]
    .filter(Boolean)
    .join(', ');
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
${o.noindex ? '<meta name="robots" content="noindex,follow">' : `<link rel="canonical" href="${esc(canonical)}">\n<meta name="robots" content="index,follow,max-image-preview:large">`}
${shop.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(shop.googleSiteVerification)}">` : ''}
<meta property="og:site_name" content="${esc(shop.shopName)}">
<meta property="og:locale" content="fr_FR">
<meta property="og:type" content="${o.ogType ?? 'website'}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(canonical)}">
${o.ogImage ? `<meta property="og:image" content="${esc(o.ogImage)}">\n<meta name="twitter:image" content="${esc(o.ogImage)}">` : ''}
<meta name="twitter:card" content="${o.ogImage ? 'summary_large_image' : 'summary'}">
<meta name="theme-color" content="#e8590c">
<link rel="icon" href="/icons/icon-192.png" type="image/png">
<style>${CSS.replace(/\n/g, '')}</style>
${(o.jsonLd ?? []).map(ld).join('\n')}
</head>
<body>
<header class="top"><div class="wrap">
<a class="logo" href="/boutique">${esc(shop.shopName)}<span>.</span></a>
<nav class="cats" aria-label="Catégories">${o.categories
    .slice(0, 8)
    .map((c) => `<a href="${categoryPath(c.name)}">${esc(c.name)}</a>`)
    .join('')}</nav>
</div></header>
<main class="wrap">${o.body}</main>
<footer class="bot"><div class="wrap cols">
<div><p><strong>${esc(shop.shopName)}</strong></p><p>${esc(shop.shopTagline)}</p></div>
<div>${nap ? `<p>${esc(nap)}</p>` : ''}${shop.shopPhone ? `<p><a href="tel:${esc(shop.shopPhone.replace(/\s+/g, ''))}">${esc(shop.shopPhone)}</a></p>` : ''}${shop.shopEmail ? `<p><a href="mailto:${esc(shop.shopEmail)}">${esc(shop.shopEmail)}</a></p>` : ''}</div>
<div><p><a href="/boutique/infos">Livraison, retours &amp; contact</a></p><p><a href="/privacy.html">Confidentialité</a></p></div>
</div></footer>
</body>
</html>`;
}

function productCard(p: Product, eager = false): string {
  const img = productImages(p)[0];
  return `<a class="card" href="${productPath(p)}">
<div class="thumb">${img ? `<img src="${esc(img)}" alt="${esc(p.name)}" width="400" height="400" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">` : ''}</div>
<div class="info"><h3>${esc(p.name)}</h3><div class="price">${money(p.salePrice, p.currency)}</div></div></a>`;
}

function faqBlock(items: { q: string; a: string }[]): string {
  return `<section><h2>Questions fréquentes</h2>${items
    .map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`)
    .join('')}</section>`;
}

const faqLd = (items: { q: string; a: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
});

function breadcrumb(items: { name: string; path: string }[]) {
  const html = `<nav class="crumbs" aria-label="Fil d'Ariane"><ol>${items
    .map((it, i) =>
      i === items.length - 1 ? `<li aria-current="page">${esc(it.name)}</li>` : `<li><a href="${it.path}">${esc(it.name)}</a></li>`,
    )
    .join('')}</ol></nav>`;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.path) })),
  };
  return { html, data };
}

export function homePage(shop: AppSettings, categories: Category[], products: Product[]): string {
  const faqs = faq(shop);
  const title = clip(`${shop.shopName} – ${shop.shopTagline}`, 65);
  const description = clip(
    shop.shopDescription ||
      `${shop.shopTagline}. ${categories
        .slice(0, 4)
        .map((c) => c.name)
        .join(', ')}${categories.length ? ' : ' : ''}livraison suivie en ${shop.shopDeliveryMinDays}-${shop.shopDeliveryMaxDays} jours, paiement sécurisé.`,
    158,
  );
  const body = `
<section class="hero"><h1>${esc(shop.shopName)} — ${esc(shop.shopTagline)}</h1>
${shop.shopDescription ? `<p>${esc(shop.shopDescription)}</p>` : ''}
<ul class="trust"><li>Livraison suivie ${shop.shopDeliveryMinDays}-${shop.shopDeliveryMaxDays} jours</li><li>Paiement sécurisé</li>${shop.shopReturnDays ? `<li>Retours ${shop.shopReturnDays} jours</li>` : ''}</ul></section>
<section><h2>Nos produits</h2>${products.length ? `<div class="grid">${products.map((p, i) => productCard(p, i < 2)).join('')}</div>` : '<p class="empty">Nos produits arrivent très bientôt.</p>'}</section>
${categories.length > 1 ? `<section><h2>Catégories</h2><div class="grid">${categories.map((c) => `<a class="card" href="${categoryPath(c.name)}"><div class="info"><h3>${esc(c.name)}</h3><span class="muted">${c.count} produit${c.count > 1 ? 's' : ''}</span></div></a>`).join('')}</div></section>` : ''}
${faqBlock(faqs)}`;
  const website = { '@context': 'https://schema.org', '@type': 'WebSite', name: shop.shopName, url: abs('/boutique') };
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: products.slice(0, 30).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(productPath(p)) })),
  };
  return layout({
    shop,
    categories,
    title,
    description,
    path: '/boutique',
    body,
    jsonLd: [storeLd(shop), website, itemList, faqLd(faqs)],
    ogImage: productImages(products[0] ?? { images: '' })[0],
  });
}

export function categoryPage(shop: AppSettings, categories: Category[], category: Category, products: Product[]): string {
  const bc = breadcrumb([
    { name: 'Accueil', path: '/boutique' },
    { name: category.name, path: categoryPath(category.name) },
  ]);
  const body = `${bc.html}<section><h1>${esc(category.name)}</h1>
<p class="muted">${category.count} produit${category.count > 1 ? 's' : ''} · livraison suivie ${shop.shopDeliveryMinDays}-${shop.shopDeliveryMaxDays} jours · paiement sécurisé</p>
<div class="grid">${products.map((p, i) => productCard(p, i < 2)).join('')}</div></section>`;
  return layout({
    shop,
    categories,
    title: clip(`${category.name} – Achat en ligne | ${shop.shopName}`, 65),
    description: clip(
      `${category.name} : ${products
        .slice(0, 3)
        .map((p) => p.name)
        .join(', ')}. Livraison suivie ${shop.shopDeliveryMinDays}-${shop.shopDeliveryMaxDays} jours, paiement sécurisé chez ${shop.shopName}.`,
      158,
    ),
    path: categoryPath(category.name),
    body,
    jsonLd: [bc.data],
    ogImage: productImages(products[0] ?? { images: '' })[0],
  });
}

export function productPage(shop: AppSettings, categories: Category[], p: Product, related: Product[], payEnabled: boolean): string {
  const imgs = productImages(p);
  const path = productPath(p);
  const faqs = faq(shop);
  const desc = p.description?.trim() || '';
  const bc = breadcrumb([
    { name: 'Accueil', path: '/boutique' },
    { name: p.category, path: categoryPath(p.category) },
    { name: p.name, path },
  ]);
  const nextYear = new Date(Date.now() + 365 * 24 * 3600_000).toISOString().slice(0, 10);
  const shippingCountry = (shop.shopCountry || 'FR').toUpperCase();
  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    ...(imgs.length ? { image: imgs.slice(0, 6) } : {}),
    description: clip(desc || p.name, 5000),
    ...(p.sku ? { sku: p.sku } : {}),
    category: p.category,
    brand: { '@type': 'Brand', name: shop.shopName },
    offers: {
      '@type': 'Offer',
      url: abs(path),
      price: (p.salePrice ?? 0).toFixed(2),
      priceCurrency: p.currency,
      priceValidUntil: nextYear,
      availability: 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': abs('/boutique#store') },
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: p.currency },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: shippingCountry },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 3, unitCode: 'DAY' },
          transitTime: {
            '@type': 'QuantitativeValue',
            minValue: shop.shopDeliveryMinDays,
            maxValue: shop.shopDeliveryMaxDays,
            unitCode: 'DAY',
          },
        },
      },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: shippingCountry,
        ...(shop.shopReturnDays > 0
          ? {
              returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
              merchantReturnDays: shop.shopReturnDays,
              returnMethod: 'https://schema.org/ReturnByMail',
              returnFees: 'https://schema.org/FreeReturn',
            }
          : { returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted' }),
      },
    },
  };

  const buyForm = payEnabled
    ? `<form class="buy" method="post" action="/boutique/commander">
<input type="hidden" name="productId" value="${esc(p.id)}">
<div class="hp" aria-hidden="true"><label>Site web<input name="website" tabindex="-1" autocomplete="off"></label></div>
<label>Quantité<select name="quantity">${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join('')}</select></label>
<label>Nom complet<input name="name" required maxlength="120" autocomplete="name"></label>
<div class="row"><label>E-mail<input type="email" name="email" required maxlength="160" autocomplete="email"></label>
<label>Téléphone<input type="tel" name="phone" required maxlength="40" autocomplete="tel"></label></div>
<label>Adresse<input name="address" required maxlength="200" autocomplete="street-address"></label>
<div class="row"><label>Ville<input name="city" required maxlength="80" autocomplete="address-level2"></label>
<label>Code postal<input name="zip" required maxlength="20" autocomplete="postal-code"></label></div>
<label>Pays<input name="country" required maxlength="60" autocomplete="country-name" value="${esc(shop.shopCountry)}"></label>
<button class="btn" type="submit">Commander – paiement sécurisé</button>
</form>`
    : `<div class="notice">Ce produit sera bientôt disponible à la commande en ligne.${shop.shopEmail ? ` Contactez-nous : <a href="mailto:${esc(shop.shopEmail)}">${esc(shop.shopEmail)}</a>` : ''}</div>`;

  const body = `${bc.html}
<article class="pdp">
<div class="gallery">${imgs[0] ? `<div class="main"><img src="${esc(imgs[0])}" alt="${esc(p.name)}" width="800" height="800" fetchpriority="high" decoding="async"></div>` : ''}
${imgs.length > 1 ? `<div class="more">${imgs.slice(1, 9).map((u, i) => `<img src="${esc(u)}" alt="${esc(p.name)} – vue ${i + 2}" width="120" height="120" loading="lazy" decoding="async">`).join('')}</div>` : ''}</div>
<div>
<h1>${esc(p.name)}</h1>
<div class="price big">${money(p.salePrice, p.currency)}</div>
<div class="ship">🚚 <b>Livraison offerte</b> · reçu en ${shop.shopDeliveryMinDays}-${shop.shopDeliveryMaxDays} jours ouvrés avec suivi${shop.shopReturnDays ? `<br>↩️ Retours acceptés sous ${shop.shopReturnDays} jours` : ''}<br>🔒 Paiement par carte sécurisé</div>
${buyForm}
</div>
</article>
${desc ? `<section><h2>Description – ${esc(p.name)}</h2><div class="desc">${esc(desc)}</div></section>` : ''}
${faqBlock(faqs)}
${related.length ? `<section><h2>Vous aimerez aussi</h2><div class="grid">${related.map((r) => productCard(r)).join('')}</div></section>` : ''}`;

  return layout({
    shop,
    categories,
    title: clip(`${p.name} – ${money(p.salePrice, p.currency)} | ${shop.shopName}`, 70),
    description: clip(
      `${p.name} à ${money(p.salePrice, p.currency)}. ${(desc || p.category).replace(/[.!…\s]+$/, '')}. Livraison offerte en ${shop.shopDeliveryMinDays}-${shop.shopDeliveryMaxDays} jours.`,
      158,
    ),
    path,
    body,
    jsonLd: [productLd, bc.data, faqLd(faqs)],
    ogImage: imgs[0],
    ogType: 'product',
  });
}

export function infoPage(shop: AppSettings, categories: Category[]): string {
  const faqs = faq(shop);
  const nap = [shop.shopAddress, [shop.shopZip, shop.shopCity].filter(Boolean).join(' '), shop.shopCountry].filter(Boolean).join(', ');
  const body = `<section><h1>Livraison, retours &amp; contact</h1>
<h2>Livraison</h2><p>Les commandes sont préparées sous 1 à 3 jours ouvrés puis livrées en ${shop.shopDeliveryMinDays} à ${shop.shopDeliveryMaxDays} jours ouvrés. La livraison est offerte et un numéro de suivi est envoyé par e-mail.</p>
<h2>Retours</h2><p>${shop.shopReturnDays ? `Vous pouvez retourner un article dans les ${shop.shopReturnDays} jours suivant sa réception pour un remboursement.` : 'Contactez-nous pour toute demande de retour.'}</p>
<h2>Contact</h2><p>${esc(shop.shopName)}${nap ? ` — ${esc(nap)}` : ''}${shop.shopPhone ? ` — ${esc(shop.shopPhone)}` : ''}${shop.shopEmail ? ` — <a href="mailto:${esc(shop.shopEmail)}">${esc(shop.shopEmail)}</a>` : ''}</p>
</section>${faqBlock(faqs)}`;
  return layout({
    shop,
    categories,
    title: clip(`Livraison, retours et contact | ${shop.shopName}`, 65),
    description: clip(
      `Livraison offerte en ${shop.shopDeliveryMinDays}-${shop.shopDeliveryMaxDays} jours, retours ${shop.shopReturnDays} jours, paiement sécurisé. Contactez ${shop.shopName}.`,
      158,
    ),
    path: '/boutique/infos',
    body,
    jsonLd: [storeLd(shop), faqLd(faqs)],
  });
}

/** Page transitoire (non indexée) : confirmation, paiement, erreurs. */
export function messagePage(shop: AppSettings, categories: Category[], title: string, html: string, path = '/boutique'): string {
  return layout({
    shop,
    categories,
    title: `${title} | ${shop.shopName}`,
    description: title,
    path,
    body: `<div class="notice"><h1>${esc(title)}</h1>${html}</div>`,
    noindex: true,
  });
}

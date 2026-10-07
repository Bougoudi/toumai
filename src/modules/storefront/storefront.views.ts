import type { Product } from '@prisma/client';
import { env } from '../../config/env.js';
import type { AppSettings } from '../settings/settings.service.js';
import {
  absUrl,
  bundlePct,
  bundleUnitPrice,
  categoryPath,
  productHighlights,
  productImages,
  productPath,
  productSizes,
  productSteps,
} from './storefront.service.js';

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
.announce{background:var(--fg);color:var(--bg);text-align:center;font-size:13px;font-weight:600;padding:8px 16px}
.was{color:var(--muted);text-decoration:line-through;font-weight:500;font-size:.6em;margin-left:8px}
.save{display:inline-block;background:var(--brand);color:#fff;font-size:12px;font-weight:700;border-radius:999px;padding:3px 10px;margin-left:8px;vertical-align:middle}
.checks{list-style:none;padding:0;margin:14px 0;display:grid;gap:6px}
.checks li::before{content:"✓";color:var(--ok);font-weight:800;margin-right:8px}
.offers{display:grid;gap:8px;border:0;padding:0;margin:0}
.offers legend{font-size:13px;color:var(--muted);margin-bottom:6px}
.offer{display:flex;align-items:center;gap:10px;border:2px solid var(--line);border-radius:12px;padding:12px 14px;cursor:pointer;color:var(--fg);font-size:15px}
.offer:has(input:checked){border-color:var(--brand);background:var(--card)}
.offer input{width:auto;accent-color:var(--brand)}
.offer .q{flex:1;font-weight:600}.offer .tag{white-space:nowrap;background:var(--ok);color:#fff;border-radius:999px;font-size:11px;font-weight:700;padding:2px 8px;margin-left:6px}
.offer .t{font-weight:800;text-align:right}.offer .t small{display:block;font-weight:500;color:var(--muted);font-size:12px}
.badges{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0;text-align:center;font-size:12px;color:var(--muted)}
.badges div{background:var(--card);border-radius:10px;padding:10px 6px}.badges b{display:block;font-size:20px}
.reason{display:grid;gap:20px;align-items:center;margin:40px 0}@media(min-width:760px){.reason{grid-template-columns:1fr 1fr}.reason:nth-of-type(even) .rimg{order:2}}
.reason h3{font-size:22px;margin:0 0 8px;letter-spacing:-.01em}.reason p{color:var(--muted);margin:0 0 14px}
.rimg{aspect-ratio:1/1;border-radius:16px;overflow:hidden;background:var(--card)}.rimg img{width:100%;height:100%;object-fit:cover}
.steps{list-style:none;counter-reset:s;padding:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.steps li{counter-increment:s;background:var(--card);border-radius:14px;padding:16px;font-weight:600}
.steps li::before{content:counter(s);display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--brand);color:#fff;font-weight:800;margin-bottom:10px}
.lhero{display:grid;gap:24px;align-items:center;padding:28px 0}@media(min-width:860px){.lhero{grid-template-columns:1fr 1fr}}
.lhero h1{font-size:clamp(28px,4.4vw,46px);line-height:1.1;margin:0 0 12px;letter-spacing:-.02em}
.lhero p.lead{color:var(--muted);font-size:18px;margin:0 0 16px}
.cta-band{text-align:center;background:var(--card);border-radius:18px;padding:28px 16px;margin:40px 0}
.sticky-buy{position:fixed;left:0;right:0;bottom:0;background:var(--bg);border-top:1px solid var(--line);padding:10px 16px;display:flex;gap:12px;align-items:center;z-index:9}
.sticky-buy .btn{flex:1;padding:12px}@media(min-width:860px){.sticky-buy{display:none}}
body.has-sticky{padding-bottom:72px}@media(min-width:860px){body.has-sticky{padding-bottom:0}}
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
  /** Barre d'achat fixe en bas sur mobile (pages de vente). */
  sticky?: { label: string; href: string; price: string };
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
${o.ogImage ? `<meta property="og:image" content="${esc(absUrl(o.ogImage))}">\n<meta name="twitter:image" content="${esc(absUrl(o.ogImage))}">` : ''}
<meta name="twitter:card" content="${o.ogImage ? 'summary_large_image' : 'summary'}">
<meta name="theme-color" content="#e8590c">
<link rel="icon" href="/icons/icon-192.png" type="image/png">
<style>${CSS.replace(/\n/g, '')}</style>
${(o.jsonLd ?? []).map(ld).join('\n')}
</head>
<body${o.sticky ? ' class="has-sticky"' : ''}>
${shop.shopAnnouncement ? `<div class="announce">${esc(shop.shopAnnouncement)}</div>` : ''}
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
${o.sticky ? `<div class="sticky-buy"><strong>${o.sticky.price}</strong><a class="btn" href="${esc(o.sticky.href)}">${esc(o.sticky.label)}</a></div>` : ''}
</body>
</html>`;
}

/** Prix de vente + prix barré éventuel (uniquement s'il est réellement supérieur). */
function priceHtml(p: Product, big = false): string {
  const sale = p.salePrice ?? 0;
  const was = p.compareAtPrice && p.compareAtPrice > sale ? p.compareAtPrice : null;
  const pct = was ? Math.round((1 - sale / was) * 100) : 0;
  return `<div class="price${big ? ' big' : ''}">${money(sale, p.currency)}${was ? `<span class="was">${money(was, p.currency)}</span>${big && pct > 0 ? `<span class="save">-${pct} %</span>` : ''}` : ''}</div>`;
}

function reasonsHtml(p: Product, imgs: string[], ctaHref: string): string {
  const hl = productHighlights(p).filter((h) => h.text);
  if (!hl.length) return '';
  return hl
    .map((h, i) => {
      // Une seule photo : on ne la répète pas dans chaque section.
      const img = imgs.length > 1 ? imgs[(i + 1) % imgs.length] : '';
      return `<section class="reason">${img ? `<div class="rimg"><img src="${esc(img)}" alt="${esc(p.name)} – ${esc(h.title)}" width="600" height="600" loading="lazy" decoding="async"></div>` : ''}
<div><h3>${hl.length > 1 ? `${i + 1}. ` : ''}${esc(h.title)}</h3><p>${esc(h.text)}</p><a class="btn" href="${esc(ctaHref)}">Je le veux</a></div></section>`;
    })
    .join('');
}

function stepsHtml(p: Product): string {
  const st = productSteps(p);
  return st.length ? `<section><h2>Comment ça marche</h2><ol class="steps">${st.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></section>` : '';
}

function badgesHtml(shop: AppSettings): string {
  return `<div class="badges"><div><b>🚚</b>Livraison ${shop.shopDeliveryMinDays}-${shop.shopDeliveryMaxDays} j</div><div><b>🔒</b>Paiement sécurisé</div><div><b>↩️</b>${shop.shopReturnDays ? `Retours ${shop.shopReturnDays} j` : 'Service client'}</div></div>`;
}

function productCard(p: Product, eager = false): string {
  const img = productImages(p)[0];
  return `<a class="card" href="${productPath(p)}">
<div class="thumb">${img ? `<img src="${esc(img)}" alt="${esc(p.name)}" width="400" height="400" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">` : ''}</div>
<div class="info"><h3>${esc(p.name)}</h3>${priceHtml(p)}</div></a>`;
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

/** Accueil « page de vente » centré sur le produit mis en avant (style boutique mono-produit). */
function landingPage(shop: AppSettings, categories: Category[], products: Product[], f: Product): string {
  const faqs = faq(shop);
  const imgs = productImages(f);
  const href = productPath(f) + '#acheter';
  const hl = productHighlights(f);
  const others = products.filter((x) => x.id !== f.id);
  const short = f.name.split(' – ')[0];
  const lead = shop.shopDescription || (f.description ?? '').split('\n')[0] || shop.shopTagline;
  const body = `
<section class="lhero">
${imgs[0] ? `<div class="rimg"><img src="${esc(imgs[0])}" alt="${esc(f.name)}" width="800" height="800" fetchpriority="high" decoding="async"></div>` : ''}
<div><h1>${esc(f.name)}</h1><p class="lead">${esc(clip(lead, 220))}</p>
${priceHtml(f, true)}
${hl.length ? `<ul class="checks">${hl.slice(0, 5).map((h) => `<li>${esc(h.title)}</li>`).join('')}</ul>` : ''}
<a class="btn" href="${esc(href)}">Commander maintenant</a>
${badgesHtml(shop)}</div></section>
${hl.some((h) => h.text) ? `<h2>${hl.filter((h) => h.text).length > 1 ? `${hl.filter((h) => h.text).length} raisons de choisir notre ${esc(short.charAt(0).toLowerCase() + short.slice(1))}` : `Pourquoi choisir ${esc(short)}`}</h2>` : ''}
${reasonsHtml(f, imgs, href)}
${stepsHtml(f)}
<div class="cta-band"><h2>Commandez votre ${esc(short.charAt(0).toLowerCase() + short.slice(1))}</h2>${priceHtml(f, true)}<p><a class="btn" href="${esc(href)}">Commander maintenant</a></p></div>
${faqBlock(faqs)}
${others.length ? `<section><h2>Nos autres produits</h2><div class="grid">${others.slice(0, 8).map((p) => productCard(p)).join('')}</div></section>` : ''}`;
  return layout({
    shop,
    categories,
    title: clip(`${f.name} – ${shop.shopName}`, 65),
    description: clip(`${f.name} à ${money(f.salePrice, f.currency)}. ${lead.replace(/[.!…\s]+$/, '')}. Livraison suivie, paiement sécurisé.`, 158),
    path: '/boutique',
    body,
    jsonLd: [storeLd(shop), { '@context': 'https://schema.org', '@type': 'WebSite', name: shop.shopName, url: abs('/boutique') }, faqLd(faqs)],
    ogImage: imgs[0],
    sticky: { label: 'Commander', href, price: money(f.salePrice, f.currency) },
  });
}

export function homePage(shop: AppSettings, categories: Category[], products: Product[], featured?: Product | null): string {
  if (featured) return landingPage(shop, categories, products, featured);
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
    ...(imgs.length ? { image: imgs.slice(0, 6).map(absUrl) } : {}),
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
<fieldset class="offers"><legend>Choisissez votre offre</legend>${[1, 2, 3]
        .map((q) => {
          const unit = bundleUnitPrice(shop, q, p.salePrice ?? 0);
          const pct = bundlePct(shop, q);
          return `<label class="offer"><input type="radio" name="quantity" value="${q}"${q === 1 ? ' checked' : ''}><span class="q">${q} × ${q === 1 ? 'article' : 'articles'}${pct ? `<span class="tag">-${pct} %</span>` : ''}</span><span class="t">${money(unit * q, p.currency)}${q > 1 ? `<small>soit ${money(unit, p.currency)} / pièce</small>` : ''}</span></label>`;
        })
        .join('')}</fieldset>
${productSizes(p).length ? `<label>Taille<select name="size" required><option value="">Choisissez votre taille</option>${productSizes(p).map((z) => `<option>${esc(z)}</option>`).join('')}</select></label>` : ''}
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
${priceHtml(p, true)}
${productHighlights(p).length ? `<ul class="checks">${productHighlights(p).slice(0, 5).map((h) => `<li>${esc(h.title)}</li>`).join('')}</ul>` : ''}
<div class="ship">🚚 <b>Livraison offerte</b> · reçu en ${shop.shopDeliveryMinDays}-${shop.shopDeliveryMaxDays} jours ouvrés avec suivi${shop.shopReturnDays ? `<br>↩️ Retours acceptés sous ${shop.shopReturnDays} jours` : ''}<br>🔒 Paiement par carte sécurisé</div>
<div id="acheter">${buyForm}</div>
${badgesHtml(shop)}
</div>
</article>
${reasonsHtml(p, imgs, '#acheter')}
${stepsHtml(p)}
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
    sticky: payEnabled ? { label: 'Commander', href: '#acheter', price: money(p.salePrice, p.currency) } : undefined,
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

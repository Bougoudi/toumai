import type { Product } from '@prisma/client';
import { env } from '../../config/env.js';
import type { AppSettings } from '../settings/settings.service.js';
import {
  absUrl,
  bundlePct,
  bundleUnitPrice,
  categoryPath,
  productColors,
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
 * script ni ressource externe : polices auto-hébergées (/fonts), icônes SVG en
 * ligne → chargement rapide (PageSpeed / Core Web Vitals). Balises title,
 * description, canonical, Open Graph et données structurées schema.org (Product,
 * Offer, BreadcrumbList, OnlineStore / LocalBusiness, FAQPage).
 *
 * Direction artistique : maison de mode douce et haut de gamme — fond porcelaine,
 * encre cacao, détails bronze, titres Bodoni Moda, texte Jost.
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

// ── Icônes (SVG en ligne, trait fin, couleur héritée) ──────────────────────
const svg = (d: string, size = 22) =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  truck: svg('<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
  ret: svg('<path d="M4 9h11a5 5 0 0 1 0 10H8"/><path d="M8 5 4 9l4 4"/>'),
  check: svg('<path d="m5 12.5 4.2 4L19 7"/>', 16),
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 18),
};

/** Teinte des pastilles de couleur (noms courants en français). */
const SWATCH: Record<string, string> = {
  beige: '#E4D7C3', creme: '#F0E7D8', crème: '#F0E7D8', blanc: '#F7F5F2', ecru: '#EFE6D6', écru: '#EFE6D6',
  rose: '#D8B4BE', 'vieux rose': '#C79AA3', gris: '#8E9097', 'gris clair': '#BDBEC2', noir: '#1E1B1D',
  marron: '#6B4A3A', camel: '#B68A5E', kaki: '#6F6B4C', vert: '#6E8A6F', bleu: '#5D7392', 'bleu marine': '#2C3A55',
  bordeaux: '#6E2633', rouge: '#A6383A', violet: '#7D6491', jaune: '#D9B858', orange: '#C97A44',
};

function faq(shop: AppSettings): { q: string; a: string }[] {
  const out = [
    {
      q: 'Quels sont les délais de livraison ?',
      a: `Votre commande est préparée sous 1 à 3 jours ouvrés, puis livrée en ${shop.shopDeliveryMinDays} à ${shop.shopDeliveryMaxDays} jours ouvrés. Un numéro de suivi vous est envoyé dès l'expédition.`,
    },
    {
      q: 'Puis-je retourner un article ?',
      a:
        shop.shopReturnDays > 0
          ? `Oui. Vous disposez de ${shop.shopReturnDays} jours après réception pour nous retourner un article et être remboursé.`
          : 'Contactez-nous : nous étudions chaque demande de retour.',
    },
    {
      q: 'Le paiement est-il sécurisé ?',
      a: 'Oui. Le paiement par carte se fait sur la page chiffrée de notre prestataire de paiement : nous ne voyons jamais vos données bancaires.',
    },
  ];
  if (shop.shopEmail) out.push({ q: 'Comment vous contacter ?', a: `Écrivez-nous à ${shop.shopEmail}. Nous répondons sous 24 h.` });
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

/*
 * Mise en page : colonne éditoriale de 1180 px, grands blancs, fiche produit en deux
 * colonnes (galerie / panneau d'achat collant), sections en accordéon.
 */
const CSS = `
@font-face{font-family:"Bodoni Moda";font-style:normal;font-weight:400 600;font-display:swap;src:url(/fonts/bodoni-moda.woff2) format("woff2")}
@font-face{font-family:"Bodoni Moda";font-style:italic;font-weight:400 600;font-display:swap;src:url(/fonts/bodoni-moda-italic.woff2) format("woff2")}
@font-face{font-family:"Jost";font-style:normal;font-weight:300 600;font-display:swap;src:url(/fonts/jost.woff2) format("woff2")}
:root{--bg:#FBF8F6;--surface:#F3EDE9;--fg:#2A2026;--muted:#76696E;--line:#E6DCD7;--accent:#9C6B4E;--btn:#2A2026;--on-btn:#FBF8F6;--ok:#4F6E55;
--display:"Bodoni Moda","Bodoni 72",Didot,"Times New Roman",serif;--body:"Jost","Avenir Next",Futura,"Segoe UI",system-ui,sans-serif;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#151012;--surface:#211A1D;--fg:#F2EBE7;--muted:#B5A8AD;--line:#362C30;--accent:#D6A889;--btn:#F2EBE7;--on-btn:#151012;--ok:#93B89A;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#151012;--surface:#211A1D;--fg:#F2EBE7;--muted:#B5A8AD;--line:#362C30;--accent:#D6A889;--btn:#F2EBE7;--on-btn:#151012;--ok:#93B89A;color-scheme:dark}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
body{margin:0;background:var(--bg);color:var(--fg);font:300 17px/1.65 var(--body);-webkit-font-smoothing:antialiased}
a{color:inherit}img{max-width:100%;height:auto;display:block}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.wrap{max-width:1180px;margin:0 auto;padding-inline:20px}
.ico{flex:none}
.eyebrow{font:500 12px/1.4 var(--body);letter-spacing:.18em;text-transform:uppercase;color:var(--accent);margin:0 0 14px}
h1,h2,h3{font-family:var(--display);font-weight:400;line-height:1.12;letter-spacing:-.005em;text-wrap:balance;margin:0}
h2{font-size:clamp(28px,3.4vw,40px)}
h2 em,h1 em{font-style:italic}
.announce{background:var(--btn);color:var(--on-btn);text-align:center;font:500 11.5px/1.4 var(--body);letter-spacing:.16em;text-transform:uppercase;padding:9px 16px}
header.top{position:sticky;top:env(safe-area-inset-top,0px);z-index:6;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
header.top .wrap{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px;min-height:72px}
.logo{font:500 22px/1 var(--display);letter-spacing:.22em;text-transform:uppercase;text-decoration:none;text-align:center;white-space:nowrap}
nav.cats{display:flex;gap:22px;overflow-x:auto;scrollbar-width:none;font:400 13px/1 var(--body);letter-spacing:.08em;text-transform:uppercase}
nav.cats a,.hlink{text-decoration:none;color:var(--muted);white-space:nowrap;padding:6px 0;border-bottom:1px solid transparent}
nav.cats a:hover,.hlink:hover{color:var(--fg);border-bottom-color:var(--fg)}
.hlink{justify-self:end;font:400 13px/1 var(--body);letter-spacing:.08em;text-transform:uppercase}
@media (max-width:720px){header.top .wrap{grid-template-columns:1fr;justify-items:center;padding-block:14px;gap:10px}.hlink{display:none}nav.cats{max-width:100%}.logo{font-size:19px}}
main{display:block;padding-bottom:40px}
section{margin-block:clamp(56px,8vw,104px)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:var(--btn);color:var(--on-btn);border:1px solid var(--btn);border-radius:2px;padding:17px 30px;font:500 13px/1 var(--body);letter-spacing:.16em;text-transform:uppercase;text-decoration:none;cursor:pointer;transition:background .2s,color .2s}
.btn:hover{background:transparent;color:var(--fg)}
.btn.block{width:100%}
.btn.ghost{background:transparent;color:var(--fg)}.btn.ghost:hover{background:var(--btn);color:var(--on-btn)}
.price{font:400 26px/1.2 var(--display);display:flex;align-items:baseline;flex-wrap:wrap;gap:12px;font-variant-numeric:lining-nums tabular-nums}
.price.small{font-size:19px}
.was{color:var(--muted);text-decoration:line-through;font-size:.68em}
.save{font:500 11px/1 var(--body);letter-spacing:.12em;text-transform:uppercase;color:var(--accent);border:1px solid var(--accent);padding:6px 9px;align-self:center}
.checks{list-style:none;padding:0;margin:0;display:grid;gap:10px}
.checks li{display:flex;gap:12px;align-items:flex-start}.checks .ico{color:var(--accent);margin-top:5px}
.media{aspect-ratio:1/1;background:var(--surface);overflow:hidden;max-width:100%}.media img{width:100%;height:100%;object-fit:cover}
/* Accueil — page de vente */
.lhero{display:grid;gap:clamp(28px,5vw,72px);align-items:center;margin-block:clamp(28px,5vw,64px)}
@media (min-width:880px){.lhero{grid-template-columns:1.05fr 1fr}}
.lhero h1{font-size:clamp(34px,4.2vw,52px);margin-bottom:20px}
.lead{color:var(--muted);font-size:19px;max-width:34em;margin:0 0 28px}
.lhero .price{margin-bottom:26px}.lhero .checks{margin-bottom:34px}
.reassure{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-block:1px solid var(--line)}
.reassure div{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;padding:26px 10px;font-size:14px;color:var(--muted)}
.reassure div+div{border-left:1px solid var(--line)}.reassure .ico{color:var(--fg)}
.reassure strong{display:block;font-weight:500;color:var(--fg);letter-spacing:.04em}
@media (max-width:560px){.reassure{grid-template-columns:1fr}.reassure div+div{border-left:0;border-top:1px solid var(--line)}}
.shead{display:grid;gap:12px;max-width:40em;margin-bottom:clamp(32px,4vw,52px)}
.reason{display:grid;gap:clamp(24px,5vw,72px);align-items:center;margin-block:clamp(36px,6vw,80px)}
@media (min-width:880px){.reason{grid-template-columns:1fr 1fr}.reason.flip .media{order:2}}
.reason h3{font-size:clamp(26px,3vw,34px);margin-bottom:16px}.reason p{color:var(--muted);margin:0 0 28px;max-width:30em}
.reason.text{max-width:40em}
.steps{list-style:none;counter-reset:s;padding:0;margin:0;display:grid;gap:0;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));border-top:1px solid var(--line)}
.steps li{counter-increment:s;padding:28px 24px 28px 0;display:grid;gap:12px;align-content:start}
.steps li::before{content:counter(s,decimal-leading-zero);font:italic 400 34px/1 var(--display);color:var(--accent)}
.cta-band{text-align:center;background:var(--surface);padding:clamp(40px,6vw,72px) 20px;display:grid;justify-items:center;gap:18px}
.cta-band p{margin:0;color:var(--muted)}
/* Catalogue */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:36px 24px}
.card{text-decoration:none;display:grid;gap:14px}
.card .media img{transition:transform .6s ease}.card:hover .media img{transform:scale(1.03)}
.card h3{font:400 19px/1.3 var(--display)}
.hero{margin-block:clamp(40px,6vw,80px)}.hero h1{font-size:clamp(36px,5vw,58px);margin-bottom:14px}
.hero p{color:var(--muted);margin:0;font-size:19px;max-width:36em}
/* Fiche produit */
.crumbs{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-block:26px}
.crumbs ol{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}
.crumbs li+li::before{content:"/";margin-right:8px;color:var(--line)}.crumbs a{text-decoration:none}.crumbs a:hover{color:var(--fg)}
.pdp{display:grid;gap:clamp(28px,4vw,64px);align-items:start}
@media (min-width:900px){.pdp{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)}.panel{position:sticky;top:96px}}
.gallery{display:grid;gap:10px}
.gallery .more{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.gallery .more a{display:block}
.panel{display:grid;gap:22px;min-width:0}
.panel h1{font-size:clamp(30px,3.4vw,42px)}
.panel .lead{font-size:17px;margin:0}
form.buy{display:grid;gap:22px}
fieldset{border:0;margin:0;padding:0;min-width:0;display:grid;gap:12px}
legend,.flabel{font:500 12px/1.4 var(--body);letter-spacing:.16em;text-transform:uppercase;color:var(--fg);padding:0;margin-bottom:12px;display:flex;justify-content:space-between;gap:12px;width:100%}
legend a{color:var(--muted);letter-spacing:.08em;text-transform:none;font-weight:400;font-size:13px}
.chips{display:flex;flex-wrap:wrap;gap:10px}
.chip{position:relative;display:inline-flex;align-items:center;gap:10px;border:1px solid var(--line);padding:11px 16px;min-width:56px;justify-content:center;cursor:pointer;font-size:15px;transition:border-color .2s}
.chip:hover{border-color:var(--muted)}
.chip input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.chip:has(input:checked){border-color:var(--fg);box-shadow:inset 0 0 0 1px var(--fg)}
.chip:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.dot{width:16px;height:16px;border-radius:50%;border:1px solid color-mix(in srgb,var(--fg) 20%,transparent)}
.offers{gap:10px}
.offer{position:relative;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;border:1px solid var(--line);padding:16px 18px;cursor:pointer;transition:border-color .2s}
.offer:hover{border-color:var(--muted)}
.offer:has(input:checked){border-color:var(--fg);box-shadow:inset 0 0 0 1px var(--fg)}
.offer input{accent-color:var(--fg);width:18px;height:18px;margin:0}
.offer .q{font-weight:400}.offer .tag{font:500 10.5px/1 var(--body);letter-spacing:.12em;text-transform:uppercase;color:var(--accent);border:1px solid var(--accent);padding:4px 7px;margin-left:8px;white-space:nowrap}
.offer .t{font:400 18px/1.2 var(--display);text-align:right;font-variant-numeric:tabular-nums}.offer .t small{display:block;font:300 12.5px/1.5 var(--body);color:var(--muted)}
.fields{display:grid;gap:14px}
.fields .row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media (max-width:480px){.fields .row{grid-template-columns:1fr}}
label.f{display:grid;gap:6px;font-size:13px;color:var(--muted);letter-spacing:.02em}
input,select{font:400 16px/1.3 var(--body);padding:14px 14px;border:1px solid var(--line);border-radius:2px;background:var(--bg);color:var(--fg);width:100%;transition:border-color .2s}
input:focus,select:focus{border-color:var(--fg);outline:none}
.secure{display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;color:var(--muted);margin:-8px 0 0}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.perks{display:grid;gap:12px;border-top:1px solid var(--line);padding-top:20px;font-size:15px}
.perks div{display:flex;gap:12px;align-items:center}.perks .ico{color:var(--accent)}
.acc{border-top:1px solid var(--line);max-width:860px}
details{border-bottom:1px solid var(--line)}
summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:22px 0;font:400 21px/1.3 var(--display)}
summary::-webkit-details-marker{display:none}
summary .ico{transition:transform .25s}details[open] summary .ico{transform:rotate(45deg)}
details .inner{padding:0 0 26px;color:var(--muted);display:grid;gap:14px}
details .inner p{margin:0}
.specs{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;margin:0;border-top:1px solid var(--line)}
.specs dt,.specs dd{margin:0;padding:12px 0;border-bottom:1px solid var(--line)}
.specs dt{font-weight:500;color:var(--fg);padding-right:24px}
.notice{background:var(--surface);padding:clamp(28px,5vw,56px);margin-block:48px;display:grid;gap:18px;justify-items:start}
.notice h1{font-size:clamp(30px,4vw,44px)}.notice p{margin:0;color:var(--muted)}
.prose{max-width:44em}.prose h2{font-size:28px;margin:40px 0 10px}.prose p{color:var(--muted)}
footer.bot{border-top:1px solid var(--line);margin-top:40px;padding-block:56px 40px;font-size:15px;color:var(--muted)}
footer.bot .cols{display:grid;gap:32px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
footer.bot .logo{text-align:left;color:var(--fg);display:block;margin-bottom:14px;font-size:18px}
footer.bot h4{font:500 12px/1.4 var(--body);letter-spacing:.16em;text-transform:uppercase;color:var(--fg);margin:0 0 14px}
footer.bot p{margin:0 0 8px}footer.bot a{text-decoration:none}footer.bot a:hover{color:var(--fg)}
.legal{margin-top:40px;padding-top:20px;border-top:1px solid var(--line);font-size:13px}
.empty{color:var(--muted)}
.nlf{display:flex;gap:0;max-width:360px}.nlf input{border-right:0}.nlf .btn{padding:0 18px}
.code{font:500 22px/1.2 var(--body);letter-spacing:.14em;color:var(--fg)}
.nl{position:fixed;inset:0;z-index:30;display:grid;place-items:center;padding:16px}
.nl[hidden],.nl [hidden]{display:none!important}
.nl-back{position:absolute;inset:0;background:color-mix(in srgb,#140E11 55%,transparent);animation:nlfade .3s ease}
.nl-box{position:relative;display:grid;background:var(--bg);color:var(--fg);width:min(780px,100%);max-height:calc(100% - 32px);overflow:auto;box-shadow:0 30px 80px -20px rgba(20,14,17,.45);animation:nlup .35s ease}
@media (min-width:680px){.nl-box{grid-template-columns:1fr 1.1fr}}
@media (max-width:679px){.nl-img{display:none}}
.nl-img{background:var(--surface);min-height:100%}.nl-img img{width:100%;height:100%;object-fit:cover}
.nl-body{padding:clamp(30px,5vw,48px);display:grid;gap:16px;align-content:center}
.nl-body h2{font-size:clamp(30px,4vw,40px)}.nl-body p{margin:0;color:var(--muted)}
.nl-body .eyebrow{margin:0}
.nl-form{display:grid;gap:12px}
.nl-x{position:absolute;top:10px;right:10px;background:none;border:0;color:var(--fg);padding:8px;cursor:pointer;line-height:0}
.nl-x .ico{transform:rotate(45deg)}
.nl-no{background:none;border:0;color:var(--muted);font:400 13px/1 var(--body);text-decoration:underline;cursor:pointer;justify-self:center;padding:6px}
.nl-legal{font-size:12px}
.nl-err{color:#B4443D}
.copy{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px dashed var(--accent);padding:14px 16px}
@keyframes nlfade{from{opacity:0}}@keyframes nlup{from{opacity:0;transform:translateY(14px)}}
.sticky-buy{position:fixed;left:0;right:0;bottom:0;z-index:9;background:var(--bg);border-top:1px solid var(--line);padding:12px 20px calc(12px + env(safe-area-inset-bottom,0px));display:flex;gap:16px;align-items:center}
.sticky-buy .price{font-size:20px}.sticky-buy .btn{flex:1;padding:15px 18px}
@media (min-width:900px){.sticky-buy{display:none}}
body.has-sticky{padding-bottom:84px}@media (min-width:900px){body.has-sticky{padding-bottom:0}}
.sum{border:1px solid var(--line);background:var(--surface);padding:16px 18px;display:grid;gap:10px;margin:0}
.sum>div{display:flex;justify-content:space-between;gap:16px;font-size:14px;color:var(--muted)}
.sum dt,.sum dd{margin:0}.sum dd{font-variant-numeric:tabular-nums;text-align:right}
.sum .tot{border-top:1px solid var(--line);padding-top:12px;color:var(--fg);font-size:16px}.sum .tot dd{font-weight:500}
.sum .off dd{color:var(--ok)}.sum [hidden]{display:none}
.rv{position:fixed;inset:0;z-index:40;display:grid;place-items:center;padding:16px}.rv[hidden],.rv [hidden]{display:none!important}
.rv-back{position:absolute;inset:0;background:color-mix(in srgb,#140E11 55%,transparent);animation:nlfade .25s ease}
.rv-box{position:relative;background:var(--bg);color:var(--fg);width:min(520px,100%);max-height:calc(100% - 32px);overflow:auto;padding:36px 28px 24px;display:grid;gap:14px;box-shadow:0 30px 80px -20px rgba(20,14,17,.45);animation:nlup .3s ease}
.rv-box h2{font-size:clamp(26px,4vw,32px);margin:0}.rv-box .eyebrow{margin:0}
.rv-card{border:1px solid var(--line);padding:14px 16px;display:grid;gap:4px;font-size:14px}.rv-card b{font-weight:500}.rv-card span{color:var(--muted)}
.rv-row{display:flex;justify-content:space-between;gap:16px}
.rv-back-btn{background:none;border:0;color:var(--muted);font:400 13px/1 var(--body);text-decoration:underline;cursor:pointer;justify-self:center;padding:8px}
.rv-wait{display:grid;justify-items:center;gap:14px;text-align:center;padding:12px 0}.rv-wait p{margin:0;color:var(--muted)}
.spin{width:30px;height:30px;border:2px solid var(--line);border-top-color:var(--fg);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
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
  /** Visuel de la pop-up d'inscription (photo du produit vedette). */
  popupImage?: string;
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
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
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
<meta name="theme-color" content="#FBF8F6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151012" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/icons/icon-192.png" type="image/png">
<link rel="preload" href="/fonts/bodoni-moda.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/jost.woff2" as="font" type="font/woff2" crossorigin>
<style>${CSS.replace(/\n/g, '')}</style>
${(o.jsonLd ?? []).map(ld).join('\n')}
</head>
<body${o.sticky ? ' class="has-sticky"' : ''}>
${shop.shopAnnouncement ? `<div class="announce">${esc(shop.shopAnnouncement)}</div>` : ''}
<header class="top"><div class="wrap">
<nav class="cats" aria-label="Collections">${o.categories
    .slice(0, 4)
    .map((c) => `<a href="${categoryPath(c.name)}">${esc(c.name)}</a>`)
    .join('')}</nav>
<a class="logo" href="/boutique">${esc(shop.shopName)}</a>
<a class="hlink" href="/boutique/infos">Livraison &amp; retours</a>
</div></header>
<main class="wrap">${o.body}</main>
<footer class="bot"><div class="wrap">
<div class="cols">
<div><a class="logo" href="/boutique">${esc(shop.shopName)}</a><p>${esc(shop.shopTagline)}</p></div>
<div><h4>Service client</h4><p><a href="/boutique/infos">Livraison &amp; retours</a></p><p><a href="/boutique/infos#contact">Nous contacter</a></p><p><a href="/privacy.html">Confidentialité</a></p></div>
${shop.newsletterEnabled ? `<div><h4>Newsletter</h4><p>−${shop.newsletterPct} % sur votre première commande.</p><form class="nlf" method="post" action="/boutique/newsletter"><input type="hidden" name="source" value="footer"><label class="hp" aria-hidden="true">Site<input name="website" tabindex="-1" autocomplete="off"></label><input type="email" name="email" required maxlength="160" placeholder="Votre e-mail" aria-label="Votre adresse e-mail" autocomplete="email"><button class="btn" type="submit">OK</button></form></div>` : ''}
<div><h4>Nous trouver</h4>${nap ? `<p>${esc(nap)}</p>` : ''}${shop.shopPhone ? `<p><a href="tel:${esc(shop.shopPhone.replace(/\s+/g, ''))}">${esc(shop.shopPhone)}</a></p>` : ''}${shop.shopEmail ? `<p><a href="mailto:${esc(shop.shopEmail)}">${esc(shop.shopEmail)}</a></p>` : ''}${!nap ? '<p>Service client · France et international</p>' : ''}</div>
</div>
<p class="legal">© ${new Date().getFullYear()} ${esc(shop.shopName)} · Paiement sécurisé · Livraison suivie</p>
</div></footer>
${shop.newsletterEnabled && !o.noindex ? popupHtml(shop, o.popupImage) : ''}
${o.sticky ? `<div class="sticky-buy"><span class="price">${o.sticky.price}</span><a class="btn" href="${esc(o.sticky.href)}">${esc(o.sticky.label)}</a></div>` : ''}
<script src="/boutique.js" defer></script>
</body>
</html>`;
}

/** Pop-up d'inscription : masquée sans JavaScript, ouverte par /boutique.js une seule fois par visiteur. */
function popupHtml(shop: AppSettings, image?: string): string {
  return `<div class="nl" id="nl" hidden role="dialog" aria-modal="true" aria-labelledby="nl-title">
<div class="nl-back" data-close></div>
<div class="nl-box">
<button class="nl-x" type="button" data-close aria-label="Fermer">${ICON.plus}</button>
${image ? `<div class="nl-img"><img src="${esc(image)}" alt="" width="400" height="400" loading="lazy" decoding="async"></div>` : ''}
<div class="nl-body">
<p class="eyebrow">Bienvenue chez ${esc(shop.shopName)}</p>
<h2 id="nl-title">−${shop.newsletterPct} % <em>sur votre première commande</em></h2>
<div id="nl-step1" class="nl-form">
<p>Inscrivez-vous pour recevoir votre code personnel et nos nouveautés en avant-première.</p>
<form class="nl-form" id="nl-form" method="post" action="/boutique/newsletter">
<input type="hidden" name="source" value="popup">
<label class="hp" aria-hidden="true">Site<input name="website" tabindex="-1" autocomplete="off"></label>
<input type="email" id="nl-email" name="email" required maxlength="160" placeholder="Votre adresse e-mail" aria-label="Votre adresse e-mail" autocomplete="email">
<button class="btn block" type="submit">Recevoir mon code</button>
<p class="nl-err" id="nl-err" role="alert" hidden></p>
</form>
<p class="nl-legal">En vous inscrivant, vous acceptez de recevoir nos e-mails. Désinscription en un clic.</p>
<button class="nl-no" type="button" data-close>Non merci</button>
</div>
<div id="nl-step2" class="nl-form" hidden>
<p>Voici votre code personnel, valable sur votre première commande :</p>
<div class="copy"><span class="code" id="nl-code"></span><button class="btn ghost" type="button" id="nl-copy">Copier</button></div>
<p>Il est déjà enregistré : il s'ajoutera tout seul au moment de commander.</p>
<button class="btn block" type="button" data-close>Continuer mes achats</button>
</div>
</div></div></div>`;
}

/** Prix de vente + prix barré éventuel (uniquement s'il est réellement supérieur). */
function priceHtml(p: Product, big = false): string {
  const sale = p.salePrice ?? 0;
  const was = p.compareAtPrice && p.compareAtPrice > sale ? p.compareAtPrice : null;
  const pct = was ? Math.round((1 - sale / was) * 100) : 0;
  return `<div class="price${big ? '' : ' small'}">${money(sale, p.currency)}${was ? `<span class="was">${money(was, p.currency)}</span>${big && pct > 0 ? `<span class="save">−${pct} %</span>` : ''}` : ''}</div>`;
}

function checksHtml(p: Product): string {
  const hl = productHighlights(p);
  return hl.length ? `<ul class="checks">${hl.slice(0, 5).map((h) => `<li>${ICON.check}<span>${esc(h.title)}</span></li>`).join('')}</ul>` : '';
}

/** Photos d'ambiance (on écarte les visuels « guide des tailles » des sections éditoriales). */
const moodImages = (imgs: string[]) => imgs.filter((u) => !/taille|guide|size/i.test(u));

function reasonsHtml(p: Product, imgs: string[], ctaHref: string): string {
  const hl = productHighlights(p).filter((h) => h.text);
  if (!hl.length) return '';
  const mood = moodImages(imgs);
  return hl
    .map((h, i) => {
      // Une seule photo : on ne la répète pas dans chaque section.
      const img = mood.length > 1 ? mood[(i + 1) % mood.length] : '';
      return `<div class="reason${i % 2 ? ' flip' : ''}${img ? '' : ' text'}">${img ? `<div class="media"><img src="${esc(img)}" alt="${esc(p.name)} – ${esc(h.title)}" width="700" height="700" loading="lazy" decoding="async"></div>` : ''}
<div><h3>${esc(h.title)}</h3><p>${esc(h.text)}</p><a class="btn ghost" href="${esc(ctaHref)}">Choisir le mien</a></div></div>`;
    })
    .join('');
}

function stepsHtml(p: Product): string {
  const st = productSteps(p);
  return st.length
    ? `<section><div class="shead"><p class="eyebrow">Mode d'emploi</p><h2>Comment ça marche</h2></div><ol class="steps">${st.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></section>`
    : '';
}

function reassureHtml(shop: AppSettings): string {
  return `<div class="reassure">
<div>${ICON.truck}<span><strong>Livraison suivie</strong>${shop.shopDeliveryMinDays} à ${shop.shopDeliveryMaxDays} jours ouvrés</span></div>
<div>${ICON.lock}<span><strong>Paiement sécurisé</strong>Carte bancaire chiffrée</span></div>
<div>${ICON.ret}<span><strong>${shop.shopReturnDays ? `Retours ${shop.shopReturnDays} jours` : 'Service client'}</strong>${shop.shopReturnDays ? 'Remboursement simple' : 'Réponse sous 24 h'}</span></div>
</div>`;
}

function productCard(p: Product, eager = false): string {
  const img = productImages(p)[0];
  return `<a class="card" href="${productPath(p)}">
<div class="media">${img ? `<img src="${esc(img)}" alt="${esc(p.name)}" width="500" height="500" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">` : ''}</div>
<div><h3>${esc(p.name.split(' – ')[0])}</h3>${priceHtml(p)}</div></a>`;
}

function accordion(items: { title: string; html: string; open?: boolean; id?: string }[]): string {
  return `<div class="acc">${items
    .map(
      (it) =>
        `<details${it.open ? ' open' : ''}${it.id ? ` id="${it.id}"` : ''}><summary>${esc(it.title)}${ICON.plus}</summary><div class="inner">${it.html}</div></details>`,
    )
    .join('')}</div>`;
}

function faqBlock(items: { q: string; a: string }[]): string {
  return `<section><div class="shead"><p class="eyebrow">Questions fréquentes</p><h2>Tout ce qu'il faut savoir</h2></div>${accordion(
    items.map((f) => ({ title: f.q, html: `<p>${esc(f.a)}</p>` })),
  )}</section>`;
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

/**
 * Description structurée : les lignes « Libellé : valeur » courtes deviennent un
 * tableau de caractéristiques ; les autres restent des paragraphes.
 */
function parseDescription(desc: string): { intro: string; paras: { label?: string; text: string }[]; specs: { k: string; v: string }[] } {
  const lines = desc
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const intro = lines.shift() ?? '';
  const paras: { label?: string; text: string }[] = [];
  const specs: { k: string; v: string }[] = [];
  for (const l of lines) {
    const m = l.match(/^([^:]{2,32}?)\s*:\s*(.+)$/);
    if (m && m[2].length <= 140) specs.push({ k: m[1], v: m[2] });
    else if (m) paras.push({ label: m[1], text: m[2] });
    else paras.push({ text: l });
  }
  return { intro, paras, specs };
}

/** Accueil « page de vente » centré sur le produit mis en avant. */
function landingPage(shop: AppSettings, categories: Category[], products: Product[], f: Product): string {
  const faqs = faq(shop);
  const imgs = productImages(f);
  const href = productPath(f) + '#acheter';
  const hl = productHighlights(f);
  const others = products.filter((x) => x.id !== f.id);
  const short = f.name.split(' – ')[0];
  const sub = f.name.includes(' – ') ? f.name.split(' – ').slice(1).join(' – ') : '';
  const { intro } = parseDescription(f.description ?? '');
  const lead = shop.shopDescription || intro || shop.shopTagline;
  const nReasons = hl.filter((h) => h.text).length;
  const body = `
<section class="lhero">
${imgs[0] ? `<div class="media"><img src="${esc(imgs[0])}" alt="${esc(f.name)}" width="900" height="900" fetchpriority="high" decoding="async"></div>` : ''}
<div><p class="eyebrow">${esc(f.category)}</p><h1>${esc(short)}${sub ? `<br><em>${esc(sub)}</em>` : ''}</h1>
<p class="lead">${esc(clip(lead, 240))}</p>
${priceHtml(f, true)}
${checksHtml(f)}
<a class="btn block" href="${esc(href)}">Choisir ma couleur et ma taille</a></div></section>
${reassureHtml(shop)}
${nReasons ? `<section><div class="shead"><p class="eyebrow">${nReasons > 1 ? `${nReasons} raisons de l'adopter` : 'Pourquoi l’adopter'}</p><h2>Pensé pour <em>vous deux</em></h2></div>${reasonsHtml(f, imgs, href)}</section>` : ''}
${stepsHtml(f)}
<section class="cta-band"><p class="eyebrow">${esc(f.category)}</p><h2>${esc(short)}</h2>${priceHtml(f, true)}<a class="btn" href="${esc(href)}">Commander</a><p>Livraison suivie · Paiement sécurisé${shop.shopReturnDays ? ` · Retours ${shop.shopReturnDays} jours` : ''}</p></section>
${faqBlock(faqs)}
${others.length ? `<section><div class="shead"><p class="eyebrow">La boutique</p><h2>Vous aimerez aussi</h2></div><div class="grid">${others.slice(0, 8).map((p) => productCard(p)).join('')}</div></section>` : ''}`;
  return layout({
    shop,
    categories,
    title: clip(`${f.name} – ${shop.shopName}`, 65),
    description: clip(`${f.name} à ${money(f.salePrice, f.currency)}. ${lead.replace(/[.!…\s]+$/, '')}. Livraison suivie, paiement sécurisé.`, 158),
    path: '/boutique',
    body,
    jsonLd: [storeLd(shop), { '@context': 'https://schema.org', '@type': 'WebSite', name: shop.shopName, url: abs('/boutique') }, faqLd(faqs)],
    ogImage: imgs[0],
    popupImage: imgs[0],
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
<section class="hero"><p class="eyebrow">${esc(shop.shopName)}</p><h1>${esc(shop.shopTagline)}</h1>
${shop.shopDescription ? `<p>${esc(shop.shopDescription)}</p>` : ''}</section>
${reassureHtml(shop)}
<section><div class="shead"><p class="eyebrow">La collection</p><h2>Nos pièces</h2></div>${products.length ? `<div class="grid">${products.map((p, i) => productCard(p, i < 2)).join('')}</div>` : '<p class="empty">Nos pièces arrivent très bientôt.</p>'}</section>
${categories.length > 1 ? `<section><div class="shead"><p class="eyebrow">Collections</p><h2>Parcourir</h2></div><div class="grid">${categories.map((c) => `<a class="card" href="${categoryPath(c.name)}"><div><h3>${esc(c.name)}</h3><p class="empty">${c.count} pièce${c.count > 1 ? 's' : ''}</p></div></a>`).join('')}</div></section>` : ''}
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
  const body = `${bc.html}<section class="hero"><p class="eyebrow">Collection</p><h1>${esc(category.name)}</h1>
<p>${category.count} pièce${category.count > 1 ? 's' : ''} · livraison suivie ${shop.shopDeliveryMinDays}-${shop.shopDeliveryMaxDays} jours · paiement sécurisé</p></section>
<div class="grid">${products.map((p, i) => productCard(p, i < 2)).join('')}</div>`;
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
  const { intro, paras, specs } = parseDescription(desc);
  const sizeGuide = imgs.find((u) => /taille|guide|size/i.test(u));
  const colors = productColors(p);
  const sizes = productSizes(p);
  const bc = breadcrumb([
    { name: 'Accueil', path: '/boutique' },
    { name: p.category, path: categoryPath(p.category) },
    { name: p.name.split(' – ')[0], path },
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
    ...(colors.length ? { color: colors.join(', ') } : {}),
    ...(sizes.length ? { size: sizes.join(', ') } : {}),
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

  const colorField = colors.length
    ? `<fieldset><legend><span>Couleur</span></legend><div class="chips">${colors
        .map((c) => {
          const hex = SWATCH[c.toLowerCase()];
          return `<label class="chip"><input type="radio" name="color" value="${esc(c)}" required>${hex ? `<span class="dot" style="background:${hex}"></span>` : ''}${esc(c)}</label>`;
        })
        .join('')}</div></fieldset>`
    : '';
  const sizeField = sizes.length
    ? `<fieldset><legend><span>Taille</span>${sizeGuide ? '<a href="#guide-tailles">Guide des tailles</a>' : ''}</legend><div class="chips">${sizes
        .map((z) => `<label class="chip"><input type="radio" name="size" value="${esc(z)}" required>${esc(z)}</label>`)
        .join('')}</div></fieldset>`
    : '';
  const offers = `<fieldset class="offers"><legend><span>Quantité</span></legend>${[1, 2, 3]
    .map((q) => {
      const unit = bundleUnitPrice(shop, q, p.salePrice ?? 0);
      const pct = bundlePct(shop, q);
      return `<label class="offer"><input type="radio" name="quantity" value="${q}"${q === 1 ? ' checked' : ''}><span class="q">${q === 1 ? '1 pièce' : `${q} pièces`}${pct ? `<span class="tag">−${pct} %</span>` : ''}</span><span class="t">${money(unit * q, p.currency)}${q > 1 ? `<small>${money(unit, p.currency)} la pièce</small>` : ''}</span></label>`;
    })
    .join('')}</fieldset>`;

  const buyForm = payEnabled
    ? `<form class="buy" method="post" action="/boutique/commander" data-name="${esc(p.name)}" data-currency="${esc(p.currency)}" data-promo-pct="${shop.newsletterEnabled ? shop.newsletterPct : 0}" data-prices="${esc(JSON.stringify([1, 2, 3].map((q) => Number((bundleUnitPrice(shop, q, p.salePrice ?? 0) * q).toFixed(2)))))}">
<input type="hidden" name="productId" value="${esc(p.id)}">
<div class="hp" aria-hidden="true"><label>Site web<input name="website" tabindex="-1" autocomplete="off"></label></div>
${colorField}${sizeField}${offers}
<fieldset><legend><span>Livraison</span></legend><div class="fields">
<label class="f">Nom complet<input name="name" required maxlength="120" autocomplete="name"></label>
<div class="row"><label class="f">E-mail<input type="email" name="email" required maxlength="160" autocomplete="email"></label>
<label class="f">Téléphone<input type="tel" name="phone" required maxlength="40" autocomplete="tel"></label></div>
<label class="f">Adresse<input name="address" required maxlength="200" autocomplete="street-address"></label>
<div class="row"><label class="f">Ville<input name="city" required maxlength="80" autocomplete="address-level2"></label>
<label class="f">Code postal<input name="zip" required maxlength="20" autocomplete="postal-code"></label></div>
<label class="f">Pays<input name="country" required maxlength="60" autocomplete="country-name" value="${esc(shop.shopCountry)}"></label>
</div></fieldset>
<label class="f">Code promo (facultatif)<input id="promo" name="promo" maxlength="40" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
<dl class="sum" aria-live="polite">
<div><dt>Sous-total</dt><dd id="sum-sub">${money(bundleUnitPrice(shop, 1, p.salePrice ?? 0), p.currency)}</dd></div>
<div class="off" id="sum-promo-row" hidden><dt>Code de bienvenue (−${shop.newsletterPct} %)</dt><dd id="sum-promo"></dd></div>
<div><dt>Livraison</dt><dd>Offerte</dd></div>
<div class="tot"><dt>Total</dt><dd id="sum-total">${money(bundleUnitPrice(shop, 1, p.salePrice ?? 0), p.currency)}</dd></div>
</dl>
<button class="btn block" type="submit">Passer au paiement sécurisé</button>
<p class="secure">${ICON.lock}Paiement par carte sécurisé et chiffré</p>
</form>
<div class="rv" id="rv" hidden role="dialog" aria-modal="true" aria-labelledby="rv-title">
<div class="rv-back" data-rv-close></div>
<div class="rv-box">
<button class="nl-x" type="button" data-rv-close aria-label="Fermer">${ICON.plus}</button>
<div id="rv-main">
<p class="eyebrow">Récapitulatif</p>
<h2 id="rv-title">Vérifiez votre commande</h2>
</div>
<div class="rv-card" id="rv-product"></div>
<div class="rv-card" id="rv-address"></div>
<p class="secure">${ICON.lock}Vous allez être redirigé(e) vers la page de paiement sécurisée.</p>
<button class="btn block" type="button" id="rv-pay">Confirmer et payer</button>
<button class="rv-back-btn" type="button" data-rv-close>Modifier ma commande</button>
<div class="rv-wait" id="rv-wait" hidden><div class="spin" aria-hidden="true"></div><p>Préparation du paiement sécurisé…</p></div>
</div>
</div>`
    : `<div class="notice"><p>Cette pièce sera bientôt disponible à la commande en ligne.${shop.shopEmail ? ` Écrivez-nous : <a href="mailto:${esc(shop.shopEmail)}">${esc(shop.shopEmail)}</a>` : ''}</p></div>`;

  const perks = `<div class="perks">
<div>${ICON.truck}<span>Livraison offerte, reçue en ${shop.shopDeliveryMinDays} à ${shop.shopDeliveryMaxDays} jours ouvrés avec suivi</span></div>
${shop.shopReturnDays ? `<div>${ICON.ret}<span>Retours acceptés sous ${shop.shopReturnDays} jours</span></div>` : ''}
<div>${ICON.heart}<span>Service client à votre écoute${shop.shopEmail ? ` : ${esc(shop.shopEmail)}` : ''}</span></div>
</div>`;

  const accItems = [
    ...(desc
      ? [
          {
            title: 'Description',
            open: true,
            html: [intro, ...paras.filter((x) => !x.label).map((x) => x.text)]
              .filter(Boolean)
              .map((t) => `<p>${esc(t)}</p>`)
              .join(''),
          },
        ]
      : []),
    ...(specs.length
      ? [{ title: 'Caractéristiques', html: `<dl class="specs">${specs.map((s) => `<dt>${esc(s.k)}</dt><dd>${esc(s.v)}</dd>`).join('')}</dl>` }]
      : []),
    ...(sizeGuide
      ? [
          {
            title: 'Guide des tailles',
            id: 'guide-tailles',
            html: `<img src="${esc(sizeGuide)}" alt="Guide des tailles – ${esc(p.name)}" width="900" height="900" loading="lazy" decoding="async">`,
          },
        ]
      : []),
    ...paras.filter((x) => x.label).map((x) => ({ title: x.label!, html: `<p>${esc(x.text)}</p>` })),
    {
      title: 'Livraison et retours',
      html: `<p>Préparation sous 1 à 3 jours ouvrés, livraison suivie en ${shop.shopDeliveryMinDays} à ${shop.shopDeliveryMaxDays} jours ouvrés.</p><p>${shop.shopReturnDays ? `Vous disposez de ${shop.shopReturnDays} jours après réception pour nous retourner l'article.` : 'Contactez-nous pour toute demande de retour.'}</p>`,
    },
  ];

  const gallery = imgs.filter((u) => u !== sizeGuide || imgs.length === 1);
  const body = `${bc.html}
<article class="pdp">
<div class="gallery">${gallery[0] ? `<div class="media"><img src="${esc(gallery[0])}" alt="${esc(p.name)}" width="900" height="900" fetchpriority="high" decoding="async"></div>` : ''}
${gallery.length > 1 ? `<div class="more">${gallery
    .slice(1, 9)
    .map((u, i) => `<a class="media" href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="${esc(p.name)} – vue ${i + 2}" width="300" height="300" loading="lazy" decoding="async"></a>`)
    .join('')}</div>` : ''}</div>
<div class="panel" id="acheter">
<div><p class="eyebrow">${esc(p.category)}</p><h1>${esc(p.name)}</h1></div>
${priceHtml(p, true)}
${intro ? `<p class="lead">${esc(intro)}</p>` : ''}
${checksHtml(p)}
${buyForm}
${perks}
</div>
</article>
<section>${accordion(accItems)}</section>
${productHighlights(p).some((h) => h.text) ? `<section><div class="shead"><p class="eyebrow">Les détails</p><h2>Pensé pour <em>vous deux</em></h2></div>${reasonsHtml(p, imgs, '#acheter')}</section>` : ''}
${stepsHtml(p)}
${faqBlock(faqs)}
${related.length ? `<section><div class="shead"><p class="eyebrow">La boutique</p><h2>Vous aimerez aussi</h2></div><div class="grid">${related.map((r) => productCard(r)).join('')}</div></section>` : ''}`;

  return layout({
    shop,
    categories,
    title: clip(`${p.name} – ${money(p.salePrice, p.currency)} | ${shop.shopName}`, 70),
    description: clip(
      `${p.name} à ${money(p.salePrice, p.currency)}. ${(intro || p.category).replace(/[.!…\s]+$/, '')}. Livraison offerte en ${shop.shopDeliveryMinDays}-${shop.shopDeliveryMaxDays} jours.`,
      158,
    ),
    path,
    body,
    jsonLd: [productLd, bc.data, faqLd(faqs)],
    ogImage: imgs[0],
    popupImage: imgs[0],
    ogType: 'product',
    sticky: payEnabled ? { label: 'Commander', href: '#acheter', price: money(p.salePrice, p.currency) } : undefined,
  });
}

export function infoPage(shop: AppSettings, categories: Category[]): string {
  const faqs = faq(shop);
  const nap = [shop.shopAddress, [shop.shopZip, shop.shopCity].filter(Boolean).join(' '), shop.shopCountry].filter(Boolean).join(', ');
  const body = `<section class="hero"><p class="eyebrow">Service client</p><h1>Livraison, retours <em>&amp; contact</em></h1></section>
${reassureHtml(shop)}
<div class="prose">
<h2>Livraison</h2><p>Les commandes sont préparées sous 1 à 3 jours ouvrés puis livrées en ${shop.shopDeliveryMinDays} à ${shop.shopDeliveryMaxDays} jours ouvrés. La livraison est offerte et un numéro de suivi vous est envoyé par e-mail.</p>
<h2>Retours</h2><p>${shop.shopReturnDays ? `Vous pouvez retourner un article dans les ${shop.shopReturnDays} jours suivant sa réception pour être remboursé.` : 'Contactez-nous pour toute demande de retour.'}</p>
<h2 id="contact">Contact</h2><p>${esc(shop.shopName)}${nap ? ` · ${esc(nap)}` : ''}${shop.shopPhone ? ` · ${esc(shop.shopPhone)}` : ''}${shop.shopEmail ? ` · <a href="mailto:${esc(shop.shopEmail)}">${esc(shop.shopEmail)}</a>` : ''}</p>
</div>${faqBlock(faqs)}`;
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


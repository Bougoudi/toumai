import express, { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { asyncHandler } from '../../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { paymentService } from '../payments/payment.service.js';
import { trackPageView } from './analytics.service.js';
import { newsletterService } from './newsletter.service.js';
import { getSettings } from '../settings/settings.service.js';
import {
  absUrl,
  bundleUnitPrice,
  categoryPath,
  productImages,
  productColors,
  productPath,
  productSizes,
  storefrontService,
} from './storefront.service.js';
import { categoryPage, esc, homePage, infoPage, messagePage, money, productPage } from './storefront.views.js';

/**
 * Boutique en ligne publique (sans authentification), optimisée pour le
 * référencement naturel : /boutique, pages catégorie et produit, robots.txt,
 * sitemap.xml. Les commandes passées ici arrivent dans l'onglet « Commandes »
 * (canal « boutique ») et suivent le circuit habituel paiement → expédition.
 */
export const storefrontRouter = Router();

// Statistiques de visite anonymes (sans cookie) des pages de la boutique.
storefrontRouter.use(trackPageView);

const abs = (path: string) => env.publicUrl.replace(/\/+$/, '') + path;

/** Pages publiques : cache court côté navigateur/CDN (rapidité PageSpeed). */
function html(res: Response, body: string, status = 200, cache = true) {
  res
    .status(status)
    .set('Cache-Control', cache ? 'public, max-age=300, stale-while-revalidate=600' : 'no-store')
    .type('html')
    .send(body);
}

/** Anti-abus : limite les commandes par IP. */
const orderLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

/** Commande possible : API de paiement (iyzico/Stripe) ou lien de paiement hébergé. */
const canSell = () => paymentService.enabled() || !!paymentService.linkUrl();

async function chrome() {
  return { shop: getSettings(), categories: await storefrontService.listCategories() };
}

async function notFoundPage(res: Response) {
  const { shop, categories } = await chrome();
  html(
    res,
    messagePage(shop, categories, 'Page introuvable', '<p>Ce produit n’est plus disponible.</p><p><a class="btn" href="/boutique">Voir la boutique</a></p>'),
    404,
    false,
  );
}

// ── Référencement : robots.txt + sitemap.xml ─────────────────────────────
storefrontRouter.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Allow: /boutique',
      'Disallow: /api/',
      'Disallow: /boutique/commander',
      'Disallow: /boutique/merci',
      'Disallow: /boutique/newsletter',
      'Disallow: /boutique/desinscription',
      // L'application d'administration (racine) n'a rien à faire dans Google.
      'Disallow: /$',
      'Disallow: /index.html',
      '',
      `Sitemap: ${abs('/sitemap.xml')}`,
      '',
    ].join('\n'),
  );
});

storefrontRouter.get(
  '/sitemap.xml',
  asyncHandler(async (_req, res) => {
    const [products, categories] = await Promise.all([storefrontService.sitemapEntries(), storefrontService.listCategories()]);
    const x = (s: string) => esc(s);
    const newest = products[0]?.updatedAt.toISOString();
    const urls = [
      `<url><loc>${x(abs('/boutique'))}</loc>${newest ? `<lastmod>${newest}</lastmod>` : ''}</url>`,
      `<url><loc>${x(abs('/boutique/infos'))}</loc></url>`,
      ...categories.map((c) => `<url><loc>${x(abs(categoryPath(c.name)))}</loc></url>`),
      ...products.map((p) => {
        const img = productImages(p)[0];
        return `<url><loc>${x(abs(productPath(p)))}</loc><lastmod>${p.updatedAt.toISOString()}</lastmod>${
          img ? `<image:image><image:loc>${x(absUrl(img))}</image:loc></image:image>` : ''
        }</url>`;
      }),
    ];
    res
      .type('application/xml')
      .set('Cache-Control', 'public, max-age=3600')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join('\n')}\n</urlset>\n`,
      );
  }),
);

// ── Pages ────────────────────────────────────────────────────────────────
storefrontRouter.get(
  '/boutique',
  asyncHandler(async (_req, res) => {
    const [{ shop, categories }, products] = await Promise.all([chrome(), storefrontService.listProducts()]);
    const featured = await storefrontService.featured(shop.shopFeaturedProductId);
    html(res, homePage(shop, categories, products, featured));
  }),
);

storefrontRouter.get(
  '/boutique/infos',
  asyncHandler(async (_req, res) => {
    const { shop, categories } = await chrome();
    html(res, infoPage(shop, categories));
  }),
);

storefrontRouter.get(
  '/boutique/categorie/:slug',
  asyncHandler(async (req, res) => {
    const { shop, categories } = await chrome();
    const category = categories.find((c) => c.slug === req.params.slug);
    if (!category) return notFoundPage(res);
    const products = await storefrontService.listProducts({ category: category.name, take: 120 });
    html(res, categoryPage(shop, categories, category, products));
  }),
);

storefrontRouter.get(
  '/boutique/produit/:slug',
  asyncHandler(async (req, res) => {
    let product;
    try {
      product = await storefrontService.getProductBySlug(req.params.slug);
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 404) return notFoundPage(res);
      throw err;
    }
    // Une seule URL par produit : si le nom a changé, redirection permanente (301).
    const canonical = productPath(product);
    if (req.path !== canonical) return res.redirect(301, canonical);

    const [{ shop, categories }, related] = await Promise.all([chrome(), storefrontService.related(product)]);
    html(res, productPage(shop, categories, product, related, canSell()));
  }),
);

// ── Commande ─────────────────────────────────────────────────────────────
const orderSchema = z.object({
  productId: z.string().min(1).max(40),
  quantity: z.coerce.number().int().min(1).max(5),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().min(5).max(40),
  address: z.string().trim().min(3).max(200),
  city: z.string().trim().min(1).max(80),
  zip: z.string().trim().min(1).max(20),
  country: z.string().trim().min(2).max(60),
  size: z.string().trim().max(20).optional(),
  color: z.string().trim().max(30).optional(),
  promo: z.string().trim().max(40).optional(),
  website: z.string().max(0).optional(), // pot de miel anti-robots : doit rester vide
});

storefrontRouter.post(
  '/boutique/commander',
  orderLimiter,
  express.urlencoded({ extended: false, limit: '20kb' }),
  asyncHandler(async (req: Request, res: Response) => {
    const { shop, categories } = await chrome();
    const fail = (msg: string, status = 400, back = '/boutique') =>
      html(
        res,
        messagePage(shop, categories, 'Commande impossible', `<p>${esc(msg)}</p><p><a class="btn" href="${esc(back)}">Revenir</a></p>`),
        status,
        false,
      );

    const parsed = orderSchema.safeParse(req.body);
    const productId = typeof req.body?.productId === 'string' ? req.body.productId.slice(0, 40) : '';
    const product = productId
      ? await prisma.product.findFirst({ where: { id: productId, status: 'ACTIVE', salePrice: { gt: 0 } } })
      : null;
    if (!product) return fail('Ce produit n’est plus disponible.', 404);
    const back = productPath(product);
    if (!parsed.success) return fail('Merci de vérifier les informations saisies (tous les champs sont requis).', 400, back);
    const input = parsed.data;
    const sizes = productSizes(product);
    if (sizes.length && !sizes.includes(input.size ?? '')) return fail('Merci de choisir une taille.', 400, back);
    const colors = productColors(product);
    if (colors.length && !colors.includes(input.color ?? '')) return fail('Merci de choisir une couleur.', 400, back);
    const variant = [colors.length ? input.color : null, sizes.length ? input.size : null].filter(Boolean).join(' / ') || null;
    if (!canSell()) return fail('Le paiement en ligne n’est pas encore activé.', 503, back);

    // Code promo (code de bienvenue newsletter) : vérifié et réservé côté serveur.
    const promo = input.promo ? await newsletterService.validCode(input.promo) : null;
    if (input.promo && (!promo || !(await newsletterService.consume(promo.id, 'en-cours')))) {
      return fail('Ce code promo n’est pas valide ou a déjà été utilisé.', 400, back);
    }

    // Remise par lot (2 ou 3 articles) puis code promo, appliqués côté serveur.
    const bundleUnit = bundleUnitPrice(shop, input.quantity, product.salePrice ?? 0);
    const unit = promo ? Math.round(bundleUnit * (1 - promo.pct / 100) * 100) / 100 : bundleUnit;
    const discountAmount = promo ? Number(((bundleUnit - unit) * input.quantity).toFixed(2)) : null;
    const order = await prisma.order.create({
      data: {
        orderNumber: `TM-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        channel: 'boutique',
        status: 'PENDING',
        currency: product.currency,
        total: Number((unit * input.quantity).toFixed(2)),
        discountCode: promo?.code ?? null,
        discountAmount,
        customer: {
          create: {
            name: input.name,
            email: input.email,
            phone: input.phone,
            address: input.address,
            city: input.city,
            zip: input.zip,
            country: input.country,
          },
        },
        items: {
          create: [{ productId: product.id, quantity: input.quantity, unitSalePrice: unit, unitCostPrice: product.costPrice, variant }],
        },
      },
    });
    logger.info('Commande boutique créée', { orderNumber: order.orderNumber, promo: !!promo });
    if (promo) await prisma.subscriber.update({ where: { id: promo.id }, data: { orderId: order.id } });

    const promoLine = promo ? `<p>Code ${esc(promo.code)} appliqué : −${money(discountAmount, order.currency)}.</p>` : '';

    // Lien de paiement hébergé (ex. iyzico Link) : pas de confirmation automatique,
    // la commande reste « en attente » jusqu'à vérification du paiement reçu.
    const link = paymentService.linkUrl();
    if (link) {
      logger.info('Commande boutique en attente de paiement par lien', { orderNumber: order.orderNumber });
      return html(
        res,
        messagePage(
          shop,
          categories,
          'Dernière étape : le paiement',
          `<p>Commande <strong>${esc(order.orderNumber)}</strong> — ${esc(product.name)}${variant ? ` (${esc(variant)})` : ''} × ${input.quantity}.</p>${promoLine}
<p>Montant à régler : <strong>${money(order.total, order.currency)}</strong></p>
<p>Sur la page de paiement sécurisée, réglez ce montant exact et indiquez la référence <strong>${esc(order.orderNumber)}</strong>. Votre commande est préparée dès réception du paiement ; vous recevrez le numéro de suivi par e-mail.</p>
<p><a class="btn" href="${esc(link)}" rel="nofollow noopener" target="_blank">Payer par carte en toute sécurité</a></p>`,
          '/boutique/commander',
        ),
        200,
        false,
      );
    }

    let url: string | null = null;
    try {
      url = (await paymentService.createCheckout(order.id)).url;
    } catch (err) {
      logger.error('Paiement boutique indisponible', { err: err instanceof Error ? err.message : String(err) });
    }
    if (!url && promo) {
      // Paiement impossible : on libère le code pour qu'il reste utilisable.
      await prisma.subscriber.update({ where: { id: promo.id }, data: { codeUsedAt: null, orderId: null } });
      await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    }
    if (!url) return fail('Le paiement est momentanément indisponible, merci de réessayer dans quelques minutes.', 502, back);

    // Lien (et non redirection) : la CSP « form-action 'self' » bloquerait une
    // redirection de formulaire vers la page de paiement externe.
    html(
      res,
      messagePage(
        shop,
        categories,
        'Dernière étape : le paiement',
        `<p>Commande <strong>${esc(order.orderNumber)}</strong> — ${esc(product.name)} × ${input.quantity} : <strong>${money(order.total, order.currency)}</strong>.</p>${promoLine}
<p><a class="btn" href="${esc(url)}" rel="nofollow">Payer par carte en toute sécurité</a></p>`,
        '/boutique/commander',
      ),
      200,
      false,
    );
  }),
);

storefrontRouter.get(
  '/boutique/merci',
  asyncHandler(async (req, res) => {
    const { shop, categories } = await chrome();
    const num = String(req.query.commande ?? '').slice(0, 40);
    const canceled = req.query.annule != null;
    html(
      res,
      canceled
        ? messagePage(shop, categories, 'Paiement annulé', `<p>Votre paiement n’a pas été finalisé${num ? ` (commande ${esc(num)})` : ''}. Aucun montant n’a été débité.</p><p><a class="btn" href="/boutique">Retour à la boutique</a></p>`, '/boutique/merci')
        : messagePage(shop, categories, 'Merci pour votre commande !', `<p>Commande <strong>${esc(num)}</strong> confirmée. Vous recevrez le numéro de suivi par e-mail dès l’expédition.</p><p><a class="btn" href="/boutique">Continuer mes achats</a></p>`, '/boutique/merci'),
      200,
      false,
    );
  }),
);

// ── Liste e-mail : inscription (pop-up / pied de page) et désinscription ───────
const newsletterLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
const newsletterSchema = z.object({
  email: z.string().trim().email().max(160),
  source: z.enum(['popup', 'footer']).default('footer'),
  website: z.string().max(0).optional(), // pot de miel
});

storefrontRouter.post(
  '/boutique/newsletter',
  newsletterLimiter,
  express.urlencoded({ extended: false, limit: '4kb' }),
  express.json({ limit: '4kb' }),
  asyncHandler(async (req: Request, res: Response) => {
    const wantsJson = (req.get('accept') ?? '').includes('application/json');
    const shop = getSettings();
    const parsed = newsletterSchema.safeParse(req.body);
    if (!shop.newsletterEnabled) {
      return wantsJson ? res.status(404).json({ error: 'Inscription indisponible.' }) : res.redirect(303, '/boutique');
    }
    if (!parsed.success) {
      if (wantsJson) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
      const { categories } = await chrome();
      return html(res, messagePage(shop, categories, 'Adresse e-mail invalide', '<p>Vérifiez votre adresse puis réessayez.</p><p><a class="btn" href="/boutique">Revenir</a></p>'), 400, false);
    }
    const r = await newsletterService.subscribe(parsed.data.email, parsed.data.source);
    if (wantsJson) return res.json({ code: r.used ? null : r.code, pct: r.pct, reused: r.reused, used: r.used });
    const { categories } = await chrome();
    html(
      res,
      messagePage(
        shop,
        categories,
        r.used ? 'Vous êtes déjà inscrit(e)' : 'Bienvenue !',
        r.used
          ? '<p>Votre code de bienvenue a déjà été utilisé. Merci de votre fidélité !</p><p><a class="btn" href="/boutique">Retour à la boutique</a></p>'
          : `<p>Votre code personnel : <strong class="code">${esc(r.code)}</strong></p><p>−${r.pct} % sur votre première commande. Saisissez-le dans le champ « Code promo » au moment de commander.</p><p><a class="btn" href="/boutique">Découvrir la boutique</a></p>`,
        '/boutique/newsletter',
      ),
      200,
      false,
    );
  }),
);

storefrontRouter.get(
  '/boutique/desinscription',
  asyncHandler(async (req, res) => {
    const { shop, categories } = await chrome();
    const ok = await newsletterService.unsubscribe(String(req.query.e ?? '').slice(0, 160), String(req.query.t ?? '').slice(0, 64));
    html(
      res,
      messagePage(
        shop,
        categories,
        ok ? 'Désinscription confirmée' : 'Lien invalide',
        ok ? '<p>Vous ne recevrez plus nos e-mails.</p>' : '<p>Ce lien de désinscription est invalide ou incomplet.</p>',
        '/boutique/desinscription',
      ),
      ok ? 200 : 400,
      false,
    );
  }),
);

/**
 * TOUMA — parcours acheteur : accueil, catalogue, fiche produit, boutiques,
 * panier, tunnel de commande, commandes et suivi.
 */
import { api, esc, money, formatDate, label, session, statusPill, stars, productImage, svg, emptyState, toast } from './core.js';
import { productCard, storeCard, breadcrumb, stepper, orderTimeline, trackingTimeline, pagination, featureBlock } from './components.js';
import { t } from './i18n.js';

// ── Accueil ────────────────────────────────────────────────────────────────
export async function home() {
  const [latest, popular, categories, verifiedStores, countries] = await Promise.all([
    api('/products?limit=8&sort=recent'),
    api('/products?limit=8&sort=popular'),
    api('/categories'),
    api('/stores?verified=true&limit=3'),
    api('/countries'),
  ]);
  const corridor = countries.items.map((c) => c.name).join(' ↔ ');
  const topCategories = categories.items.filter((c) => c.productCount > 0).slice(0, 10);

  return `
    <section class="hero">
      <div class="hero-grid">
        <div>
          <span class="corridor-pill">${esc(t('home.corridor'))}</span>
          <h1>${esc(t('home.headline'))}</h1>
          <p>${esc(t('home.lede'))}</p>
          <div class="row">
            <a class="btn btn-accent btn-lg" href="/touma/produits" data-link>${esc(t('home.exploreCatalog'))}</a>
            <a class="btn btn-secondary btn-lg" href="/touma/inscription" data-link>${esc(t('home.openStore'))}</a>
          </div>
        </div>
        <div class="hero-visual" aria-hidden="true">
          <div class="hero-card"><span class="feature-icon">${svg('store')}</span><span><strong>${esc(t('home.verifiedCount', { count: verifiedStores.total ?? verifiedStores.items.length }))}</strong><span>${esc(t('home.verifiedCountHint'))}</span></span></div>
          <div class="hero-card"><span class="feature-icon">${svg('box')}</span><span><strong>${esc(t('home.productCount', { count: latest.total }))}</strong><span>${esc(t('home.productCountHint', { corridor }))}</span></span></div>
          <div class="hero-card"><span class="feature-icon">${svg('truck')}</span><span><strong>${esc(t('home.trackedDelivery'))}</strong><span>${esc(t('home.trackedDeliveryHint'))}</span></span></div>
        </div>
      </div>
    </section>

    ${topCategories.length
      ? `<section class="section">
          <div class="section-head"><h2>${esc(t('home.categories'))}</h2><a class="small" href="/touma/produits" data-link>${esc(t('home.seeAll'))}</a></div>
          <div class="chip-row">
            ${topCategories.map((c) => `<a class="chip" href="/touma/produits?category=${esc(c.slug)}" data-link>${esc(c.name)} <span class="muted">${c.productCount}</span></a>`).join('')}
          </div>
        </section>`
      : ''}

    ${popular.items.length
      ? `<section class="section">
          <div class="section-head">
            <h2>${esc(t('home.popular'))}</h2>
            <p>${esc(t('home.popularHint'))}</p>
          </div>
          <div class="grid grid-products">${popular.items.map((p) => productCard(p)).join('')}</div>
        </section>`
      : ''}

    ${verifiedStores.items.length
      ? `<section class="section">
          <div class="section-head">
            <h2>${esc(t('home.verifiedStores'))}</h2>
            <a class="small" href="/touma/boutiques" data-link>${esc(t('home.allStores'))}</a>
          </div>
          <div class="grid grid-cards">${verifiedStores.items.map(storeCard).join('')}</div>
        </section>`
      : ''}

    ${latest.items.length
      ? `<section class="section">
          <div class="section-head"><h2>${esc(t('home.latest'))}</h2></div>
          <div class="grid grid-products">${latest.items.map((p) => productCard(p)).join('')}</div>
        </section>`
      : emptyState({ title: t('home.emptyTitle'), body: t('home.emptyBody'), actionLabel: t('home.openStore'), actionHref: '/touma/inscription', iconName: 'store' })}

    <section class="section">
      <div class="section-head"><h2>${esc(t('home.why'))}</h2></div>
      <div class="grid grid-cards">
        <div class="card">${featureBlock('store', t('home.why.sellers'), t('home.why.sellersBody'))}</div>
        <div class="card">${featureBlock('card', t('home.why.payment'), t('home.why.paymentBody'))}</div>
        <div class="card">${featureBlock('truck', t('home.why.shipping'), t('home.why.shippingBody'))}</div>
        <div class="card">${featureBlock('shield', t('home.why.disputes'), t('home.why.disputesBody'))}</div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>${esc(t('home.how'))}</h2></div>
      <div class="grid grid-2">
        <div class="card">
          <h3 style="margin-bottom:var(--space-4)">${esc(t('home.youBuy'))}</h3>
          <div class="steps">
            <div class="step"><div><h3>${esc(t('home.buy1'))}</h3><p>${esc(t('home.buy1Body'))}</p></div></div>
            <div class="step"><div><h3>${esc(t('home.buy2'))}</h3><p>${esc(t('home.buy2Body'))}</p></div></div>
            <div class="step"><div><h3>${esc(t('home.buy3'))}</h3><p>${esc(t('home.buy3Body'))}</p></div></div>
          </div>
        </div>
        <div class="card">
          <h3 style="margin-bottom:var(--space-4)">${esc(t('home.youSell'))}</h3>
          <div class="steps">
            <div class="step"><div><h3>${esc(t('home.sell1'))}</h3><p>${esc(t('home.sell1Body'))}</p></div></div>
            <div class="step"><div><h3>${esc(t('home.sell2'))}</h3><p>${esc(t('home.sell2Body'))}</p></div></div>
            <div class="step"><div><h3>${esc(t('home.sell3'))}</h3><p>${esc(t('home.sell3Body'))}</p></div></div>
          </div>
        </div>
      </div>
    </section>

    <section class="cta-band">
      <h2>${esc(t('home.ctaTitle', { corridor }))}</h2>
      <p class="muted">${esc(t('home.ctaBody'))}</p>
      <div class="row" style="justify-content:center">
        <a class="btn btn-accent btn-lg" href="/touma/inscription" data-link>${esc(t('home.createAccount'))}</a>
        <a class="btn btn-secondary btn-lg" href="/touma/produits" data-link>${esc(t('home.seeCatalog'))}</a>
      </div>
    </section>`;
}

// ── Catalogue ──────────────────────────────────────────────────────────────
export async function catalog(_params, query) {
  const search = new URLSearchParams();
  for (const key of ['q', 'category', 'country', 'store', 'minPrice', 'maxPrice', 'availability', 'verifiedOnly', 'sort', 'page']) {
    const value = query.get(key);
    if (value) search.set(key, value);
  }
  search.set('limit', '12');

  const [result, categories, countries, facets] = await Promise.all([
    api(`/products?${search.toString()}`),
    api('/categories'),
    api('/countries'),
    // Les compteurs viennent du serveur : sans eux l'acheteur filtre à l'aveugle.
    api(`/products/facets?${search.toString()}`).catch(() => null),
  ]);

  const opt = (value, text, current) => `<option value="${esc(value)}"${current === value ? ' selected' : ''}>${esc(text)}</option>`;
  const hrefFor = (page) => {
    const next = new URLSearchParams(query);
    next.set('page', String(page));
    return `/touma/produits?${next.toString()}`;
  };

  return `
    ${breadcrumb([{ label: t('catalog.home'), href: '/touma/' }, { label: t('catalog.title') }])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div>
        <h1 style="margin-bottom:2px">${esc(t('catalog.title'))}</h1>
        <p class="muted small" style="margin:0">${result.total} produit(s)${query.get('q') ? ` pour « ${esc(query.get('q'))} »` : ''}</p>
      </div>
      <button class="btn btn-secondary btn-sm filters-toggle hide-desktop" data-toggle-filters>${esc(t('catalog.filterAndSort'))}</button>
    </div>

    <div class="catalog-layout">
      <form class="card filters-panel" id="filters" aria-label="${esc(t('catalog.filterAndSort'))}">
        <div class="field">
          <label for="f-q">${esc(t('catalog.keyword'))}</label>
          <input id="f-q" name="q" type="search" value="${esc(query.get('q') || '')}" placeholder="${esc(t('catalog.searchPlaceholder'))}" />
        </div>
        <div class="field">
          <label for="f-category">${esc(t('catalog.category'))}</label>
          <select id="f-category" name="category">
            ${opt('', t('catalog.allCategories'), query.get('category') || '')}
            ${(facets?.categories ?? categories.items.map((c) => ({ ...c, count: c.productCount })))
              .map((c) => opt(c.slug, `${c.name} (${c.count})`, query.get('category') || ''))
              .join('')}
          </select>
        </div>
        <div class="field">
          <label for="f-country">${esc(t('catalog.shipsFrom'))}</label>
          <select id="f-country" name="country">
            ${opt('', t('catalog.allCountries'), query.get('country') || '')}
            ${(facets?.countries ?? countries.items.map((c) => ({ ...c, count: null })))
              .map((c) => opt(c.code, c.count === null ? c.name : `${c.name} (${c.count})`, query.get('country') || ''))
              .join('')}
          </select>
        </div>
        ${priceFacet(facets, query)}
        <div class="row" style="gap:var(--space-3)">
          <div class="field" style="flex:1;min-width:110px">
            <label for="f-min">${esc(t('catalog.priceMin'))}</label>
            <input id="f-min" name="minPrice" inputmode="numeric" value="${esc(query.get('minPrice') || '')}" />
          </div>
          <div class="field" style="flex:1;min-width:110px">
            <label for="f-max">${esc(t('catalog.priceMax'))}</label>
            <input id="f-max" name="maxPrice" inputmode="numeric" value="${esc(query.get('maxPrice') || '')}" />
          </div>
        </div>
        <div class="field">
          <label for="f-availability">${esc(t('catalog.availability'))}</label>
          <select id="f-availability" name="availability">
            ${opt('any', t('catalog.allProducts'), query.get('availability') || 'any')}
            ${opt(
              'in_stock',
              facets ? `${t('catalog.inStockOnly')} (${facets.availability.inStock})` : t('catalog.inStockOnly'),
              query.get('availability') || 'any',
            )}
          </select>
        </div>
        <label class="check" style="margin-bottom:var(--space-4)">
          <input type="checkbox" name="verifiedOnly" value="true" ${query.get('verifiedOnly') === 'true' ? 'checked' : ''} />
          <span class="small">${esc(t('home.verifiedStores'))}${facets ? ` (${facets.verified})` : ''}</span>
        </label>
        <div class="field">
          <label for="f-sort">${esc(t('catalog.sortBy'))}</label>
          <select id="f-sort" name="sort">
            ${opt('recent', t('catalog.sort.recent'), query.get('sort') || 'recent')}
            ${opt('popular', t('catalog.sort.popular'), query.get('sort') || 'recent')}
            ${opt('price_asc', t('catalog.sort.priceAsc'), query.get('sort') || 'recent')}
            ${opt('price_desc', t('catalog.sort.priceDesc'), query.get('sort') || 'recent')}
          </select>
        </div>
        <div class="row">
          <button class="btn btn-block" type="submit">${esc(t('catalog.apply'))}</button>
          ${[...query.keys()].length ? `<a class="btn btn-ghost btn-block" href="/touma/produits" data-link>${esc(t('catalog.reset'))}</a>` : ''}
        </div>
      </form>

      <div>
        ${result.items.length
          ? `<div class="grid grid-products">${result.items.map((p) => productCard(p)).join('')}</div>
             ${pagination(result, hrefFor)}`
          : emptyState({
              title: t('catalog.noMatch'),
              body: t('catalog.noMatchBody'),
              actionLabel: t('catalog.seeAll'),
              actionHref: '/touma/produits',
              iconName: 'search',
            })}
      </div>
    </div>`;
}

/**
 * Tranches de prix cliquables, calculées par le serveur sur les prix réellement
 * présents dans les résultats. Une tranche vide n'est jamais proposée.
 */
function priceFacet(facets, query) {
  const price = facets?.price;
  if (!price) return '';
  if (price.unavailableReason) return `<p class="xs muted">${esc(price.unavailableReason)}</p>`;
  if (!price.buckets?.length) return '';

  const base = new URLSearchParams(query);
  base.delete('page');
  const hrefFor = (from, to) => {
    const next = new URLSearchParams(base);
    next.set('minPrice', from);
    if (to === null) next.delete('maxPrice');
    else next.set('maxPrice', to);
    return `/touma/produits?${next.toString()}`;
  };
  const active = (from, to) =>
    (query.get('minPrice') || '') === from && (query.get('maxPrice') || '') === (to ?? '');

  return `<div class="field">
    <span class="small" style="font-weight:var(--weight-semibold);display:block;margin-bottom:var(--space-2)">${esc(t('catalog.priceRanges'))}</span>
    <div class="chip-row">
      ${price.buckets
        .map(
          (b) => `<a class="chip${active(b.from, b.to) ? ' chip-active' : ''}" href="${esc(hrefFor(b.from, b.to))}" data-link>
            ${b.to === null ? `${money(b.from, price.currency)} et +` : `${money(b.from, price.currency)} – ${money(b.to, price.currency)}`}
            <span class="muted">${b.count}</span>
          </a>`,
        )
        .join('')}
    </div>
  </div>`;
}

// ── Fiche produit ──────────────────────────────────────────────────────────
export async function product(params) {
  const p = await api(`/products/${params.slug}`);
  const images = p.images.length ? p.images : [{ url: null, alt: p.title }];
  const verified = p.store.verificationStatus === 'APPROVED';
  // Le référentiel était déjà lu plus bas pour le choix du pays de livraison ;
  // il sert maintenant aussi à nommer le pays d'origine. Un code ISO affiché
  // brut à un acheteur ne lui apprend rien, et une table de noms recopiée ici
  // se périmerait sans bruit.
  const pays = (await api('/countries')).items;
  const nomPays = (code) => pays.find((c) => c.code === code)?.name ?? code;

  return `
    ${breadcrumb([
      { label: t('catalog.home'), href: '/touma/' },
      { label: t('catalog.title'), href: '/touma/produits' },
      { label: p.category?.name ?? t('product.breadcrumb'), href: p.category ? `/touma/produits?category=${p.category.slug}` : undefined },
      { label: p.title },
    ])}

    <div class="grid grid-2">
      <div class="gallery">
        <div class="gallery-main" id="gallery-main">${productImage(images[0].url, p.title)}</div>
        ${images.length > 1
          ? `<div class="gallery-thumbs" role="tablist" aria-label="${esc(t('order.galleryAria'))}">
              ${images.map((img, i) => `<button type="button" data-gallery="${esc(img.url ?? '')}" aria-current="${i === 0}" aria-label="Visuel ${i + 1}">${productImage(img.url, '')}</button>`).join('')}
            </div>`
          : ''}
      </div>

      <div class="buybox">
        <h1 style="font-size:var(--text-xl)">${esc(p.title)}</h1>
        <div class="row" style="gap:var(--space-2);margin-bottom:var(--space-3)">
          <a class="badge" href="/touma/boutiques/${esc(p.store.slug)}" data-link>${svg('store')} ${esc(p.store.name)}</a>
          ${verified ? `<span class="badge badge-verified">${esc(t('product.verifiedSeller'))}</span>` : `<span class="badge">${esc(t('product.verificationPending'))}</span>`}
          <span class="badge badge-country">${esc(t('product.shipsFrom', { country: p.countryCode }))}</span>
        </div>
        ${stars(p.rating, p.ratingCount)}

        <div class="price-block mt-6">
          <span class="price-lg">${money(p.price, p.currency)}</span>
          ${p.referencePrice
            ? `<span class="price-compare">${money(p.referencePrice.amount, p.referencePrice.currency)}</span>`
            : ''}
        </div>
        ${p.referencePrice && p.savings
          ? `<p class="small" style="color:var(--success);margin:2px 0 0">
              ${esc(t('price.savings', { amount: money(p.savings, p.currency) }))}
              <span class="xs muted">— ${esc(t('price.referenceHeld', { days: p.referencePrice.heldDays }))}</span>
            </p>`
          : ''}
        <p class="small muted">
          ${esc(p.inStock ? t('product.inStock', { count: p.stock }) : t('product.outOfStock'))}
          ${p.minOrderQty > 1 ? ` · ${esc(t('product.minOrder', { count: p.minOrderQty }))}` : ''}
        </p>

        <div class="card">
          ${p.variants.length
            ? `<div class="field">
                <label for="variant">${esc(t('product.variant'))}</label>
                <select id="variant">
                  ${p.variants.map((v) => `<option value="${esc(v.id)}" data-price="${esc(v.price)}" ${v.stock <= 0 ? 'disabled' : ''}>${esc(v.name)} — ${money(v.price, p.currency)}${v.stock <= 0 ? ` (${t('product.soldOut')})` : ''}</option>`).join('')}
                </select>
              </div>`
            : ''}
          <div class="field">
            <label for="qty">${esc(t('product.quantity'))}</label>
            <input id="qty" type="number" min="${p.minOrderQty}" step="1" value="${p.minOrderQty}" inputmode="numeric" />
          </div>
          <div class="row" style="gap:var(--space-2)">
            <button class="btn btn-accent btn-block" data-buy-now="${esc(p.id)}" ${p.inStock ? '' : 'disabled'}>${esc(t('product.buyNow'))}</button>
            <button class="btn btn-secondary btn-block" data-add-to-cart="${esc(p.id)}" ${p.inStock ? '' : 'disabled'}>${esc(t('product.addToCart'))}</button>
          </div>
          <button class="btn btn-ghost btn-block btn-sm" data-contact-store="${esc(p.store.id)}">${esc(t('product.contactSeller'))}</button>
          <p class="xs muted" style="margin:var(--space-2) 0 0">
            ${esc(t('product.bulkPrompt'))} <a href="/touma/business/appels-offres/nouveau" data-link>${esc(t('product.bulkLink'))}</a>.
          </p>
        </div>

        ${p.origin?.countryCode
          ? `<div class="card mt-6">
              <h3>${esc(t('product.origin'))}</h3>
              <p style="margin:0">${esc(nomPays(p.origin.countryCode))}</p>
              <!-- Le statut accompagne toujours le pays : « origine : Tchad »
                   rendu seul se lirait comme un fait vérifié. -->
              <p class="small muted" style="margin:var(--space-2) 0 0">${esc(t(`product.originStatus.${p.origin.status}`))}</p>
              ${p.origin.evidence ? `<p class="xs muted" style="margin:var(--space-2) 0 0">${esc(p.origin.evidence)}</p>` : ''}
            </div>`
          : ''}

        <div class="card mt-6">
          <h3>${esc(t('product.shipping'))}</h3>
          <p class="small muted">${esc(t('product.shippingHint'))}</p>
          <div class="row" style="gap:var(--space-2);align-items:flex-end">
            <div class="field" style="flex:1;margin-bottom:0">
              <label for="ship-country">${esc(t('product.shipTo'))}</label>
              <select id="ship-country">${pays.map((c) => `<option value="${esc(c.code)}"${c.code === (session.user?.countryCode ?? '') ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
            </div>
            <button class="btn btn-secondary" data-estimate="${esc(p.id)}" data-weight="${p.weightGrams}" data-origin="${esc(p.countryCode)}" data-currency="${esc(p.currency)}">${esc(t('product.estimate'))}</button>
          </div>
          <div id="ship-estimate" class="small mt-6"></div>
        </div>

        <div class="card mt-6">
          <h3>${esc(t('product.availabilityTitle'))}</h3>
          <p class="small muted">
            ${esc(t('product.availabilityHint'))}
          </p>
          <div class="row" style="gap:var(--space-2);align-items:flex-end">
            <div class="field" style="flex:1;margin-bottom:0">
              <label for="avail-province">${esc(t('product.province'))}</label>
              <select id="avail-province">
                <option value="">${esc(t('product.chooseProvince'))}</option>
                ${(await api('/geo/provinces?country=TD')).items
                  .map((pr) => `<option value="${esc(pr.id)}">${esc(pr.name)}</option>`)
                  .join('')}
              </select>
            </div>
            <button class="btn btn-secondary" data-availability="${esc(p.id)}">${esc(t('product.check'))}</button>
          </div>
          <div id="availability-result" class="small mt-6"></div>
        </div>
      </div>
    </div>

    <section class="section mt-8">
      <h2>${esc(t('product.description'))}</h2>
      <div class="card"><p style="white-space:pre-line;margin:0">${esc(p.description) || esc(t('product.noDescription'))}</p></div>
    </section>

    <section class="section">
      <h2>${esc(t('product.specs'))}</h2>
      <div class="card">
        <dl class="spec-list">
          ${p.brand ? `<div><dt>${esc(t('product.brand'))}</dt><dd>${esc(p.brand)}</dd></div>` : ''}
          ${p.sku ? `<div><dt>${esc(t('product.reference'))}</dt><dd>${esc(p.sku)}</dd></div>` : ''}
          <div><dt>Pays d'expédition</dt><dd>${esc(p.countryCode)}</dd></div>
          <div><dt>${esc(t('product.weight'))}</dt><dd>${(p.weightGrams / 1000).toFixed(2)} kg</dd></div>
          <div><dt>${esc(t('product.minOrderQty'))}</dt><dd>${p.minOrderQty}</dd></div>
          <div><dt>${esc(t('product.category'))}</dt><dd>${esc(p.category?.name ?? '—')}</dd></div>
        </dl>
      </div>
    </section>

    <section class="section">
      <h2>Avis (${p.ratingCount})</h2>
      <div class="card">
        ${p.reviews.length
          ? p.reviews
              .map(
                (r) => `<div style="padding:var(--space-3) 0;border-bottom:1px solid var(--border)">
                  ${stars(r.rating, 1)}
                  <div class="small"><strong>${esc(r.author?.name ?? 'Acheteur')}</strong> · <span class="muted">${formatDate(r.createdAt)}</span></div>
                  ${r.comment ? `<p class="small" style="margin:var(--space-1) 0 0">${esc(r.comment)}</p>` : ''}
                </div>`,
              )
              .join('')
          : `<p class="muted small" style="margin:0">${esc(t('product.noReviews'))}</p>`}
      </div>
    </section>`;
}

// ── Boutiques ──────────────────────────────────────────────────────────────
export async function stores(_params, query) {
  const search = new URLSearchParams();
  if (query.get('q')) search.set('q', query.get('q'));
  if (query.get('page')) search.set('page', query.get('page'));
  if (query.get('verified')) search.set('verified', query.get('verified'));
  const result = await api(`/stores?${search.toString()}`);
  const hrefFor = (page) => {
    const next = new URLSearchParams(query);
    next.set('page', String(page));
    return `/touma/boutiques?${next.toString()}`;
  };

  return `
    ${breadcrumb([{ label: t('nav.home'), href: '/touma/' }, { label: t('stores.title') }])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div><h1 style="margin-bottom:2px">${esc(t('stores.title'))}</h1><p class="muted small" style="margin:0">${esc(
        t('stores.count', { count: result.total }),
      )}</p></div>
      <div class="chip-row">
        <a class="chip" href="/touma/boutiques" data-link aria-current="${!query.get('verified')}">${esc(t('stores.all'))}</a>
        <a class="chip" href="/touma/boutiques?verified=true" data-link aria-current="${query.get('verified') === 'true'}">${esc(
          t('stores.verifiedOnly'),
        )}</a>
      </div>
    </div>
    ${result.items.length
      ? `<div class="grid grid-cards">${result.items.map(storeCard).join('')}</div>${pagination(result, hrefFor)}`
      : emptyState({ title: t('stores.emptyTitle'), body: t('stores.emptyBody'), iconName: 'store' })}`;
}

/** Libellés des paliers de réputation. Un palier n'est jamais une garantie. */
const niveauReputation = (code) => t(`rep.level.${code}`);

const percent = (value) => `${Math.round(value * 100)} %`;

/** Un délai mesuré à quelques minutes se lit mieux ainsi que « 0.0 h ». */
const delay = (value, unit) => {
  if (value === null) return null;
  if (value < 1) return t(unit === 'h' ? 'rep.lessThanHour' : 'rep.lessThanDay');
  return t(unit === 'h' ? 'rep.hours' : 'rep.days', { value: value.toFixed(1) });
};

/**
 * Bloc de réputation. Tant que le volume est insuffisant, on le dit — afficher
 * « 100 % de livraisons à l'heure » sur deux ventes tromperait l'acheteur.
 */
function reputationBlock(r) {
  if (!r?.published) {
    return `<div class="card" style="box-shadow:none">
      <h2 style="font-size:var(--text-md)">${esc(t('rep.title'))}</h2>
      <p class="small muted" style="margin:0">${esc(
        t('rep.notEnough', { minimum: r?.minimumOrders ?? 5, delivered: r?.ordersDelivered ?? 0 }),
      )}</p>
    </div>`;
  }

  const m = r.metrics;
  const rows = [
    m.onTimeRate !== null ? [t('rep.onTime'), percent(m.onTimeRate)] : null,
    m.avgPreparationHours !== null ? [t('rep.avgPreparation'), delay(m.avgPreparationHours, 'h')] : null,
    m.avgDeliveryDays !== null ? [t('rep.avgDelivery'), delay(m.avgDeliveryDays, 'j')] : null,
    m.cancellationRate !== null ? [t('rep.cancelled'), percent(m.cancellationRate)] : null,
    m.disputeRate !== null ? [t('rep.disputes'), percent(m.disputeRate)] : null,
    m.returnRate !== null ? [t('rep.returns'), percent(m.returnRate)] : null,
    m.responseRate !== null ? [t('rep.answered'), percent(m.responseRate)] : null,
    m.medianResponseHours !== null ? [t('rep.medianResponse'), delay(m.medianResponseHours, 'h')] : null,
  ].filter(Boolean);

  return `<div class="card" style="box-shadow:none">
    <div class="card-head">
      <h2 style="font-size:var(--text-md)">${esc(t('rep.title'))}</h2>
      <span class="badge badge-verified">${esc(niveauReputation(r.level))} · ${r.score}/100</span>
    </div>
    <dl class="spec-list">
      ${rows.map(([labelText, value]) => `<div><dt>${esc(labelText)}</dt><dd>${esc(value)}</dd></div>`).join('')}
    </dl>
    <p class="xs muted" style="margin:var(--space-3) 0 0">${esc(t('rep.computedOn', { count: r.ordersDelivered }))}</p>
  </div>`;
}

export async function store(params) {
  const s = await api(`/stores/${params.slug}`);
  const [products, reputation] = await Promise.all([
    api(`/products?store=${s.id}&limit=24`),
    // La réputation est publique : elle aide justement à décider avant de s'inscrire.
    api(`/reputation/store/${s.id}`).catch(() => null),
  ]);
  const initial = (s.name || 'T').trim().charAt(0).toUpperCase();

  return `
    ${breadcrumb([{ label: t('nav.home'), href: '/touma/' }, { label: t('store.crumb'), href: '/touma/boutiques' }, { label: s.name }])}
    <div class="card card-flush">
      <div class="store-banner">${s.bannerUrl ? `<img src="${esc(s.bannerUrl)}" alt="" />` : ''}</div>
      <div class="store-head">
        <span class="store-logo">${s.logoUrl ? `<img src="${esc(s.logoUrl)}" alt="" />` : esc(initial)}</span>
        <div style="flex:1;min-width:0">
          <h1 style="font-size:var(--text-xl);margin-bottom:var(--space-1)">${esc(s.name)}</h1>
          <div class="product-meta">
            <span class="badge badge-country">${esc(s.countryCode)}${s.city ? ` · ${esc(s.city)}` : ''}</span>
            ${
              s.verificationStatus === 'APPROVED'
                ? `<span class="badge badge-verified">${esc(t('store.verified'))}</span>`
                : `<span class="badge">${esc(t('store.verifying'))}</span>`
            }
            ${reputation?.published ? `<span class="badge badge-verified">${esc(niveauReputation(reputation.level))} · ${reputation.score}/100</span>` : ''}
            ${stars(s.ratingAverage, s.ratingCount)}
          </div>
        </div>
      </div>
      <div style="padding:0 var(--space-5) var(--space-5)">
        ${s.description ? `<p class="small">${esc(s.description)}</p>` : ''}
        <div class="grid grid-stats">
          <div class="stat-card"><div class="stat-label">${esc(t('store.productsOnline'))}</div><div class="stat-value">${s.productCount}</div></div>
          <div class="stat-card"><div class="stat-label">${esc(t('store.salesMade'))}</div><div class="stat-value">${s.salesCount}</div></div>
          <div class="stat-card"><div class="stat-label">${esc(t('store.reviews'))}</div><div class="stat-value">${s.ratingCount}</div></div>
          <div class="stat-card"><div class="stat-label">${esc(t('store.memberSince'))}</div><div class="stat-value" style="font-size:var(--text-md)">${formatDate(s.createdAt)}</div></div>
        </div>
        <div class="mt-6">${reputationBlock(reputation)}</div>
      </div>
    </div>

    <section class="section mt-8">
      <div class="section-head"><h2>${esc(t('store.productsCount', { count: products.total }))}</h2></div>
      ${products.items.length
        ? `<div class="grid grid-products">${products.items.map((p) => productCard(p)).join('')}</div>`
        : emptyState({ title: t('store.noProductTitle'), body: t('store.noProductBody'), iconName: 'box' })}
    </section>`;
}

// ── Panier ─────────────────────────────────────────────────────────────────
/**
 * Anomalies d'une ligne de panier. Le serveur les renvoie sous forme de code :
 * elles passent donc par le dictionnaire, comme les statuts de commande.
 */
const issueLabel = (code) => t(`cart.issue.${code}`);

export async function cart() {
  const data = await api('/cart');
  if (!data.items.length) {
    return `<h1>${esc(t('cart.title'))}</h1>${emptyState({
      title: t('cart.emptyTitle'),
      body: t('cart.emptyBody'),
      actionLabel: t('cart.emptyAction'),
      actionHref: '/touma/produits',
      iconName: 'cart',
    })}`;
  }

  return `
    <h1>${esc(t('cart.title'))}</h1>
    <p class="muted small">${esc(t('cart.summaryCount', { items: data.itemCount, stores: data.stores.length }))}</p>

    <div class="grid grid-2 mt-6">
      <div class="stack">
        ${data.stores
          .map(
            (group) => `<section class="card">
              <div class="card-head">
                <h2 style="font-size:var(--text-md)">${esc(group.store.name)}</h2>
                <span class="badge badge-country">${esc(group.store.countryCode)}</span>
              </div>
              ${group.items
                .map(
                  (item) => `<div class="cart-line">
                    <a class="cart-thumb" href="/touma/produits/${esc(item.slug)}" data-link>${productImage(item.image, item.title)}</a>
                    <div>
                      <a href="/touma/produits/${esc(item.slug)}" data-link><strong>${esc(item.title)}</strong></a>
                      ${item.variantName ? `<div class="small muted">${esc(item.variantName)}</div>` : ''}
                      <div class="small muted">${esc(t('cart.unitPrice', { price: money(item.unitPrice, item.currency) }))} · ${esc(t('cart.inStock', { count: item.stock }))}</div>
                      ${item.issues.map((i) => `<div class="small"><span class="badge badge-warn">${esc(issueLabel(i))}</span></div>`).join('')}
                      <div class="cart-line-actions">
                        <div class="qty">
                          <button type="button" data-qty="-1" data-item="${esc(item.id)}" aria-label="${esc(t('cart.decrease'))}">−</button>
                          <input type="number" min="0" value="${item.quantity}" data-item-input="${esc(item.id)}" aria-label="${esc(t('cart.quantityFor', { title: item.title }))}" />
                          <button type="button" data-qty="1" data-item="${esc(item.id)}" aria-label="${esc(t('cart.increase'))}">+</button>
                        </div>
                        <strong>${money(item.lineTotal, item.currency)}</strong>
                        <button class="btn btn-ghost btn-sm" data-remove-item="${esc(item.id)}">${esc(t('cart.remove'))}</button>
                      </div>
                    </div>
                  </div>`,
                )
                .join('')}
              <div class="summary-line mt-6"><span class="muted">${esc(t('cart.subtotalFor', { store: group.store.name }))}</span><strong>${money(group.subtotal, group.currency)}</strong></div>
            </section>`,
          )
          .join('')}
        <button class="btn btn-ghost btn-sm" data-clear-cart>${esc(t('cart.clear'))}</button>
      </div>

      <aside>
        <div class="card buybox">
          <h2 style="font-size:var(--text-md)">${esc(t('cart.recap'))}</h2>
          <div class="summary">
            <div class="summary-line"><span>${esc(t('cart.itemsLine', { count: data.itemCount }))}</span><span>${money(data.subtotal, data.currency)}</span></div>
            <div class="summary-line"><span>${esc(t('cart.shipping'))}</span><span class="muted small">${esc(t('cart.shippingLater'))}</span></div>
            <div class="summary-line summary-total"><span>${esc(t('cart.subtotal'))}</span><span>${money(data.subtotal, data.currency)}</span></div>
          </div>
          ${data.checkoutReady
            ? `<a class="btn btn-accent btn-block btn-lg mt-6" href="/touma/checkout" data-link>${esc(t('cart.checkout'))}</a>`
            : `<div class="alert alert-warning mt-6">${esc(t('cart.fixIssues'))}</div>`}
          <p class="xs muted mt-6" style="margin-bottom:0">${esc(t('cart.onePerStore'))}</p>
        </div>
      </aside>
    </div>`;
}

// ── Tunnel de commande ─────────────────────────────────────────────────────
const checkoutSteps = () => [t('checkout.step.address'), t('checkout.step.shipping'), t('checkout.step.payment'), t('checkout.step.done')];

/** État du tunnel, conservé le temps de la session de navigation. */
export const checkoutState = {
  step: 0,
  addressId: null,
  quotes: {},
  orders: [],
  group: null,
  deliveryMethod: 'HOME',
  pickupPointId: null,
  /** Code de réduction validé par le serveur, et remise annoncée. */
  coupon: null,
  loyaltyPoints: 0,
  loyaltyValue: 0,
  /** Transport retenu à l'étape 2, pour l'afficher aussi à l'étape paiement. */
  shippingTotal: null,
};

export async function checkout(_params, query) {
  const step = Number(query.get('etape') ?? checkoutState.step ?? 0);
  const [data, me, countries] = await Promise.all([api('/cart'), api('/auth/me'), api('/countries')]);

  if (!data.items.length && step < 3) {
    return `<h1>${esc(t('checkout.title'))}</h1>${emptyState({
      title: t('checkout.emptyTitle'),
      body: t('checkout.emptyBody'),
      actionLabel: t('checkout.emptyAction'),
      actionHref: '/touma/produits',
      iconName: 'cart',
    })}`;
  }

  const header = `<h1>${esc(t('checkout.title'))}</h1>${stepper(checkoutSteps(), step)}`;

  // Étape 1 — adresse et mode de remise
  if (step === 0) {
    const buyerCountry = me.addresses[0]?.countryCode ?? me.countryCode ?? '';
    const pickupPoints = buyerCountry ? await api(`/pickup-points?country=${buyerCountry}`) : { items: [] };
    return `${header}
      <div class="grid grid-2">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('checkout.whereToDeliver'))}</h2>
          ${me.addresses.length
            ? `<div class="stack" id="address-list">
                ${me.addresses
                  .map(
                    (a, i) => `<label class="check" data-selected="${checkoutState.addressId ? checkoutState.addressId === a.id : i === 0}">
                      <input type="radio" name="address" value="${esc(a.id)}" ${(checkoutState.addressId ? checkoutState.addressId === a.id : i === 0) ? 'checked' : ''} />
                      <span>
                        <strong>${esc(a.fullName)}</strong><br />
                        ${esc(a.line1)}${a.line2 ? `, ${esc(a.line2)}` : ''}<br />
                        ${esc(a.city)}${a.region ? `, ${esc(a.region)}` : ''} — ${esc(a.countryCode)}<br />
                        <span class="small muted">${esc(a.phone)}</span>
                      </span>
                    </label>`,
                  )
                  .join('')}
              </div>`
            : `<p class="muted small">${esc(t('checkout.noAddress'))}</p>`}

          <details ${me.addresses.length ? '' : 'open'} style="margin-top:var(--space-4)">
            <summary class="strong">${esc(t('checkout.addAddress'))}</summary>
            <form id="address-form" style="margin-top:var(--space-4)">
              <div class="field"><label for="a-name">${esc(t('checkout.fullName'))}</label><input id="a-name" name="fullName" required autocomplete="name" /></div>
              <div class="field"><label for="a-phone">${esc(t('checkout.phone'))}</label><input id="a-phone" name="phone" required inputmode="tel" placeholder="+235…" autocomplete="tel" /></div>
              <div class="field"><label for="a-line1">${esc(t('checkout.line1'))}</label><input id="a-line1" name="line1" required autocomplete="address-line1" /></div>
              <div class="field">
                <label for="a-district">${esc(t('checkout.district'))}</label>
                <input id="a-district" name="district" placeholder="${esc(t('order.districtPlaceholder'))}" />
                <span class="field-hint">${esc(t('checkout.districtHint'))}</span>
              </div>
              <div class="field">
                <label for="a-landmark">${esc(t('checkout.landmark'))}</label>
                <input id="a-landmark" name="landmark" placeholder="${esc(t('checkout.landmarkPlaceholder'))}" />
              </div>
              <div class="field"><label for="a-city">${esc(t('checkout.city'))}</label><input id="a-city" name="city" required autocomplete="address-level2" /></div>
              <div class="field"><label for="a-country">${esc(t('checkout.country'))}</label>
                <select id="a-country" name="countryCode">${countries.items.map((c) => `<option value="${esc(c.code)}"${c.code === me.countryCode ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
              </div>
              <div class="field"><label for="a-instructions">${esc(t('checkout.instructions'))}</label><input id="a-instructions" name="instructions" placeholder="${esc(t('checkout.instructionsPlaceholder'))}" /></div>
              <button class="btn btn-secondary" type="submit">${esc(t('checkout.saveAddress'))}</button>
            </form>
          </details>
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('checkout.deliveryMode'))}</h2>
          <div class="stack">
            <label class="check" data-selected="true">
              <input type="radio" name="delivery" value="HOME" checked />
              <span><strong>${esc(t('checkout.home'))}</strong><br /><span class="small muted">${esc(t('checkout.homeHint'))}</span></span>
            </label>
            <label class="check" ${pickupPoints.items.length ? '' : 'aria-disabled="true"'}>
              <input type="radio" name="delivery" value="PICKUP_POINT" ${pickupPoints.items.length ? '' : 'disabled'} />
              <span><strong>${esc(t('checkout.pickup'))}</strong><br /><span class="small muted">
                ${esc(pickupPoints.items.length ? t('checkout.pickupHint') : t('checkout.pickupNone'))}
              </span></span>
            </label>
          </div>
          <div class="field mt-6" id="pickup-choice" hidden>
            <label for="pickup-point">${esc(t('checkout.pickupPoint'))}</label>
            <select id="pickup-point">
              ${pickupPoints.items
                .map(
                  (p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${esc(p.city)}${p.district ? ` (${esc(p.district)})` : ''}${p.openingHours ? ` · ${esc(p.openingHours)}` : ''}</option>`,
                )
                .join('')}
            </select>
            <span class="field-hint">${esc(t('checkout.pickupNotice'))}</span>
          </div>
        </section>

      </div>
      <div class="card buybox mt-6">
        ${summaryBlock(data)}
        <button class="btn btn-accent btn-block btn-lg mt-6" data-checkout-next="1" ${me.addresses.length ? '' : 'disabled'}>${esc(t('checkout.toShipping'))}</button>
      </div>`;
  }

  // Étape 2 — choix du transport, boutique par boutique
  if (step === 1) {
    const address = me.addresses.find((a) => a.id === checkoutState.addressId) ?? me.addresses[0];
    if (!address) return `${header}<div class="alert alert-error">${esc(t('checkout.chooseAddressFirst'))}</div>`;
    checkoutState.addressId = address.id;

    const groups = await Promise.all(
      data.stores.map(async (group) => {
        // Poids réel du colis : le serveur refuse un devis établi pour un
        // colis plus léger que la commande.
        const weightGrams = Math.max(1, group.items.reduce((acc, i) => acc + (i.weightGrams ?? 1000) * i.quantity, 0));
        const quotes = await api('/shipping/quote', {
          method: 'POST',
          body: {
            origin: { countryCode: group.store.countryCode },
            destination: { countryCode: address.countryCode, city: address.city },
            weightGrams,
            currency: group.currency,
          },
        });
        return { group, quotes: quotes.items };
      }),
    );
    // Pré-sélection du tarif le moins cher.
    for (const { group, quotes } of groups) {
      if (!checkoutState.quotes[group.store.id]) checkoutState.quotes[group.store.id] = quotes[0]?.id ?? null;
    }
    // Mémorisé pour que l'étape de paiement affiche un total complet.
    checkoutState.shippingTotal = groups.reduce((acc, { group, quotes }) => {
      const chosen = quotes.find((q) => q.id === checkoutState.quotes[group.store.id]) ?? quotes[0];
      return acc + Number(chosen?.amount ?? 0);
    }, 0);

    return `${header}
      <div class="grid grid-2">
        <div class="stack">
          <div class="card">
            <h2 style="font-size:var(--text-md)">${esc(t('checkout.deliveryAddress'))}</h2>
            <p class="small" style="margin:0">${esc(address.fullName)} — ${esc(address.line1)}, ${esc(address.city)} (${esc(address.countryCode)})</p>
            <a class="small" href="/touma/checkout?etape=0" data-link>${esc(t('checkout.edit'))}</a>
          </div>
          ${groups
            .map(
              ({ group, quotes }) => `<section class="card">
                <div class="card-head">
                  <h2 style="font-size:var(--text-md)">${esc(group.store.name)}</h2>
                  <span class="badge badge-country">${esc(group.store.countryCode)} → ${esc(address.countryCode)}</span>
                </div>
                ${group.store.countryCode !== address.countryCode ? `<p class="small"><span class="badge badge-cross">${esc(t('checkout.crossBorder'))}</span></p>` : ''}
                <div class="stack">
                  ${quotes
                    .map(
                      (q) => `<label class="check" data-selected="${checkoutState.quotes[group.store.id] === q.id}">
                        <input type="radio" name="quote-${esc(group.store.id)}" value="${esc(q.id)}" data-store="${esc(group.store.id)}" ${checkoutState.quotes[group.store.id] === q.id ? 'checked' : ''} />
                        <span style="flex:1">
                          <strong>${esc(q.serviceName)}</strong><br />
                          <span class="small muted">${esc(t('checkout.eta', { min: q.etaMinDays, max: q.etaMaxDays, carrier: q.providerCode }))}</span>
                        </span>
                        <strong>${money(q.amount, q.currency)}</strong>
                      </label>`,
                    )
                    .join('')}
                </div>
              </section>`,
            )
            .join('')}
        </div>

        <aside>
          <div class="card buybox">
            ${summaryBlock(data, groups)}
            <button class="btn btn-accent btn-block btn-lg mt-6" data-checkout-next="2">${esc(t('checkout.toPayment'))}</button>
            <a class="btn btn-ghost btn-block btn-sm" href="/touma/checkout?etape=0" data-link>${esc(t('checkout.back'))}</a>
          </div>
        </aside>
      </div>`;
  }

  // Étape 3 — paiement
  if (step === 2) {
    const [providers, loyalty] = await Promise.all([api('/payments/providers'), api('/loyalty/usable').catch(() => null)]);
    const methods = providers.items[0]?.methods ?? ['MOBILE_MONEY'];
    const usable = loyalty?.usablePoints ?? 0;
    return `${header}
      <div class="grid grid-2">
        <div class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('checkout.discounts'))}</h2>
          <form id="coupon-form" class="row" style="gap:var(--space-2);align-items:flex-end">
            <div class="field" style="flex:1;margin:0">
              <label for="c-code">${esc(t('checkout.couponCode'))}</label>
              <input id="c-code" maxlength="40" placeholder="BIENVENUE10" value="${esc(checkoutState.coupon?.code ?? '')}" autocomplete="off" />
            </div>
            <button class="btn btn-secondary" type="submit">${esc(t('checkout.apply'))}</button>
          </form>
          ${checkoutState.coupon
            ? `<p class="small" style="color:var(--success);margin:var(--space-3) 0 0">
                ${esc(t('checkout.couponApplied', { label: checkoutState.coupon.label }))}${checkoutState.coupon.description ? ` — ${esc(checkoutState.coupon.description)}` : ''}.
                <button class="btn btn-ghost btn-sm" data-remove-coupon>${esc(t('checkout.removeCoupon'))}</button>
              </p>`
            : ''}

          ${usable > 0
            ? `<form id="loyalty-form" class="mt-6">
                <div class="field" style="margin:0">
                  <label for="c-points">${esc(t('checkout.loyaltyLabel', { count: usable, value: money(loyalty.value, loyalty.currency) }))}</label>
                  <div class="row" style="gap:var(--space-2)">
                    <input id="c-points" type="number" min="0" max="${usable}" step="1" value="${checkoutState.loyaltyPoints || 0}" style="flex:1" />
                    <button class="btn btn-secondary" type="submit">${esc(t('checkout.use'))}</button>
                  </div>
                  <span class="field-hint">${esc(t('checkout.loyaltyHint'))}</span>
                </div>
              </form>`
            : `<p class="xs muted" style="margin:var(--space-3) 0 0">${esc(t('checkout.loyaltyNone'))}</p>`}
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('checkout.paymentMethod'))}</h2>
          <p class="small muted">${esc(t('checkout.paymentNotice'))}</p>
          <div class="stack" id="payment-methods">
            ${methods
              .filter((m) => m !== 'MOCK')
              .map(
                (m, i) => `<label class="check" data-selected="${i === 0}">
                  <input type="radio" name="method" value="${esc(m)}" ${i === 0 ? 'checked' : ''} />
                  <span><strong>${esc(label(m))}</strong><br /><span class="small muted">${esc(paymentHint(m))}</span></span>
                </label>`,
              )
              .join('')}
          </div>
        </section>
        </div>

        <aside>
          <div class="card buybox">
            ${summaryBlock(data)}
            <button class="btn btn-accent btn-block btn-lg mt-6" data-place-order>${esc(t('checkout.pay'))}</button>
            <a class="btn btn-ghost btn-block btn-sm" href="/touma/checkout?etape=1" data-link>${esc(t('checkout.back'))}</a>
          </div>
        </aside>
      </div>`;
  }

  // Étape 4 — confirmation
  const orders = checkoutState.orders;
  const group = checkoutState.group;
  return `${header}
    <div class="card center">
      <div class="state-icon" style="background:var(--success-soft);color:var(--success)">${svg('shield')}</div>
      <h2>${esc(t('checkout.thanks'))}</h2>
      <p class="muted">${esc(orders.length > 1 ? t('checkout.severalOrders', { count: orders.length }) : t('checkout.oneOrder'))}</p>
      <div class="stack mt-6">
        ${orders
          .map(
            (o) => `<div class="row-between card" style="box-shadow:none">
              <div><strong>${esc(o.orderNumber)}</strong><div class="small muted">${money(o.total, o.currency)}</div></div>
              ${statusPill(o.status)}
              <a class="btn btn-secondary btn-sm" href="/touma/commandes/${esc(o.id)}" data-link>${esc(t('checkout.trackOrder'))}</a>
            </div>`,
          )
          .join('')}
      </div>
      <div class="row" style="justify-content:center;margin-top:var(--space-6)">
        ${group ? `<a class="btn" href="/touma/commandes/groupe/${esc(group.id)}" data-link>${esc(t('checkout.groupRecap'))}</a>` : ''}
        <a class="btn btn-secondary" href="/touma/commandes" data-link>${esc(t('checkout.myOrders'))}</a>
        <a class="btn btn-ghost" href="/touma/produits" data-link>${esc(t('checkout.keepShopping'))}</a>
      </div>
    </div>`;
}

/** Une phrase par moyen de paiement, dans la langue courante. */
function paymentHint(method) {
  return ['MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'CASH_ON_DELIVERY'].includes(method) ? t(`checkout.hint.${method}`) : '';
}

function summaryBlock(data, groups = null) {
  const shipping = groups
    ? groups.reduce((acc, { group, quotes }) => {
        const chosen = quotes.find((q) => q.id === checkoutState.quotes[group.store.id]) ?? quotes[0];
        return acc + Number(chosen?.amount ?? 0);
      }, 0)
    : // Une fois le transport choisi, il reste affiché jusqu'au paiement.
      (checkoutState.shippingTotal ?? null);
  // Les remises affichées sont celles que le serveur a calculées : l'interface
  // ne décide jamais d'un montant par elle-même.
  const couponDiscount = checkoutState.coupon && !checkoutState.coupon.onShipping ? Number(checkoutState.coupon.discount) : 0;
  const freeShipping = checkoutState.coupon?.onShipping && shipping !== null ? shipping : 0;
  const pointsValue = Number(checkoutState.loyaltyValue ?? 0);
  const discount = couponDiscount + freeShipping + pointsValue;

  const gross = shipping === null ? Number(data.subtotal) : Number(data.subtotal) + shipping;
  const total = Math.max(0, gross - discount);

  return `<h2 style="font-size:var(--text-md)">${esc(t('summary.title'))}</h2>
    <div class="summary">
      <div class="summary-line"><span>${esc(t('summary.items', { count: data.itemCount }))}</span><span>${money(data.subtotal, data.currency)}</span></div>
      <div class="summary-line">
        <span>${esc(t('summary.shipping'))}</span>
        <span>${shipping === null ? `<span class="muted small">${esc(t('summary.shippingNext'))}</span>` : money(shipping, data.currency)}</span>
      </div>
      ${couponDiscount || freeShipping
        ? `<div class="summary-line" style="color:var(--success)">
            <span>${esc(t('summary.couponCode', { code: checkoutState.coupon.code }))}</span>
            <span>− ${money(couponDiscount + freeShipping, data.currency)}</span>
          </div>`
        : ''}
      ${pointsValue
        ? `<div class="summary-line" style="color:var(--success)">
            <span>${esc(t('summary.loyaltyPoints', { count: checkoutState.loyaltyPoints }))}</span>
            <span>− ${money(pointsValue, data.currency)}</span>
          </div>`
        : ''}
      <div class="summary-line summary-total"><span>${esc(t('summary.total'))}</span><span>${money(total, data.currency)}</span></div>
    </div>`;
}

/** Récapitulatif d'un panier payé en une fois : le groupe et ses sous-commandes. */
export async function orderGroup(params) {
  const g = await api(`/orders/groups/${params.id}`);
  return `
    ${breadcrumb([{ label: t('nav.myOrders'), href: '/touma/commandes' }, { label: g.reference }])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px">${esc(t('group.title', { reference: g.reference }))}</h1>
        <p class="small muted" style="margin:0">
          ${formatDate(g.createdAt, true)} · ${esc(t('group.meta', { sellers: g.orders.length }))}${
            g.crossBorder ? esc(t('group.crossBorder')) : ''
          }
        </p>
      </div>
      ${statusPill(g.status)}
    </div>

    <div class="grid grid-2">
      <div class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('group.bySeller'))}</h2>
          <p class="small muted">${esc(t('group.bySellerHint'))}</p>
          <div class="stack" style="gap:var(--space-3)">
            ${g.orders
              .map(
                (o) => `<div class="row-between card" style="box-shadow:none">
                  <div>
                    <strong>${esc(o.store.name)}</strong>
                    <div class="small muted">${esc(
                      t('group.orderMeta', { number: o.orderNumber, items: o.itemCount, country: o.store.countryCode }),
                    )}</div>
                    ${o.shipment ? `<div class="xs muted">${esc(t('group.tracking', { number: o.shipment.trackingNumber }))}</div>` : ''}
                  </div>
                  <div class="row" style="gap:var(--space-3)">
                    ${statusPill(o.status)}
                    <strong>${money(o.total, o.currency)}</strong>
                    <a class="btn btn-secondary btn-sm" href="/touma/commandes/${esc(o.id)}" data-link>${esc(t('group.follow'))}</a>
                  </div>
                </div>`,
              )
              .join('')}
          </div>
        </section>
      </div>

      <aside class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('group.payment'))}</h2>
          <div class="summary">
            <div class="summary-line"><span>${esc(t('group.goods'))}</span><span>${money(g.itemsTotal, g.currency)}</span></div>
            <div class="summary-line"><span>${esc(t('cart.shipping'))}</span><span>${money(g.shippingTotal, g.currency)}</span></div>
            ${Number(g.discountTotal) > 0
              ? `<div class="summary-line" style="color:var(--success)"><span>${esc(t('group.discount'))}</span><span>− ${money(g.discountTotal, g.currency)}</span></div>`
              : ''}
            <div class="summary-line summary-total"><span>${esc(t('group.totalPaid'))}</span><span>${money(g.total, g.currency)}</span></div>
          </div>
          ${g.payment
            ? `<p class="row mt-6" style="gap:var(--space-2)">${statusPill(g.payment.status)}<span class="small muted">${esc(label(g.payment.method))}</span></p>`
            : `<button class="btn btn-accent btn-block mt-6" data-pay-group="${esc(g.id)}">${esc(
                t('group.pay', { amount: money(g.total, g.currency) }),
              )}</button>`}
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('group.delivery'))}</h2>
          <p class="small" style="margin:0">
            ${esc(g.shippingSnapshot?.fullName ?? '')}<br />
            ${esc(g.shippingSnapshot?.line1 ?? '')}<br />
            ${g.shippingSnapshot?.district ? `${esc(g.shippingSnapshot.district)}<br />` : ''}
            ${
              g.shippingSnapshot?.landmark
                ? `<span class="muted">${esc(t('group.landmark', { landmark: g.shippingSnapshot.landmark }))}</span><br />`
                : ''
            }
            ${esc(g.shippingSnapshot?.city ?? '')} — ${esc(g.shippingSnapshot?.countryCode ?? '')}
          </p>
          ${g.shippingSnapshot?.pickupPoint
            ? `<p class="small mt-6" style="margin-bottom:0"><span class="badge badge-country">${esc(t('group.pickupPoint'))}</span>
                <strong>${esc(g.shippingSnapshot.pickupPoint.name)}</strong> — ${esc(g.shippingSnapshot.pickupPoint.addressLine)}</p>`
            : ''}
        </section>
      </aside>
    </div>`;
}

// ── Commandes ──────────────────────────────────────────────────────────────
export async function orders(_params, query) {
  const status = query.get('statut');
  const result = await api(`/orders?scope=buyer&limit=25${status ? `&status=${status}` : ''}`);

  if (!result.items.length && !status) {
    return `<h1>${esc(t('orders.title'))}</h1>${emptyState({
      title: t('orders.emptyTitle'),
      body: t('orders.emptyBody'),
      actionLabel: t('orders.emptyAction'),
      actionHref: '/touma/produits',
      iconName: 'box',
    })}`;
  }

  const filters = ['', 'PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'COMPLETED'];
  return `
    <h1>${esc(t('orders.title'))}</h1>
    <div class="chip-row" style="margin-bottom:var(--space-5)">
      ${filters
        .map(
          (f) => `<a class="chip" href="/touma/commandes${f ? `?statut=${f}` : ''}" data-link aria-current="${(status ?? '') === f}">${f ? esc(label(f)) : esc(t('orders.filterAll'))}</a>`,
        )
        .join('')}
    </div>
    ${result.items.length
      ? `<div class="stack">
          ${result.items
            .map(
              (o) => `<article class="card">
                <div class="row-between">
                  <div>
                    <strong>${esc(o.orderNumber)}</strong>
                    ${o.crossBorder ? `<span class="badge badge-cross">${esc(t('orders.crossBorder'))}</span>` : ''}
                    <div class="small muted">${esc(o.store.name)} · ${formatDate(o.createdAt)} · ${esc(t('orders.itemCount', { count: o.itemCount }))}</div>
                  </div>
                  <div class="row" style="gap:var(--space-3)">
                    ${statusPill(o.status)}
                    <strong>${money(o.total, o.currency)}</strong>
                    <a class="btn btn-secondary btn-sm" href="/touma/commandes/${esc(o.id)}" data-link>${esc(t('orders.detail'))}</a>
                  </div>
                </div>
                ${o.shipment ? `<div class="small muted mt-6">${esc(t('orders.tracking', { number: o.shipment.trackingNumber }))} · ${esc(label(o.shipment.status))}</div>` : ''}
              </article>`,
            )
            .join('')}
        </div>`
      : emptyState({ title: t('orders.noneInStatus'), body: t('orders.tryAnotherFilter'), iconName: 'box' })}`;
}

export async function order(params) {
  const [o, documents] = await Promise.all([
    api(`/orders/${params.id}`),
    // Les documents sont émis automatiquement : leur absence n'est pas une erreur.
    api(`/documents/order/${params.id}`).catch(() => ({ items: [] })),
  ]);
  const shipment = o.shipments?.[0];
  const payment = o.payments?.[0];

  return `
    ${breadcrumb([{ label: t('nav.myOrders'), href: '/touma/commandes' }, { label: o.orderNumber }])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px">${esc(t('order.title', { number: o.orderNumber }))}</h1>
        <p class="small muted" style="margin:0">${esc(
          t('order.meta', { date: formatDate(o.createdAt, true), store: o.store.name, country: o.store.countryCode }),
        )}${o.crossBorder ? esc(t('order.crossBorder')) : ''}</p>
      </div>
      ${statusPill(o.status)}
    </div>

    <div class="grid grid-2">
      <div class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('order.tracking'))}</h2>
          ${orderTimeline(o)}
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('order.items'))}</h2>
          <div class="table-wrap" style="border:0">
            <table>
              <thead><tr><th>${esc(t('order.col.product'))}</th><th>${esc(t('order.col.qty'))}</th><th>${esc(
                t('order.col.price'),
              )}</th><th>${esc(t('order.col.total'))}</th></tr></thead>
              <tbody>
                ${o.items
                  .map(
                    (i) => `<tr>
                      <td>${esc(i.titleSnapshot)}${i.variantSnapshot ? `<div class="small muted">${esc(i.variantSnapshot)}</div>` : ''}</td>
                      <td>${i.quantity}</td><td>${money(i.unitPrice, i.currency)}</td><td>${money(i.lineTotal, i.currency)}</td>
                    </tr>`,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
          <div class="summary mt-6">
            <div class="summary-line"><span>${esc(t('cart.subtotal'))}</span><span>${money(o.subtotal, o.currency)}</span></div>
            <div class="summary-line"><span>${esc(t('cart.shipping'))}</span><span>${money(o.shippingTotal, o.currency)}</span></div>
            ${Number(o.discountTotal) > 0
              ? `<div class="summary-line" style="color:var(--success)"><span>${esc(t('group.discount'))}</span><span>− ${money(o.discountTotal, o.currency)}</span></div>`
              : ''}
            <div class="summary-line summary-total"><span>${esc(t('order.col.total'))}</span><span>${money(o.total, o.currency)}</span></div>
          </div>
        </section>

        ${['DELIVERED', 'COMPLETED'].includes(o.status)
          ? `<section class="card">
              <h2 style="font-size:var(--text-md)">${esc(t('order.reviewTitle'))}</h2>
              <form id="review-form" data-order="${esc(o.id)}">
                <div class="field"><label for="r-product">${esc(t('order.reviewProduct'))}</label>
                  <select id="r-product">${o.items.filter((i) => i.productId).map((i) => `<option value="${esc(i.productId)}">${esc(i.titleSnapshot)}</option>`).join('')}</select>
                </div>
                <div class="field"><label for="r-rating">${esc(t('order.reviewRating'))}</label>
                  <select id="r-rating">${[5, 4, 3, 2, 1]
                    .map((n) => `<option value="${n}">${esc(t('order.reviewStars', { stars: '★'.repeat(n), n }))}</option>`)
                    .join('')}</select>
                </div>
                <div class="field"><label for="r-comment">${esc(t('order.reviewComment'))}</label><textarea id="r-comment" rows="3" maxlength="2000"></textarea></div>
                <button class="btn" type="submit">${esc(t('order.reviewSubmit'))}</button>
              </form>
            </section>`
          : ''}
      </div>

      <aside class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('order.payment'))}</h2>
          ${payment
            ? `<p class="row" style="gap:var(--space-2)">${statusPill(payment.status)} <span class="small muted">${esc(label(payment.method))} · ${money(payment.amount, payment.currency)}</span></p>`
            : `<p class="muted small">${esc(t('order.noPayment'))}</p>`}
          ${o.status === 'PENDING'
            ? `<div class="field"><label for="method">${esc(t('order.methodLabel'))}</label>
                 <select id="method">
                   ${
                     // Les moyens de paiement sont des codes serveur : `label()`
                     // les traduit déjà partout, ici comme ailleurs.
                     ['MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'CASH_ON_DELIVERY']
                       .map((code) => `<option value="${code}">${esc(label(code))}</option>`)
                       .join('')
                   }
                 </select></div>
               <button class="btn btn-accent btn-block" data-pay-order="${esc(o.id)}">${esc(
                 t('order.pay', { amount: money(o.total, o.currency) }),
               )}</button>
               <button class="btn btn-ghost btn-block btn-sm mt-6" data-cancel-order="${esc(o.id)}">${esc(t('order.cancel'))}</button>`
            : ''}
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('order.delivery'))}</h2>
          <p class="small">
            ${esc(o.shippingSnapshot?.fullName ?? '')}<br />
            ${esc(o.shippingSnapshot?.line1 ?? '')}<br />
            ${esc(o.shippingSnapshot?.city ?? '')} — ${esc(o.shippingSnapshot?.countryCode ?? '')}
          </p>
          ${shipment
            ? `<div class="row" style="gap:var(--space-2)">${statusPill(shipment.status)}<span class="small muted">${esc(shipment.trackingNumber)}</span></div>
               <div class="mt-6">${trackingTimeline(shipment.events)}</div>
               ${o.status === 'DELIVERED' ? `<button class="btn btn-block" data-complete-order="${esc(o.id)}">${esc(t('order.confirmReceipt'))}</button>` : ''}`
            : `<p class="muted small">${esc(t('order.noShipment'))}</p>`}
        </section>

        ${documents.items.length
          ? `<section class="card">
              <h2 style="font-size:var(--text-md)">${esc(t('order.documents'))}</h2>
              <div class="stack" style="gap:var(--space-2)">
                ${documents.items
                  .map(
                    (doc) => `<a class="row-between" href="/touma/documents/${esc(doc.id)}" data-link style="color:inherit;text-decoration:none">
                      <span class="small"><strong>${esc(doc.title)}</strong><br /><span class="xs muted" style="font-family:var(--font-mono)">${esc(doc.number)}</span></span>
                      <span class="small">${doc.type === 'DELIVERY_NOTE' ? '' : money(doc.totalAmount, doc.currency)} →</span>
                    </a>`,
                  )
                  .join('')}
              </div>
            </section>`
          : ''}

        ${o.refunds?.length
          ? `<section class="card">
              <h2 style="font-size:var(--text-md)">${esc(t('order.refunds'))}</h2>
              <div class="stack" style="gap:var(--space-2)">
                ${o.refunds
                  .map(
                    (r) => `<div class="row-between">
                      <span class="small">${esc(r.reference)}<br /><span class="xs muted">${formatDate(r.processedAt ?? r.createdAt, true)}</span></span>
                      <span class="row" style="gap:var(--space-2)">${statusPill(r.status)}<strong>${money(r.amount, r.currency)}</strong></span>
                    </div>`,
                  )
                  .join('')}
              </div>
              <p class="small muted" style="margin:var(--space-3) 0 0">${esc(
                t('order.refundedTotal', { amount: money(o.refundedTotal, o.currency) }),
              )}</p>
            </section>`
          : ''}

        ${['DELIVERED', 'COMPLETED'].includes(o.status) && o.status !== 'REFUNDED'
          ? `<section class="card">
              <h2 style="font-size:var(--text-md)">${esc(t('order.returnTitle'))}</h2>
              <p class="small muted">${esc(t('order.returnBody'))}</p>
              <a class="btn btn-secondary btn-block btn-sm" href="/touma/retours/nouveau?commande=${esc(o.id)}" data-link>${esc(
                t('order.returnAction'),
              )}</a>
            </section>`
          : ''}

        ${['PAID', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED'].includes(o.status)
          ? `<section class="card">
              <h2 style="font-size:var(--text-md)">${esc(t('order.problemTitle'))}</h2>
              <form id="dispute-form" data-order="${esc(o.id)}">
                <div class="field"><label for="d-reason">${esc(t('order.disputeReason'))}</label>
                  <select id="d-reason">
                    ${
                      // Les motifs sont ceux du moteur de litige : mêmes codes,
                      // mêmes libellés que dans le dossier une fois ouvert.
                      ['NOT_RECEIVED', 'DAMAGED', 'NOT_AS_DESCRIBED', 'WRONG_ITEM', 'OTHER']
                        .map((code) => `<option value="${code}">${esc(t(`dispute.reason.${code}`))}</option>`)
                        .join('')
                    }
                  </select></div>
                <div class="field"><label for="d-details">${esc(t('order.disputeDetails'))}</label><textarea id="d-details" rows="3" maxlength="2000"></textarea></div>
                <button class="btn btn-secondary btn-block" type="submit">${esc(t('order.openDispute'))}</button>
              </form>
              <a class="btn btn-ghost btn-block btn-sm mt-6" href="/touma/litiges" data-link>${esc(t('order.followDisputes'))}</a>
              <a class="btn btn-ghost btn-block btn-sm" href="/touma/aide/nouveau?commande=${esc(o.id)}&sujet=ORDER" data-link>${esc(
                t('order.contactSupport'),
              )}</a>
            </section>`
          : ''}
      </aside>
    </div>`;
}

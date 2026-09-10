/**
 * TOUMA — parcours acheteur : accueil, catalogue, fiche produit, boutiques,
 * panier, tunnel de commande, commandes et suivi.
 */
import { api, esc, money, formatDate, label, session, statusPill, stars, productImage, svg, emptyState, toast } from './core.js';
import { productCard, storeCard, breadcrumb, stepper, orderTimeline, trackingTimeline, pagination, featureBlock } from './components.js';

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
          <span class="corridor-pill">🇹🇩 Tchad ↔ 🇨🇲 Cameroun · corridor pilote ouvert</span>
          <h1>Acheter et vendre entre pays africains, simplement.</h1>
          <p>
            TOUMA connecte fournisseurs, commerçants et acheteurs d'un pays à l'autre : catalogue, paiement, transport et
            suivi de bout en bout.
          </p>
          <div class="row">
            <a class="btn btn-accent btn-lg" href="/touma/produits" data-link>Explorer le catalogue</a>
            <a class="btn btn-secondary btn-lg" href="/touma/inscription" data-link>Ouvrir une boutique</a>
          </div>
        </div>
        <div class="hero-visual" aria-hidden="true">
          <div class="hero-card"><span class="feature-icon">${svg('store')}</span><span><strong>${verifiedStores.total ?? verifiedStores.items.length} boutique(s) vérifiée(s)</strong><span>Entreprises contrôlées par notre équipe</span></span></div>
          <div class="hero-card"><span class="feature-icon">${svg('box')}</span><span><strong>${latest.total} produit(s) en ligne</strong><span>Gros et détail, ${esc(corridor)}</span></span></div>
          <div class="hero-card"><span class="feature-icon">${svg('truck')}</span><span><strong>Livraison suivie</strong><span>Tarif et délai calculés pour le corridor réel</span></span></div>
        </div>
      </div>
    </section>

    ${topCategories.length
      ? `<section class="section">
          <div class="section-head"><h2>Catégories</h2><a class="small" href="/touma/produits" data-link>Tout voir</a></div>
          <div class="chip-row">
            ${topCategories.map((c) => `<a class="chip" href="/touma/produits?category=${esc(c.slug)}" data-link>${esc(c.name)} <span class="muted">${c.productCount}</span></a>`).join('')}
          </div>
        </section>`
      : ''}

    ${popular.items.length
      ? `<section class="section">
          <div class="section-head">
            <h2>Produits populaires</h2>
            <p>Les plus commandés sur le corridor</p>
          </div>
          <div class="grid grid-products">${popular.items.map((p) => productCard(p)).join('')}</div>
        </section>`
      : ''}

    ${verifiedStores.items.length
      ? `<section class="section">
          <div class="section-head">
            <h2>Boutiques vérifiées</h2>
            <a class="small" href="/touma/boutiques" data-link>Toutes les boutiques</a>
          </div>
          <div class="grid grid-cards">${verifiedStores.items.map(storeCard).join('')}</div>
        </section>`
      : ''}

    ${latest.items.length
      ? `<section class="section">
          <div class="section-head"><h2>Derniers produits publiés</h2></div>
          <div class="grid grid-products">${latest.items.map((p) => productCard(p)).join('')}</div>
        </section>`
      : emptyState({ title: 'Le catalogue démarre', body: 'Aucun produit publié pour le moment. Ouvrez une boutique et publiez le premier.', actionLabel: 'Ouvrir une boutique', actionHref: '/touma/inscription', iconName: 'store' })}

    <section class="section">
      <div class="section-head"><h2>Pourquoi TOUMA ?</h2></div>
      <div class="grid grid-cards">
        <div class="card">${featureBlock('store', 'Vendeurs identifiés', 'Chaque boutique déclare son pays, sa ville et peut faire vérifier son entreprise par notre équipe (Touma Verified).')}</div>
        <div class="card">${featureBlock('card', 'Paiement encadré', 'Le paiement est confirmé par le serveur TOUMA auprès du prestataire, jamais par le navigateur. Chaque étape est tracée.')}</div>
        <div class="card">${featureBlock('truck', 'Transport transfrontalier', 'Tarif et délai calculés pour le corridor réel, étiquette et numéro de suivi générés, colis suivi jusqu’à la livraison.')}</div>
        <div class="card">${featureBlock('shield', 'Litiges arbitrés', 'Un problème sur une commande ? Ouvrez un litige : messages, preuves et décision motivée, consignés dans un journal d’audit.')}</div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Comment ça marche ?</h2></div>
      <div class="grid grid-2">
        <div class="card">
          <h3 style="margin-bottom:var(--space-4)">Vous achetez</h3>
          <div class="steps">
            <div class="step"><div><h3>Trouvez un fournisseur</h3><p>Filtrez par pays, catégorie, prix et disponibilité.</p></div></div>
            <div class="step"><div><h3>Commandez et payez</h3><p>Le prix, le transport et le total sont affichés avant validation.</p></div></div>
            <div class="step"><div><h3>Suivez la livraison</h3><p>Numéro de suivi et étapes du colis jusqu’à réception.</p></div></div>
          </div>
        </div>
        <div class="card">
          <h3 style="margin-bottom:var(--space-4)">Vous vendez</h3>
          <div class="steps">
            <div class="step"><div><h3>Ouvrez votre boutique</h3><p>Nom, pays, ville : votre vitrine est en ligne immédiatement.</p></div></div>
            <div class="step"><div><h3>Publiez vos produits</h3><p>Prix, stock, quantité minimale de commande, variantes.</p></div></div>
            <div class="step"><div><h3>Expédiez et encaissez</h3><p>Créez l’expédition en un clic, suivez vos ventes et votre stock.</p></div></div>
          </div>
        </div>
      </div>
    </section>

    <section class="cta-band">
      <h2>Prêt à commercer entre ${esc(corridor)} ?</h2>
      <p class="muted">Créez un compte gratuitement : le même compte permet d'acheter et de vendre.</p>
      <div class="row" style="justify-content:center">
        <a class="btn btn-accent btn-lg" href="/touma/inscription" data-link>Créer mon compte</a>
        <a class="btn btn-secondary btn-lg" href="/touma/produits" data-link>Voir le catalogue</a>
      </div>
    </section>`;
}

// ── Catalogue ──────────────────────────────────────────────────────────────
export async function catalog(_params, query) {
  const search = new URLSearchParams();
  for (const key of ['q', 'category', 'country', 'store', 'minPrice', 'maxPrice', 'availability', 'sort', 'page']) {
    const value = query.get(key);
    if (value) search.set(key, value);
  }
  search.set('limit', '12');

  const [result, categories, countries] = await Promise.all([
    api(`/products?${search.toString()}`),
    api('/categories'),
    api('/countries'),
  ]);

  const opt = (value, text, current) => `<option value="${esc(value)}"${current === value ? ' selected' : ''}>${esc(text)}</option>`;
  const hrefFor = (page) => {
    const next = new URLSearchParams(query);
    next.set('page', String(page));
    return `/touma/produits?${next.toString()}`;
  };

  return `
    ${breadcrumb([{ label: 'Accueil', href: '/touma/' }, { label: 'Catalogue' }])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div>
        <h1 style="margin-bottom:2px">Catalogue</h1>
        <p class="muted small" style="margin:0">${result.total} produit(s)${query.get('q') ? ` pour « ${esc(query.get('q'))} »` : ''}</p>
      </div>
      <button class="btn btn-secondary btn-sm filters-toggle hide-desktop" data-toggle-filters>Filtrer et trier</button>
    </div>

    <div class="catalog-layout">
      <form class="card filters-panel" id="filters" aria-label="Filtres du catalogue">
        <div class="field">
          <label for="f-q">Mot-clé</label>
          <input id="f-q" name="q" type="search" value="${esc(query.get('q') || '')}" placeholder="sésame, pagne, cartons…" />
        </div>
        <div class="field">
          <label for="f-category">Catégorie</label>
          <select id="f-category" name="category">
            ${opt('', 'Toutes les catégories', query.get('category') || '')}
            ${categories.items.map((c) => opt(c.slug, `${c.name} (${c.productCount})`, query.get('category') || '')).join('')}
          </select>
        </div>
        <div class="field">
          <label for="f-country">Pays d'expédition</label>
          <select id="f-country" name="country">
            ${opt('', 'Tous les pays', query.get('country') || '')}
            ${countries.items.map((c) => opt(c.code, c.name, query.get('country') || '')).join('')}
          </select>
        </div>
        <div class="row" style="gap:var(--space-3)">
          <div class="field" style="flex:1;min-width:110px">
            <label for="f-min">Prix min.</label>
            <input id="f-min" name="minPrice" inputmode="numeric" value="${esc(query.get('minPrice') || '')}" />
          </div>
          <div class="field" style="flex:1;min-width:110px">
            <label for="f-max">Prix max.</label>
            <input id="f-max" name="maxPrice" inputmode="numeric" value="${esc(query.get('maxPrice') || '')}" />
          </div>
        </div>
        <div class="field">
          <label for="f-availability">Disponibilité</label>
          <select id="f-availability" name="availability">
            ${opt('any', 'Tous les produits', query.get('availability') || 'any')}
            ${opt('in_stock', 'En stock uniquement', query.get('availability') || 'any')}
          </select>
        </div>
        <div class="field">
          <label for="f-sort">Trier par</label>
          <select id="f-sort" name="sort">
            ${opt('recent', 'Plus récents', query.get('sort') || 'recent')}
            ${opt('popular', 'Les plus vendus', query.get('sort') || 'recent')}
            ${opt('price_asc', 'Prix croissant', query.get('sort') || 'recent')}
            ${opt('price_desc', 'Prix décroissant', query.get('sort') || 'recent')}
          </select>
        </div>
        <div class="row">
          <button class="btn btn-block" type="submit">Appliquer</button>
          ${[...query.keys()].length ? '<a class="btn btn-ghost btn-block" href="/touma/produits" data-link>Réinitialiser</a>' : ''}
        </div>
      </form>

      <div>
        ${result.items.length
          ? `<div class="grid grid-products">${result.items.map((p) => productCard(p)).join('')}</div>
             ${pagination(result, hrefFor)}`
          : emptyState({
              title: 'Aucun produit ne correspond',
              body: 'Élargissez vos critères : retirez un filtre, augmentez le prix maximum ou explorez une autre catégorie.',
              actionLabel: 'Voir tout le catalogue',
              actionHref: '/touma/produits',
              iconName: 'search',
            })}
      </div>
    </div>`;
}

// ── Fiche produit ──────────────────────────────────────────────────────────
export async function product(params) {
  const p = await api(`/products/${params.slug}`);
  const images = p.images.length ? p.images : [{ url: null, alt: p.title }];
  const verified = p.store.verificationStatus === 'APPROVED';

  return `
    ${breadcrumb([
      { label: 'Accueil', href: '/touma/' },
      { label: 'Catalogue', href: '/touma/produits' },
      { label: p.category?.name ?? 'Produit', href: p.category ? `/touma/produits?category=${p.category.slug}` : undefined },
      { label: p.title },
    ])}

    <div class="grid grid-2">
      <div class="gallery">
        <div class="gallery-main" id="gallery-main">${productImage(images[0].url, p.title)}</div>
        ${images.length > 1
          ? `<div class="gallery-thumbs" role="tablist" aria-label="Visuels du produit">
              ${images.map((img, i) => `<button type="button" data-gallery="${esc(img.url ?? '')}" aria-current="${i === 0}" aria-label="Visuel ${i + 1}">${productImage(img.url, '')}</button>`).join('')}
            </div>`
          : ''}
      </div>

      <div class="buybox">
        <h1 style="font-size:var(--text-xl)">${esc(p.title)}</h1>
        <div class="row" style="gap:var(--space-2);margin-bottom:var(--space-3)">
          <a class="badge" href="/touma/boutiques/${esc(p.store.slug)}" data-link>${svg('store')} ${esc(p.store.name)}</a>
          ${verified ? '<span class="badge badge-verified">Vendeur vérifié</span>' : '<span class="badge">Vérification en cours</span>'}
          <span class="badge badge-country">Expédié depuis ${esc(p.countryCode)}</span>
        </div>
        ${stars(p.rating, p.ratingCount)}

        <div class="price-block mt-6">
          <span class="price-lg">${money(p.price, p.currency)}</span>
          ${p.compareAtPrice ? `<span class="price-compare">${money(p.compareAtPrice, p.currency)}</span>` : ''}
        </div>
        <p class="small muted">
          ${p.inStock ? `${p.stock} unité(s) disponible(s)` : 'Rupture de stock'}
          ${p.minOrderQty > 1 ? ` · commande minimale : ${p.minOrderQty}` : ''}
        </p>

        <div class="card">
          ${p.variants.length
            ? `<div class="field">
                <label for="variant">Variante</label>
                <select id="variant">
                  ${p.variants.map((v) => `<option value="${esc(v.id)}" data-price="${esc(v.price)}" ${v.stock <= 0 ? 'disabled' : ''}>${esc(v.name)} — ${money(v.price, p.currency)}${v.stock <= 0 ? ' (épuisé)' : ''}</option>`).join('')}
                </select>
              </div>`
            : ''}
          <div class="field">
            <label for="qty">Quantité</label>
            <input id="qty" type="number" min="${p.minOrderQty}" step="1" value="${p.minOrderQty}" inputmode="numeric" />
          </div>
          <div class="row" style="gap:var(--space-2)">
            <button class="btn btn-accent btn-block" data-buy-now="${esc(p.id)}" ${p.inStock ? '' : 'disabled'}>Acheter maintenant</button>
            <button class="btn btn-secondary btn-block" data-add-to-cart="${esc(p.id)}" ${p.inStock ? '' : 'disabled'}>Ajouter au panier</button>
          </div>
        </div>

        <div class="card mt-6">
          <h3>Livraison</h3>
          <p class="small muted">Estimez le coût et le délai vers votre pays avant de commander.</p>
          <div class="row" style="gap:var(--space-2);align-items:flex-end">
            <div class="field" style="flex:1;margin-bottom:0">
              <label for="ship-country">Livrer vers</label>
              <select id="ship-country">${(await api('/countries')).items.map((c) => `<option value="${esc(c.code)}"${c.code === (session.user?.countryCode ?? '') ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
            </div>
            <button class="btn btn-secondary" data-estimate="${esc(p.id)}" data-weight="${p.weightGrams}" data-origin="${esc(p.countryCode)}" data-currency="${esc(p.currency)}">Estimer</button>
          </div>
          <div id="ship-estimate" class="small mt-6"></div>
        </div>
      </div>
    </div>

    <section class="section mt-8">
      <h2>Description</h2>
      <div class="card"><p style="white-space:pre-line;margin:0">${esc(p.description) || 'Le vendeur n’a pas encore rédigé de description.'}</p></div>
    </section>

    <section class="section">
      <h2>Caractéristiques</h2>
      <div class="card">
        <dl class="spec-list">
          ${p.brand ? `<div><dt>Marque</dt><dd>${esc(p.brand)}</dd></div>` : ''}
          ${p.sku ? `<div><dt>Référence</dt><dd>${esc(p.sku)}</dd></div>` : ''}
          <div><dt>Pays d'expédition</dt><dd>${esc(p.countryCode)}</dd></div>
          <div><dt>Poids unitaire</dt><dd>${(p.weightGrams / 1000).toFixed(2)} kg</dd></div>
          <div><dt>Quantité minimale</dt><dd>${p.minOrderQty}</dd></div>
          <div><dt>Catégorie</dt><dd>${esc(p.category?.name ?? '—')}</dd></div>
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
          : '<p class="muted small" style="margin:0">Aucun avis pour l’instant. Seuls les acheteurs ayant reçu ce produit peuvent en déposer un.</p>'}
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
    ${breadcrumb([{ label: 'Accueil', href: '/touma/' }, { label: 'Boutiques' }])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div><h1 style="margin-bottom:2px">Boutiques</h1><p class="muted small" style="margin:0">${result.total} boutique(s) active(s)</p></div>
      <div class="chip-row">
        <a class="chip" href="/touma/boutiques" data-link aria-current="${!query.get('verified')}">Toutes</a>
        <a class="chip" href="/touma/boutiques?verified=true" data-link aria-current="${query.get('verified') === 'true'}">Vérifiées</a>
      </div>
    </div>
    ${result.items.length
      ? `<div class="grid grid-cards">${result.items.map(storeCard).join('')}</div>${pagination(result, hrefFor)}`
      : emptyState({ title: 'Aucune boutique', body: 'Aucune boutique ne correspond à ce filtre.', iconName: 'store' })}`;
}

export async function store(params) {
  const s = await api(`/stores/${params.slug}`);
  const products = await api(`/products?store=${s.id}&limit=24`);
  const initial = (s.name || 'T').trim().charAt(0).toUpperCase();

  return `
    ${breadcrumb([{ label: 'Accueil', href: '/touma/' }, { label: 'Boutiques', href: '/touma/boutiques' }, { label: s.name }])}
    <div class="card card-flush">
      <div class="store-banner">${s.bannerUrl ? `<img src="${esc(s.bannerUrl)}" alt="" />` : ''}</div>
      <div class="store-head">
        <span class="store-logo">${s.logoUrl ? `<img src="${esc(s.logoUrl)}" alt="" />` : esc(initial)}</span>
        <div style="flex:1;min-width:0">
          <h1 style="font-size:var(--text-xl);margin-bottom:var(--space-1)">${esc(s.name)}</h1>
          <div class="product-meta">
            <span class="badge badge-country">${esc(s.countryCode)}${s.city ? ` · ${esc(s.city)}` : ''}</span>
            ${s.verificationStatus === 'APPROVED' ? '<span class="badge badge-verified">Vendeur vérifié</span>' : '<span class="badge">Vérification en cours</span>'}
            ${stars(s.ratingAverage, s.ratingCount)}
          </div>
        </div>
      </div>
      <div style="padding:0 var(--space-5) var(--space-5)">
        ${s.description ? `<p class="small">${esc(s.description)}</p>` : ''}
        <div class="grid grid-stats">
          <div class="stat-card"><div class="stat-label">Produits en ligne</div><div class="stat-value">${s.productCount}</div></div>
          <div class="stat-card"><div class="stat-label">Ventes réalisées</div><div class="stat-value">${s.salesCount}</div></div>
          <div class="stat-card"><div class="stat-label">Avis</div><div class="stat-value">${s.ratingCount}</div></div>
          <div class="stat-card"><div class="stat-label">Sur TOUMA depuis</div><div class="stat-value" style="font-size:var(--text-md)">${formatDate(s.createdAt)}</div></div>
        </div>
      </div>
    </div>

    <section class="section mt-8">
      <div class="section-head"><h2>Produits (${products.total})</h2></div>
      ${products.items.length
        ? `<div class="grid grid-products">${products.items.map((p) => productCard(p)).join('')}</div>`
        : emptyState({ title: 'Aucun produit publié', body: 'Cette boutique n’a pas encore mis de produit en ligne.', iconName: 'box' })}
    </section>`;
}

// ── Panier ─────────────────────────────────────────────────────────────────
const ISSUES = {
  PRODUCT_UNAVAILABLE: 'Ce produit n’est plus disponible',
  VARIANT_UNAVAILABLE: 'Cette variante n’est plus disponible',
  INSUFFICIENT_STOCK: 'Stock insuffisant',
  PRICE_CHANGED: 'Le prix a changé depuis l’ajout',
  BELOW_MIN_ORDER_QTY: 'Sous la quantité minimale de commande',
};

export async function cart() {
  const data = await api('/cart');
  if (!data.items.length) {
    return `<h1>Mon panier</h1>${emptyState({
      title: 'Votre panier est vide',
      body: 'Parcourez le catalogue pour trouver un fournisseur au Tchad ou au Cameroun.',
      actionLabel: 'Explorer le catalogue',
      actionHref: '/touma/produits',
      iconName: 'cart',
    })}`;
  }

  return `
    <h1>Mon panier</h1>
    <p class="muted small">${data.itemCount} article(s) · ${data.stores.length} boutique(s)</p>

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
                      <div class="small muted">${money(item.unitPrice, item.currency)} l'unité · ${item.stock} en stock</div>
                      ${item.issues.map((i) => `<div class="small"><span class="badge badge-warn">${esc(ISSUES[i] ?? i)}</span></div>`).join('')}
                      <div class="cart-line-actions">
                        <div class="qty">
                          <button type="button" data-qty="-1" data-item="${esc(item.id)}" aria-label="Diminuer la quantité">−</button>
                          <input type="number" min="0" value="${item.quantity}" data-item-input="${esc(item.id)}" aria-label="Quantité pour ${esc(item.title)}" />
                          <button type="button" data-qty="1" data-item="${esc(item.id)}" aria-label="Augmenter la quantité">+</button>
                        </div>
                        <strong>${money(item.lineTotal, item.currency)}</strong>
                        <button class="btn btn-ghost btn-sm" data-remove-item="${esc(item.id)}">Retirer</button>
                      </div>
                    </div>
                  </div>`,
                )
                .join('')}
              <div class="summary-line mt-6"><span class="muted">Sous-total ${esc(group.store.name)}</span><strong>${money(group.subtotal, group.currency)}</strong></div>
            </section>`,
          )
          .join('')}
        <button class="btn btn-ghost btn-sm" data-clear-cart>Vider le panier</button>
      </div>

      <aside>
        <div class="card buybox">
          <h2 style="font-size:var(--text-md)">Récapitulatif</h2>
          <div class="summary">
            <div class="summary-line"><span>Articles (${data.itemCount})</span><span>${money(data.subtotal, data.currency)}</span></div>
            <div class="summary-line"><span>Livraison</span><span class="muted small">calculée à l'étape suivante</span></div>
            <div class="summary-line summary-total"><span>Sous-total</span><span>${money(data.subtotal, data.currency)}</span></div>
          </div>
          ${data.checkoutReady
            ? `<a class="btn btn-accent btn-block btn-lg mt-6" href="/touma/checkout" data-link>Continuer vers le paiement</a>`
            : `<div class="alert alert-warning mt-6">Corrigez les lignes signalées avant de continuer.</div>`}
          <p class="xs muted mt-6" style="margin-bottom:0">Une commande distincte est créée par boutique : chaque vendeur gère sa préparation et son expédition.</p>
        </div>
      </aside>
    </div>`;
}

// ── Tunnel de commande ─────────────────────────────────────────────────────
const CHECKOUT_STEPS = ['Adresse', 'Livraison', 'Paiement', 'Confirmation'];

/** État du tunnel, conservé le temps de la session de navigation. */
export const checkoutState = { step: 0, addressId: null, quotes: {}, orders: [] };

export async function checkout(_params, query) {
  const step = Number(query.get('etape') ?? checkoutState.step ?? 0);
  const [data, me, countries] = await Promise.all([api('/cart'), api('/auth/me'), api('/countries')]);

  if (!data.items.length && step < 3) {
    return `<h1>Commande</h1>${emptyState({
      title: 'Votre panier est vide',
      body: 'Ajoutez des produits avant de passer commande.',
      actionLabel: 'Explorer le catalogue',
      actionHref: '/touma/produits',
      iconName: 'cart',
    })}`;
  }

  const header = `<h1>Commande</h1>${stepper(CHECKOUT_STEPS, step)}`;

  // Étape 1 — adresse de livraison
  if (step === 0) {
    return `${header}
      <div class="grid grid-2">
        <section class="card">
          <h2 style="font-size:var(--text-md)">Où livrer votre commande ?</h2>
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
            : '<p class="muted small">Aucune adresse enregistrée. Ajoutez-en une ci-dessous.</p>'}

          <details ${me.addresses.length ? '' : 'open'} style="margin-top:var(--space-4)">
            <summary class="strong">Ajouter une adresse</summary>
            <form id="address-form" style="margin-top:var(--space-4)">
              <div class="field"><label for="a-name">Nom complet</label><input id="a-name" name="fullName" required autocomplete="name" /></div>
              <div class="field"><label for="a-phone">Téléphone</label><input id="a-phone" name="phone" required inputmode="tel" placeholder="+235…" autocomplete="tel" /></div>
              <div class="field"><label for="a-line1">Adresse</label><input id="a-line1" name="line1" required autocomplete="address-line1" /></div>
              <div class="field"><label for="a-city">Ville</label><input id="a-city" name="city" required autocomplete="address-level2" /></div>
              <div class="field"><label for="a-country">Pays</label>
                <select id="a-country" name="countryCode">${countries.items.map((c) => `<option value="${esc(c.code)}"${c.code === me.countryCode ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
              </div>
              <button class="btn btn-secondary" type="submit">Enregistrer l'adresse</button>
            </form>
          </details>
        </section>

        <aside>
          <div class="card buybox">
            ${summaryBlock(data)}
            <button class="btn btn-accent btn-block btn-lg mt-6" data-checkout-next="1" ${me.addresses.length ? '' : 'disabled'}>Continuer vers la livraison</button>
          </div>
        </aside>
      </div>`;
  }

  // Étape 2 — choix du transport, boutique par boutique
  if (step === 1) {
    const address = me.addresses.find((a) => a.id === checkoutState.addressId) ?? me.addresses[0];
    if (!address) return `${header}<div class="alert alert-error">Choisissez d'abord une adresse de livraison.</div>`;
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

    return `${header}
      <div class="grid grid-2">
        <div class="stack">
          <div class="card">
            <h2 style="font-size:var(--text-md)">Adresse de livraison</h2>
            <p class="small" style="margin:0">${esc(address.fullName)} — ${esc(address.line1)}, ${esc(address.city)} (${esc(address.countryCode)})</p>
            <a class="small" href="/touma/checkout?etape=0" data-link>Modifier</a>
          </div>
          ${groups
            .map(
              ({ group, quotes }) => `<section class="card">
                <div class="card-head">
                  <h2 style="font-size:var(--text-md)">${esc(group.store.name)}</h2>
                  <span class="badge badge-country">${esc(group.store.countryCode)} → ${esc(address.countryCode)}</span>
                </div>
                ${group.store.countryCode !== address.countryCode ? '<p class="small"><span class="badge badge-cross">Expédition transfrontalière</span></p>' : ''}
                <div class="stack">
                  ${quotes
                    .map(
                      (q) => `<label class="check" data-selected="${checkoutState.quotes[group.store.id] === q.id}">
                        <input type="radio" name="quote-${esc(group.store.id)}" value="${esc(q.id)}" data-store="${esc(group.store.id)}" ${checkoutState.quotes[group.store.id] === q.id ? 'checked' : ''} />
                        <span style="flex:1">
                          <strong>${esc(q.serviceName)}</strong><br />
                          <span class="small muted">Livraison estimée en ${q.etaMinDays} à ${q.etaMaxDays} jours · transporteur ${esc(q.providerCode)}</span>
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
            <button class="btn btn-accent btn-block btn-lg mt-6" data-checkout-next="2">Continuer vers le paiement</button>
            <a class="btn btn-ghost btn-block btn-sm" href="/touma/checkout?etape=0" data-link>Retour</a>
          </div>
        </aside>
      </div>`;
  }

  // Étape 3 — paiement
  if (step === 2) {
    const providers = await api('/payments/providers');
    const methods = providers.items[0]?.methods ?? ['MOBILE_MONEY'];
    return `${header}
      <div class="grid grid-2">
        <section class="card">
          <h2 style="font-size:var(--text-md)">Moyen de paiement</h2>
          <p class="small muted">Le paiement est confirmé par le serveur TOUMA auprès du prestataire. Aucune donnée bancaire n'est stockée par TOUMA.</p>
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

        <aside>
          <div class="card buybox">
            ${summaryBlock(data)}
            <button class="btn btn-accent btn-block btn-lg mt-6" data-place-order>Payer et confirmer la commande</button>
            <a class="btn btn-ghost btn-block btn-sm" href="/touma/checkout?etape=1" data-link>Retour</a>
          </div>
        </aside>
      </div>`;
  }

  // Étape 4 — confirmation
  const orders = checkoutState.orders;
  return `${header}
    <div class="card center">
      <div class="state-icon" style="background:var(--success-soft);color:var(--success)">${svg('shield')}</div>
      <h2>Merci, votre commande est enregistrée</h2>
      <p class="muted">${orders.length > 1 ? `${orders.length} commandes ont été créées, une par boutique.` : 'Votre commande a été transmise au vendeur.'}</p>
      <div class="stack mt-6">
        ${orders
          .map(
            (o) => `<div class="row-between card" style="box-shadow:none">
              <div><strong>${esc(o.orderNumber)}</strong><div class="small muted">${money(o.total, o.currency)}</div></div>
              ${statusPill(o.status)}
              <a class="btn btn-secondary btn-sm" href="/touma/commandes/${esc(o.id)}" data-link>Suivre ma commande</a>
            </div>`,
          )
          .join('')}
      </div>
      <div class="row" style="justify-content:center;margin-top:var(--space-6)">
        <a class="btn" href="/touma/commandes" data-link>Mes commandes</a>
        <a class="btn btn-secondary" href="/touma/produits" data-link>Continuer mes achats</a>
      </div>
    </div>`;
}

function paymentHint(method) {
  return {
    MOBILE_MONEY: 'Paiement depuis votre portefeuille mobile.',
    CARD: 'Carte bancaire via une page sécurisée du prestataire.',
    BANK_TRANSFER: 'Virement bancaire avec référence de commande.',
    CASH_ON_DELIVERY: 'Réglez au livreur à la réception.',
  }[method] ?? '';
}

function summaryBlock(data, groups = null) {
  const shipping = groups
    ? groups.reduce((acc, { group, quotes }) => {
        const chosen = quotes.find((q) => q.id === checkoutState.quotes[group.store.id]) ?? quotes[0];
        return acc + Number(chosen?.amount ?? 0);
      }, 0)
    : null;
  const total = shipping === null ? Number(data.subtotal) : Number(data.subtotal) + shipping;

  return `<h2 style="font-size:var(--text-md)">Récapitulatif</h2>
    <div class="summary">
      <div class="summary-line"><span>Articles (${data.itemCount})</span><span>${money(data.subtotal, data.currency)}</span></div>
      <div class="summary-line">
        <span>Livraison</span>
        <span>${shipping === null ? '<span class="muted small">à l\'étape suivante</span>' : money(shipping, data.currency)}</span>
      </div>
      <div class="summary-line summary-total"><span>Total</span><span>${money(total, data.currency)}</span></div>
    </div>`;
}

// ── Commandes ──────────────────────────────────────────────────────────────
export async function orders(_params, query) {
  const status = query.get('statut');
  const result = await api(`/orders?scope=buyer&limit=25${status ? `&status=${status}` : ''}`);

  if (!result.items.length && !status) {
    return `<h1>Mes commandes</h1>${emptyState({
      title: 'Aucune commande pour l’instant',
      body: 'Vos achats et leur suivi apparaîtront ici.',
      actionLabel: 'Explorer le catalogue',
      actionHref: '/touma/produits',
      iconName: 'box',
    })}`;
  }

  const filters = ['', 'PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'COMPLETED'];
  return `
    <h1>Mes commandes</h1>
    <div class="chip-row" style="margin-bottom:var(--space-5)">
      ${filters
        .map(
          (f) => `<a class="chip" href="/touma/commandes${f ? `?statut=${f}` : ''}" data-link aria-current="${(status ?? '') === f}">${f ? esc(label(f)) : 'Toutes'}</a>`,
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
                    ${o.crossBorder ? '<span class="badge badge-cross">Transfrontalier</span>' : ''}
                    <div class="small muted">${esc(o.store.name)} · ${formatDate(o.createdAt)} · ${o.itemCount} article(s)</div>
                  </div>
                  <div class="row" style="gap:var(--space-3)">
                    ${statusPill(o.status)}
                    <strong>${money(o.total, o.currency)}</strong>
                    <a class="btn btn-secondary btn-sm" href="/touma/commandes/${esc(o.id)}" data-link>Détail</a>
                  </div>
                </div>
                ${o.shipment ? `<div class="small muted mt-6">Suivi ${esc(o.shipment.trackingNumber)} · ${esc(label(o.shipment.status))}</div>` : ''}
              </article>`,
            )
            .join('')}
        </div>`
      : emptyState({ title: 'Aucune commande dans ce statut', body: 'Essayez un autre filtre.', iconName: 'box' })}`;
}

export async function order(params) {
  const o = await api(`/orders/${params.id}`);
  const shipment = o.shipments?.[0];
  const payment = o.payments?.[0];

  return `
    ${breadcrumb([{ label: 'Mes commandes', href: '/touma/commandes' }, { label: o.orderNumber }])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px">Commande ${esc(o.orderNumber)}</h1>
        <p class="small muted" style="margin:0">${formatDate(o.createdAt, true)} · ${esc(o.store.name)} (${esc(o.store.countryCode)})${o.crossBorder ? ' · transfrontalière' : ''}</p>
      </div>
      ${statusPill(o.status)}
    </div>

    <div class="grid grid-2">
      <div class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">Suivi de la commande</h2>
          ${orderTimeline(o)}
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">Articles</h2>
          <div class="table-wrap" style="border:0">
            <table>
              <thead><tr><th>Produit</th><th>Qté</th><th>Prix</th><th>Total</th></tr></thead>
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
            <div class="summary-line"><span>Sous-total</span><span>${money(o.subtotal, o.currency)}</span></div>
            <div class="summary-line"><span>Livraison</span><span>${money(o.shippingTotal, o.currency)}</span></div>
            <div class="summary-line summary-total"><span>Total</span><span>${money(o.total, o.currency)}</span></div>
          </div>
        </section>

        ${['DELIVERED', 'COMPLETED'].includes(o.status)
          ? `<section class="card">
              <h2 style="font-size:var(--text-md)">Votre avis</h2>
              <form id="review-form" data-order="${esc(o.id)}">
                <div class="field"><label for="r-product">Produit</label>
                  <select id="r-product">${o.items.filter((i) => i.productId).map((i) => `<option value="${esc(i.productId)}">${esc(i.titleSnapshot)}</option>`).join('')}</select>
                </div>
                <div class="field"><label for="r-rating">Note</label>
                  <select id="r-rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${'★'.repeat(n)} (${n}/5)</option>`).join('')}</select>
                </div>
                <div class="field"><label for="r-comment">Commentaire (facultatif)</label><textarea id="r-comment" rows="3" maxlength="2000"></textarea></div>
                <button class="btn" type="submit">Publier mon avis</button>
              </form>
            </section>`
          : ''}
      </div>

      <aside class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">Paiement</h2>
          ${payment
            ? `<p class="row" style="gap:var(--space-2)">${statusPill(payment.status)} <span class="small muted">${esc(label(payment.method))} · ${money(payment.amount, payment.currency)}</span></p>`
            : '<p class="muted small">Aucun paiement enregistré.</p>'}
          ${o.status === 'PENDING'
            ? `<div class="field"><label for="method">Moyen de paiement</label>
                 <select id="method">
                   <option value="MOBILE_MONEY">Mobile money</option>
                   <option value="CARD">Carte bancaire</option>
                   <option value="BANK_TRANSFER">Virement bancaire</option>
                   <option value="CASH_ON_DELIVERY">Paiement à la livraison</option>
                 </select></div>
               <button class="btn btn-accent btn-block" data-pay-order="${esc(o.id)}">Payer ${money(o.total, o.currency)}</button>
               <button class="btn btn-ghost btn-block btn-sm mt-6" data-cancel-order="${esc(o.id)}">Annuler la commande</button>`
            : ''}
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">Livraison</h2>
          <p class="small">
            ${esc(o.shippingSnapshot?.fullName ?? '')}<br />
            ${esc(o.shippingSnapshot?.line1 ?? '')}<br />
            ${esc(o.shippingSnapshot?.city ?? '')} — ${esc(o.shippingSnapshot?.countryCode ?? '')}
          </p>
          ${shipment
            ? `<div class="row" style="gap:var(--space-2)">${statusPill(shipment.status)}<span class="small muted">${esc(shipment.trackingNumber)}</span></div>
               <div class="mt-6">${trackingTimeline(shipment.events)}</div>
               ${o.status === 'DELIVERED' ? `<button class="btn btn-block" data-complete-order="${esc(o.id)}">Confirmer la réception</button>` : ''}`
            : '<p class="muted small">Le vendeur n’a pas encore créé l’expédition.</p>'}
        </section>

        ${['PAID', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED'].includes(o.status)
          ? `<section class="card">
              <h2 style="font-size:var(--text-md)">Un problème ?</h2>
              <form id="dispute-form" data-order="${esc(o.id)}">
                <div class="field"><label for="d-reason">Motif</label>
                  <select id="d-reason">
                    <option value="NOT_RECEIVED">Commande non reçue</option>
                    <option value="DAMAGED">Marchandise endommagée</option>
                    <option value="NOT_AS_DESCRIBED">Non conforme à la description</option>
                    <option value="WRONG_ITEM">Mauvais article</option>
                    <option value="OTHER">Autre</option>
                  </select></div>
                <div class="field"><label for="d-details">Détails</label><textarea id="d-details" rows="3" maxlength="2000"></textarea></div>
                <button class="btn btn-secondary btn-block" type="submit">Ouvrir un litige</button>
              </form>
            </section>`
          : ''}
      </aside>
    </div>`;
}

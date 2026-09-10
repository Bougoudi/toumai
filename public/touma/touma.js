/**
 * TOUMA — application de la place de marché (acheteur, vendeur, administration).
 *
 * Vanilla JS en modules, sans dépendance : l'application est servie par la même
 * origine que l'API et respecte la politique de sécurité du contenu (aucun
 * script ni gestionnaire d'événement en ligne).
 */

const API = '/api/v1';
const STORAGE = 'touma.session';

// ── Session ────────────────────────────────────────────────────────────────
const session = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE) || 'null');
    } catch {
      return null;
    }
  },
  set(value) {
    localStorage.setItem(STORAGE, JSON.stringify(value));
    renderHeader();
  },
  clear() {
    localStorage.removeItem(STORAGE);
    renderHeader();
  },
  get user() {
    return this.get()?.user ?? null;
  },
  get role() {
    return this.get()?.user?.role ?? null;
  },
};

// ── Client API ─────────────────────────────────────────────────────────────
/** Appelle l'API ; renouvelle le jeton d'accès une fois en cas d'expiration. */
async function call(path, { method = 'GET', body, retry = true } = {}) {
  const current = session.get();
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (current?.accessToken) headers.authorization = `Bearer ${current.accessToken}`;

  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

  if (res.status === 401 && retry && current?.refreshToken) {
    const refreshed = await refresh(current.refreshToken);
    if (refreshed) return call(path, { method, body, retry: false });
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const error = new Error(data?.error || `Erreur ${res.status}`);
    error.status = res.status;
    error.details = data?.details;
    throw error;
  }
  return data;
}

async function refresh(refreshToken) {
  try {
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      session.clear();
      return false;
    }
    const data = await res.json();
    session.set({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
    return true;
  } catch {
    return false;
  }
}

// ── Utilitaires d'affichage ────────────────────────────────────────────────
/**
 * Conteneur de la vue courante. Chaque navigation crée un conteneur neuf et le
 * monte immédiatement : un rendu lent déclenché par une navigation précédente
 * écrit alors dans un conteneur détaché et ne peut plus écraser l'écran actuel.
 */
let activeView = document.getElementById('view');
const view = () => activeView;

/** Monte un conteneur neuf pour la navigation en cours et le renvoie. */
function openView() {
  const container = document.createElement('div');
  document.getElementById('view').replaceChildren(container);
  activeView = container;
  return container;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Formate un montant décimal (chaîne) selon sa devise. Aucune conversion. */
function fmt(amount, currency) {
  const decimals = ['XAF', 'XOF'].includes(currency) ? 0 : 2;
  const n = Number(amount ?? 0);
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${currency ?? ''}`.trim();
}

const dateFmt = (value) => (value ? new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const status = (value) => `<span class="status ${esc(value)}">${esc(value)}</span>`;

function toast(message, kind = '') {
  const stack = document.getElementById('toasts');
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  stack.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

function loading(label = 'Chargement…') {
  view().innerHTML = `<div class="state"><div class="skeleton block"></div><p class="muted" style="margin-top:16px">${esc(label)}</p></div>`;
}

function errorState(err) {
  view().innerHTML = `<div class="state"><strong>Une erreur est survenue</strong><p>${esc(err.message)}</p>
    <p><a class="btn btn-secondary" href="#/">Retour à l'accueil</a></p></div>`;
}

function requireLogin(next) {
  if (!session.user) {
    location.hash = `#/connexion?suite=${encodeURIComponent(next || location.hash)}`;
    return false;
  }
  return true;
}

/** Récupère les paramètres de la route courante (#/chemin?clé=valeur). */
function routeParts() {
  const raw = location.hash.slice(2) || '';
  const [path, query] = raw.split('?');
  return { segments: path.split('/').filter(Boolean), params: new URLSearchParams(query || '') };
}

function productCard(p) {
  const image = p.image
    ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" />`
    : 'Photo à venir';
  return `<article class="card product-card">
    <a href="#/produits/${esc(p.slug || p.id)}">
      <div class="thumb">${image}</div>
      <div class="product-body">
        <span class="product-title">${esc(p.title)}</span>
        <span class="price">${fmt(p.price, p.currency)}${p.minOrderQty > 1 ? ` <small>· min. ${p.minOrderQty}</small>` : ''}</span>
        <span class="small muted">${esc(p.store?.name ?? '')} · ${esc(p.countryCode)}</span>
        <span class="row small">
          ${p.store?.verificationStatus === 'APPROVED' ? '<span class="tag verified">Vendeur vérifié</span>' : ''}
          ${p.inStock ? '' : '<span class="tag warn">Rupture</span>'}
        </span>
      </div>
    </a>
  </article>`;
}

function pagination(page, target) {
  if (!page || page.pages <= 1) return '';
  return `<nav class="pagination">
    <button class="btn-secondary btn-small" data-page="${page.page - 1}" data-target="${target}" ${page.page <= 1 ? 'disabled' : ''}>Précédent</button>
    <span class="small muted">Page ${page.page} sur ${page.pages} · ${page.total} résultat(s)</span>
    <button class="btn-secondary btn-small" data-page="${page.page + 1}" data-target="${target}" ${page.hasNext ? '' : 'disabled'}>Suivant</button>
  </nav>`;
}

// ── En-tête ────────────────────────────────────────────────────────────────
async function renderHeader() {
  const nav = document.getElementById('header-nav');
  const user = session.user;
  const links = [`<a href="#/produits">Catalogue</a>`, `<a href="#/boutiques">Boutiques</a>`];
  if (user) {
    links.push(`<a href="#/panier">Panier<span class="badge-count" id="cart-count">0</span></a>`);
    links.push(`<a href="#/commandes">Mes commandes</a>`);
    if (user.role === 'SELLER' || user.role === 'ADMIN') links.push(`<a href="#/vendeur">Espace vendeur</a>`);
    if (user.role === 'ADMIN') links.push(`<a href="#/admin">Administration</a>`);
    links.push(`<a href="#/compte" title="${esc(user.name)}">Mon compte</a>`);
    links.push(`<a href="#/deconnexion">Se déconnecter</a>`);
  } else {
    links.push(`<a href="#/connexion">Se connecter</a>`);
    links.push(`<a class="cta" href="#/inscription">Vendre sur Touma</a>`);
  }
  nav.innerHTML = links.join('');
  if (user) updateCartCount();
}

async function updateCartCount() {
  const el = document.getElementById('cart-count');
  if (!el || !session.user) return;
  try {
    const cart = await call('/cart');
    el.textContent = cart.itemCount ?? 0;
  } catch {
    el.textContent = '0';
  }
}

async function renderCorridor() {
  const bar = document.getElementById('corridor-bar');
  try {
    const { items } = await call('/countries');
    const names = items.map((c) => c.name).join(' ↔ ');
    bar.textContent = `Corridor ouvert : ${names} — les marchés suivants s'activent depuis le référentiel, sans modifier l'application.`;
  } catch {
    bar.textContent = 'Touma — commerce transfrontalier africain';
  }
}

// ── Vues acheteur ──────────────────────────────────────────────────────────
async function viewHome() {
  loading();
  const [catalogue, categories] = await Promise.all([call('/products?limit=8&sort=recent'), call('/categories')]);
  const topCategories = categories.items.filter((c) => c.productCount > 0).slice(0, 8);

  view().innerHTML = `
    <section class="hero">
      <h1>Acheter et vendre entre pays africains, simplement.</h1>
      <p>
        Touma relie fournisseurs, commerçants et acheteurs d'un pays à l'autre : catalogue vérifié, paiement encadré,
        transport orchestré et suivi de bout en bout. Le corridor pilote Tchad ↔ Cameroun ouvre la voie.
      </p>
      <div class="row">
        <a class="btn btn-accent" href="#/produits">Explorer le catalogue</a>
        <a class="btn btn-secondary" href="#/inscription">Ouvrir une boutique</a>
      </div>
      <div class="pillars">
        <div class="pillar"><strong>Touma Marketplace</strong><span>Produits B2B en gros et essentiels du quotidien.</span></div>
        <div class="pillar"><strong>Touma Pay</strong><span>Paiement confirmé côté serveur, jamais côté client.</span></div>
        <div class="pillar"><strong>Touma Logistics</strong><span>Devis, expédition et suivi transfrontalier.</span></div>
        <div class="pillar"><strong>Touma Verified</strong><span>Vendeurs vérifiés, litiges arbitrés, historique tracé.</span></div>
      </div>
    </section>

    <h2>Catégories</h2>
    <div class="row">
      ${topCategories.map((c) => `<a class="btn btn-secondary btn-small" href="#/produits?category=${esc(c.slug)}">${esc(c.name)} (${c.productCount})</a>`).join('') || '<p class="muted">Catalogue en cours de constitution.</p>'}
    </div>

    <h2>Derniers produits publiés</h2>
    <div class="grid products">${catalogue.items.map(productCard).join('') || '<p class="muted">Aucun produit pour l’instant.</p>'}</div>
    <p style="margin-top:20px"><a class="btn" href="#/produits">Voir tout le catalogue</a></p>`;
}

async function viewProducts(params) {
  loading('Chargement du catalogue…');
  const query = new URLSearchParams();
  for (const key of ['q', 'category', 'country', 'store', 'minPrice', 'maxPrice', 'availability', 'sort', 'page']) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  query.set('limit', '12');

  const [result, categories, countries] = await Promise.all([
    call(`/products?${query.toString()}`),
    call('/categories'),
    call('/countries'),
  ]);

  const option = (value, label, current) => `<option value="${esc(value)}"${current === value ? ' selected' : ''}>${esc(label)}</option>`;

  view().innerHTML = `
    <h1>Catalogue Touma</h1>
    <p class="muted">${result.total} produit(s)${params.get('q') ? ` pour « ${esc(params.get('q'))} »` : ''}.</p>
    <div class="layout">
      <form class="card" id="filters">
        <div class="field">
          <label for="f-q">Mot-clé</label>
          <input id="f-q" name="q" value="${esc(params.get('q') || '')}" placeholder="sésame, pagne…" />
        </div>
        <div class="field">
          <label for="f-category">Catégorie</label>
          <select id="f-category" name="category">
            ${option('', 'Toutes', params.get('category') || '')}
            ${categories.items.map((c) => option(c.slug, `${c.name} (${c.productCount})`, params.get('category') || '')).join('')}
          </select>
        </div>
        <div class="field">
          <label for="f-country">Pays d'expédition</label>
          <select id="f-country" name="country">
            ${option('', 'Tous', params.get('country') || '')}
            ${countries.items.map((c) => option(c.code, c.name, params.get('country') || '')).join('')}
          </select>
        </div>
        <div class="field">
          <label for="f-min">Prix minimum</label>
          <input id="f-min" name="minPrice" inputmode="numeric" value="${esc(params.get('minPrice') || '')}" />
        </div>
        <div class="field">
          <label for="f-max">Prix maximum</label>
          <input id="f-max" name="maxPrice" inputmode="numeric" value="${esc(params.get('maxPrice') || '')}" />
        </div>
        <div class="field">
          <label for="f-availability">Disponibilité</label>
          <select id="f-availability" name="availability">
            ${option('any', 'Tous les produits', params.get('availability') || 'any')}
            ${option('in_stock', 'En stock uniquement', params.get('availability') || 'any')}
          </select>
        </div>
        <div class="field">
          <label for="f-sort">Trier par</label>
          <select id="f-sort" name="sort">
            ${option('recent', 'Plus récents', params.get('sort') || 'recent')}
            ${option('price_asc', 'Prix croissant', params.get('sort') || 'recent')}
            ${option('price_desc', 'Prix décroissant', params.get('sort') || 'recent')}
            ${option('popular', 'Les plus vendus', params.get('sort') || 'recent')}
          </select>
        </div>
        <button type="submit">Filtrer</button>
      </form>

      <div>
        ${result.items.length
          ? `<div class="grid products">${result.items.map(productCard).join('')}</div>${pagination(result, 'produits')}`
          : `<div class="state"><strong>Aucun produit ne correspond</strong><p>Élargissez vos critères ou explorez une autre catégorie.</p></div>`}
      </div>
    </div>`;
}

async function viewProduct(slug) {
  loading();
  const p = await call(`/products/${slug}`);
  const variantOptions = p.variants.length
    ? `<div class="field"><label for="variant">Variante</label><select id="variant">
        ${p.variants.map((v) => `<option value="${esc(v.id)}" data-price="${esc(v.price)}" ${v.stock <= 0 ? 'disabled' : ''}>${esc(v.name)} — ${fmt(v.price, p.currency)}${v.stock <= 0 ? ' (épuisé)' : ''}</option>`).join('')}
      </select></div>`
    : '';

  view().innerHTML = `
    <p class="small muted"><a href="#/produits">Catalogue</a> › ${esc(p.category?.name ?? 'Produit')}</p>
    <div class="grid two">
      <div class="card" style="padding:0;overflow:hidden">
        <div class="thumb" style="aspect-ratio:1">${p.images[0] ? `<img src="${esc(p.images[0].url)}" alt="${esc(p.title)}" />` : 'Photo à venir'}</div>
      </div>
      <div>
        <h1>${esc(p.title)}</h1>
        <p class="row">
          <a href="#/boutiques/${esc(p.store.slug)}">${esc(p.store.name)}</a>
          ${p.store.verificationStatus === 'APPROVED' ? '<span class="tag verified">Vendeur vérifié</span>' : '<span class="tag">Vérification en cours</span>'}
          <span class="tag">Expédié depuis ${esc(p.countryCode)}</span>
        </p>
        <p class="price" style="font-size:26px">${fmt(p.price, p.currency)}</p>
        <p class="small muted">
          ${p.inStock ? `${p.stock} unité(s) disponible(s)` : 'Rupture de stock'}
          ${p.minOrderQty > 1 ? ` · commande minimale : ${p.minOrderQty}` : ''}
          · poids unitaire ${(p.weightGrams / 1000).toFixed(2)} kg
        </p>
        <div class="card" style="margin-top:16px">
          ${variantOptions}
          <div class="field">
            <label for="qty">Quantité</label>
            <input id="qty" type="number" min="${p.minOrderQty}" step="1" value="${p.minOrderQty}" />
          </div>
          <button id="add-to-cart" data-product="${esc(p.id)}" ${p.inStock ? '' : 'disabled'}>Ajouter au panier</button>
          <p class="small muted" style="margin-bottom:0">Paiement encadré par Touma Pay · livraison suivie par Touma Logistics.</p>
        </div>
      </div>
    </div>

    <h2>Description</h2>
    <div class="card"><p style="white-space:pre-line;margin:0">${esc(p.description) || 'Aucune description fournie.'}</p></div>

    <h2>Avis (${p.reviews.length})</h2>
    <div class="card">
      ${p.reviews.length
        ? p.reviews.map((r) => `<p><strong>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</strong> — ${esc(r.author?.name ?? 'Acheteur')} <span class="small muted">${dateFmt(r.createdAt)}</span><br />${esc(r.comment ?? '')}</p>`).join('<hr style="border:0;border-top:1px solid #e7dfd0" />')
        : '<p class="muted" style="margin:0">Aucun avis pour l’instant. Seuls les acheteurs livrés peuvent en déposer.</p>'}
    </div>`;
}

async function viewStores(params) {
  loading();
  const query = new URLSearchParams();
  if (params.get('q')) query.set('q', params.get('q'));
  if (params.get('page')) query.set('page', params.get('page'));
  const result = await call(`/stores?${query.toString()}`);
  view().innerHTML = `
    <h1>Boutiques</h1>
    <p class="muted">${result.total} boutique(s) active(s) sur le corridor.</p>
    <div class="grid two">
      ${result.items.map((s) => `<article class="card">
        <h3><a href="#/boutiques/${esc(s.slug)}">${esc(s.name)}</a></h3>
        <p class="row small">
          <span class="tag">${esc(s.countryCode)}${s.city ? ` · ${esc(s.city)}` : ''}</span>
          ${s.verificationStatus === 'APPROVED' ? '<span class="tag verified">Vérifiée</span>' : ''}
        </p>
        <p class="small">${esc(s.description ?? '')}</p>
      </article>`).join('') || '<p class="muted">Aucune boutique pour l’instant.</p>'}
    </div>
    ${pagination(result, 'boutiques')}`;
}

async function viewStore(slug) {
  loading();
  const store = await call(`/stores/${slug}`);
  const products = await call(`/products?store=${store.id}&limit=24`);
  view().innerHTML = `
    <div class="card">
      <div class="spread">
        <div>
          <h1 style="margin-bottom:4px">${esc(store.name)}</h1>
          <p class="row small">
            <span class="tag">${esc(store.countryCode)}${store.city ? ` · ${esc(store.city)}` : ''}</span>
            ${store.verificationStatus === 'APPROVED' ? '<span class="tag verified">Vendeur vérifié Touma</span>' : '<span class="tag">Vérification en cours</span>'}
            <span class="tag">${store.ratingCount} avis · ${Number(store.ratingAverage).toFixed(1)}/5</span>
          </p>
        </div>
      </div>
      <p>${esc(store.description ?? '')}</p>
    </div>
    <h2>Produits (${products.total})</h2>
    <div class="grid products">${products.items.map(productCard).join('') || '<p class="muted">Cette boutique n’a pas encore publié de produit.</p>'}</div>`;
}

// ── Panier & commande ──────────────────────────────────────────────────────
async function viewCart() {
  if (!requireLogin('#/panier')) return;
  loading();
  const cart = await call('/cart');
  updateCartCount();

  if (!cart.items.length) {
    view().innerHTML = `<h1>Votre panier</h1>
      <div class="state"><strong>Votre panier est vide</strong><p>Parcourez le catalogue pour trouver un fournisseur.</p>
      <a class="btn" href="#/produits">Voir le catalogue</a></div>`;
    return;
  }

  const issueLabels = {
    PRODUCT_UNAVAILABLE: 'Produit indisponible',
    VARIANT_UNAVAILABLE: 'Variante indisponible',
    INSUFFICIENT_STOCK: 'Stock insuffisant',
    PRICE_CHANGED: 'Le prix a changé',
    BELOW_MIN_ORDER_QTY: 'Sous la quantité minimale',
  };

  view().innerHTML = `
    <h1>Votre panier</h1>
    ${cart.stores.map((group) => `
      <h2>${esc(group.store.name)} <span class="small muted">— expédié depuis ${esc(group.store.countryCode)}</span></h2>
      <div class="card">
        ${group.items.map((item) => `
          <div class="cart-line">
            <div class="thumb">${item.image ? `<img src="${esc(item.image)}" alt="" />` : ''}</div>
            <div>
              <a href="#/produits/${esc(item.slug)}"><strong>${esc(item.title)}</strong></a>
              ${item.variantName ? `<div class="small muted">${esc(item.variantName)}</div>` : ''}
              <div class="small muted">${fmt(item.unitPrice, item.currency)} l'unité · ${item.stock} en stock</div>
              ${item.issues.map((i) => `<div class="small"><span class="tag warn">${esc(issueLabels[i] || i)}</span></div>`).join('')}
            </div>
            <div class="actions">
              <div class="qty">
                <input type="number" min="0" value="${item.quantity}" data-item="${esc(item.id)}" class="qty-input" aria-label="Quantité" />
                <button class="btn-secondary btn-small remove-item" data-item="${esc(item.id)}">Retirer</button>
              </div>
              <div class="price" style="text-align:right">${fmt(item.lineTotal, item.currency)}</div>
            </div>
          </div>`).join('')}
        <div class="totals" style="margin-top:14px">
          <div class="line"><span>Sous-total ${esc(group.store.name)}</span><strong>${fmt(group.subtotal, group.currency)}</strong></div>
        </div>
      </div>`).join('')}

    <div class="card" style="margin-top:18px">
      <div class="totals">
        <div class="line"><span>Articles</span><span>${cart.itemCount}</span></div>
        <div class="line total"><span>Sous-total</span><span>${fmt(cart.subtotal, cart.currency)}</span></div>
      </div>
      <p class="small muted">Les frais de livraison sont calculés à l'étape suivante, selon le corridor et le poids réel.</p>
      <div class="row">
        <a class="btn btn-accent" href="#/checkout" ${cart.checkoutReady ? '' : 'aria-disabled="true"'}>Passer commande</a>
        <button class="btn-secondary" id="clear-cart">Vider le panier</button>
      </div>
      ${cart.checkoutReady ? '' : '<p class="error-box" style="margin-top:12px">Corrigez les lignes signalées avant de valider votre commande.</p>'}
    </div>`;
}

async function viewCheckout() {
  if (!requireLogin('#/checkout')) return;
  loading();
  const [cart, me, countries] = await Promise.all([call('/cart'), call('/auth/me'), call('/countries')]);
  if (!cart.items.length) {
    location.hash = '#/panier';
    return;
  }

  view().innerHTML = `
    <h1>Validation de la commande</h1>
    <div class="grid two">
      <div>
        <h2>Adresse de livraison</h2>
        <div class="card">
          ${me.addresses.length
            ? me.addresses.map((a, i) => `<label class="row" style="font-weight:400">
                <input type="radio" name="address" value="${esc(a.id)}" ${i === 0 ? 'checked' : ''} style="width:auto" />
                <span>${esc(a.fullName)} — ${esc(a.line1)}, ${esc(a.city)} (${esc(a.countryCode)})<br /><span class="small muted">${esc(a.phone)}</span></span>
              </label>`).join('')
            : '<p class="muted">Aucune adresse enregistrée : ajoutez-en une ci-dessous.</p>'}
          <details style="margin-top:12px"${me.addresses.length ? '' : ' open'}>
            <summary>Ajouter une adresse</summary>
            <form id="address-form" style="margin-top:12px">
              <div class="field"><label for="a-name">Nom complet</label><input id="a-name" name="fullName" required /></div>
              <div class="field"><label for="a-phone">Téléphone</label><input id="a-phone" name="phone" required placeholder="+235…" /></div>
              <div class="field"><label for="a-line1">Adresse</label><input id="a-line1" name="line1" required /></div>
              <div class="field"><label for="a-city">Ville</label><input id="a-city" name="city" required /></div>
              <div class="field"><label for="a-country">Pays</label>
                <select id="a-country" name="countryCode">${countries.items.map((c) => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</select>
              </div>
              <button type="submit">Enregistrer l'adresse</button>
            </form>
          </details>
        </div>
      </div>

      <div>
        <h2>Récapitulatif</h2>
        <div class="card">
          ${cart.stores.map((g) => `<div class="line spread"><span>${esc(g.store.name)} (${g.items.length} article(s))</span><strong>${fmt(g.subtotal, g.currency)}</strong></div>`).join('')}
          <div class="totals" style="margin-top:12px">
            <div class="line"><span>Sous-total</span><span>${fmt(cart.subtotal, cart.currency)}</span></div>
            <div class="line"><span>Livraison</span><span class="muted small">calculée à la validation (tarif transporteur)</span></div>
          </div>
          <p class="small muted">
            Une commande distincte est créée par boutique : chaque vendeur gère sa préparation, son expédition et son suivi.
          </p>
          <button id="place-order" class="btn-accent" ${me.addresses.length ? '' : 'disabled'}>Créer la commande</button>
        </div>
      </div>
    </div>`;
}

async function viewOrders() {
  if (!requireLogin('#/commandes')) return;
  loading();
  const result = await call('/orders?scope=buyer&limit=25');
  view().innerHTML = `
    <h1>Mes commandes</h1>
    ${result.items.length
      ? `<div class="card table-wrap"><table>
          <thead><tr><th>Commande</th><th>Boutique</th><th>Statut</th><th>Total</th><th>Date</th><th></th></tr></thead>
          <tbody>${result.items.map((o) => `<tr>
            <td><strong>${esc(o.orderNumber)}</strong>${o.crossBorder ? ' <span class="tag cross">transfrontalier</span>' : ''}</td>
            <td>${esc(o.store.name)}</td>
            <td>${status(o.status)}</td>
            <td>${fmt(o.total, o.currency)}</td>
            <td class="small muted">${dateFmt(o.createdAt)}</td>
            <td><a class="btn btn-secondary btn-small" href="#/commandes/${esc(o.id)}">Détail</a></td>
          </tr>`).join('')}</tbody></table></div>`
      : `<div class="state"><strong>Aucune commande</strong><p>Vos achats apparaîtront ici.</p><a class="btn" href="#/produits">Explorer le catalogue</a></div>`}`;
}

async function viewOrder(id) {
  if (!requireLogin(`#/commandes/${id}`)) return;
  loading();
  const order = await call(`/orders/${id}`);
  const shipment = order.shipments?.[0];
  const payment = order.payments?.[0];
  const payable = order.status === 'PENDING';
  const reviewable = ['DELIVERED', 'COMPLETED'].includes(order.status);

  view().innerHTML = `
    <p class="small muted"><a href="#/commandes">Mes commandes</a> › ${esc(order.orderNumber)}</p>
    <div class="spread">
      <h1 style="margin:0">Commande ${esc(order.orderNumber)}</h1>
      ${status(order.status)}
    </div>
    <p class="small muted">Passée le ${dateFmt(order.createdAt)} auprès de ${esc(order.store.name)} (${esc(order.store.countryCode)})${order.crossBorder ? ' · commande transfrontalière' : ''}.</p>

    <div class="grid two">
      <div class="card">
        <h3>Articles</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Produit</th><th>Qté</th><th>Prix unitaire</th><th>Total</th></tr></thead>
          <tbody>${order.items.map((i) => `<tr>
            <td>${esc(i.titleSnapshot)}${i.variantSnapshot ? `<div class="small muted">${esc(i.variantSnapshot)}</div>` : ''}</td>
            <td>${i.quantity}</td><td>${fmt(i.unitPrice, i.currency)}</td><td>${fmt(i.lineTotal, i.currency)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="totals" style="margin-top:12px">
          <div class="line"><span>Sous-total</span><span>${fmt(order.subtotal, order.currency)}</span></div>
          <div class="line"><span>Livraison</span><span>${fmt(order.shippingTotal, order.currency)}</span></div>
          <div class="line total"><span>Total</span><span>${fmt(order.total, order.currency)}</span></div>
        </div>
      </div>

      <div>
        <div class="card">
          <h3>Paiement</h3>
          ${payment
            ? `<p>${status(payment.status)} · ${esc(payment.method)} · ${fmt(payment.amount, payment.currency)}</p>`
            : '<p class="muted">Aucun paiement enregistré.</p>'}
          ${payable
            ? `<div class="field"><label for="method">Moyen de paiement</label>
                <select id="method">
                  <option value="MOBILE_MONEY">Mobile money</option>
                  <option value="CARD">Carte bancaire</option>
                  <option value="BANK_TRANSFER">Virement bancaire</option>
                  <option value="CASH_ON_DELIVERY">Paiement à la livraison</option>
                </select></div>
              <button id="pay-order" class="btn-accent" data-order="${esc(order.id)}">Payer ${fmt(order.total, order.currency)}</button>
              <p class="small muted">Le paiement est confirmé par le serveur Touma auprès du prestataire — jamais par le navigateur.</p>`
            : ''}
          ${order.status === 'PENDING'
            ? `<button class="btn-secondary btn-small cancel-order" data-order="${esc(order.id)}" style="margin-top:8px">Annuler la commande</button>`
            : ''}
        </div>

        <div class="card" style="margin-top:16px">
          <h3>Livraison</h3>
          <p class="small">${esc(order.shippingSnapshot?.fullName ?? '')} — ${esc(order.shippingSnapshot?.line1 ?? '')}, ${esc(order.shippingSnapshot?.city ?? '')} (${esc(order.shippingSnapshot?.countryCode ?? '')})</p>
          ${shipment
            ? `<p>Transporteur ${esc(shipment.providerCode)} · suivi <strong>${esc(shipment.trackingNumber)}</strong> ${status(shipment.status)}</p>
               <ul class="timeline">${shipment.events.map((e) => `<li><strong>${esc(e.label)}</strong><div class="small muted">${dateFmt(e.occurredAt)}${e.location ? ` · ${esc(e.location)}` : ''}</div></li>`).join('')}</ul>`
            : '<p class="muted">Le vendeur n’a pas encore créé l’expédition.</p>'}
          ${order.status === 'DELIVERED'
            ? `<button class="btn-small complete-order" data-order="${esc(order.id)}">Confirmer la réception</button>`
            : ''}
        </div>

        ${reviewable
          ? `<div class="card" style="margin-top:16px">
              <h3>Laisser un avis</h3>
              <form id="review-form" data-order="${esc(order.id)}">
                <div class="field"><label for="r-product">Produit</label>
                  <select id="r-product">${order.items.map((i) => `<option value="${esc(i.productId)}">${esc(i.titleSnapshot)}</option>`).join('')}</select>
                </div>
                <div class="field"><label for="r-rating">Note</label>
                  <select id="r-rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${'★'.repeat(n)}</option>`).join('')}</select>
                </div>
                <div class="field"><label for="r-comment">Commentaire</label><textarea id="r-comment" rows="3"></textarea></div>
                <button type="submit">Publier l'avis</button>
              </form>
            </div>`
          : ''}

        ${['PAID', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED'].includes(order.status)
          ? `<div class="card" style="margin-top:16px">
              <h3>Un problème ?</h3>
              <form id="dispute-form" data-order="${esc(order.id)}">
                <div class="field"><label for="d-reason">Motif</label>
                  <select id="d-reason">
                    <option value="NOT_RECEIVED">Commande non reçue</option>
                    <option value="DAMAGED">Marchandise endommagée</option>
                    <option value="NOT_AS_DESCRIBED">Non conforme à la description</option>
                    <option value="WRONG_ITEM">Mauvais article</option>
                    <option value="OTHER">Autre</option>
                  </select></div>
                <div class="field"><label for="d-details">Détails</label><textarea id="d-details" rows="3"></textarea></div>
                <button type="submit" class="btn-secondary">Ouvrir un litige</button>
              </form>
            </div>`
          : ''}
      </div>
    </div>`;
}

// ── Compte ─────────────────────────────────────────────────────────────────
function viewLogin(params) {
  view().innerHTML = `
    <form class="card" id="login-form">
      <h1>Se connecter</h1>
      <p class="muted small">Accédez à vos commandes, votre boutique et vos paiements.</p>
      <div class="field"><label for="l-email">Adresse e-mail</label><input id="l-email" type="email" required autocomplete="email" /></div>
      <div class="field"><label for="l-password">Mot de passe</label><input id="l-password" type="password" required autocomplete="current-password" /></div>
      <input type="hidden" id="l-next" value="${esc(params.get('suite') || '#/')}" />
      <button type="submit">Se connecter</button>
      <p class="small" style="margin-bottom:0">Pas encore de compte ? <a href="#/inscription">Créer un compte</a></p>
    </form>`;
}

async function viewRegister() {
  const countries = await call('/countries');
  view().innerHTML = `
    <form class="card" id="register-form">
      <h1>Créer un compte Touma</h1>
      <p class="muted small">Un seul compte pour acheter et pour vendre.</p>
      <div class="field"><label for="r-name">Nom complet</label><input id="r-name" required autocomplete="name" /></div>
      <div class="field"><label for="r-email">Adresse e-mail</label><input id="r-email" type="email" required autocomplete="email" /></div>
      <div class="field"><label for="r-phone">Téléphone (facultatif)</label><input id="r-phone" placeholder="+235…" autocomplete="tel" /></div>
      <div class="field"><label for="r-country">Pays</label>
        <select id="r-country">${countries.items.map((c) => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label for="r-role">Je souhaite</label>
        <select id="r-role"><option value="BUYER">Acheter sur Touma</option><option value="SELLER">Vendre sur Touma</option></select>
      </div>
      <div class="field"><label for="r-password">Mot de passe</label><input id="r-password" type="password" required minlength="10" autocomplete="new-password" />
        <span class="small muted">10 caractères minimum.</span></div>
      <button type="submit">Créer mon compte</button>
      <p class="small" style="margin-bottom:0">Déjà inscrit ? <a href="#/connexion">Se connecter</a></p>
    </form>`;
}

async function viewAccount() {
  if (!requireLogin('#/compte')) return;
  loading();
  const [me, notifications] = await Promise.all([call('/auth/me'), call('/notifications')]);
  view().innerHTML = `
    <h1>Mon compte</h1>
    <div class="grid two">
      <div class="card">
        <h3>Profil</h3>
        <p class="small">${esc(me.name)} · ${esc(me.email)}<br />Rôle : ${esc(me.role)} · Pays : ${esc(me.countryCode ?? '—')}</p>
        ${me.role === 'BUYER' ? '<p><a class="btn btn-secondary btn-small" href="#/vendeur/boutique">Ouvrir une boutique</a></p>' : ''}
        <h3 style="margin-top:18px">Adresses (${me.addresses.length})</h3>
        ${me.addresses.map((a) => `<p class="small">${esc(a.fullName)} — ${esc(a.line1)}, ${esc(a.city)} (${esc(a.countryCode)})
          <button class="btn-secondary btn-small delete-address" data-address="${esc(a.id)}">Supprimer</button></p>`).join('') || '<p class="muted small">Aucune adresse.</p>'}
      </div>
      <div class="card">
        <h3>Notifications (${notifications.unread} non lue(s))</h3>
        ${notifications.items.slice(0, 12).map((n) => `<p class="small"><strong>${esc(n.title)}</strong><br />${esc(n.body)}
          <span class="muted">· ${dateFmt(n.createdAt)}</span></p>`).join('') || '<p class="muted small">Aucune notification.</p>'}
        ${notifications.unread ? '<button class="btn-secondary btn-small" id="read-all">Tout marquer comme lu</button>' : ''}
      </div>
    </div>`;
}

// ── Espace vendeur ─────────────────────────────────────────────────────────
function sellerTabs(active) {
  const tabs = [
    ['#/vendeur', 'Tableau de bord'],
    ['#/vendeur/produits', 'Produits'],
    ['#/vendeur/produits/nouveau', 'Nouveau produit'],
    ['#/vendeur/commandes', 'Commandes'],
    ['#/vendeur/boutique', 'Boutique'],
    ['#/vendeur/verification', 'Touma Verified'],
  ];
  return `<nav class="tabs">${tabs.map(([href, label]) => `<a href="${href}" class="${href === active ? 'active' : ''}">${label}</a>`).join('')}</nav>`;
}

async function viewSellerDashboard() {
  if (!requireLogin('#/vendeur')) return;
  loading();
  const data = await call('/seller/dashboard');
  view().innerHTML = `
    <h1>Espace vendeur</h1>
    ${sellerTabs('#/vendeur')}
    ${data.stores.length
      ? data.stores.map((s) => `<section class="card" style="margin-bottom:16px">
          <div class="spread">
            <h2 style="margin:0">${esc(s.name)}</h2>
            <span class="row">
              ${status(s.status)}
              ${s.verificationStatus === 'APPROVED' ? '<span class="tag verified">Vérifiée</span>' : `<span class="tag">Vérification : ${esc(s.verificationStatus)}</span>`}
            </span>
          </div>
          <div class="grid stats" style="margin-top:14px">
            <div><span class="small muted">Commandes payées</span><div class="price">${s.stats.paidOrders}</div></div>
            <div><span class="small muted">Chiffre d'affaires</span><div class="price">${Object.entries(s.stats.revenue).map(([c, v]) => fmt(v, c)).join(' · ') || '—'}</div></div>
            <div><span class="small muted">Produits actifs</span><div class="price">${s.stats.activeProducts}</div></div>
            <div><span class="small muted">À expédier</span><div class="price">${s.stats.toShip}</div></div>
            <div><span class="small muted">Stock faible</span><div class="price">${s.stats.lowStockItems}</div></div>
          </div>
        </section>`).join('')
      : `<div class="state"><strong>Aucune boutique</strong><p>Ouvrez votre boutique pour publier vos produits.</p>
         <a class="btn" href="#/vendeur/boutique">Créer ma boutique</a></div>`}

    ${data.recentOrders.length
      ? `<h2>Dernières commandes</h2>
        <div class="card table-wrap"><table>
          <thead><tr><th>Commande</th><th>Client</th><th>Articles</th><th>Statut</th><th>Total</th><th></th></tr></thead>
          <tbody>${data.recentOrders.map((o) => `<tr>
            <td><strong>${esc(o.orderNumber)}</strong></td><td>${esc(o.buyer)}</td><td>${o.itemCount}</td>
            <td>${status(o.status)}</td><td>${fmt(o.total, o.currency)}</td>
            <td><a class="btn btn-secondary btn-small" href="#/vendeur/commandes/${esc(o.id)}">Traiter</a></td>
          </tr>`).join('')}</tbody></table></div>`
      : ''}`;
}

async function viewSellerStore() {
  if (!requireLogin('#/vendeur/boutique')) return;
  loading();
  const [stores, countries] = await Promise.all([call('/stores/mine'), call('/countries')]);
  view().innerHTML = `
    <h1>Ma boutique</h1>
    ${sellerTabs('#/vendeur/boutique')}
    ${stores.items.map((s) => `<form class="card store-form" data-store="${esc(s.id)}" style="margin-bottom:16px;max-width:none">
      <div class="spread"><h2 style="margin:0">${esc(s.name)}</h2>${status(s.status)}</div>
      <div class="grid two">
        <div class="field"><label for="s-name-${esc(s.id)}">Nom</label><input id="s-name-${esc(s.id)}" name="name" value="${esc(s.name)}" /></div>
        <div class="field"><label for="s-city-${esc(s.id)}">Ville</label><input id="s-city-${esc(s.id)}" name="city" value="${esc(s.city ?? '')}" /></div>
      </div>
      <div class="field"><label for="s-desc-${esc(s.id)}">Description</label><textarea id="s-desc-${esc(s.id)}" name="description" rows="3">${esc(s.description ?? '')}</textarea></div>
      <div class="field"><label for="s-logo-${esc(s.id)}">Logo (URL)</label><input id="s-logo-${esc(s.id)}" name="logoUrl" value="${esc(s.logoUrl ?? '')}" /></div>
      <button type="submit">Enregistrer</button>
      <a class="btn btn-secondary" href="#/boutiques/${esc(s.slug)}">Voir la vitrine</a>
    </form>`).join('')}

    <form class="card" id="create-store-form">
      <h2>Ouvrir une nouvelle boutique</h2>
      <div class="field"><label for="ns-name">Nom de la boutique</label><input id="ns-name" required /></div>
      <div class="field"><label for="ns-country">Pays</label>
        <select id="ns-country">${countries.items.map((c) => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="ns-city">Ville</label><input id="ns-city" /></div>
      <div class="field"><label for="ns-desc">Description</label><textarea id="ns-desc" rows="3"></textarea></div>
      <button type="submit">Créer la boutique</button>
    </form>`;
}

async function viewSellerProducts() {
  if (!requireLogin('#/vendeur/produits')) return;
  loading();
  const result = await call('/products/mine?limit=50');
  view().innerHTML = `
    <h1>Mes produits</h1>
    ${sellerTabs('#/vendeur/produits')}
    ${result.items.length
      ? `<div class="card table-wrap"><table>
          <thead><tr><th>Produit</th><th>Prix</th><th>Stock</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>${result.items.map((p) => `<tr>
            <td><a href="#/produits/${esc(p.slug)}">${esc(p.title)}</a><div class="small muted">${esc(p.store.name)}</div></td>
            <td>${fmt(p.price, p.currency)}</td>
            <td><input type="number" min="0" value="${p.stock}" class="stock-input" data-product="${esc(p.id)}" style="width:90px" aria-label="Stock" /></td>
            <td>${status(p.status)}</td>
            <td class="row">
              <button class="btn-secondary btn-small toggle-status" data-product="${esc(p.id)}" data-status="${p.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE'}">
                ${p.status === 'ACTIVE' ? 'Dépublier' : 'Publier'}
              </button>
              <button class="btn-secondary btn-small archive-product" data-product="${esc(p.id)}">Archiver</button>
            </td>
          </tr>`).join('')}</tbody></table></div>
        <p class="small muted">Modifier un stock l'enregistre immédiatement.</p>`
      : `<div class="state"><strong>Aucun produit</strong><p>Publiez votre premier produit.</p>
         <a class="btn" href="#/vendeur/produits/nouveau">Ajouter un produit</a></div>`}`;
}

async function viewSellerNewProduct() {
  if (!requireLogin('#/vendeur/produits/nouveau')) return;
  loading();
  const [stores, categories, countries] = await Promise.all([call('/stores/mine'), call('/categories'), call('/countries')]);
  if (!stores.items.length) {
    view().innerHTML = `${sellerTabs('#/vendeur/produits/nouveau')}
      <div class="state"><strong>Créez d'abord votre boutique</strong><a class="btn" href="#/vendeur/boutique">Ouvrir ma boutique</a></div>`;
    return;
  }
  view().innerHTML = `
    <h1>Nouveau produit</h1>
    ${sellerTabs('#/vendeur/produits/nouveau')}
    <form class="card" id="product-form" style="max-width:none">
      <div class="grid two">
        <div class="field"><label for="p-store">Boutique</label>
          <select id="p-store">${stores.items.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${esc(s.countryCode)})</option>`).join('')}</select></div>
        <div class="field"><label for="p-category">Catégorie</label>
          <select id="p-category"><option value="">—</option>${categories.items.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="p-title">Titre</label><input id="p-title" required maxlength="200" /></div>
      <div class="field"><label for="p-description">Description</label><textarea id="p-description" rows="5"></textarea>
        <button type="button" class="btn-secondary btn-small" id="ai-description" style="margin-top:6px">Proposer une description (Touma AI)</button>
        <span class="small muted"> — proposition à relire et valider.</span></div>
      <div class="grid two">
        <div class="field"><label for="p-price">Prix unitaire</label><input id="p-price" required inputmode="decimal" placeholder="25000" /></div>
        <div class="field"><label for="p-quantity">Stock</label><input id="p-quantity" type="number" min="0" value="10" /></div>
        <div class="field"><label for="p-min">Quantité minimale de commande</label><input id="p-min" type="number" min="1" value="1" /></div>
        <div class="field"><label for="p-weight">Poids unitaire (g)</label><input id="p-weight" type="number" min="1" value="800" /></div>
        <div class="field"><label for="p-country">Pays d'expédition</label>
          <select id="p-country">${countries.items.map((c) => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="p-image">Image (URL)</label><input id="p-image" placeholder="https://…" /></div>
      </div>
      <div class="field"><label for="p-keywords">Mots-clés</label><input id="p-keywords" placeholder="sésame, export, gros" /></div>
      <div class="field"><label for="p-status">Publication</label>
        <select id="p-status"><option value="ACTIVE">Publier immédiatement</option><option value="DRAFT">Enregistrer en brouillon</option></select></div>
      <button type="submit">Créer le produit</button>
    </form>`;
}

async function viewSellerOrders() {
  if (!requireLogin('#/vendeur/commandes')) return;
  loading();
  const result = await call('/orders?scope=seller&limit=50');
  view().innerHTML = `
    <h1>Commandes reçues</h1>
    ${sellerTabs('#/vendeur/commandes')}
    ${result.items.length
      ? `<div class="card table-wrap"><table>
          <thead><tr><th>Commande</th><th>Statut</th><th>Total</th><th>Suivi</th><th>Date</th><th></th></tr></thead>
          <tbody>${result.items.map((o) => `<tr>
            <td><strong>${esc(o.orderNumber)}</strong>${o.crossBorder ? ' <span class="tag cross">transfrontalier</span>' : ''}</td>
            <td>${status(o.status)}</td><td>${fmt(o.total, o.currency)}</td>
            <td class="small">${o.shipment ? `${esc(o.shipment.trackingNumber)}` : '—'}</td>
            <td class="small muted">${dateFmt(o.createdAt)}</td>
            <td><a class="btn btn-secondary btn-small" href="#/vendeur/commandes/${esc(o.id)}">Traiter</a></td>
          </tr>`).join('')}</tbody></table></div>`
      : '<div class="state"><strong>Aucune commande reçue</strong><p>Vos ventes apparaîtront ici.</p></div>'}`;
}

async function viewSellerOrder(id) {
  if (!requireLogin(`#/vendeur/commandes/${id}`)) return;
  loading();
  const order = await call(`/orders/${id}`);
  const shipment = order.shipments?.[0];
  view().innerHTML = `
    ${sellerTabs('#/vendeur/commandes')}
    <div class="spread"><h1 style="margin:0">Commande ${esc(order.orderNumber)}</h1>${status(order.status)}</div>
    <p class="small muted">Acheteur : ${esc(order.buyer?.name ?? '')} · ${dateFmt(order.createdAt)}</p>

    <div class="grid two">
      <div class="card">
        <h3>Articles</h3>
        <div class="table-wrap"><table><thead><tr><th>Produit</th><th>Qté</th><th>Total</th></tr></thead>
          <tbody>${order.items.map((i) => `<tr><td>${esc(i.titleSnapshot)}</td><td>${i.quantity}</td><td>${fmt(i.lineTotal, i.currency)}</td></tr>`).join('')}</tbody></table></div>
        <div class="totals" style="margin-top:10px">
          <div class="line"><span>Sous-total</span><span>${fmt(order.subtotal, order.currency)}</span></div>
          <div class="line"><span>Livraison</span><span>${fmt(order.shippingTotal, order.currency)}</span></div>
          <div class="line"><span>Commission Touma</span><span>− ${fmt(order.commissionTotal, order.currency)}</span></div>
          <div class="line total"><span>Net vendeur estimé</span><span>${fmt(Number(order.total) - Number(order.commissionTotal), order.currency)}</span></div>
        </div>
      </div>

      <div class="card">
        <h3>Livraison</h3>
        <p class="small">${esc(order.shippingSnapshot?.fullName ?? '')} — ${esc(order.shippingSnapshot?.line1 ?? '')}, ${esc(order.shippingSnapshot?.city ?? '')} (${esc(order.shippingSnapshot?.countryCode ?? '')})</p>
        ${shipment
          ? `<p>Suivi <strong>${esc(shipment.trackingNumber)}</strong> ${status(shipment.status)}</p>
             <div class="field"><label for="ship-status">Faire avancer le suivi</label>
               <select id="ship-status">
                 <option value="SHIPPED">Colis remis au transporteur</option>
                 <option value="IN_TRANSIT">En transit</option>
                 <option value="DELIVERED">Livré</option>
                 <option value="RETURNED">Retourné</option>
               </select></div>
             <button class="update-shipment" data-shipment="${esc(shipment.id)}">Mettre à jour le suivi</button>
             <ul class="timeline" style="margin-top:14px">${shipment.events.map((e) => `<li><strong>${esc(e.label)}</strong><div class="small muted">${dateFmt(e.occurredAt)}</div></li>`).join('')}</ul>`
          : ['PAID', 'CONFIRMED', 'PROCESSING'].includes(order.status)
            ? `<p class="muted small">Créez l'expédition : Touma interroge les transporteurs et génère le numéro de suivi.</p>
               <button class="create-shipment" data-order="${esc(order.id)}">Créer l'expédition</button>`
            : '<p class="muted small">L’expédition sera possible une fois la commande payée.</p>'}
      </div>
    </div>`;
}

async function viewSellerVerification() {
  if (!requireLogin('#/vendeur/verification')) return;
  loading();
  const [statusData, stores] = await Promise.all([call('/verification/status'), call('/stores/mine')]);
  view().innerHTML = `
    <h1>Touma Verified</h1>
    ${sellerTabs('#/vendeur/verification')}
    <p class="muted">La vérification atteste de l'identité de votre entreprise. Les documents transmis restent privés : ils ne sont visibles que de l'équipe de revue.</p>

    ${statusData.items.map((s) => `<div class="card" style="margin-bottom:14px">
      <div class="spread"><h3 style="margin:0">${esc(s.storeName)}</h3><span class="row">${status(s.verificationStatus)}</span></div>
      ${s.submissions.map((v) => `<p class="small">Dossier du ${dateFmt(v.submittedAt)} — ${status(v.status)} · ${v.documentCount} document(s)
        ${v.reviewerComment ? `<br /><em>${esc(v.reviewerComment)}</em>` : ''}</p>`).join('') || '<p class="small muted">Aucun dossier déposé.</p>'}
    </div>`).join('')}

    ${stores.items.length
      ? `<form class="card" id="verification-form" style="max-width:none">
          <h2>Déposer un dossier</h2>
          <div class="field"><label for="v-store">Boutique</label>
            <select id="v-store">${stores.items.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="v-type">Type</label>
            <select id="v-type"><option value="COMPANY">Entreprise</option><option value="INDIVIDUAL">Entrepreneur individuel</option></select></div>
          <div class="field"><label for="v-legal">Raison sociale / nom légal</label><input id="v-legal" required /></div>
          <div class="field"><label for="v-reg">Numéro d'enregistrement (RCCM…)</label><input id="v-reg" /></div>
          <div class="field"><label for="v-phone">Téléphone de contact</label><input id="v-phone" required /></div>
          <div class="field"><label for="v-email">E-mail de contact</label><input id="v-email" type="email" required /></div>
          <div class="field"><label for="v-doc">Lien du document justificatif</label><input id="v-doc" type="url" required placeholder="https://…" />
            <span class="small muted">Stockage privé : le lien n'est jamais rendu public.</span></div>
          <button type="submit">Envoyer le dossier</button>
        </form>`
      : ''}`;
}

// ── Administration ─────────────────────────────────────────────────────────
function adminTabs(active) {
  const tabs = [
    ['#/admin', 'Tableau de bord'],
    ['#/admin/utilisateurs', 'Utilisateurs'],
    ['#/admin/boutiques', 'Boutiques'],
    ['#/admin/commandes', 'Commandes'],
    ['#/admin/paiements', 'Paiements'],
    ['#/admin/expeditions', 'Expéditions'],
    ['#/admin/verifications', 'Vérifications'],
    ['#/admin/litiges', 'Litiges'],
    ['#/admin/risque', 'Risque'],
    ['#/admin/audit', 'Audit'],
  ];
  return `<nav class="tabs">${tabs.map(([href, label]) => `<a href="${href}" class="${href === active ? 'active' : ''}">${label}</a>`).join('')}</nav>`;
}

async function viewAdminDashboard() {
  if (!requireLogin('#/admin')) return;
  loading();
  const [data, analytics] = await Promise.all([call('/admin/dashboard'), call('/admin/analytics?days=30')]);
  const stat = (label, value) => `<div class="card"><span class="small muted">${label}</span><div class="price">${value}</div></div>`;
  view().innerHTML = `
    <h1>Administration Touma</h1>
    ${adminTabs('#/admin')}
    <div class="grid stats">
      ${stat('Utilisateurs', data.users)}
      ${stat('Vendeurs', data.sellers)}
      ${stat('Boutiques actives', data.stores)}
      ${stat('Produits actifs', data.products)}
      ${stat('Commandes', data.orders)}
      ${stat('Commandes payées', data.paidOrders)}
      ${stat('Transfrontalières', data.crossBorderOrders)}
      ${stat('GMV', Object.entries(data.gmvByCurrency).map(([c, v]) => fmt(v, c)).join(' · ') || '—')}
      ${stat('Panier moyen', Object.entries(data.averageBasket).map(([c, v]) => fmt(v, c)).join(' · ') || '—')}
      ${stat("Taux d'annulation", `${(data.cancellationRate * 100).toFixed(1)} %`)}
      ${stat('Vérifications en attente', data.pendingVerifications)}
      ${stat('Litiges ouverts', data.openDisputes)}
      ${stat('Paiements échoués', data.failedPayments)}
      ${stat('Expéditions', data.shipments)}
    </div>

    <h2>30 derniers jours</h2>
    <div class="card table-wrap">
      <table><thead><tr><th>Date</th><th>Commandes</th><th>Payées</th><th>GMV</th></tr></thead>
        <tbody>${analytics.series.map((r) => `<tr><td>${esc(r.date)}</td><td>${r.orders}</td><td>${r.paid}</td>
          <td>${Object.entries(r.gmv).map(([c, v]) => fmt(v, c)).join(' · ') || '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucune donnée.</td></tr>'}</tbody></table>
    </div>

    <h2>Produits les plus vendus</h2>
    <div class="card table-wrap">
      <table><thead><tr><th>Produit</th><th>Quantité vendue</th></tr></thead>
        <tbody>${analytics.topProducts.map((p) => `<tr><td>${esc(p.title)}</td><td>${p.quantity}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">Aucune vente.</td></tr>'}</tbody></table>
    </div>`;
}

/** Vue générique d'une liste d'administration. */
async function viewAdminList(kind) {
  if (!requireLogin(`#/admin`)) return;
  loading();
  const config = {
    utilisateurs: {
      path: '/admin/users?limit=50',
      title: 'Utilisateurs',
      head: ['Nom', 'E-mail', 'Rôle', 'Statut', 'Pays', 'Risque', 'Actions'],
      row: (u) => `<tr>
        <td>${esc(u.name)}</td><td class="small">${esc(u.email)}</td><td>${esc(u.toumaRole)}</td>
        <td>${status(u.status)}</td><td>${esc(u.countryCode ?? '—')}</td>
        <td>${u.riskScore ? `${u.riskScore.score} (${esc(u.riskScore.level)})` : '—'}</td>
        <td class="row">
          <button class="btn-secondary btn-small user-status" data-user="${esc(u.id)}" data-status="${u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}">
            ${u.status === 'ACTIVE' ? 'Suspendre' : 'Réactiver'}
          </button>
          <button class="btn-secondary btn-small user-risk" data-user="${esc(u.id)}">Recalculer le risque</button>
        </td></tr>`,
    },
    boutiques: {
      path: '/admin/stores?limit=50',
      title: 'Boutiques',
      head: ['Boutique', 'Propriétaire', 'Pays', 'Produits', 'Commandes', 'Statut', 'Vérification', 'Actions'],
      row: (s) => `<tr>
        <td><a href="#/boutiques/${esc(s.slug)}">${esc(s.name)}</a></td>
        <td class="small">${esc(s.owner.email)}</td><td>${esc(s.countryCode)}</td>
        <td>${s._count.products}</td><td>${s._count.orders}</td>
        <td>${status(s.status)}</td><td>${status(s.verificationStatus)}</td>
        <td><button class="btn-secondary btn-small store-status" data-store="${esc(s.id)}" data-status="${s.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}">
          ${s.status === 'ACTIVE' ? 'Suspendre' : 'Réactiver'}</button></td></tr>`,
    },
    commandes: {
      path: '/admin/orders?limit=50',
      title: 'Commandes',
      head: ['Commande', 'Acheteur', 'Boutique', 'Statut', 'Total', 'Commission', 'Date'],
      row: (o) => `<tr>
        <td><strong>${esc(o.orderNumber)}</strong>${o.crossBorder ? ' <span class="tag cross">TF</span>' : ''}</td>
        <td class="small">${esc(o.buyer.email)}</td><td>${esc(o.store.name)}</td>
        <td>${status(o.status)}</td><td>${fmt(o.total, o.currency)}</td><td>${fmt(o.commissionTotal, o.currency)}</td>
        <td class="small muted">${dateFmt(o.createdAt)}</td></tr>`,
    },
    paiements: {
      path: '/admin/payments?limit=50',
      title: 'Paiements',
      head: ['Commande', 'Prestataire', 'Méthode', 'Statut', 'Montant', 'Remboursé', 'Date'],
      row: (p) => `<tr>
        <td>${esc(p.order.orderNumber)}</td><td>${esc(p.provider)}</td><td>${esc(p.method)}</td>
        <td>${status(p.status)}</td><td>${fmt(p.amount, p.currency)}</td><td>${fmt(p.refundedAmount, p.currency)}</td>
        <td class="small muted">${dateFmt(p.createdAt)}</td></tr>`,
    },
    expeditions: {
      path: '/admin/shipments?limit=50',
      title: 'Expéditions',
      head: ['Suivi', 'Commande', 'Transporteur', 'Trajet', 'Statut', 'Coût'],
      row: (s) => `<tr>
        <td class="small">${esc(s.trackingNumber)}</td><td>${esc(s.order.orderNumber)}</td><td>${esc(s.providerCode)}</td>
        <td>${esc(s.originCountry)} → ${esc(s.destinationCountry)}</td><td>${status(s.status)}</td><td>${fmt(s.amount, s.currency)}</td></tr>`,
    },
    litiges: {
      path: '/admin/disputes?limit=50',
      title: 'Litiges',
      head: ['Commande', 'Motif', 'Statut', 'Messages', 'Preuves', 'Date', 'Actions'],
      row: (d) => `<tr>
        <td>${esc(d.order.orderNumber)}</td><td>${esc(d.reason)}</td><td>${status(d.status)}</td>
        <td>${d._count.messages}</td><td>${d._count.evidence}</td><td class="small muted">${dateFmt(d.createdAt)}</td>
        <td class="row">${['OPEN', 'UNDER_REVIEW'].includes(d.status)
          ? `<button class="btn-secondary btn-small resolve-dispute" data-dispute="${esc(d.id)}" data-decision="RESOLVED_BUYER">Trancher pour l'acheteur</button>
             <button class="btn-secondary btn-small resolve-dispute" data-dispute="${esc(d.id)}" data-decision="RESOLVED_SELLER">Trancher pour le vendeur</button>`
          : '—'}</td></tr>`,
    },
    audit: {
      path: '/admin/audit?limit=50',
      title: "Journal d'audit",
      head: ['Action', 'Entité', 'Acteur', 'Détail', 'Date'],
      row: (a) => `<tr>
        <td><strong>${esc(a.action)}</strong></td><td class="small">${esc(a.entity)} ${esc(a.entityId ?? '')}</td>
        <td class="small">${esc(a.actor?.email ?? 'système')}</td>
        <td class="small muted">${esc(JSON.stringify(a.metadata ?? {}).slice(0, 90))}</td>
        <td class="small muted">${dateFmt(a.createdAt)}</td></tr>`,
    },
  }[kind];

  const data = await call(config.path);
  view().innerHTML = `
    <h1>${config.title}</h1>
    ${adminTabs(`#/admin/${kind}`)}
    <div class="card table-wrap">
      <table><thead><tr>${config.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${data.items.map(config.row).join('') || `<tr><td colspan="${config.head.length}" class="muted">Aucun élément.</td></tr>`}</tbody></table>
    </div>`;
}

async function viewAdminVerifications() {
  if (!requireLogin('#/admin/verifications')) return;
  loading();
  const data = await call('/admin/verifications?limit=50');
  view().innerHTML = `
    <h1>Dossiers Touma Verified</h1>
    ${adminTabs('#/admin/verifications')}
    ${data.items.length
      ? data.items.map((v) => `<div class="card" style="margin-bottom:14px">
          <div class="spread">
            <h3 style="margin:0">${esc(v.store.name)} <span class="small muted">(${esc(v.store.countryCode)})</span></h3>
            ${status(v.status)}
          </div>
          <p class="small">${esc(v.legalName)} · ${esc(v.businessType)} · ${esc(v.registrationNo ?? 'sans numéro')}<br />
             Contact : ${esc(v.contactEmail)} · ${esc(v.contactPhone)} · propriétaire ${esc(v.store.owner.email)}<br />
             Déposé le ${dateFmt(v.submittedAt)} · ${(v.documents || []).length} document(s) privé(s)</p>
          <div class="row">
            <button class="btn-small approve-verification" data-verification="${esc(v.id)}">Approuver</button>
            <button class="btn-secondary btn-small reject-verification" data-verification="${esc(v.id)}">Rejeter</button>
          </div>
        </div>`).join('')
      : '<div class="state"><strong>Aucun dossier en attente</strong></div>'}`;
}

async function viewAdminRisk() {
  if (!requireLogin('#/admin/risque')) return;
  loading();
  const data = await call('/admin/risk');
  view().innerHTML = `
    <h1>Score de risque</h1>
    ${adminTabs('#/admin/risque')}
    <p class="muted small">Le score agrège des signaux pondérés et explicables. Il n'exclut jamais un utilisateur automatiquement : toute sanction reste une décision humaine, tracée dans l'audit.</p>
    <div class="card table-wrap">
      <table><thead><tr><th>Utilisateur</th><th>Score</th><th>Niveau</th><th>Signaux</th><th>Calculé le</th></tr></thead>
        <tbody>${data.items.map((r) => `<tr>
          <td>${esc(r.user.name)}<div class="small muted">${esc(r.user.email)}</div></td>
          <td><strong>${r.score}</strong></td><td>${esc(r.level)}</td>
          <td class="small">${(r.signals || []).map((s) => esc(s.code)).join(', ') || '—'}</td>
          <td class="small muted">${dateFmt(r.computedAt)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun score calculé.</td></tr>'}</tbody></table>
    </div>`;
}

// ── Actions (délégation d'événements, aucun gestionnaire en ligne) ─────────
async function guard(fn) {
  try {
    await fn();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.addEventListener('submit', (event) => {
  const form = event.target;

  if (form.id === 'search-form') {
    event.preventDefault();
    const q = document.getElementById('search-input').value.trim();
    location.hash = q ? `#/produits?q=${encodeURIComponent(q)}` : '#/produits';
    return;
  }

  if (form.id === 'filters') {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form).entries()) if (String(value).trim()) params.set(key, String(value).trim());
    location.hash = `#/produits?${params.toString()}`;
    return;
  }

  if (form.id === 'login-form') {
    event.preventDefault();
    guard(async () => {
      const data = await call('/auth/login', {
        method: 'POST',
        body: { email: document.getElementById('l-email').value, password: document.getElementById('l-password').value },
      });
      session.set({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
      toast(`Bienvenue, ${data.user.name}.`, 'success');
      location.hash = document.getElementById('l-next').value || '#/';
    });
    return;
  }

  if (form.id === 'register-form') {
    event.preventDefault();
    guard(async () => {
      const body = {
        name: document.getElementById('r-name').value,
        email: document.getElementById('r-email').value,
        password: document.getElementById('r-password').value,
        countryCode: document.getElementById('r-country').value,
        role: document.getElementById('r-role').value,
      };
      const phone = document.getElementById('r-phone').value.trim();
      if (phone) body.phone = phone;
      const data = await call('/auth/register', { method: 'POST', body });
      session.set({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
      toast('Compte créé. Bienvenue sur Touma.', 'success');
      location.hash = data.user.role === 'SELLER' ? '#/vendeur/boutique' : '#/produits';
    });
    return;
  }

  if (form.id === 'address-form') {
    event.preventDefault();
    guard(async () => {
      const data = Object.fromEntries(new FormData(form).entries());
      await call('/auth/me/addresses', { method: 'POST', body: { ...data, isDefault: true } });
      toast('Adresse enregistrée.', 'success');
      route();
    });
    return;
  }

  if (form.id === 'create-store-form') {
    event.preventDefault();
    guard(async () => {
      const store = await call('/stores', {
        method: 'POST',
        body: {
          name: document.getElementById('ns-name').value,
          countryCode: document.getElementById('ns-country').value,
          city: document.getElementById('ns-city').value || undefined,
          description: document.getElementById('ns-desc').value || undefined,
        },
      });
      const current = session.get();
      if (current?.user?.role === 'BUYER') session.set({ ...current, user: { ...current.user, role: 'SELLER' } });
      toast(`Boutique « ${store.name} » créée.`, 'success');
      location.hash = '#/vendeur/produits/nouveau';
    });
    return;
  }

  if (form.classList.contains('store-form')) {
    event.preventDefault();
    guard(async () => {
      const body = Object.fromEntries([...new FormData(form).entries()].filter(([, v]) => String(v).trim() !== ''));
      await call(`/stores/${form.dataset.store}`, { method: 'PATCH', body });
      toast('Boutique mise à jour.', 'success');
    });
    return;
  }

  if (form.id === 'product-form') {
    event.preventDefault();
    guard(async () => {
      const image = document.getElementById('p-image').value.trim();
      const body = {
        storeId: document.getElementById('p-store').value,
        title: document.getElementById('p-title').value,
        description: document.getElementById('p-description').value,
        price: document.getElementById('p-price').value.replace(',', '.'),
        quantity: Number(document.getElementById('p-quantity').value),
        minOrderQty: Number(document.getElementById('p-min').value),
        weightGrams: Number(document.getElementById('p-weight').value),
        countryCode: document.getElementById('p-country').value,
        keywords: document.getElementById('p-keywords').value,
        status: document.getElementById('p-status').value,
        images: image ? [{ url: image }] : [],
      };
      const categoryId = document.getElementById('p-category').value;
      if (categoryId) body.categoryId = categoryId;
      await call('/products', { method: 'POST', body });
      toast('Produit publié.', 'success');
      location.hash = '#/vendeur/produits';
    });
    return;
  }

  if (form.id === 'verification-form') {
    event.preventDefault();
    guard(async () => {
      await call('/verification/submit', {
        method: 'POST',
        body: {
          storeId: document.getElementById('v-store').value,
          businessType: document.getElementById('v-type').value,
          legalName: document.getElementById('v-legal').value,
          registrationNo: document.getElementById('v-reg').value || undefined,
          contactPhone: document.getElementById('v-phone').value,
          contactEmail: document.getElementById('v-email').value,
          documents: [{ kind: 'justificatif', url: document.getElementById('v-doc').value }],
        },
      });
      toast('Dossier envoyé : réponse sous quelques jours ouvrés.', 'success');
      route();
    });
    return;
  }

  if (form.id === 'review-form') {
    event.preventDefault();
    guard(async () => {
      await call('/reviews', {
        method: 'POST',
        body: {
          orderId: form.dataset.order,
          productId: document.getElementById('r-product').value,
          rating: Number(document.getElementById('r-rating').value),
          comment: document.getElementById('r-comment').value || undefined,
        },
      });
      toast('Merci, votre avis est publié.', 'success');
      route();
    });
    return;
  }

  if (form.id === 'dispute-form') {
    event.preventDefault();
    guard(async () => {
      await call('/disputes', {
        method: 'POST',
        body: {
          orderId: form.dataset.order,
          reason: document.getElementById('d-reason').value,
          details: document.getElementById('d-details').value || undefined,
        },
      });
      toast('Litige ouvert : l’équipe Touma examine votre dossier.', 'success');
      route();
    });
  }
});

document.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;

  const actions = {
    'add-to-cart': async () => {
      if (!requireLogin(location.hash)) return;
      const variant = document.getElementById('variant');
      await call('/cart/items', {
        method: 'POST',
        body: {
          productId: target.dataset.product,
          variantId: variant?.value || null,
          quantity: Number(document.getElementById('qty').value || 1),
        },
      });
      toast('Article ajouté au panier.', 'success');
      updateCartCount();
    },
    'clear-cart': async () => {
      await call('/cart', { method: 'DELETE' });
      toast('Panier vidé.');
      route();
    },
    'place-order': async () => {
      const selected = document.querySelector('input[name="address"]:checked');
      if (!selected) return toast('Choisissez une adresse de livraison.', 'error');
      target.disabled = true;
      const result = await call('/checkout', {
        method: 'POST',
        body: { addressId: selected.value, idempotencyKey: `web-${Date.now()}-${Math.random().toString(16).slice(2, 8)}` },
      });
      toast(`${result.orders.length} commande(s) créée(s).`, 'success');
      updateCartCount();
      location.hash = `#/commandes/${result.orders[0].id}`;
    },
    'pay-order': async () => {
      target.disabled = true;
      const created = await call('/payments/create', {
        method: 'POST',
        body: {
          orderId: target.dataset.order,
          method: document.getElementById('method').value,
          idempotencyKey: `pay-${target.dataset.order}`,
        },
      });
      // La confirmation est demandée au serveur : le navigateur ne décide jamais
      // qu'un paiement a réussi.
      const confirmed = await call('/payments/confirm', { method: 'POST', body: { paymentId: created.payment.id } });
      toast(confirmed.status === 'SUCCEEDED' ? 'Paiement confirmé.' : `Paiement ${confirmed.status}.`, confirmed.status === 'SUCCEEDED' ? 'success' : 'error');
      route();
    },
    'read-all': async () => {
      await call('/notifications/read-all', { method: 'POST' });
      route();
    },
  };

  if (target.id && actions[target.id]) {
    event.preventDefault();
    guard(actions[target.id]);
    return;
  }

  const classActions = {
    'remove-item': () => call(`/cart/items/${target.dataset.item}`, { method: 'DELETE' }).then(() => { toast('Article retiré.'); route(); }),
    'delete-address': () => call(`/auth/me/addresses/${target.dataset.address}`, { method: 'DELETE' }).then(() => { toast('Adresse supprimée.'); route(); }),
    'cancel-order': () => call(`/orders/${target.dataset.order}/status`, { method: 'PATCH', body: { status: 'CANCELLED' } }).then(() => { toast('Commande annulée.'); route(); }),
    'complete-order': () => call(`/orders/${target.dataset.order}/status`, { method: 'PATCH', body: { status: 'COMPLETED' } }).then(() => { toast('Réception confirmée. Merci !', 'success'); route(); }),
    'toggle-status': () => call(`/products/${target.dataset.product}`, { method: 'PATCH', body: { status: target.dataset.status } }).then(() => { toast('Statut mis à jour.'); route(); }),
    'archive-product': () => call(`/products/${target.dataset.product}`, { method: 'DELETE' }).then(() => { toast('Produit archivé.'); route(); }),
    'create-shipment': () => call('/shipping/create', { method: 'POST', body: { orderId: target.dataset.order } }).then((s) => { toast(`Expédition créée : ${s.trackingNumber}`, 'success'); route(); }),
    'update-shipment': () => call(`/shipping/${target.dataset.shipment}/status`, { method: 'PATCH', body: { status: document.getElementById('ship-status').value } }).then(() => { toast('Suivi mis à jour.', 'success'); route(); }),
    'approve-verification': () => call(`/admin/verifications/${target.dataset.verification}/approve`, { method: 'POST', body: { comment: 'Documents vérifiés.' } }).then(() => { toast('Vendeur vérifié.', 'success'); route(); }),
    'reject-verification': () => {
      const comment = prompt('Motif du rejet (communiqué au vendeur) :');
      if (!comment) return Promise.resolve();
      return call(`/admin/verifications/${target.dataset.verification}/reject`, { method: 'POST', body: { comment } }).then(() => { toast('Dossier rejeté.'); route(); });
    },
    'user-status': () => call(`/admin/users/${target.dataset.user}/status`, { method: 'PATCH', body: { status: target.dataset.status } }).then(() => { toast('Statut modifié.'); route(); }),
    'user-risk': () => call(`/admin/risk/${target.dataset.user}/recompute`, { method: 'POST' }).then((r) => { toast(`Score recalculé : ${r.score} (${r.level}).`); route(); }),
    'store-status': () => call(`/admin/stores/${target.dataset.store}/status`, { method: 'PATCH', body: { status: target.dataset.status } }).then(() => { toast('Boutique mise à jour.'); route(); }),
    'resolve-dispute': () => {
      const resolution = prompt('Motivation de la décision :');
      if (!resolution) return Promise.resolve();
      return call(`/disputes/${target.dataset.dispute}/resolve`, { method: 'POST', body: { decision: target.dataset.decision, resolution } })
        .then(() => { toast('Litige tranché.', 'success'); route(); });
    },
  };

  for (const [className, action] of Object.entries(classActions)) {
    if (target.classList.contains(className)) {
      event.preventDefault();
      guard(action);
      return;
    }
  }

  if (target.dataset.page) {
    event.preventDefault();
    const { params } = routeParts();
    params.set('page', target.dataset.page);
    location.hash = `#/${target.dataset.target}?${params.toString()}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (target.id === 'ai-description') {
    event.preventDefault();
    guard(async () => {
      const title = document.getElementById('p-title').value.trim();
      if (!title) return toast('Renseignez d’abord un titre.', 'error');
      const category = document.getElementById('p-category');
      const result = await call('/ai/generate', {
        method: 'POST',
        body: {
          useCase: 'product_description',
          prompt: title,
          context: { title, category: category.options[category.selectedIndex]?.text, countryCode: document.getElementById('p-country').value },
        },
      });
      document.getElementById('p-description').value = result.text;
      toast('Proposition générée : relisez-la avant publication.');
    });
  }
});

/** Quantité du panier / stock vendeur : enregistrement à la sortie du champ. */
document.addEventListener('change', (event) => {
  const input = event.target;
  if (input.classList.contains('qty-input')) {
    guard(async () => {
      await call(`/cart/items/${input.dataset.item}`, { method: 'PATCH', body: { quantity: Number(input.value) } });
      toast('Panier mis à jour.');
      route();
    });
  }
  if (input.classList.contains('stock-input')) {
    guard(async () => {
      await call(`/products/${input.dataset.product}/stock`, { method: 'PUT', body: { quantity: Number(input.value) } });
      toast('Stock enregistré.', 'success');
    });
  }
});

// ── Routeur ────────────────────────────────────────────────────────────────
const ROUTES = [
  [[], () => viewHome()],
  [['produits'], (_s, params) => viewProducts(params)],
  [['produits', '*'], (s) => viewProduct(s[1])],
  [['boutiques'], (_s, params) => viewStores(params)],
  [['boutiques', '*'], (s) => viewStore(s[1])],
  [['panier'], () => viewCart()],
  [['checkout'], () => viewCheckout()],
  [['commandes'], () => viewOrders()],
  [['commandes', '*'], (s) => viewOrder(s[1])],
  [['connexion'], (_s, params) => viewLogin(params)],
  [['inscription'], () => viewRegister()],
  [['compte'], () => viewAccount()],
  [['vendeur'], () => viewSellerDashboard()],
  [['vendeur', 'boutique'], () => viewSellerStore()],
  [['vendeur', 'produits'], () => viewSellerProducts()],
  [['vendeur', 'produits', 'nouveau'], () => viewSellerNewProduct()],
  [['vendeur', 'commandes'], () => viewSellerOrders()],
  [['vendeur', 'commandes', '*'], (s) => viewSellerOrder(s[2])],
  [['vendeur', 'verification'], () => viewSellerVerification()],
  [['admin'], () => viewAdminDashboard()],
  [['admin', 'verifications'], () => viewAdminVerifications()],
  [['admin', 'risque'], () => viewAdminRisk()],
  [['admin', '*'], (s) => viewAdminList(s[1])],
];

function match(segments) {
  for (const [pattern, handler] of ROUTES) {
    if (pattern.length !== segments.length) continue;
    if (pattern.every((part, i) => part === '*' || part === segments[i])) return handler;
  }
  return null;
}

async function route() {
  const { segments, params } = routeParts();
  const container = openView();

  if (segments[0] === 'deconnexion') {
    const current = session.get();
    if (current?.refreshToken) await call('/auth/logout', { method: 'POST', body: { refreshToken: current.refreshToken } }).catch(() => undefined);
    session.clear();
    toast('Vous êtes déconnecté.');
    location.hash = '#/';
    return;
  }

  const handler = match(segments);
  if (!handler) {
    view().innerHTML = `<div class="state"><strong>Page introuvable</strong><p>Le lien demandé n'existe pas.</p>
      <a class="btn" href="#/">Retour à l'accueil</a></div>`;
    return;
  }
  try {
    await handler(segments, params);
    // Une navigation plus récente a pris la main : ce rendu est obsolète.
    if (activeView !== container) return;
    window.scrollTo({ top: 0 });
  } catch (err) {
    if (activeView !== container) return;
    if (err.status === 401) {
      session.clear();
      location.hash = '#/connexion';
      return;
    }
    errorState(err);
  }
}

window.addEventListener('hashchange', route);
renderHeader();
renderCorridor();
route();

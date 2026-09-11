/**
 * TOUMA — routeur, ossature de l'interface et actions.
 *
 * Les pages ont de vraies URLs (History API) : elles sont partageables et
 * indexables, le serveur renvoyant la coquille avec les métadonnées de la page.
 * Les espaces vendeur et administration sont chargés à la demande
 * (import dynamique) pour ne pas alourdir la visite d'un simple acheteur.
 */
import {
  api,
  ApiError,
  confirmDialog,
  emptyState,
  errorState,
  esc,
  loadingState,
  money,
  session,
  svg,
  toast,
} from './core.js';
import * as shop from './views-shop.js';
import * as account from './views-account.js';

// ── Table de routage ───────────────────────────────────────────────────────
/** Chaque route : motif d'URL, vue, et exigences d'accès. */
const ROUTES = [
  { path: '/touma/', view: shop.home },
  { path: '/touma/produits', view: shop.catalog },
  { path: '/touma/produits/:slug', view: shop.product },
  { path: '/touma/boutiques', view: shop.stores },
  { path: '/touma/boutiques/:slug', view: shop.store },
  { path: '/touma/panier', view: shop.cart, auth: true },
  { path: '/touma/checkout', view: shop.checkout, auth: true },
  { path: '/touma/commandes', view: shop.orders, auth: true },
  { path: '/touma/commandes/:id', view: shop.order, auth: true },
  { path: '/touma/connexion', view: account.login },
  { path: '/touma/inscription', view: account.register },
  { path: '/touma/compte', view: account.account, auth: true },

  { path: '/touma/commandes/groupe/:id', view: shop.orderGroup, auth: true },

  // TOUMA Business (chargé à la demande).
  { path: '/touma/business', module: 'business', name: 'dashboard', auth: true },
  { path: '/touma/business/appels-offres', module: 'business', name: 'rfqs', auth: true },
  { path: '/touma/business/appels-offres/nouveau', module: 'business', name: 'newRfq', auth: true },
  { path: '/touma/business/appels-offres/:id', module: 'business', name: 'rfq', auth: true },
  { path: '/touma/business/profil', module: 'business', name: 'profile', auth: true },
  { path: '/touma/sourcing', module: 'sourcing', name: 'suppliers' },
  { path: '/touma/sourcing/:slug', module: 'sourcing', name: 'supplier' },
  { path: '/touma/vendeur/offres', module: 'business', name: 'myQuotes', auth: true, role: 'SELLER' },

  // Messagerie.
  { path: '/touma/messages', module: 'messages', name: 'inbox', auth: true },
  { path: '/touma/messages/:id', module: 'messages', name: 'thread', auth: true },

  // Après-vente et assistance (chargés à la demande).
  { path: '/touma/retours', module: 'support', name: 'returns', auth: true },
  { path: '/touma/retours/nouveau', module: 'support', name: 'newReturn', auth: true },
  { path: '/touma/retours/:id', module: 'support', name: 'returnDetail', auth: true },
  { path: '/touma/aide', module: 'support', name: 'tickets', auth: true },
  { path: '/touma/aide/nouveau', module: 'support', name: 'newTicket', auth: true },
  { path: '/touma/aide/:id', module: 'support', name: 'ticket', auth: true },
  { path: '/touma/vendeur/retours', module: 'support', name: 'sellerReturns', auth: true, role: 'SELLER' },
  { path: '/touma/admin/assistance', module: 'support', name: 'adminTickets', auth: true, role: 'ADMIN' },

  // Documents commerciaux.
  { path: '/touma/documents', module: 'documents', name: 'documents', auth: true },
  { path: '/touma/documents/:id', module: 'documents', name: 'documentView', auth: true },
  { path: '/touma/vendeur/documents', module: 'documents', name: 'sellerDocuments', auth: true, role: 'SELLER' },

  // Promotions (codes de réduction).
  { path: '/touma/vendeur/promotions', module: 'promotions', name: 'sellerCoupons', auth: true, role: 'SELLER' },
  { path: '/touma/admin/promotions', module: 'promotions', name: 'adminCoupons', auth: true, role: 'ADMIN' },
  { path: '/touma/promotions/:id', module: 'promotions', name: 'couponDetail', auth: true },

  // Espace vendeur (chargé à la demande).
  { path: '/touma/vendeur', module: 'seller', name: 'dashboard', auth: true, role: 'SELLER' },
  { path: '/touma/vendeur/boutique', module: 'seller', name: 'storeSettings', auth: true },
  { path: '/touma/vendeur/produits', module: 'seller', name: 'products', auth: true, role: 'SELLER' },
  { path: '/touma/vendeur/produits/nouveau', module: 'seller', name: 'productForm', auth: true, role: 'SELLER' },
  { path: '/touma/vendeur/produits/:id', module: 'seller', name: 'productForm', auth: true, role: 'SELLER' },
  { path: '/touma/vendeur/commandes', module: 'seller', name: 'orders', auth: true, role: 'SELLER' },
  { path: '/touma/vendeur/commandes/:id', module: 'seller', name: 'order', auth: true, role: 'SELLER' },
  { path: '/touma/vendeur/analyses', module: 'seller', name: 'analytics', auth: true, role: 'SELLER' },
  { path: '/touma/vendeur/verification', module: 'seller', name: 'verification', auth: true, role: 'SELLER' },

  // Administration (chargée à la demande).
  { path: '/touma/admin', module: 'admin', name: 'dashboard', auth: true, role: 'ADMIN' },
  { path: '/touma/admin/verifications', module: 'admin', name: 'verifications', auth: true, role: 'ADMIN' },
  { path: '/touma/admin/risque', module: 'admin', name: 'risk', auth: true, role: 'ADMIN' },
  { path: '/touma/admin/:section', module: 'admin', name: 'list', auth: true, role: 'ADMIN' },
];

const modules = {};
const LOADERS = {
  seller: () => import('./views-seller.js'),
  admin: () => import('./views-admin.js'),
  business: () => import('./views-business.js'),
  messages: () => import('./views-messages.js'),
  support: () => import('./views-support.js'),
  promotions: () => import('./views-promotions.js'),
  documents: () => import('./views-documents.js'),
  sourcing: () => import('./views-sourcing.js'),
};

async function loadModule(name) {
  modules[name] = modules[name] ?? LOADERS[name]();
  return modules[name];
}

/** Fait correspondre un chemin à une route et extrait ses paramètres. */
function matchRoute(pathname) {
  const path = pathname.length > 8 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  for (const route of ROUTES) {
    const pattern = route.path.length > 8 && route.path.endsWith('/') ? route.path.slice(0, -1) : route.path;
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = path.split('/').filter(Boolean);
    if (patternParts.length !== pathParts.length) continue;

    const params = {};
    const matched = patternParts.every((part, i) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(pathParts[i]);
        return true;
      }
      return part === pathParts[i];
    });
    if (matched) return { route, params };
  }
  return null;
}

// ── Ossature : en-tête, tiroir, navigation basse ───────────────────────────
function navLinks() {
  const user = session.user;
  const links = [
    ['/touma/produits', 'Catalogue'],
    ['/touma/boutiques', 'Boutiques'],
  ];
  links.push(['/touma/business', 'Business']);
  if (user) {
    links.push(['/touma/commandes', 'Mes commandes']);
    if (session.isSeller) links.push(['/touma/vendeur', 'Espace vendeur']);
    if (session.isAdmin) links.push(['/touma/admin', 'Administration']);
  }
  return links;
}

function renderChrome() {
  const user = session.user;
  const current = location.pathname;
  const isCurrent = (href) => (href === '/touma/' ? current === href : current.startsWith(href));

  document.getElementById('header-nav').innerHTML = [
    ...navLinks().map(([href, text]) => `<a href="${href}" data-link${isCurrent(href) ? ' aria-current="page"' : ''}>${text}</a>`),
    user ? '' : '<a class="sell-cta" href="/touma/inscription" data-link>Vendre sur TOUMA</a>',
  ].join('');

  // Tiroir mobile : mêmes destinations, plus les actions de compte.
  const drawerLinks = [...navLinks()];
  if (user) {
    drawerLinks.splice(2, 0, ['/touma/panier', 'Panier']);
    drawerLinks.push(['/touma/messages', 'Messages']);
    drawerLinks.push(['/touma/retours', 'Mes retours']);
    drawerLinks.push(['/touma/documents', 'Mes documents']);
    drawerLinks.push(['/touma/aide', 'Assistance']);
    drawerLinks.push(['/touma/compte', 'Mon compte']);
  }
  document.getElementById('drawer-nav').innerHTML = [
    `<a href="/touma/" data-link${current === '/touma/' ? ' aria-current="page"' : ''}>${svg('home')} Accueil</a>`,
    ...drawerLinks.map(([href, text]) => `<a href="${href}" data-link${isCurrent(href) ? ' aria-current="page"' : ''}>${drawerIcon(href)} ${text}</a>`),
  ].join('');

  document.getElementById('drawer-foot').innerHTML = user
    ? `<div class="small muted" style="margin-bottom:var(--space-3)">Connecté : <strong>${esc(user.name)}</strong></div>
       <a class="btn btn-secondary btn-block" href="/touma/deconnexion" data-link>Se déconnecter</a>`
    : `<a class="btn btn-block" href="/touma/connexion" data-link>Se connecter</a>
       <a class="btn btn-accent btn-block" style="margin-top:var(--space-2)" href="/touma/inscription" data-link>Vendre sur TOUMA</a>`;

  const bottom = [
    ['/touma/', 'Accueil', 'home'],
    ['/touma/produits', 'Catalogue', 'grid'],
    ['/touma/panier', 'Panier', 'cart'],
    ['/touma/commandes', 'Commandes', 'box'],
    [user ? '/touma/compte' : '/touma/connexion', user ? 'Compte' : 'Connexion', 'user'],
  ];
  document.getElementById('bottom-nav').innerHTML = bottom
    .map(
      ([href, text, name]) =>
        `<a href="${href}" data-link${isCurrent(href) ? ' aria-current="page"' : ''}>${svg(name)}<span>${text}</span>${
          href === '/touma/panier' ? '<span class="icon-badge" id="cart-badge-mobile" hidden>0</span>' : ''
        }</a>`,
    )
    .join('');

  document.getElementById('notif-btn').hidden = !user;
  const accountLink = document.getElementById('account-link');
  accountLink.hidden = !user;
  if (user) accountLink.setAttribute('title', user.name);
  refreshCounters();
}

function drawerIcon(href) {
  if (href.includes('produits')) return svg('grid');
  if (href.includes('boutiques')) return svg('store');
  if (href.includes('panier')) return svg('cart');
  if (href.includes('commandes')) return svg('box');
  if (href.includes('business')) return svg('chart');
  if (href.includes('messages')) return svg('inbox');
  if (href.includes('retours')) return svg('truck');
  if (href.includes('aide')) return svg('alert');
  if (href.includes('documents')) return svg('inbox');
  if (href.includes('vendeur')) return svg('chart');
  if (href.includes('admin')) return svg('shield');
  return svg('user');
}

/** Compteurs du panier et des notifications (en-tête et navigation basse). */
async function refreshCounters() {
  const badges = [document.getElementById('cart-badge'), document.getElementById('cart-badge-mobile')].filter(Boolean);
  const notifBadge = document.getElementById('notif-badge');
  if (!session.user) {
    badges.forEach((b) => (b.hidden = true));
    if (notifBadge) notifBadge.hidden = true;
    return;
  }
  try {
    const [cart, notifications] = await Promise.all([api('/cart'), api('/notifications')]);
    badges.forEach((b) => {
      b.textContent = String(cart.itemCount ?? 0);
      b.hidden = !cart.itemCount;
    });
    if (notifBadge) {
      notifBadge.textContent = String(notifications.unread ?? 0);
      notifBadge.hidden = !notifications.unread;
    }
  } catch {
    // Silencieux : un compteur indisponible ne doit pas perturber la navigation.
  }
}

// ── Tiroir de navigation ───────────────────────────────────────────────────
function setDrawer(open) {
  const drawer = document.getElementById('drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  const button = document.getElementById('menu-btn');
  drawer.hidden = false;
  backdrop.hidden = false;
  requestAnimationFrame(() => {
    drawer.dataset.open = String(open);
    backdrop.dataset.open = String(open);
    drawer.setAttribute('aria-hidden', String(!open));
    button.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
      drawer.querySelector('a')?.focus();
    } else {
      // Refermé, le tiroir est retiré du flux : hors écran, il élargirait la page.
      setTimeout(() => {
        if (drawer.dataset.open !== 'true') {
          drawer.hidden = true;
          backdrop.hidden = true;
        }
      }, 250);
    }
  });
}

// ── Rendu d'une page ───────────────────────────────────────────────────────
let renderToken = 0;

/**
 * Affiche la vue correspondant à l'URL courante.
 * Un jeton par navigation empêche un rendu lent d'écraser un écran plus récent.
 */
async function render() {
  const token = ++renderToken;
  const view = document.getElementById('view');
  const url = new URL(location.href);
  const matched = matchRoute(url.pathname);

  renderChrome();

  if (url.pathname === '/touma/deconnexion') {
    const current = session.read();
    if (current?.refreshToken) await api('/auth/logout', { method: 'POST', body: { refreshToken: current.refreshToken } }).catch(() => undefined);
    session.clear();
    toast('Vous êtes déconnecté.');
    return navigate('/touma/');
  }

  if (!matched) {
    view.innerHTML = emptyState({
      title: 'Page introuvable',
      body: "Le lien demandé n'existe pas ou a été déplacé.",
      actionLabel: "Retour à l'accueil",
      actionHref: '/touma/',
      iconName: 'search',
    });
    return;
  }

  const { route, params } = matched;

  if (route.auth && !session.user) {
    return navigate(`/touma/connexion?suite=${encodeURIComponent(url.pathname + url.search)}`, { replace: true });
  }
  if (route.role === 'ADMIN' && !session.isAdmin) {
    view.innerHTML = emptyState({ title: 'Accès réservé', body: "Cet espace est réservé à l'administration TOUMA.", actionLabel: 'Retour', actionHref: '/touma/', iconName: 'shield' });
    return;
  }
  if (route.role === 'SELLER' && !session.isSeller) {
    view.innerHTML = emptyState({
      title: 'Ouvrez d’abord votre boutique',
      body: 'L’espace vendeur s’active dès la création de votre première boutique.',
      actionLabel: 'Créer ma boutique',
      actionHref: '/touma/vendeur/boutique',
      iconName: 'store',
    });
    return;
  }

  view.innerHTML = loadingState(route.path === '/touma/produits' || route.path === '/touma/' ? 'products' : 'list');

  try {
    const handler = route.view ?? (await loadModule(route.module))[route.name];
    const html = await handler(params, url.searchParams);
    if (token !== renderToken) return; // navigation plus récente : rendu abandonné
    view.innerHTML = html;
    document.getElementById('contenu').focus({ preventScroll: true });
  } catch (error) {
    if (token !== renderToken) return;
    if (error instanceof ApiError && error.status === 401) {
      session.clear();
      return navigate(`/touma/connexion?suite=${encodeURIComponent(url.pathname)}`, { replace: true });
    }
    if (error instanceof ApiError && error.status === 404) {
      view.innerHTML = emptyState({
        title: 'Introuvable',
        body: error.message,
        actionLabel: 'Retour au catalogue',
        actionHref: '/touma/produits',
        iconName: 'search',
      });
      return;
    }
    view.innerHTML = errorState(error);
  }
}

/** Navigation interne (sans rechargement de page). */
export function navigate(href, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', href);
  else history.pushState({}, '', href);
  window.scrollTo({ top: 0 });
  return render();
}

// ── Actions : délégation d'événements ──────────────────────────────────────
/** Exécute une action en signalant proprement l'échec à l'utilisateur. */
async function run(action, { button } = {}) {
  if (button) button.disabled = true;
  try {
    await action();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

function requireLogin() {
  if (session.user) return true;
  navigate(`/touma/connexion?suite=${encodeURIComponent(location.pathname + location.search)}`);
  toast('Connectez-vous pour continuer.');
  return false;
}

async function addToCart(productId, { quantity, variantId } = {}) {
  await api('/cart/items', { method: 'POST', body: { productId, variantId: variantId || null, quantity: quantity || 1 } });
  await refreshCounters();
}

// Liens internes.
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-link]');
  if (link && link.origin === location.origin && !event.metaKey && !event.ctrlKey && event.button === 0) {
    event.preventDefault();
    if (document.getElementById('drawer').dataset.open === 'true') setDrawer(false);
    if (link.hasAttribute('data-close-modal')) document.getElementById('modal-root').innerHTML = '';
    navigate(link.getAttribute('href'));
  }
});

// Boutons et actions.
document.addEventListener('click', (event) => {
  const el = event.target.closest('button, [data-action]');
  if (!el) return;
  const d = el.dataset;

  // Ossature
  if (el.id === 'menu-btn') return setDrawer(true);
  if (el.id === 'drawer-close') return setDrawer(false);
  if (el.id === 'notif-btn') {
    return run(async () => {
      const root = document.getElementById('modal-root');
      const { notificationsPanel } = await import('./views-account.js');
      root.innerHTML = `<div class="modal-backdrop" role="dialog" aria-modal="true">${await notificationsPanel()}</div>`;
    });
  }
  if (d.closeModal !== undefined || (event.target.classList.contains('modal-backdrop') && !el.closest('.modal'))) {
    document.getElementById('modal-root').innerHTML = '';
    return;
  }
  if (d.action === 'reload') return render();
  if (d.toggleFilters !== undefined) {
    const panel = document.getElementById('filters');
    panel.dataset.open = panel.dataset.open === 'true' ? 'false' : 'true';
    return;
  }

  // Catalogue et fiche produit
  if (d.addToCart) {
    if (!requireLogin()) return;
    const variant = document.getElementById('variant');
    const qty = document.getElementById('qty');
    return run(
      async () => {
        await addToCart(d.addToCart, { quantity: Number(qty?.value || 1), variantId: variant?.value });
        toast('Article ajouté au panier.', 'success');
      },
      { button: el },
    );
  }
  if (d.buyNow) {
    if (!requireLogin()) return;
    const variant = document.getElementById('variant');
    const qty = document.getElementById('qty');
    return run(
      async () => {
        await addToCart(d.buyNow, { quantity: Number(qty?.value || 1), variantId: variant?.value });
        navigate('/touma/checkout');
      },
      { button: el },
    );
  }
  if (d.contactStore) {
    if (!requireLogin()) return;
    return run(
      async () => {
        const conversation = await api('/conversations', {
          method: 'POST',
          body: { storeId: d.contactStore, orderId: d.order || undefined },
        });
        navigate(`/touma/messages/${conversation.id}`);
      },
      { button: el },
    );
  }
  if (d.gallery !== undefined) {
    const main = document.getElementById('gallery-main');
    if (main) main.innerHTML = `<img src="${d.gallery || '/touma/img/placeholder.svg'}" alt="" />`;
    el.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', String(b === el)));
    return;
  }
  if (d.estimate) {
    const destination = document.getElementById('ship-country').value;
    const target = document.getElementById('ship-estimate');
    return run(
      async () => {
        target.innerHTML = '<span class="muted">Calcul en cours…</span>';
        const quotes = await api('/shipping/quote', {
          method: 'POST',
          body: {
            origin: { countryCode: d.origin },
            destination: { countryCode: destination },
            weightGrams: Number(d.weight) || 1000,
            currency: d.currency,
          },
        });
        target.innerHTML = quotes.items
          .map(
            (q) => `<div class="summary-line"><span>${esc(q.serviceName)} <span class="muted">(${q.etaMinDays}–${q.etaMaxDays} j)</span></span><strong>${money(q.amount, q.currency)}</strong></div>`,
          )
          .join('');
      },
      { button: el },
    );
  }

  // Panier
  if (d.qty) {
    const input = document.querySelector(`[data-item-input="${d.item}"]`);
    const next = Math.max(0, Number(input.value) + Number(d.qty));
    return run(async () => {
      await api(`/cart/items/${d.item}`, { method: 'PATCH', body: { quantity: next } });
      await refreshCounters();
      await render();
    });
  }
  if (d.removeItem) {
    return run(async () => {
      await api(`/cart/items/${d.removeItem}`, { method: 'DELETE' });
      toast('Article retiré.');
      await refreshCounters();
      await render();
    });
  }
  if (d.clearCart !== undefined) {
    return run(async () => {
      const ok = await confirmDialog({ title: 'Vider le panier ?', body: 'Tous les articles seront retirés.', confirmLabel: 'Vider', danger: true });
      if (!ok) return;
      await api('/cart', { method: 'DELETE' });
      toast('Panier vidé.');
      await refreshCounters();
      await render();
    });
  }

  // Tunnel de commande
  if (d.checkoutNext) {
    const step = Number(d.checkoutNext);
    if (step === 1) {
      const selected = document.querySelector('input[name="address"]:checked');
      if (!selected) return toast('Choisissez une adresse de livraison.', 'error');
      shop.checkoutState.addressId = selected.value;
      const delivery = document.querySelector('input[name="delivery"]:checked')?.value ?? 'HOME';
      shop.checkoutState.deliveryMethod = delivery;
      if (delivery === 'PICKUP_POINT') {
        const point = document.getElementById('pickup-point');
        if (!point?.value) return toast('Choisissez un point relais.', 'error');
        shop.checkoutState.pickupPointId = point.value;
      }
    }
    shop.checkoutState.step = step;
    return navigate(`/touma/checkout?etape=${step}`);
  }
  if (d.placeOrder !== undefined) {
    const method = document.querySelector('input[name="method"]:checked')?.value ?? 'MOBILE_MONEY';
    return run(
      async () => {
        const key = `web-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        const result = await api('/checkout', {
          method: 'POST',
          body: {
            addressId: shop.checkoutState.addressId,
            shippingQuotes: shop.checkoutState.quotes,
            deliveryMethod: shop.checkoutState.deliveryMethod,
            pickupPointId: shop.checkoutState.pickupPointId ?? undefined,
            couponCode: shop.checkoutState.coupon?.code ?? undefined,
            loyaltyPoints: shop.checkoutState.loyaltyPoints || 0,
            idempotencyKey: key,
          },
        });
        // UN seul paiement pour tout le panier, même multi-vendeurs ; le serveur
        // confirme auprès du prestataire et répartit ensuite par commande.
        const created = await api('/payments/create', {
          method: 'POST',
          body: { orderGroupId: result.group.id, method, idempotencyKey: `pay-${result.group.id}` },
        });
        const confirmed = await api('/payments/confirm', { method: 'POST', body: { paymentId: created.payment.id } });
        const paid = confirmed.status === 'SUCCEEDED';
        shop.checkoutState.group = result.group;
        shop.checkoutState.orders = result.orders.map((o) => ({ ...o, status: paid ? 'PAID' : o.status }));
        // Les réductions ont été consommées : elles ne doivent pas se reporter
        // sur la commande suivante.
        shop.checkoutState.coupon = null;
        shop.checkoutState.loyaltyPoints = 0;
        shop.checkoutState.loyaltyValue = 0;
        shop.checkoutState.shippingTotal = null;
        shop.checkoutState.step = 3;
        await refreshCounters();
        toast(paid ? 'Commande confirmée. Merci !' : 'Commande créée : le paiement reste à confirmer.', paid ? 'success' : 'warning');
        navigate('/touma/checkout?etape=3');
      },
      { button: el },
    );
  }

  if (d.print !== undefined) {
    // L'export PDF passe par l'impression du navigateur : aucune bibliothèque
    // embarquée, et un rendu fidèle à ce que l'utilisateur voit.
    window.print();
    return;
  }

  if (d.pauseCoupon || d.resumeCoupon) {
    const id = d.pauseCoupon ?? d.resumeCoupon;
    const status = d.pauseCoupon ? 'PAUSED' : 'ACTIVE';
    return run(async () => {
      await api(`/coupons/${id}`, { method: 'PATCH', body: { status } });
      toast(status === 'PAUSED' ? 'Code suspendu.' : 'Code réactivé.', 'success');
      await render();
    });
  }

  if (d.removeCoupon !== undefined) {
    shop.checkoutState.coupon = null;
    toast('Code retiré.');
    return render();
  }

  // Commandes acheteur
  if (d.payGroup) {
    return run(
      async () => {
        const created = await api('/payments/create', {
          method: 'POST',
          body: { orderGroupId: d.payGroup, method: 'MOBILE_MONEY', idempotencyKey: `pay-${d.payGroup}` },
        });
        const confirmed = await api('/payments/confirm', { method: 'POST', body: { paymentId: created.payment.id } });
        toast(confirmed.status === 'SUCCEEDED' ? 'Paiement confirmé.' : `Paiement ${confirmed.status}.`, confirmed.status === 'SUCCEEDED' ? 'success' : 'error');
        await render();
      },
      { button: el },
    );
  }
  if (d.payOrder) {
    const method = document.getElementById('method')?.value ?? 'MOBILE_MONEY';
    return run(
      async () => {
        const created = await api('/payments/create', { method: 'POST', body: { orderId: d.payOrder, method, idempotencyKey: `pay-${d.payOrder}` } });
        const confirmed = await api('/payments/confirm', { method: 'POST', body: { paymentId: created.payment.id } });
        toast(confirmed.status === 'SUCCEEDED' ? 'Paiement confirmé.' : `Paiement ${confirmed.status}.`, confirmed.status === 'SUCCEEDED' ? 'success' : 'error');
        await render();
      },
      { button: el },
    );
  }
  if (d.cancelOrder) {
    return run(async () => {
      const ok = await confirmDialog({ title: 'Annuler la commande ?', body: 'Le stock sera restitué au vendeur. Cette action est définitive.', confirmLabel: 'Annuler la commande', danger: true });
      if (!ok) return;
      await api(`/orders/${d.cancelOrder}/status`, { method: 'PATCH', body: { status: 'CANCELLED' } });
      toast('Commande annulée.');
      await render();
    });
  }
  if (d.completeOrder) {
    return run(async () => {
      await api(`/orders/${d.completeOrder}/status`, { method: 'PATCH', body: { status: 'COMPLETED' } });
      toast('Réception confirmée. Merci !', 'success');
      await render();
    });
  }

  // Après-vente
  if (d.cancelReturn) {
    return run(async () => {
      const ok = await confirmDialog({
        title: 'Retirer la demande de retour ?',
        body: 'Le vendeur ne la traitera plus. Vous pourrez en ouvrir une nouvelle tant que le délai court.',
        confirmLabel: 'Retirer la demande',
        danger: true,
      });
      if (!ok) return;
      await api(`/returns/${d.cancelReturn}/cancel`, { method: 'POST' });
      toast('Demande retirée.');
      await render();
    });
  }
  if (d.closeTicket) {
    return run(async () => {
      await api(`/support/tickets/${d.closeTicket}/close`, { method: 'POST' });
      toast('Ticket clos. Merci de nous avoir prévenus.', 'success');
      await render();
    });
  }

  // Compte
  if (d.deleteAddress) {
    return run(async () => {
      const ok = await confirmDialog({ title: 'Supprimer cette adresse ?', body: 'Elle ne sera plus proposée au moment de la commande.', confirmLabel: 'Supprimer', danger: true });
      if (!ok) return;
      await api(`/auth/me/addresses/${d.deleteAddress}`, { method: 'DELETE' });
      toast('Adresse supprimée.');
      await render();
    });
  }
  if (d.readAll !== undefined) {
    return run(async () => {
      await api('/notifications/read-all', { method: 'POST' });
      document.getElementById('modal-root').innerHTML = '';
      await refreshCounters();
      await render();
    });
  }
  if (d.logoutAll !== undefined) {
    return run(async () => {
      const ok = await confirmDialog({ title: 'Déconnecter tous les appareils ?', body: 'Toutes vos sessions seront fermées, y compris celle-ci.', confirmLabel: 'Déconnecter' });
      if (!ok) return;
      await api('/auth/logout', { method: 'POST', body: { allDevices: true } });
      session.clear();
      navigate('/touma/');
    });
  }

  // Vendeur
  if (d.toggleProduct) {
    return run(async () => {
      await api(`/products/${d.toggleProduct}`, { method: 'PATCH', body: { status: d.status } });
      toast(d.status === 'ACTIVE' ? 'Produit publié.' : 'Produit dépublié.', 'success');
      await render();
    });
  }
  if (d.archiveProduct) {
    return run(async () => {
      const ok = await confirmDialog({ title: 'Archiver ce produit ?', body: 'Il disparaît du catalogue public. Les commandes passées ne sont pas modifiées.', confirmLabel: 'Archiver', danger: true });
      if (!ok) return;
      await api(`/products/${d.archiveProduct}`, { method: 'DELETE' });
      toast('Produit archivé.');
      navigate('/touma/vendeur/produits');
    });
  }
  if (d.createShipment) {
    return run(
      async () => {
        const shipment = await api('/shipping/create', { method: 'POST', body: { orderId: d.createShipment } });
        toast(`Expédition créée : ${shipment.trackingNumber}`, 'success');
        await render();
      },
      { button: el },
    );
  }
  if (d.updateShipment) {
    const status = document.getElementById('ship-status').value;
    return run(
      async () => {
        await api(`/shipping/${d.updateShipment}/status`, { method: 'PATCH', body: { status } });
        toast('Suivi mis à jour.', 'success');
        await render();
      },
      { button: el },
    );
  }

  // TOUMA Business
  if (el.id === 'add-rfq-item') {
    event.preventDefault();
    const container = document.getElementById('rfq-items');
    const template = container.firstElementChild.cloneNode(true);
    template.querySelectorAll('input').forEach((input) => {
      if (input.classList.contains('i-qty')) input.value = '100';
      else if (input.classList.contains('i-unit')) input.value = 'kg';
      else input.value = '';
    });
    // Les identifiants doivent rester uniques (libellés accessibles).
    const index = container.children.length;
    template.querySelectorAll('input, select').forEach((field) => {
      const oldId = field.id;
      field.id = `${oldId.replace(/-\d+$/, '')}-${index}`;
      const labelFor = template.querySelector(`label[for="${oldId}"]`);
      if (labelFor) labelFor.setAttribute('for', field.id);
    });
    container.appendChild(template);
    return;
  }
  if (d.closeRfq) {
    return run(async () => {
      const ok = await confirmDialog({
        title: 'Clore cette demande ?',
        body: 'Les fournisseurs ne pourront plus y répondre. Les offres déjà reçues restent consultables.',
        confirmLabel: 'Clore',
      });
      if (!ok) return;
      await api(`/rfqs/${d.closeRfq}/close`, { method: 'POST' });
      toast('Demande close.');
      await render();
    });
  }
  if (d.acceptQuote) {
    const select = el.parentElement.querySelector('.accept-address');
    return run(
      async () => {
        const ok = await confirmDialog({
          title: 'Accepter cette offre ?',
          body: 'Une commande sera créée au prix négocié et les autres offres seront écartées.',
          confirmLabel: 'Accepter et commander',
        });
        if (!ok) return;
        const result = await api(`/quotes/${d.acceptQuote}/accept`, { method: 'POST', body: { addressId: select.value } });
        toast(`Commande ${result.orderNumber} créée.`, 'success');
        navigate(`/touma/commandes/groupe/${result.orderGroupId}`);
      },
      { button: el },
    );
  }
  if (d.rejectQuote) {
    return run(async () => {
      const reason = prompt('Motif du refus (communiqué au fournisseur, facultatif) :');
      await api(`/quotes/${d.rejectQuote}/reject`, { method: 'POST', body: reason ? { reason } : {} });
      toast('Offre écartée.');
      await render();
    });
  }

  // Administration
  if (d.userStatus) {
    return run(async () => {
      await api(`/admin/users/${d.userStatus}/status`, { method: 'PATCH', body: { status: d.status } });
      toast('Statut mis à jour.');
      await render();
    });
  }
  if (d.userRisk) {
    return run(async () => {
      const score = await api(`/admin/risk/${d.userRisk}/recompute`, { method: 'POST' });
      toast(`Score recalculé : ${score.score} (${score.level}).`);
      await render();
    });
  }
  if (d.storeStatus) {
    return run(async () => {
      await api(`/admin/stores/${d.storeStatus}/status`, { method: 'PATCH', body: { status: d.status } });
      toast('Boutique mise à jour.');
      await render();
    });
  }
  if (d.productStatus) {
    return run(async () => {
      await api(`/admin/products/${d.productStatus}/status`, { method: 'PATCH', body: { status: d.status } });
      toast('Produit mis à jour.');
      await render();
    });
  }
  if (d.approveVerification) {
    return run(async () => {
      const ok = await confirmDialog({ title: 'Approuver ce vendeur ?', body: 'La boutique affichera le badge « Vendeur vérifié ». La décision est journalisée.', confirmLabel: 'Approuver' });
      if (!ok) return;
      await api(`/admin/verifications/${d.approveVerification}/approve`, { method: 'POST', body: { comment: 'Documents vérifiés.' } });
      toast('Vendeur vérifié.', 'success');
      await render();
    });
  }
  if (d.rejectVerification) {
    return run(async () => {
      const comment = prompt('Motif du rejet (communiqué au vendeur) :');
      if (!comment) return;
      await api(`/admin/verifications/${d.rejectVerification}/reject`, { method: 'POST', body: { comment } });
      toast('Dossier rejeté.');
      await render();
    });
  }
  if (d.resolveDispute) {
    return run(async () => {
      const resolution = prompt('Motivation de la décision (journalisée) :');
      if (!resolution) return;
      await api(`/disputes/${d.resolveDispute}/resolve`, { method: 'POST', body: { decision: d.decision, resolution } });
      toast('Litige tranché.', 'success');
      await render();
    });
  }
});

// Formulaires.
document.addEventListener('submit', (event) => {
  const form = event.target;
  const submit = form.querySelector('[type="submit"]');

  if (form.id === 'search-form') {
    event.preventDefault();
    const q = document.getElementById('search-input').value.trim();
    return navigate(q ? `/touma/produits?q=${encodeURIComponent(q)}` : '/touma/produits');
  }

  if (form.id === 'filters') {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form).entries()) if (String(value).trim()) params.set(key, String(value).trim());
    return navigate(`/touma/produits?${params.toString()}`);
  }

  if (form.id === 'admin-search') {
    event.preventDefault();
    const q = new FormData(form).get('q');
    return navigate(`/touma/admin/${form.dataset.section}${q ? `?q=${encodeURIComponent(String(q))}` : ''}`);
  }

  if (form.id === 'login-form') {
    event.preventDefault();
    return run(
      async () => {
        const data = await api('/auth/login', {
          method: 'POST',
          body: { email: document.getElementById('l-email').value, password: document.getElementById('l-password').value },
        });
        session.write({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
        toast(`Bienvenue, ${data.user.name.split(' ')[0]}.`, 'success');
        navigate(document.getElementById('l-next').value || '/touma/');
      },
      { button: submit },
    );
  }

  if (form.id === 'register-form') {
    event.preventDefault();
    return run(
      async () => {
        const body = {
          name: document.getElementById('r-name').value,
          email: document.getElementById('r-email').value,
          password: document.getElementById('r-password').value,
          countryCode: document.getElementById('r-country').value,
          role: document.querySelector('input[name="role"]:checked')?.value ?? 'BUYER',
        };
        const phone = document.getElementById('r-phone').value.trim();
        if (phone) body.phone = phone;
        const data = await api('/auth/register', { method: 'POST', body });
        session.write({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
        toast('Compte créé. Bienvenue sur TOUMA.', 'success');
        navigate(data.user.role === 'SELLER' ? '/touma/vendeur/boutique' : '/touma/produits');
      },
      { button: submit },
    );
  }

  if (form.id === 'address-form') {
    event.preventDefault();
    return run(
      async () => {
        const data = Object.fromEntries(new FormData(form).entries());
        const created = await api('/auth/me/addresses', { method: 'POST', body: { ...data, isDefault: true } });
        shop.checkoutState.addressId = created.id;
        toast('Adresse enregistrée.', 'success');
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'create-store-form') {
    event.preventDefault();
    return run(
      async () => {
        const store = await api('/stores', {
          method: 'POST',
          body: {
            name: document.getElementById('ns-name').value,
            countryCode: document.getElementById('ns-country').value,
            city: document.getElementById('ns-city').value || undefined,
            description: document.getElementById('ns-desc').value || undefined,
          },
        });
        const current = session.read();
        if (current?.user?.role === 'BUYER') session.write({ ...current, user: { ...current.user, role: 'SELLER' } });
        toast(`Boutique « ${store.name} » créée.`, 'success');
        navigate('/touma/vendeur/produits/nouveau');
      },
      { button: submit },
    );
  }

  if (form.classList.contains('store-form')) {
    event.preventDefault();
    return run(
      async () => {
        const body = Object.fromEntries([...new FormData(form).entries()].filter(([, v]) => String(v).trim() !== ''));
        await api(`/stores/${form.dataset.store}`, { method: 'PATCH', body });
        toast('Boutique mise à jour.', 'success');
      },
      { button: submit },
    );
  }

  if (form.id === 'product-form') {
    event.preventDefault();
    return run(
      async () => {
        const image = document.getElementById('p-image').value.trim();
        const body = {
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

        if (form.dataset.product) {
          await api(`/products/${form.dataset.product}`, { method: 'PATCH', body });
          toast('Produit mis à jour.', 'success');
        } else {
          await api('/products', { method: 'POST', body: { ...body, storeId: document.getElementById('p-store').value } });
          toast('Produit publié.', 'success');
        }
        navigate('/touma/vendeur/produits');
      },
      { button: submit },
    );
  }

  if (form.id === 'verification-form') {
    event.preventDefault();
    return run(
      async () => {
        await api('/verification/submit', {
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
        toast('Dossier envoyé. Réponse sous quelques jours ouvrés.', 'success');
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'review-form') {
    event.preventDefault();
    return run(
      async () => {
        await api('/reviews', {
          method: 'POST',
          body: {
            orderId: form.dataset.order,
            productId: document.getElementById('r-product').value,
            rating: Number(document.getElementById('r-rating').value),
            comment: document.getElementById('r-comment').value || undefined,
          },
        });
        toast('Merci, votre avis est publié.', 'success');
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'business-form') {
    event.preventDefault();
    return run(
      async () => {
        const optional = (id) => document.getElementById(id).value.trim() || undefined;
        await api('/business/profile', {
          method: 'PUT',
          body: {
            legalName: document.getElementById('b-legal').value,
            registrationNo: optional('b-reg'),
            taxId: optional('b-tax'),
            sector: optional('b-sector'),
            countryCode: document.getElementById('b-country').value,
            city: optional('b-city'),
            phone: optional('b-phone'),
            website: optional('b-website'),
            annualVolume: optional('b-volume'),
          },
        });
        toast('Profil entreprise enregistré.', 'success');
      },
      { button: submit },
    );
  }

  if (form.id === 'rfq-form') {
    event.preventDefault();
    return run(
      async () => {
        const items = [...document.querySelectorAll('#rfq-items .rfq-item')].map((row) => {
          const target = row.querySelector('.i-target').value.trim().replace(',', '.');
          const categoryId = row.querySelector('.i-category').value;
          return {
            name: row.querySelector('.i-name').value,
            description: row.querySelector('.i-desc').value.trim() || undefined,
            quantity: Number(row.querySelector('.i-qty').value),
            unit: row.querySelector('.i-unit').value || 'pièce',
            targetUnitPrice: target || undefined,
            categoryId: categoryId || undefined,
          };
        });
        const deadline = document.getElementById('q-deadline').value;
        const source = document.getElementById('q-source').value;
        const rfq = await api('/rfqs', {
          method: 'POST',
          body: {
            title: document.getElementById('q-title').value,
            description: document.getElementById('q-description').value,
            countryCode: document.getElementById('q-country').value,
            city: document.getElementById('q-city').value.trim() || undefined,
            sourceCountry: source || undefined,
            currency: document.getElementById('q-currency').value,
            deadline: deadline ? new Date(`${deadline}T12:00:00Z`).toISOString() : undefined,
            items,
          },
        });
        toast('Demande publiée : les fournisseurs peuvent répondre.', 'success');
        navigate(`/touma/business/appels-offres/${rfq.id}`);
      },
      { button: submit },
    );
  }

  if (form.id === 'quote-form') {
    event.preventDefault();
    return run(
      async () => {
        const items = [...document.querySelectorAll('#quote-lines .quote-line')].map((row) => ({
          rfqItemId: row.dataset.rfqItem,
          name: row.querySelector('.ql-name').value,
          quantity: Number(row.querySelector('.ql-qty').value),
          unit: row.querySelector('.ql-unit').value,
          unitPrice: row.querySelector('.ql-price').value.replace(',', '.'),
        }));
        await api(`/rfqs/${form.dataset.rfq}/quotes`, {
          method: 'POST',
          body: {
            storeId: document.getElementById('qf-store').value,
            shippingTotal: document.getElementById('qf-shipping').value.replace(',', '.') || '0',
            leadTimeDays: Number(document.getElementById('qf-lead').value),
            validityDays: Number(document.getElementById('qf-validity').value),
            message: document.getElementById('qf-message').value.trim() || undefined,
            items,
          },
        });
        toast('Offre envoyée à l’acheteur.', 'success');
        await render();
      },
      { button: submit },
    );
  }

  if (form.classList.contains('negotiate-form')) {
    event.preventDefault();
    return run(
      async () => {
        const body = form.querySelector('.neg-body').value.trim();
        if (!body) return toast('Écrivez votre message.', 'error');
        const proposed = form.querySelector('.neg-total').value.trim().replace(',', '.');
        await api(`/quotes/${form.dataset.quote}/messages`, {
          method: 'POST',
          body: { kind: proposed ? 'COUNTER_OFFER' : 'MESSAGE', body, proposedTotal: proposed || undefined },
        });
        toast(proposed ? 'Contre-proposition envoyée.' : 'Message envoyé.', 'success');
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'message-form') {
    event.preventDefault();
    return run(
      async () => {
        await api(`/conversations/${form.dataset.conversation}/messages`, {
          method: 'POST',
          body: { body: document.getElementById('m-body').value },
        });
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'sourcing-filters') {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form).entries()) if (String(value).trim()) params.set(key, String(value).trim());
    return navigate(`/touma/sourcing?${params.toString()}`);
  }

  if (form.id === 'invite-form') {
    event.preventDefault();
    return run(
      async () => {
        const storeIds = [...document.querySelectorAll('.supplier-pick')]
          .filter((box) => box.checked)
          .map((box) => box.dataset.store);
        if (!storeIds.length) return toast('Cochez au moins un fournisseur.', 'error');
        const rfqId = document.getElementById('so-rfq').value;
        const result = await api(`/rfqs/${rfqId}/invitations`, { method: 'POST', body: { storeIds } });
        toast(
          result.invited
            ? `${result.invited} fournisseur(s) sollicité(s).`
            : 'Ces fournisseurs étaient déjà sollicités.',
          result.invited ? 'success' : 'info',
        );
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'coupon-create-form') {
    event.preventDefault();
    return run(
      async () => {
        const value = document.getElementById('co-value').value.trim().replace(',', '.');
        const currency = document.getElementById('co-currency').value.trim().toUpperCase();
        const countries = document.getElementById('co-countries').value
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean);
        const endsAt = document.getElementById('co-ends').value;
        const limit = document.getElementById('co-limit').value;
        const perUser = document.getElementById('co-limit-user').value;
        const min = document.getElementById('co-min').value.trim().replace(',', '.');
        const max = document.getElementById('co-max').value.trim().replace(',', '.');

        await api('/coupons', {
          method: 'POST',
          body: {
            code: document.getElementById('co-code').value.trim(),
            type: document.getElementById('co-type').value,
            value: value || undefined,
            currency: currency || undefined,
            description: document.getElementById('co-description').value || '',
            storeId: form.dataset.scope === 'store' ? document.getElementById('co-store').value : undefined,
            minOrderAmount: min || undefined,
            maxDiscountAmount: max || undefined,
            countryCodes: countries,
            firstOrderOnly: document.getElementById('co-first').checked,
            // Une date de fin saisie vaut pour toute la journée choisie.
            endsAt: endsAt ? new Date(`${endsAt}T23:59:59Z`).toISOString() : undefined,
            usageLimit: limit ? Number(limit) : undefined,
            usageLimitPerUser: perUser ? Number(perUser) : undefined,
          },
        });
        toast('Code créé.', 'success');
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'coupon-form') {
    event.preventDefault();
    return run(
      async () => {
        const code = document.getElementById('c-code').value.trim();
        if (!code) return toast('Saisissez un code.', 'error');
        // C'est le serveur qui valide le code et calcule la remise : l'interface
        // se contente d'afficher ce qu'il renvoie.
        const preview = await api('/coupons/preview', { method: 'POST', body: { code } });
        shop.checkoutState.coupon = preview;
        toast(`${preview.label} appliqué.`, 'success');
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'loyalty-form') {
    event.preventDefault();
    return run(
      async () => {
        const field = document.getElementById('c-points');
        const points = Math.max(0, Math.floor(Number(field.value) || 0));
        const usable = await api('/loyalty/usable');
        if (points > usable.usablePoints) {
          return toast(`Vous pouvez utiliser au plus ${usable.usablePoints} point(s).`, 'error');
        }
        shop.checkoutState.loyaltyPoints = points;
        // Le taux vient du serveur : l'interface se contente de multiplier.
        shop.checkoutState.loyaltyValue = points * usable.pointValue;
        toast(points ? `${points} point(s) appliqué(s).` : 'Points retirés.', 'success');
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'return-form') {
    event.preventDefault();
    return run(
      async () => {
        // Le serveur recalcule le montant : l'interface n'envoie que des quantités.
        const items = [...form.querySelectorAll('.rr-pick')]
          .filter((box) => box.checked)
          .map((box) => ({
            orderItemId: box.dataset.item,
            quantity: Number(form.querySelector(`.rr-qty[data-item="${box.dataset.item}"]`)?.value || 1),
          }));
        if (!items.length) return toast('Sélectionnez au moins un article à retourner.', 'error');
        const photo = document.getElementById('rr-photo').value.trim();
        const created = await api('/returns', {
          method: 'POST',
          body: {
            orderId: form.dataset.order,
            reason: document.getElementById('rr-reason').value,
            comment: document.getElementById('rr-comment').value || '',
            items,
            evidence: photo ? [{ url: photo, name: 'photo', mimeType: 'image/jpeg' }] : [],
          },
        });
        toast('Demande de retour envoyée au vendeur.', 'success');
        navigate(`/touma/retours/${created.id}`);
      },
      { button: submit },
    );
  }

  if (form.id === 'return-approve-form') {
    event.preventDefault();
    return run(
      async () => {
        const amount = document.getElementById('ra-amount').value.trim().replace(',', '.');
        await api(`/returns/${form.dataset.return}/approve`, {
          method: 'POST',
          body: { approvedAmount: amount || undefined, note: document.getElementById('ra-note').value || undefined },
        });
        toast('Retour accepté.', 'success');
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'return-reject-form') {
    event.preventDefault();
    return run(
      async () => {
        await api(`/returns/${form.dataset.return}/reject`, {
          method: 'POST',
          body: { note: document.getElementById('rj-note').value },
        });
        toast('Retour refusé : l’acheteur en est informé.', 'info');
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'return-ship-form') {
    event.preventDefault();
    return run(
      async () => {
        await api(`/returns/${form.dataset.return}/ship`, {
          method: 'POST',
          body: { trackingNumber: document.getElementById('rs-tracking').value },
        });
        toast('Merci : le vendeur suit votre colis.', 'success');
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'return-receive-form') {
    event.preventDefault();
    return run(
      async () => {
        await api(`/returns/${form.dataset.return}/receive`, {
          method: 'POST',
          body: {
            condition: document.getElementById('rc-condition').value || undefined,
            restock: document.getElementById('rc-restock').checked,
          },
        });
        toast('Réception enregistrée.', 'success');
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'return-refund-form') {
    event.preventDefault();
    const amount = document.getElementById('rf-amount').value.trim().replace(',', '.');
    return run(
      async () => {
        // Mouvement d'argent réel : confirmation explicite avant l'appel.
        const ok = await confirmDialog({
          title: 'Confirmer le remboursement',
          body: `Rembourser ${amount} à l’acheteur ? Cette opération est tracée et définitive.`,
          confirmLabel: 'Rembourser',
        });
        if (!ok) return;
        await api(`/returns/${form.dataset.return}/refund`, { method: 'POST', body: { amount: amount || undefined } });
        toast('Remboursement effectué.', 'success');
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'ticket-form') {
    event.preventDefault();
    return run(
      async () => {
        const created = await api('/support/tickets', {
          method: 'POST',
          body: {
            subject: document.getElementById('t-subject').value,
            category: document.getElementById('t-category').value,
            message: document.getElementById('t-message').value,
            orderId: form.dataset.order || undefined,
          },
        });
        toast('Demande envoyée : nous vous répondons ici même.', 'success');
        navigate(`/touma/aide/${created.id}`);
      },
      { button: submit },
    );
  }

  if (form.id === 'ticket-reply-form') {
    event.preventDefault();
    return run(
      async () => {
        await api(`/support/tickets/${form.dataset.ticket}/messages`, {
          method: 'POST',
          body: {
            body: document.getElementById('tr-body').value,
            internal: document.getElementById('tr-internal')?.checked ?? false,
          },
        });
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'ticket-update-form') {
    event.preventDefault();
    return run(
      async () => {
        await api(`/support/tickets/${form.dataset.ticket}`, {
          method: 'PATCH',
          body: {
            status: document.getElementById('tu-status').value,
            priority: document.getElementById('tu-priority').value,
          },
        });
        toast('Ticket mis à jour.', 'success');
        await render();
      },
      { button: submit },
    );
  }

  if (form.id === 'dispute-form') {
    event.preventDefault();
    return run(
      async () => {
        await api('/disputes', {
          method: 'POST',
          body: {
            orderId: form.dataset.order,
            reason: document.getElementById('d-reason').value,
            details: document.getElementById('d-details').value || undefined,
          },
        });
        toast('Litige ouvert : l’équipe TOUMA examine votre dossier.', 'success');
        await render();
      },
      { button: submit },
    );
  }
});

// Champs à enregistrement direct (stock vendeur, quantité de panier, choix).
document.addEventListener('change', (event) => {
  const input = event.target;

  if (input.classList.contains('stock-input')) {
    return run(async () => {
      await api(`/products/${input.dataset.product}/stock`, { method: 'PUT', body: { quantity: Number(input.value) } });
      toast('Stock enregistré.', 'success');
    });
  }
  if (input.dataset.itemInput) {
    return run(async () => {
      await api(`/cart/items/${input.dataset.itemInput}`, { method: 'PATCH', body: { quantity: Number(input.value) } });
      await refreshCounters();
      await render();
    });
  }
  if (input.name === 'delivery') {
    const picker = document.getElementById('pickup-choice');
    if (picker) picker.hidden = input.value !== 'PICKUP_POINT';
    shop.checkoutState.deliveryMethod = input.value;
    if (input.value !== 'PICKUP_POINT') shop.checkoutState.pickupPointId = null;
  }
  if (input.id === 'pickup-point') {
    shop.checkoutState.pickupPointId = input.value;
  }
  if (input.type === 'radio') {
    // Retour visuel sur les choix (adresse, transport, paiement).
    document.querySelectorAll(`input[name="${input.name}"]`).forEach((radio) => {
      const box = radio.closest('.check');
      if (box) box.dataset.selected = String(radio.checked);
    });
    if (input.dataset.store) shop.checkoutState.quotes[input.dataset.store] = input.value;
    if (input.name === 'address') shop.checkoutState.addressId = input.value;
  }
});

// Génération de description par Touma AI (proposition, jamais publication auto).
document.addEventListener('click', (event) => {
  if (event.target.closest('#ai-description') === null) return;
  const button = event.target.closest('#ai-description');
  const title = document.getElementById('p-title').value.trim();
  if (!title) return toast('Renseignez d’abord un titre.', 'error');
  const category = document.getElementById('p-category');
  run(
    async () => {
      const result = await api('/ai/generate', {
        method: 'POST',
        body: {
          useCase: 'product_description',
          prompt: title,
          context: { title, category: category.options[category.selectedIndex]?.text, countryCode: document.getElementById('p-country').value },
        },
      });
      document.getElementById('p-description').value = result.text;
      toast('Proposition générée : relisez-la avant publication.');
    },
    { button },
  );
});

// Fermeture du tiroir et des modales au clavier.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (document.getElementById('drawer').dataset.open === 'true') setDrawer(false);
});
document.getElementById('drawer-backdrop').addEventListener('click', () => setDrawer(false));

// Navigation par l'historique du navigateur.
window.addEventListener('popstate', render);
window.addEventListener('touma:session', renderChrome);

// Bandeau du corridor.
(async () => {
  const bar = document.getElementById('corridor');
  try {
    const { items } = await api('/countries');
    const names = items.map((c) => c.name).join(' ↔ ');
    bar.innerHTML = `Corridor ouvert : <strong>${esc(names)}</strong> — d'autres marchés africains s'activeront depuis le référentiel.`;
  } catch {
    bar.textContent = 'TOUMA — commerce transfrontalier africain';
  }
})();

// Recherche pré-remplie depuis l'URL.
const initialQuery = new URL(location.href).searchParams.get('q');
if (initialQuery) document.getElementById('search-input').value = initialQuery;

render();

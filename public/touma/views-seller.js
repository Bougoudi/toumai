/**
 * TOUMA — Seller Center : tableau de bord, boutique, produits, commandes,
 * expéditions, vérification et analyse des ventes.
 */
import { api, esc, money, formatDate, label, session, statusPill, emptyState, productImage, svg } from './core.js';
import { breadcrumb, barChart, statCard, trackingTimeline } from './components.js';
import { t } from './i18n.js';

// Les libellés sont des clés, pas du texte : l'onglet est résolu au rendu,
// donc un changement de langue en cours de session suit immédiatement.
const TABS = [
  ['/touma/vendeur', 'seller.tab.dashboard'],
  ['/touma/vendeur/produits', 'seller.tab.products'],
  ['/touma/vendeur/import', 'seller.tab.import'],
  ['/touma/vendeur/commandes', 'seller.tab.orders'],
  ['/touma/vendeur/messages', 'seller.tab.messages'],
  ['/touma/vendeur/retours', 'seller.tab.returns'],
  ['/touma/vendeur/litiges', 'seller.tab.disputes'],
  ['/touma/vendeur/promotions', 'seller.tab.promotions'],
  ['/touma/vendeur/documents', 'seller.tab.documents'],
  ['/touma/vendeur/zones', 'seller.tab.zones'],
  ['/touma/vendeur/finance', 'seller.tab.finance'],
  ['/touma/vendeur/boutique', 'seller.tab.store'],
  ['/touma/vendeur/analyses', 'seller.tab.analytics'],
  ['/touma/vendeur/verification', 'seller.tab.verification'],
];

export function tabs(current) {
  return `<nav class="tabs" aria-label="${esc(t('seller.area'))}">
    ${TABS.map(([href, cle]) => `<a href="${href}" data-link${href === current ? ' aria-current="page"' : ''}>${esc(t(cle))}</a>`).join('')}
  </nav>`;
}

function noStore() {
  return emptyState({
    title: t('seller.noStoreTitle'),
    body: t('seller.noStoreBody'),
    actionLabel: t('seller.noStoreAction'),
    actionHref: '/touma/vendeur/boutique',
    iconName: 'store',
  });
}

// ── Tableau de bord ────────────────────────────────────────────────────────
const reputationLevel = (code) => t(`reputation.level.${code}`);

const pct = (value) => `${Math.round(value * 100)} %`;

/**
 * Réputation du vendeur, avec le poids de chaque composante : un vendeur doit
 * pouvoir agir sur son score, donc savoir ce qui le compose.
 */
function reputationPanel(r, store) {
  if (!r.published) {
    return `<section class="card" style="margin-bottom:var(--space-5)">
      <h2 style="font-size:var(--text-md)">${esc(t('reputation.title'))}</h2>
      <p class="small muted" style="margin:0">
        ${esc(t('reputation.unpublished', { minimum: r.minimumOrders, delivered: r.ordersDelivered }))}
      </p>
    </section>`;
  }

  const m = r.metrics;
  const rows = [
    [t('reputation.onTime'), m.onTimeRate === null ? null : pct(m.onTimeRate), r.weights.onTime],
    [t('reputation.rating'), r.rating.count ? `${r.rating.average.toFixed(1)}/5 (${r.rating.count})` : null, r.weights.rating],
    [t('reputation.cancellation'), m.cancellationRate === null ? null : pct(1 - m.cancellationRate), r.weights.cancellation],
    [
      t('reputation.problems'),
      m.disputeRate === null || m.returnRate === null ? null : pct(Math.max(0, 1 - (m.disputeRate + m.returnRate))),
      r.weights.problems,
    ],
    [t('reputation.responsiveness'), m.responseRate === null ? null : pct(m.responseRate), r.weights.responsiveness],
  ];

  return `<section class="card" style="margin-bottom:var(--space-5)">
    <div class="card-head">
      <div>
        <h2 style="font-size:var(--text-md);margin-bottom:2px">${esc(t('reputation.titleFor', { store: store.name }))}</h2>
        <span class="small muted">${esc(t('reputation.computedOn', { count: r.ordersDelivered }))}</span>
      </div>
      <span class="badge badge-verified">${esc(reputationLevel(r.level))} · ${r.score}/100</span>
    </div>
    <div class="table-wrap" style="border:0"><table>
      <thead><tr><th>${esc(t('reputation.component'))}</th><th>${esc(t('reputation.yourResult'))}</th><th>${esc(t('reputation.weight'))}</th></tr></thead>
      <tbody>
        ${rows
          .map(
            ([labelText, value, weight]) => `<tr>
              <td>${esc(labelText)}</td>
              <td>${value === null ? `<span class="muted small">${esc(t('reputation.notMeasurable'))}</span>` : esc(value)}</td>
              <td class="small muted">${Math.round(weight * 100)} %</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table></div>
    <p class="xs muted" style="margin:var(--space-3) 0 0">${esc(t('reputation.note'))}</p>
  </section>`;
}

export async function dashboard() {
  const data = await api('/seller/dashboard');
  if (!data.stores.length) return `<h1>${esc(t('seller.area'))}</h1>${tabs('/touma/vendeur')}${noStore()}`;

  const main = data.stores[0];
  const [analytics, reputation] = await Promise.all([
    api(`/seller/stores/${main.id}/analytics?days=30`).catch(() => null),
    // Recalculée à la demande : le vendeur veut voir l'effet de ses actions.
    api(`/reputation/mine/${main.id}`).catch(() => null),
  ]);
  const revenue = Object.entries(main.stats.revenue);
  const user = session.user;
  // Un prénom vide donnait « Bonjour  » : on salue alors sans nom.
  const prenom = (user?.name ?? '').trim().split(' ')[0];

  return `
    <div class="row-between">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px">${esc(prenom ? t('seller.greeting', { name: prenom }) : t('seller.greetingNoName'))}</h1>
        <p class="muted small" style="margin:0">${esc(t('seller.dashboardIntro'))}</p>
      </div>
      <a class="btn btn-accent" href="/touma/vendeur/produits/nouveau" data-link>${esc(t('seller.addProduct'))}</a>
    </div>
    ${tabs('/touma/vendeur')}

    ${data.stores
      .map(
        (s) => `<section class="card" style="margin-bottom:var(--space-5)">
          <div class="card-head">
            <div>
              <h2 style="font-size:var(--text-md);margin-bottom:2px">${esc(s.name)}</h2>
              <span class="small muted">${esc(s.countryCode)} · <a href="/touma/boutiques/${esc(s.slug)}" data-link>${esc(t('seller.viewStorefront'))}</a></span>
            </div>
            <div class="row" style="gap:var(--space-2)">
              ${statusPill(s.status)}
              ${s.verificationStatus === 'APPROVED'
                ? `<span class="badge badge-verified">${esc(t('seller.verified'))}</span>`
                : `<a class="badge badge-warn" href="/touma/vendeur/verification" data-link>${esc(t('seller.verificationState', { status: label(s.verificationStatus) }))}</a>`}
            </div>
          </div>
          <div class="grid grid-stats">
            ${statCard(t('seller.stat.revenue'), Object.entries(s.stats.revenue).map(([c, v]) => money(v, c)).join(' · ') || '—', t('seller.stat.revenueHint'))}
            ${statCard(t('seller.stat.paidOrders'), s.stats.paidOrders)}
            ${statCard(t('seller.stat.toShip'), s.stats.toShip, t(s.stats.toShip ? 'seller.stat.toShipAction' : 'seller.stat.toShipNone'))}
            ${statCard(t('seller.stat.activeProducts'), s.stats.activeProducts)}
            ${statCard(t('seller.stat.lowStock'), s.stats.lowStockItems, t(s.stats.lowStockItems ? 'seller.stat.lowStockAction' : 'seller.stat.lowStockNone'))}
          </div>
        </section>`,
      )
      .join('')}

    ${reputation ? reputationPanel(reputation, main) : ''}

    ${analytics
      ? `<section class="card" style="margin-bottom:var(--space-5)">
          <div class="card-head"><h2 style="font-size:var(--text-md)">${esc(t('seller.sales30', { store: main.name }))}</h2></div>
          ${barChart(analytics.series, { valueKey: 'revenue', labelKey: 'date', currency: analytics.series.find((s) => s.currency)?.currency ?? null })}
        </section>`
      : ''}

    <section class="card">
      <div class="card-head">
        <h2 style="font-size:var(--text-md)">${esc(t('seller.recentOrders'))}</h2>
        <a class="small" href="/touma/vendeur/commandes" data-link>${esc(t('action.seeAll'))}</a>
      </div>
      ${data.recentOrders.length
        ? `<div class="table-wrap" style="border:0"><table>
            <thead><tr><th>${esc(t('seller.col.order'))}</th><th>${esc(t('seller.col.customer'))}</th><th>${esc(t('seller.col.status'))}</th><th>${esc(t('seller.col.total'))}</th><th></th></tr></thead>
            <tbody>
              ${data.recentOrders
                .map(
                  (o) => `<tr>
                    <td><strong>${esc(o.orderNumber)}</strong><div class="xs muted">${formatDate(o.createdAt)}</div></td>
                    <td>${esc(o.buyer)}</td>
                    <td>${statusPill(o.status)}</td>
                    <td>${money(o.total, o.currency)}</td>
                    <td><a class="btn btn-secondary btn-sm" href="/touma/vendeur/commandes/${esc(o.id)}" data-link>${esc(t('seller.process'))}</a></td>
                  </tr>`,
                )
                .join('')}
            </tbody>
          </table></div>`
        : `<p class="muted small">${esc(t('seller.noOrders'))}</p>`}
    </section>`;
}

// ── Boutique ───────────────────────────────────────────────────────────────
export async function storeSettings() {
  const [mine, countries] = await Promise.all([api('/stores/mine'), api('/countries')]);
  return `
    <h1 style="font-size:var(--text-xl)">${esc(t('seller.tab.store'))}</h1>
    ${tabs('/touma/vendeur/boutique')}

    ${mine.items
      .map(
        (s) => `<form class="card store-form" data-store="${esc(s.id)}" style="margin-bottom:var(--space-5)">
          <div class="card-head">
            <h2 style="font-size:var(--text-md)">${esc(s.name)}</h2>
            <div class="row" style="gap:var(--space-2)">${statusPill(s.status)}<a class="btn btn-secondary btn-sm" href="/touma/boutiques/${esc(s.slug)}" data-link>${esc(t('seller.store.viewStorefrontBtn'))}</a></div>
          </div>
          <div class="grid grid-2">
            <div class="field"><label for="n-${esc(s.id)}">${esc(t('seller.field.name'))}</label><input id="n-${esc(s.id)}" name="name" value="${esc(s.name)}" required /></div>
            <div class="field"><label for="c-${esc(s.id)}">${esc(t('seller.field.city'))}</label><input id="c-${esc(s.id)}" name="city" value="${esc(s.city ?? '')}" /></div>
          </div>
          <div class="field"><label for="d-${esc(s.id)}">${esc(t('seller.field.description'))}</label><textarea id="d-${esc(s.id)}" name="description" rows="3" maxlength="2000">${esc(s.description ?? '')}</textarea></div>
          <div class="grid grid-2">
            <div class="field"><label for="l-${esc(s.id)}">${esc(t('seller.field.logoUrl'))}</label><input id="l-${esc(s.id)}" name="logoUrl" type="url" value="${esc(s.logoUrl ?? '')}" placeholder="https://…" /></div>
            <div class="field"><label for="b-${esc(s.id)}">${esc(t('seller.field.bannerUrl'))}</label><input id="b-${esc(s.id)}" name="bannerUrl" type="url" value="${esc(s.bannerUrl ?? '')}" placeholder="https://…" /></div>
          </div>
          <div class="field"><label for="p-${esc(s.id)}">${esc(t('seller.field.phone'))}</label><input id="p-${esc(s.id)}" name="phone" value="${esc(s.phone ?? '')}" inputmode="tel" /></div>
          <button class="btn" type="submit">${esc(t('action.save'))}</button>
        </form>`,
      )
      .join('')}

    <form class="card" id="create-store-form">
      <h2 style="font-size:var(--text-md)">${esc(t(mine.items.length ? 'seller.store.openAnother' : 'seller.store.openMine'))}</h2>
      <div class="field"><label for="ns-name">${esc(t('seller.store.nameLabel'))}</label><input id="ns-name" required maxlength="120" /></div>
      <div class="grid grid-2">
        <div class="field"><label for="ns-country">${esc(t('seller.field.country'))}</label>
          <select id="ns-country">${countries.items.map((c) => `<option value="${esc(c.code)}"${c.code === session.user?.countryCode ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="ns-city">${esc(t('seller.field.city'))}</label><input id="ns-city" /></div>
      </div>
      <div class="field"><label for="ns-desc">${esc(t('seller.field.description'))}</label><textarea id="ns-desc" rows="3" maxlength="2000" placeholder="${esc(t('seller.store.descPlaceholder'))}"></textarea></div>
      <button class="btn btn-accent" type="submit">${esc(t('seller.store.create'))}</button>
    </form>`;
}

// ── Produits ───────────────────────────────────────────────────────────────
export async function products() {
  const result = await api('/products/mine?limit=50');
  return `
    <div class="row-between">
      <h1 style="font-size:var(--text-xl)">${esc(t('seller.products.title'))}</h1>
      <a class="btn btn-accent" href="/touma/vendeur/produits/nouveau" data-link>${esc(t('seller.addProduct'))}</a>
    </div>
    ${tabs('/touma/vendeur/produits')}
    ${result.items.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>${esc(t('seller.col.product'))}</th><th>${esc(t('seller.col.price'))}</th><th>${esc(t('seller.col.stock'))}</th><th>${esc(t('seller.col.status'))}</th><th>${esc(t('seller.col.actions'))}</th></tr></thead>
          <tbody>
            ${result.items
              .map(
                (p) => `<tr>
                  <td>
                    <div class="row" style="gap:var(--space-3);flex-wrap:nowrap">
                      <span class="cart-thumb" style="width:44px;height:44px;flex:0 0 auto">${productImage(p.image, p.title)}</span>
                      <span style="min-width:0">
                        <a href="/touma/produits/${esc(p.slug)}" data-link>${esc(p.title)}</a>
                        <div class="xs muted">${esc(p.store.name)}</div>
                      </span>
                    </div>
                  </td>
                  <td>${money(p.price, p.currency)}</td>
                  <td><input type="number" min="0" value="${p.stock}" class="stock-input" data-product="${esc(p.id)}" style="width:88px;min-height:38px" aria-label="${esc(t('seller.products.stockAria', { title: p.title }))}" /></td>
                  <td>${statusPill(p.status)}</td>
                  <td>
                    <div class="row" style="gap:var(--space-2);flex-wrap:nowrap">
                      <a class="btn btn-secondary btn-sm" href="/touma/vendeur/produits/${esc(p.id)}" data-link>${esc(t('seller.products.edit'))}</a>
                      <button class="btn btn-ghost btn-sm" data-toggle-product="${esc(p.id)}" data-status="${p.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE'}">${esc(t(p.status === 'ACTIVE' ? 'seller.products.unpublish' : 'seller.products.publish'))}</button>
                    </div>
                  </td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table></div>
        <p class="xs muted mt-6">${esc(t('seller.products.stockHint'))}</p>`
      : emptyState({
          title: t('seller.products.emptyTitle'),
          body: t('seller.products.emptyBody'),
          actionLabel: t('seller.addProduct'),
          actionHref: '/touma/vendeur/produits/nouveau',
          iconName: 'box',
        })}`;
}

/** Formulaire produit — création et modification partagent le même rendu. */
export async function productForm(params) {
  const editing = Boolean(params?.id);
  const [stores, categories, countries, existing] = await Promise.all([
    api('/stores/mine'),
    api('/categories'),
    api('/countries'),
    editing ? api(`/products/${params.id}`) : Promise.resolve(null),
  ]);
  if (!stores.items.length)
    return `<h1 style="font-size:var(--text-xl)">${esc(t('seller.product.new'))}</h1>${tabs('/touma/vendeur/produits')}${noStore()}`;

  const value = (v) => esc(v ?? '');
  return `
    ${breadcrumb([
      { label: t('seller.area'), href: '/touma/vendeur' },
      { label: t('seller.tab.products'), href: '/touma/vendeur/produits' },
      { label: editing ? existing.title : t('seller.product.new') },
    ])}
    <h1 style="font-size:var(--text-xl)">${esc(t(editing ? 'seller.product.edit' : 'seller.product.new'))}</h1>
    ${tabs('/touma/vendeur/produits')}

    <form class="card" id="product-form" ${editing ? `data-product="${esc(params.id)}"` : ''}>
      <div class="grid grid-2">
        <div class="field">
          <label for="p-store">${esc(t('seller.field.store'))}</label>
          <select id="p-store" ${editing ? 'disabled' : ''}>
            ${stores.items.map((s) => `<option value="${esc(s.id)}"${editing && existing.store.id === s.id ? ' selected' : ''}>${esc(s.name)} (${esc(s.countryCode)})</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="p-category">${esc(t('seller.field.category'))}</label>
          <select id="p-category">
            <option value="">${esc(t('seller.field.uncategorised'))}</option>
            ${categories.items.map((c) => `<option value="${esc(c.id)}"${editing && existing.category?.id === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="field"><label for="p-title">${esc(t('seller.field.title'))}</label><input id="p-title" required maxlength="200" value="${value(existing?.title)}" /></div>

      <div class="field">
        <label for="p-description">${esc(t('seller.field.description'))}</label>
        <textarea id="p-description" rows="6" maxlength="10000">${value(existing?.description)}</textarea>
        <div class="row" style="gap:var(--space-2);margin-top:var(--space-2)">
          <button class="btn btn-secondary btn-sm" type="button" id="ai-description">${svg('spark')} ${esc(t('seller.product.aiSuggest'))}</button>
          <span class="field-hint" style="margin:0">${esc(t('seller.product.aiHint'))}</span>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="field"><label for="p-price">${esc(t('seller.field.unitPrice'))}</label><input id="p-price" required inputmode="decimal" placeholder="25000" value="${value(existing?.price)}" /></div>
        <div class="field"><label for="p-quantity">${esc(t('seller.field.stockAvailable'))}</label><input id="p-quantity" type="number" min="0" value="${existing?.stock ?? 10}" /></div>
        <div class="field"><label for="p-min">${esc(t('seller.field.minOrderQty'))}</label><input id="p-min" type="number" min="1" value="${existing?.minOrderQty ?? 1}" /></div>
        <div class="field"><label for="p-weight">${esc(t('seller.field.weightGrams'))}</label><input id="p-weight" type="number" min="1" value="${existing?.weightGrams ?? 800}" /></div>
        <div class="field">
          <label for="p-country">${esc(t('seller.field.shipFrom'))}</label>
          <select id="p-country">${countries.items.map((c) => `<option value="${esc(c.code)}"${existing?.countryCode === c.code ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label for="p-image">${esc(t('seller.field.imageUrl'))}</label><input id="p-image" type="url" placeholder="https://…" value="${value(existing?.images?.[0]?.url)}" /></div>
      </div>

      <div class="field"><label for="p-keywords">${esc(t('seller.field.keywords'))}</label><input id="p-keywords" placeholder="${esc(t('seller.field.keywordsPlaceholder'))}" value="${value(existing?.keywords)}" /></div>

      <!-- Origine de la marchandise : distincte du pays d'expédition, et c'est
           elle qui sert à établir un certificat d'origine. Le vendeur la
           déclare, Touma ne la vérifie pas, et l'écran le dit. -->
      <fieldset class="field" style="border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-4)">
        <legend class="small">${esc(t('seller.origin.legend'))}</legend>
        <p class="field-hint" style="margin-top:0">${esc(t('seller.origin.hint'))}</p>
        <div class="grid grid-2">
          <div class="field">
            <label for="p-origin">${esc(t('seller.origin.country'))}</label>
            <select id="p-origin">
              <option value="">${esc(t('seller.origin.none'))}</option>
              ${countries.items.map((c) => `<option value="${esc(c.code)}"${existing?.origin?.countryCode === c.code ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="p-manufacturer">${esc(t('seller.origin.manufacturer'))}</label>
            <select id="p-manufacturer">
              <option value="">${esc(t('seller.origin.none'))}</option>
              ${countries.items.map((c) => `<option value="${esc(c.code)}"${existing?.origin?.manufacturerCountry === c.code ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label for="p-origin-evidence">${esc(t('seller.origin.evidence'))}</label>
          <input id="p-origin-evidence" maxlength="300" placeholder="${esc(t('seller.origin.evidencePlaceholder'))}" value="${value(existing?.origin?.evidence)}" />
        </div>
      </fieldset>

      <div class="field">
        <label for="p-status">${esc(t('seller.field.publication'))}</label>
        <select id="p-status">
          <option value="ACTIVE"${existing?.status === 'ACTIVE' ? ' selected' : ''}>${esc(t('seller.product.statusActive'))}</option>
          <option value="DRAFT"${existing?.status === 'DRAFT' ? ' selected' : ''}>${esc(t('seller.product.statusDraft'))}</option>
        </select>
      </div>

      <div class="row">
        <button class="btn btn-accent" type="submit">${esc(t(editing ? 'seller.product.saveEdits' : 'seller.product.publish'))}</button>
        <a class="btn btn-ghost" href="/touma/vendeur/produits" data-link>${esc(t('action.cancel'))}</a>
        ${editing ? `<button class="btn btn-ghost btn-sm" type="button" data-archive-product="${esc(params.id)}">${esc(t('seller.product.archive'))}</button>` : ''}
      </div>
    </form>`;
}

// ── Commandes vendeur ──────────────────────────────────────────────────────
export async function orders(_params, query) {
  const status = query.get('statut');
  const result = await api(`/orders?scope=seller&limit=50${status ? `&status=${status}` : ''}`);
  const filters = ['', 'PAID', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'COMPLETED'];

  return `
    <h1 style="font-size:var(--text-xl)">${esc(t('seller.orders.title'))}</h1>
    ${tabs('/touma/vendeur/commandes')}
    <div class="chip-row" style="margin-bottom:var(--space-5)">
      ${filters.map((f) => `<a class="chip" href="/touma/vendeur/commandes${f ? `?statut=${f}` : ''}" data-link aria-current="${(status ?? '') === f}">${esc(f ? label(f) : t('seller.orders.all'))}</a>`).join('')}
    </div>
    ${result.items.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>${esc(t('seller.col.order'))}</th><th>${esc(t('seller.col.status'))}</th><th>${esc(t('seller.col.total'))}</th><th>${esc(t('seller.col.tracking'))}</th><th></th></tr></thead>
          <tbody>
            ${result.items
              .map(
                (o) => `<tr>
                  <td><strong>${esc(o.orderNumber)}</strong>${o.crossBorder ? ` <span class="badge badge-cross">${esc(t('orders.crossBorder'))}</span>` : ''}<div class="xs muted">${formatDate(o.createdAt)}</div></td>
                  <td>${statusPill(o.status)}</td>
                  <td>${money(o.total, o.currency)}</td>
                  <td class="small">${o.shipment ? esc(o.shipment.trackingNumber) : '—'}</td>
                  <td><a class="btn btn-secondary btn-sm" href="/touma/vendeur/commandes/${esc(o.id)}" data-link>${esc(t('seller.process'))}</a></td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table></div>`
      : emptyState({ title: t('seller.orders.emptyTitle'), body: t('seller.orders.emptyBody'), iconName: 'box' })}`;
}

export async function order(params) {
  const o = await api(`/orders/${params.id}`);
  const shipment = o.shipments?.[0];
  const net = Number(o.total) - Number(o.commissionTotal);

  return `
    ${breadcrumb([{ label: t('seller.tab.orders'), href: '/touma/vendeur/commandes' }, { label: o.orderNumber }])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px">${esc(t('seller.order.title', { number: o.orderNumber }))}</h1>
        <p class="small muted" style="margin:0">${esc(o.buyer?.name ?? '')} · ${formatDate(o.createdAt, true)}</p>
      </div>
      ${statusPill(o.status)}
    </div>

    <div class="grid grid-2">
      <div class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('seller.order.items'))}</h2>
          <div class="table-wrap" style="border:0"><table>
            <thead><tr><th>${esc(t('seller.col.product'))}</th><th>${esc(t('seller.col.qty'))}</th><th>${esc(t('seller.col.total'))}</th></tr></thead>
            <tbody>${o.items.map((i) => `<tr><td>${esc(i.titleSnapshot)}</td><td>${i.quantity}</td><td>${money(i.lineTotal, i.currency)}</td></tr>`).join('')}</tbody>
          </table></div>
          <div class="summary mt-6">
            <div class="summary-line"><span>${esc(t('cart.subtotal'))}</span><span>${money(o.subtotal, o.currency)}</span></div>
            <div class="summary-line"><span>${esc(t('cart.shipping'))}</span><span>${money(o.shippingTotal, o.currency)}</span></div>
            <div class="summary-line"><span>${esc(t('seller.order.commission'))}</span><span>− ${money(o.commissionTotal, o.currency)}</span></div>
            <div class="summary-line summary-total"><span>${esc(t('seller.order.net'))}</span><span>${money(net, o.currency)}</span></div>
          </div>
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('seller.order.address'))}</h2>
          <p class="small" style="margin:0">
            ${esc(o.shippingSnapshot?.fullName ?? '')}<br />
            ${esc(o.shippingSnapshot?.line1 ?? '')}<br />
            ${esc(o.shippingSnapshot?.city ?? '')} — ${esc(o.shippingSnapshot?.countryCode ?? '')}<br />
            <span class="muted">${esc(o.shippingSnapshot?.phone ?? '')}</span>
          </p>
        </section>
      </div>

      <aside class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('seller.order.shipment'))}</h2>
          ${shipment
            ? `<div class="row" style="gap:var(--space-2)">${statusPill(shipment.status)}<span class="small">${esc(shipment.trackingNumber)}</span></div>
               <div class="field mt-6">
                 <label for="ship-status">${esc(t('seller.order.advanceTracking'))}</label>
                 <select id="ship-status">
                   ${['SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED']
                     .map((code) => `<option value="${code}">${esc(t(`seller.ship.${code}`))}</option>`)
                     .join('')}
                 </select>
               </div>
               <button class="btn btn-block" data-update-shipment="${esc(shipment.id)}">${esc(t('seller.order.updateTracking'))}</button>
               <div class="mt-6">${trackingTimeline(shipment.events)}</div>`
            : ['PAID', 'CONFIRMED', 'PROCESSING', 'READY_TO_SHIP'].includes(o.status)
              ? `<p class="small muted">${esc(t('seller.order.carrierHint'))}</p>
                 <button class="btn btn-accent btn-block" data-create-shipment="${esc(o.id)}">${esc(t('seller.order.createShipment'))}</button>
                 ${
                   o.status === 'READY_TO_SHIP'
                     ? `<p class="small muted mt-4">${esc(t('seller.order.readyNoted'))}</p>`
                     : `<button class="btn btn-secondary btn-block mt-4" data-order-ready="${esc(o.id)}">${esc(t('seller.order.markReady'))}</button>`
                 }`
              : `<p class="small muted">${esc(t('seller.order.shipAfterPaid'))}</p>`}
        </section>
      </aside>
    </div>`;
}

// ── Analyses ───────────────────────────────────────────────────────────────
export async function analytics(_params, query) {
  const mine = await api('/stores/mine');
  if (!mine.items.length)
    return `<h1 style="font-size:var(--text-xl)">${esc(t('seller.tab.analytics'))}</h1>${tabs('/touma/vendeur/analyses')}${noStore()}`;

  const storeId = query.get('boutique') ?? mine.items[0].id;
  const days = Number(query.get('jours') ?? 30);
  const [data, stats] = await Promise.all([
    api(`/seller/stores/${storeId}/analytics?days=${days}`),
    api(`/seller/stores/${storeId}/stats`),
  ]);
  const currency = data.series.find((s) => s.currency)?.currency ?? null;
  const totalOrders = data.series.reduce((acc, s) => acc + s.orders, 0);
  const totalRevenue = data.series.reduce((acc, s) => acc + Number(s.revenue), 0);

  return `
    <h1 style="font-size:var(--text-xl)">${esc(t('seller.tab.analytics'))}</h1>
    ${tabs('/touma/vendeur/analyses')}

    <div class="row-between" style="margin-bottom:var(--space-4)">
      <div class="row" style="gap:var(--space-2)">
        ${mine.items.map((s) => `<a class="chip" href="/touma/vendeur/analyses?boutique=${esc(s.id)}&jours=${days}" data-link aria-current="${s.id === storeId}">${esc(s.name)}</a>`).join('')}
      </div>
      <div class="row" style="gap:var(--space-2)">
        ${[7, 30, 90].map((d) => `<a class="chip" href="/touma/vendeur/analyses?boutique=${esc(storeId)}&jours=${d}" data-link aria-current="${d === days}">${esc(t('seller.analytics.days', { count: d }))}</a>`).join('')}
      </div>
    </div>

    <div class="grid grid-stats" style="margin-bottom:var(--space-5)">
      ${statCard(t('seller.stat.paidOrders'), totalOrders, t('seller.analytics.overDays', { count: days }))}
      ${statCard(t('seller.stat.revenue'), currency ? money(totalRevenue, currency) : '—', t('seller.analytics.overDays', { count: days }))}
      ${statCard(t('seller.analytics.avgBasket'), totalOrders ? money(totalRevenue / totalOrders, currency ?? '') : '—')}
      ${statCard(t('seller.stat.activeProducts'), stats.activeProducts)}
      ${statCard(t('seller.stat.lowStock'), stats.lowStockItems)}
    </div>

    <section class="card" style="margin-bottom:var(--space-5)">
      <div class="card-head"><h2 style="font-size:var(--text-md)">${esc(t('seller.analytics.revenuePerDay'))}</h2></div>
      ${barChart(data.series, { valueKey: 'revenue', labelKey: 'date', currency })}
    </section>

    <section class="card">
      <div class="card-head"><h2 style="font-size:var(--text-md)">${esc(t('seller.analytics.topProducts'))}</h2></div>
      ${data.topProducts.length
        ? `<div class="table-wrap" style="border:0"><table>
            <thead><tr><th>${esc(t('seller.col.product'))}</th><th>${esc(t('seller.analytics.qtySold'))}</th></tr></thead>
            <tbody>${data.topProducts.map((p) => `<tr><td>${esc(p.title)}</td><td>${p.quantity}</td></tr>`).join('')}</tbody>
          </table></div>`
        : `<p class="muted small">${esc(t('seller.analytics.noSales'))}</p>`}
    </section>`;
}

// ── Touma Verified ─────────────────────────────────────────────────────────
export async function verification() {
  const [statusData, mine] = await Promise.all([api('/verification/status'), api('/stores/mine')]);
  return `
    <h1 style="font-size:var(--text-xl)">${esc(t('seller.tab.verification'))}</h1>
    ${tabs('/touma/vendeur/verification')}
    <p class="muted small">${esc(t('seller.verif.intro'))}</p>

    ${statusData.items
      .map(
        (s) => `<section class="card" style="margin-bottom:var(--space-4)">
          <div class="card-head">
            <h2 style="font-size:var(--text-md)">${esc(s.storeName)}</h2>
            ${statusPill(s.verificationStatus)}
          </div>
          ${s.submissions.length
            ? s.submissions
                .map(
                  (v) => `<p class="small" style="margin-bottom:var(--space-2)">
                    ${esc(t('seller.verif.fileDated', { date: formatDate(v.submittedAt) }))} — ${statusPill(v.status)} · ${esc(t('seller.verif.docCount', { count: v.documentCount }))}
                    ${v.reviewerComment ? `<br /><em class="muted">« ${esc(v.reviewerComment)} »</em>` : ''}
                  </p>`,
                )
                .join('')
            : `<p class="small muted" style="margin:0">${esc(t('seller.verif.noFile'))}</p>`}
        </section>`,
      )
      .join('')}

    ${mine.items.length
      ? `<form class="card" id="verification-form">
          <h2 style="font-size:var(--text-md)">${esc(t('seller.verif.submit'))}</h2>
          <div class="field"><label for="v-store">${esc(t('seller.field.store'))}</label>
            <select id="v-store">${mine.items.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="v-type">${esc(t('seller.verif.activityType'))}</label>
            <select id="v-type"><option value="COMPANY">${esc(t('seller.verif.company'))}</option><option value="INDIVIDUAL">${esc(t('seller.verif.individual'))}</option></select></div>
          <div class="field"><label for="v-legal">${esc(t('seller.verif.legalName'))}</label><input id="v-legal" required maxlength="200" /></div>
          <div class="grid grid-2">
            <div class="field"><label for="v-reg">${esc(t('seller.verif.registration'))}</label><input id="v-reg" maxlength="80" /></div>
            <div class="field"><label for="v-phone">${esc(t('seller.verif.contactPhone'))}</label><input id="v-phone" required inputmode="tel" /></div>
          </div>
          <div class="field"><label for="v-email">${esc(t('seller.verif.contactEmail'))}</label><input id="v-email" type="email" required /></div>
          <div class="field">
            <label for="v-doc">${esc(t('seller.verif.docLink'))}</label>
            <input id="v-doc" type="url" required placeholder="https://…" />
            <span class="field-hint">${esc(t('seller.verif.docPrivate'))}</span>
          </div>
          <button class="btn btn-accent" type="submit">${esc(t('seller.verif.send'))}</button>
        </form>`
      : noStore()}`;
}


// ── Import de catalogue ────────────────────────────────────────────────────
/**
 * Import en masse. Un grossiste qui a deux cents références ne les saisira pas
 * une par une : sans cette page, son catalogue ne monte jamais en ligne.
 *
 * Le déroulé est volontairement en deux temps — analyser, puis appliquer :
 * un fichier à moitié importé coûte plus cher à réparer qu'à ressaisir.
 */
export async function catalogueImport() {
  const stores = await api('/stores/mine');
  if (!stores.items.length)
    return `<h1 style="font-size:var(--text-xl)">${esc(t('seller.tab.import'))}</h1>${tabs('/touma/vendeur/import')}${noStore()}`;

  return `
    <h1 style="font-size:var(--text-xl)">${esc(t('seller.import.title'))}</h1>
    ${tabs('/touma/vendeur/import')}

    <div class="grid grid-2" style="align-items:start">
      <section class="card">
        <h2 style="font-size:var(--text-md)">${esc(t('seller.import.yourFile'))}</h2>
        <p class="small muted">${esc(t('seller.import.fileHint'))}</p>

        <form id="import-form">
          <div class="field">
            <label for="im-store">${esc(t('seller.field.store'))}</label>
            <select id="im-store">${stores.items.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>
          </div>

          <div class="field">
            <label for="im-file">${esc(t('seller.import.chooseFile'))}</label>
            <input id="im-file" type="file" accept=".csv,text/csv,text/plain" />
          </div>

          <div class="field">
            <label for="im-csv">${esc(t('seller.import.orPaste'))}</label>
            <textarea id="im-csv" rows="8" spellcheck="false"
              style="font-family:var(--font-mono);font-size:var(--text-xs)"
              placeholder="${esc(t('seller.import.sample'))}"></textarea>
          </div>

          <button class="btn btn-block" type="submit">${esc(t('seller.import.analyse'))}</button>
          <p class="xs muted" style="margin:var(--space-2) 0 0">${esc(t('seller.import.nothingSaved'))}</p>
        </form>
      </section>

      <aside class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('seller.import.columns'))}</h2>
          <dl class="spec-list">
            ${
              // Les noms de colonnes ne se traduisent pas : ce sont ceux que
              // l'analyseur reconnaît dans le fichier. Seule leur explication suit la langue.
              [
                ['sku', 'seller.import.col.sku'],
                ['titre', 'seller.import.col.title'],
                ['prix', 'seller.import.col.price'],
                ['stock', 'seller.import.col.stock'],
                ['quantite_minimale', 'seller.import.col.minQty'],
                ['poids_grammes', 'seller.import.col.weight'],
                ['categorie', 'seller.import.col.category'],
                ['statut', 'seller.import.col.status'],
                ['image_url', 'seller.import.col.image'],
              ]
                .map(([colonne, cle]) => `<div><dt dir="ltr">${colonne}</dt><dd>${esc(t(cle))}</dd></div>`)
                .join('')
            }
          </dl>
          <div class="stack" style="gap:var(--space-2);margin-top:var(--space-4)">
            <a class="btn btn-secondary btn-sm" href="/api/v1/seller/catalogue/modele" data-authed-download>${esc(t('seller.import.template'))}</a>
            <a class="btn btn-secondary btn-sm" href="#" data-export-catalogue>${esc(t('seller.import.export'))}</a>
          </div>
          <p class="xs muted" style="margin:var(--space-3) 0 0">${esc(t('seller.import.exportHint'))}</p>
        </section>
      </aside>
    </div>

    <div id="import-report"></div>`;
}

/** Rapport d'analyse : ce qui sera créé, mis à jour, et ce qui bloque. */
export function importReport(result, storeId) {
  const errors = result.results.filter((r) => r.action === 'error');
  const applied = !result.dryRun;

  return `<section class="card mt-8">
    <div class="card-head">
      <h2 style="font-size:var(--text-md)">${esc(t(applied ? 'seller.import.done' : 'seller.import.analysisResult'))}</h2>
      <span class="small muted">${esc(t('seller.import.rowsRead', { count: result.summary.rows }))}</span>
    </div>

    <div class="grid grid-stats">
      ${statCard(t(applied ? 'seller.import.created' : 'seller.import.toCreate'), applied ? result.summary.created : result.summary.toCreate)}
      ${statCard(t(applied ? 'seller.import.updated' : 'seller.import.toUpdate'), applied ? result.summary.updated : result.summary.toUpdate)}
      ${statCard(t('seller.import.errorRows'), result.summary.errors, t(result.summary.errors ? 'seller.import.fixInFile' : 'seller.import.noErrors'))}
    </div>

    ${errors.length
      ? `<div class="table-wrap mt-6"><table>
          <thead><tr><th>${esc(t('seller.import.colLine'))}</th><th>${esc(t('seller.import.colRef'))}</th><th>${esc(t('seller.import.colProblem'))}</th></tr></thead>
          <tbody>
            ${errors
              .map(
                (e) => `<tr>
                  <td>${e.line}</td>
                  <td class="small">${esc(e.sku ?? '—')}</td>
                  <td class="small" style="color:var(--danger)">${esc(e.message ?? '')}</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table></div>`
      : ''}

    ${applied
      ? `<a class="btn btn-secondary mt-6" href="/touma/vendeur/produits" data-link>${esc(t('seller.import.seeProducts'))}</a>`
      : result.summary.toCreate + result.summary.toUpdate > 0
        ? `<button class="btn btn-accent mt-6" data-apply-import="${esc(storeId)}">
            ${esc(t('seller.import.apply', { created: result.summary.toCreate, updated: result.summary.toUpdate }))}
          </button>`
        : `<p class="small muted mt-6">${esc(t('seller.import.nothingUsable'))}</p>`}
  </section>`;
}

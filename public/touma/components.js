/**
 * TOUMA — composants d'affichage réutilisables (produits, chronologie,
 * étapes, pagination, graphiques). Chaque fonction renvoie du HTML : le
 * rendu reste explicite et testable à l'œil.
 */
import { esc, money, productImage, stars, statusPill, label, formatDate, svg } from './core.js';
import { t } from './i18n.js';

/** Carte produit du catalogue. */
export function productCard(p, { compact = false } = {}) {
  const verified = p.store?.verificationStatus === 'APPROVED';
  return `<article class="product-card">
    <a href="/touma/produits/${esc(p.slug)}" data-link>
      <div class="product-media">
        ${productImage(p.image, p.title)}
        ${verified ? `<span class="badge badge-verified">${esc(t('product.verifiedSeller'))}</span>` : ''}
      </div>
      <div class="product-body">
        <span class="product-title">${esc(p.title)}</span>
        <span class="price">${money(p.price, p.currency)}${p.minOrderQty > 1 ? ` <small>· min. ${p.minOrderQty}</small>` : ''}</span>
        ${stars(p.rating, p.ratingCount)}
        <span class="product-meta">
          <span class="badge badge-country">${esc(p.countryCode)}</span>
          <span>${esc(p.store?.name ?? '')}</span>
        </span>
        <span class="product-meta">
          ${p.inStock ? `<span class="badge badge-verified">${esc(t('comp.inStock'))}</span>` : `<span class="badge badge-danger">${esc(t('comp.outOfStock'))}</span>`}
        </span>
      </div>
    </a>
    ${compact ? '' : `<div class="product-actions">
      <button class="btn btn-secondary btn-sm btn-block" data-add-to-cart="${esc(p.id)}" ${p.inStock ? '' : 'disabled'}>
        ${esc(t(p.inStock ? 'product.addToCart' : 'comp.unavailable'))}
      </button>
    </div>`}
  </article>`;
}

/** Carte boutique. */
export function storeCard(s) {
  const initial = (s.name || 'T').trim().charAt(0).toUpperCase();
  return `<article class="card">
    <div class="row" style="align-items:flex-start">
      <span class="store-logo" style="width:52px;height:52px;font-size:1.25rem;border-width:2px">
        ${s.logoUrl ? `<img src="${esc(s.logoUrl)}" alt="" />` : esc(initial)}
      </span>
      <div style="flex:1;min-width:0">
        <h3 style="margin-bottom:2px"><a href="/touma/boutiques/${esc(s.slug)}" data-link>${esc(s.name)}</a></h3>
        <div class="product-meta">
          <span class="badge badge-country">${esc(s.countryCode)}${s.city ? ` · ${esc(s.city)}` : ''}</span>
          ${s.verificationStatus === 'APPROVED' ? `<span class="badge badge-verified">${esc(t('seller.verified'))}</span>` : ''}
          ${stars(s.ratingAverage, s.ratingCount)}
        </div>
      </div>
    </div>
    ${s.description ? `<p class="small muted mt-6" style="margin-bottom:0">${esc(s.description)}</p>` : ''}
  </article>`;
}

/** Fil d'Ariane. */
export function breadcrumb(items) {
  return `<nav class="small muted" aria-label="${esc(t('comp.breadcrumb'))}" style="margin-bottom:var(--space-4)">
    ${items
      .map((item, i) =>
        item.href && i < items.length - 1
          ? `<a href="${esc(item.href)}" data-link>${esc(item.label)}</a> <span aria-hidden="true">›</span> `
          : `<span aria-current="page">${esc(item.label)}</span>`,
      )
      .join('')}
  </nav>`;
}

/** Indicateur d'étapes du tunnel de commande. */
export function stepper(steps, currentIndex) {
  return `<ol class="stepper">
    ${steps
      .map((stepLabel, i) => {
        const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'todo';
        return `<li data-state="${state}"${state === 'current' ? ' aria-current="step"' : ''}>
          <span class="dot">${i < currentIndex ? '✓' : i + 1}</span>${esc(stepLabel)}
        </li>`;
      })
      .join('')}
  </ol>`;
}

/**
 * Chronologie d'une commande : les étapes franchies, l'étape courante, puis
 * celles à venir. Les événements de suivi réels sont insérés à leur place.
 */
// Une fonction, pas une constante de module : figée au chargement, elle
// garderait la langue de la première page ouverte pour toute la session.
const orderFlow = () => [
  { key: 'PENDING', title: t('flow.created'), at: 'placedAt' },
  { key: 'PAID', title: t('flow.paid'), at: 'paidAt' },
  { key: 'PROCESSING', title: t('flow.processing'), at: null },
  { key: 'SHIPPED', title: t('flow.shipped'), at: 'shippedAt' },
  { key: 'IN_TRANSIT', title: t('flow.inTransit'), at: null },
  { key: 'DELIVERED', title: t('flow.delivered'), at: 'deliveredAt' },
  { key: 'COMPLETED', title: t('flow.completed'), at: 'completedAt' },
];

export function orderTimeline(order) {
  const terminal = ['CANCELLED', 'REFUNDED'].includes(order.status);
  if (terminal) {
    return `<ul class="timeline">
      <li data-done="true"><strong>${esc(t('flow.created'))}</strong><span>${formatDate(order.placedAt, true)}</span></li>
      <li data-current="true"><strong>${esc(label(order.status))}</strong><span>${formatDate(order.cancelledAt ?? order.updatedAt, true)}${order.cancelReason ? ` · ${esc(order.cancelReason)}` : ''}</span></li>
    </ul>`;
  }
  const flow = orderFlow();
  const currentIndex = Math.max(0, flow.findIndex((s) => s.key === order.status));
  return `<ul class="timeline">
    ${flow.map((step, i) => {
      const done = i < currentIndex;
      const current = i === currentIndex;
      const at = step.at ? order[step.at] : null;
      return `<li data-done="${done}" data-current="${current}">
        <strong>${esc(step.title)}</strong>
        <span>${esc(at ? formatDate(at, true) : t(done ? 'flow.done' : current ? 'flow.current' : 'flow.upcoming'))}</span>
      </li>`;
    }).join('')}
  </ul>`;
}

/** Suivi transporteur détaillé. */
export function trackingTimeline(events) {
  if (!events?.length) return `<p class="muted small">${esc(t('comp.noTracking'))}</p>`;
  return `<ul class="timeline">
    ${events
      .map(
        (e, i) => `<li data-done="${i > 0}" data-current="${i === 0}">
          <strong>${esc(e.label)}</strong>
          <span>${formatDate(e.occurredAt, true)}${e.location ? ` · ${esc(e.location)}` : ''} · ${esc(label(e.status))}</span>
        </li>`,
      )
      .join('')}
  </ul>`;
}

/** Pagination serveur. */
export function pagination(page, buildHref) {
  if (!page || page.pages <= 1) return '';
  const prev = page.page - 1;
  const next = page.page + 1;
  return `<nav class="pagination" aria-label="${esc(t('comp.pagination'))}">
    ${page.page > 1 ? `<a class="btn btn-secondary btn-sm" href="${esc(buildHref(prev))}" data-link rel="prev">${esc(t('comp.prev'))}</a>` : '<span></span>'}
    <span class="small muted">${esc(t('comp.pageOf', { page: page.page, pages: page.pages, total: page.total }))}</span>
    ${page.hasNext ? `<a class="btn btn-secondary btn-sm" href="${esc(buildHref(next))}" data-link rel="next">${esc(t('comp.next'))}</a>` : '<span></span>'}
  </nav>`;
}

/**
 * Histogramme SVG (aucune bibliothèque). Utilisé pour les ventes vendeur et
 * l'activité de la place de marché.
 */
export function barChart(points, { valueKey = 'value', labelKey = 'date', height = 140, currency = null } = {}) {
  if (!points?.length) return `<p class="muted small">${esc(t('comp.noData'))}</p>`;
  const values = points.map((p) => Number(p[valueKey] ?? 0));
  const max = Math.max(1, ...values);
  // Barres bornées : une série d'un seul point ne doit pas produire un aplat.
  const barWidth = Math.min(40, Math.max(6, Math.floor(640 / Math.max(points.length, 8)) - 6));
  const width = Math.max(320, points.length * (barWidth + 6));

  const bars = points
    .map((p, i) => {
      const value = Number(p[valueKey] ?? 0);
      const h = Math.round((value / max) * (height - 26));
      const x = i * (barWidth + 6);
      const y = height - 20 - h;
      const readable = currency ? money(value, currency) : value;
      return `<rect class="bar" x="${x}" y="${y}" width="${barWidth}" height="${Math.max(h, 1)}" rx="3">
        <title>${esc(p[labelKey])} : ${esc(String(readable))}</title>
      </rect>`;
    })
    .join('');

  const ticks = points
    .map((p, i) =>
      i % Math.ceil(points.length / 6) === 0
        ? `<text x="${i * (barWidth + 6)}" y="${height - 6}">${esc(String(p[labelKey]).slice(5))}</text>`
        : '',
    )
    .join('');

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(t('comp.salesChart'))}">
    <line class="axis" x1="0" y1="${height - 20}" x2="${width}" y2="${height - 20}" />
    ${bars}${ticks}
  </svg>`;
}

/** Tuile d'indicateur. */
export function statCard(labelText, value, hint = '') {
  return `<div class="stat-card">
    <div class="stat-label">${esc(labelText)}</div>
    <div class="stat-value">${esc(String(value))}</div>
    ${hint ? `<div class="stat-hint">${esc(hint)}</div>` : ''}
  </div>`;
}

/** Bandeau « pourquoi TOUMA » de la page d'accueil. */
export function featureBlock(iconName, title, body) {
  return `<div class="feature">
    <span class="feature-icon">${svg(iconName)}</span>
    <div><h3>${esc(title)}</h3><p>${esc(body)}</p></div>
  </div>`;
}

export { statusPill };

/**
 * TOUMA — console d'administration : supervision, modération, vérifications,
 * litiges, risque et journal d'audit.
 */
import { api, esc, money, formatDate, label, statusPill, emptyState, svg, toast } from './core.js';
import { barChart, statCard, pagination } from './components.js';
import { t } from './i18n.js';

// Les libellés sont des clés, résolues au rendu : la barre latérale suit la
// langue sans qu'il faille recharger la console.
const SECTIONS = [
  {
    group: 'admin.group.steering',
    items: [
      ['/touma/admin', 'admin.link.dashboard', 'chart'],
      ['/touma/admin/intelligence', 'admin.link.intelligence', 'spark'],
    ],
  },
  {
    group: 'admin.group.marketplace',
    items: [
      ['/touma/admin/utilisateurs', 'admin.link.users', 'user'],
      ['/touma/admin/boutiques', 'admin.link.stores', 'store'],
      ['/touma/admin/produits', 'admin.link.products', 'box'],
    ],
  },
  {
    group: 'admin.group.transactions',
    items: [
      ['/touma/admin/commandes', 'admin.link.orders', 'cart'],
      ['/touma/admin/paiements', 'admin.link.payments', 'card'],
      ['/touma/admin/expeditions', 'admin.link.shipments', 'truck'],
      ['/touma/admin/promotions', 'admin.link.promotions', 'spark'],
      ['/touma/admin/finance', 'admin.link.finance', 'card'],
      ['/touma/admin/national', 'admin.link.national', 'map'],
      ['/touma/admin/versements', 'admin.link.payouts', 'card'],
    ],
  },
  {
    group: 'admin.group.trust',
    items: [
      ['/touma/admin/verifications', 'admin.link.verifications', 'shield'],
      ['/touma/admin/litiges', 'admin.link.disputes', 'alert'],
      ['/touma/admin/assistance', 'admin.link.support', 'inbox'],
      ['/touma/admin/moderation', 'admin.link.moderation', 'shield'],
      ['/touma/admin/risque', 'admin.link.risk', 'spark'],
      ['/touma/admin/audit', 'admin.link.audit', 'inbox'],
    ],
  },
];

/** Enveloppe commune : barre latérale sur grand écran, onglets sur mobile. */
export function layout(current, title, content) {
  const sidebar = SECTIONS.map(
    (section) => `<div class="group-label">${esc(t(section.group))}</div>
      ${section.items
        .map(
          ([href, cle, iconName]) =>
            `<a href="${href}" data-link${href === current ? ' aria-current="page"' : ''}>${svg(iconName)} ${esc(t(cle))}</a>`,
        )
        .join('')}`,
  ).join('');

  const tabs = SECTIONS.flatMap((s) => s.items)
    .map(([href, cle]) => `<a href="${href}" data-link${href === current ? ' aria-current="page"' : ''}>${esc(t(cle))}</a>`)
    .join('');

  return `
    <div class="admin-layout">
      <aside class="admin-sidebar"><nav aria-label="${esc(t('admin.nav'))}">${sidebar}</nav></aside>
      <div>
        <h1 style="font-size:var(--text-xl)">${esc(title)}</h1>
        <nav class="tabs admin-tabs hide-desktop" aria-label="${esc(t('admin.nav'))}">${tabs}</nav>
        ${content}
      </div>
    </div>`;
}

// ── Tableau de bord ────────────────────────────────────────────────────────
export async function dashboard() {
  const [data, series] = await Promise.all([api('/admin/dashboard'), api('/admin/analytics?days=30')]);
  const gmv = Object.entries(data.gmvByCurrency).map(([c, v]) => money(v, c)).join(' · ') || '—';
  const basket = Object.entries(data.averageBasket).map(([c, v]) => money(v, c)).join(' · ') || '—';
  const currency = Object.keys(data.gmvByCurrency)[0] ?? null;
  const chartPoints = series.series.map((s) => ({ date: s.date, value: Number(currency ? s.gmv[currency] ?? 0 : s.paid) }));

  const alerts = [];
  if (data.pendingVerifications)
    alerts.push([t('admin.pendingVerifications'), data.pendingVerifications, '/touma/admin/verifications']);
  if (data.openDisputes) alerts.push([t('admin.openDisputes'), data.openDisputes, '/touma/admin/litiges']);
  if (data.failedPayments) alerts.push([t('admin.failedPayments'), data.failedPayments, '/touma/admin/paiements']);

  const content = `
    ${alerts.length
      ? `<div class="alert alert-warning" style="margin-bottom:var(--space-5)">
          <div>
            <strong>${esc(t('admin.toHandle'))}</strong>
            <div class="small">${alerts
              .map(([texte, count, href]) => `<a href="${href}" data-link>${esc(t('admin.alertLine', { label: texte, count }))}</a>`)
              .join(' · ')}</div>
          </div>
        </div>`
      : ''}

    <div class="grid grid-stats">
      ${statCard(t('admin.gmv'), gmv, t('admin.paidOrdersHint'))}
      ${statCard(t('admin.averageBasket'), basket)}
      ${statCard(t('admin.crossBorder'), data.crossBorderOrders, t('admin.keyMetric'))}
      ${statCard(t('admin.paidOrders'), `${data.paidOrders} / ${data.orders}`)}
      ${statCard(t('admin.cancellationRate'), `${(data.cancellationRate * 100).toFixed(1)} %`)}
      ${statCard(t('admin.users'), data.users, t('admin.sellersHint', { count: data.sellers }))}
      ${statCard(t('admin.activeStores'), data.stores)}
      ${statCard(t('admin.activeProducts'), data.products)}
      ${statCard(t('admin.shipments'), data.shipments)}
    </div>

    <section class="card mt-8">
      <div class="card-head"><h2 style="font-size:var(--text-md)">${esc(t('admin.activity30'))}</h2></div>
      ${barChart(chartPoints, { valueKey: 'value', labelKey: 'date', currency })}
    </section>

    <section class="card mt-6">
      <div class="card-head"><h2 style="font-size:var(--text-md)">${esc(t('admin.topProducts'))}</h2></div>
      ${series.topProducts.length
        ? `<div class="table-wrap" style="border:0"><table>
            <thead><tr><th>${esc(t('admin.colProduct'))}</th><th>${esc(t('admin.colQuantity'))}</th></tr></thead>
            <tbody>${series.topProducts.map((p) => `<tr><td>${esc(p.title)}</td><td>${p.quantity}</td></tr>`).join('')}</tbody>
          </table></div>`
        : `<p class="muted small">${esc(t('admin.noSales'))}</p>`}
    </section>`;

  return layout('/touma/admin', t('admin.title'), content);
}

/** Niveau de risque : il s'affichait brut — « HIGH » en travers d'une cellule. */
const niveauRisque = (code) => t(`risk.level.${code}`);

// ── Listes génériques ──────────────────────────────────────────────────────
const LISTS = {
  utilisateurs: {
    title: 'admin.link.users',
    path: (q) => `/admin/users?limit=25&page=${q.get('page') ?? 1}${q.get('q') ? `&q=${encodeURIComponent(q.get('q'))}` : ''}`,
    search: true,
    columns: ['admin.col.user', 'admin.col.role', 'admin.col.status', 'admin.col.country', 'admin.col.risk', 'admin.col.actions'],
    row: (u) => `<tr>
      <td><strong>${esc(u.name)}</strong><div class="xs muted">${esc(u.email)}</div></td>
      <td>${esc(label(u.toumaRole))}</td>
      <td>${statusPill(u.status)}</td>
      <td>${esc(u.countryCode ?? '—')}</td>
      <td>${u.riskScore ? `${u.riskScore.score} <span class="xs muted">(${esc(niveauRisque(u.riskScore.level))})</span>` : '—'}</td>
      <td><div class="row" style="gap:var(--space-2);flex-wrap:nowrap">
        <button class="btn btn-ghost btn-sm" data-user-status="${esc(u.id)}" data-status="${u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}">${esc(
          t(u.status === 'ACTIVE' ? 'admin.suspend' : 'admin.reactivate'),
        )}</button>
        <button class="btn btn-ghost btn-sm" data-user-risk="${esc(u.id)}">${esc(t('admin.recompute'))}</button>
      </div></td>
    </tr>`,
  },
  boutiques: {
    title: 'admin.link.stores',
    path: (q) => `/admin/stores?limit=25&page=${q.get('page') ?? 1}`,
    columns: [
      'admin.col.store',
      'admin.col.owner',
      'admin.col.country',
      'admin.col.products',
      'admin.col.orders',
      'admin.col.status',
      'admin.col.verification',
      '',
    ],
    row: (s) => `<tr>
      <td><a href="/touma/boutiques/${esc(s.slug)}" data-link>${esc(s.name)}</a></td>
      <td class="xs muted">${esc(s.owner.email)}</td>
      <td>${esc(s.countryCode)}</td>
      <td>${s._count.products}</td>
      <td>${s._count.orders}</td>
      <td>${statusPill(s.status)}</td>
      <td>${statusPill(s.verificationStatus)}</td>
      <td><button class="btn btn-ghost btn-sm" data-store-status="${esc(s.id)}" data-status="${s.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}">${esc(
        t(s.status === 'ACTIVE' ? 'admin.suspend' : 'admin.reactivate'),
      )}</button></td>
    </tr>`,
  },
  produits: {
    title: 'admin.link.products',
    path: (q) => `/products?limit=25&page=${q.get('page') ?? 1}${q.get('q') ? `&q=${encodeURIComponent(q.get('q'))}` : ''}`,
    search: true,
    columns: ['admin.col.product', 'admin.col.store', 'admin.col.price', 'admin.col.stock', 'admin.col.status', ''],
    row: (p) => `<tr>
      <td><a href="/touma/produits/${esc(p.slug)}" data-link>${esc(p.title)}</a></td>
      <td class="xs muted">${esc(p.store.name)}</td>
      <td>${money(p.price, p.currency)}</td>
      <td>${p.stock}</td>
      <td>${statusPill(p.status)}</td>
      <td><button class="btn btn-ghost btn-sm" data-product-status="${esc(p.id)}" data-status="${p.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}">${esc(
        t(p.status === 'ACTIVE' ? 'admin.suspend' : 'admin.reactivate'),
      )}</button></td>
    </tr>`,
  },
  commandes: {
    title: 'admin.link.orders',
    path: (q) => `/admin/orders?limit=25&page=${q.get('page') ?? 1}${q.get('statut') ? `&status=${q.get('statut')}` : ''}`,
    columns: [
      'admin.col.order',
      'admin.col.buyer',
      'admin.col.store',
      'admin.col.status',
      'admin.col.total',
      'admin.col.commission',
      'admin.col.date',
    ],
    row: (o) => `<tr>
      <td><strong>${esc(o.orderNumber)}</strong>${o.crossBorder ? ` <span class="badge badge-cross">${esc(t('orders.crossBorder'))}</span>` : ''}</td>
      <td class="xs muted">${esc(o.buyer.email)}</td>
      <td>${esc(o.store.name)}</td>
      <td>${statusPill(o.status)}</td>
      <td>${money(o.total, o.currency)}</td>
      <td>${money(o.commissionTotal, o.currency)}</td>
      <td class="xs muted">${formatDate(o.createdAt)}</td>
    </tr>`,
  },
  paiements: {
    title: 'admin.link.payments',
    path: (q) => `/admin/payments?limit=25&page=${q.get('page') ?? 1}`,
    columns: [
      'admin.col.order',
      'admin.col.provider',
      'admin.col.method',
      'admin.col.status',
      'admin.col.amount',
      'admin.col.refunded',
      'admin.col.date',
    ],
    row: (p) => `<tr>
      <td>${esc(p.order.orderNumber)}</td>
      <td>${esc(p.provider)}</td>
      <td>${esc(label(p.method))}</td>
      <td>${statusPill(p.status)}</td>
      <td>${money(p.amount, p.currency)}</td>
      <td>${money(p.refundedAmount, p.currency)}</td>
      <td class="xs muted">${formatDate(p.createdAt)}</td>
    </tr>`,
  },
  expeditions: {
    title: 'admin.link.shipments',
    path: (q) => `/admin/shipments?limit=25&page=${q.get('page') ?? 1}`,
    columns: ['admin.col.tracking', 'admin.col.order', 'admin.col.carrier', 'admin.col.route', 'admin.col.status', 'admin.col.cost'],
    row: (s) => `<tr>
      <td class="small">${esc(s.trackingNumber)}</td>
      <td>${esc(s.order.orderNumber)}</td>
      <td>${esc(s.providerCode)}</td>
      <td>${esc(s.originCountry)} → ${esc(s.destinationCountry)}</td>
      <td>${statusPill(s.status)}</td>
      <td>${money(s.amount, s.currency)}</td>
    </tr>`,
  },
  litiges: {
    title: 'admin.link.disputes',
    path: (q) => `/admin/disputes?limit=25&page=${q.get('page') ?? 1}`,
    columns: [
      'admin.col.order',
      'admin.col.reason',
      'admin.col.status',
      'admin.col.messages',
      'admin.col.evidence',
      'admin.col.date',
      'admin.col.file',
    ],
    row: (d) => `<tr>
      <td>${esc(d.order.orderNumber)}</td>
      <td>${esc(t(`dispute.reason.${d.reason}`))}</td>
      <td>${statusPill(d.status)}</td>
      <td>${d._count.messages}</td>
      <td>${d._count.evidence}</td>
      <td class="xs muted">${formatDate(d.createdAt)}</td>
      <td><a class="btn btn-ghost btn-sm" href="/touma/admin/litiges/${esc(d.id)}" data-link>${esc(t('admin.openFile'))}</a></td>
    </tr>`,
  },
  audit: {
    title: 'admin.auditTitle',
    path: (q) => `/admin/audit?limit=30&page=${q.get('page') ?? 1}${q.get('action') ? `&action=${encodeURIComponent(q.get('action'))}` : ''}`,
    columns: ['admin.col.action', 'admin.col.entity', 'admin.col.actor', 'admin.col.detail', 'admin.col.date'],
    row: (a) => `<tr>
      <td><strong>${esc(a.action)}</strong></td>
      <td class="xs muted">${esc(a.entity)}</td>
      <td class="xs">${esc(a.actor?.email ?? t('admin.system'))}</td>
      <td class="xs muted">${esc(JSON.stringify(a.metadata ?? {}).slice(0, 80))}</td>
      <td class="xs muted">${formatDate(a.createdAt, true)}</td>
    </tr>`,
  },
};

export async function list(params, query) {
  const config = LISTS[params.section];
  if (!config)
    return layout(
      '/touma/admin',
      t('admin.title'),
      emptyState({ title: t('admin.unknownSection'), body: t('admin.unknownSectionBody'), iconName: 'alert' }),
    );

  const data = await api(config.path(query));
  const hrefFor = (page) => {
    const next = new URLSearchParams(query);
    next.set('page', String(page));
    return `/touma/admin/${params.section}?${next.toString()}`;
  };

  const content = `
    ${config.search
      ? `<form class="row" id="admin-search" data-section="${esc(params.section)}" style="margin-bottom:var(--space-4)">
          <input name="q" type="search" placeholder="${esc(t('admin.searchPlaceholder'))}" value="${esc(query.get('q') || '')}" style="max-width:320px" aria-label="${esc(
            t('admin.searchAria'),
          )}" />
          <button class="btn btn-secondary" type="submit">${esc(t('search.submit'))}</button>
        </form>`
      : ''}
    ${data.items.length
      ? `<div class="table-wrap"><table>
          <thead><tr>${config.columns.map((cle) => `<th>${cle ? esc(t(cle)) : ''}</th>`).join('')}</tr></thead>
          <tbody>${data.items.map(config.row).join('')}</tbody>
        </table></div>
        ${pagination(data, hrefFor)}`
      : emptyState({ title: t('admin.emptyTitle'), body: t('admin.emptyBody'), iconName: 'inbox' })}`;

  return layout(`/touma/admin/${params.section}`, t(config.title), content);
}

// ── Vérifications ──────────────────────────────────────────────────────────
export async function verifications() {
  const data = await api('/admin/verifications?limit=50');
  const content = data.items.length
    ? `<div class="stack">
        ${data.items
          .map(
            (v) => `<section class="card">
              <div class="card-head">
                <div>
                  <h2 style="font-size:var(--text-md);margin-bottom:2px">${esc(v.store.name)}</h2>
                  <span class="small muted">${esc(
                    t('admin.verifOwner', { country: v.store.countryCode, email: v.store.owner.email }),
                  )}</span>
                </div>
                ${statusPill(v.status)}
              </div>
              <dl class="spec-list">
                <div><dt>${esc(t('admin.verifLegalName'))}</dt><dd>${esc(v.legalName)}</dd></div>
                <div><dt>${esc(t('admin.verifType'))}</dt><dd>${esc(
                  t(v.businessType === 'COMPANY' ? 'admin.verifCompany' : 'admin.verifIndividual'),
                )}</dd></div>
                <div><dt>${esc(t('admin.verifRegistration'))}</dt><dd>${esc(v.registrationNo ?? '—')}</dd></div>
                <div><dt>${esc(t('admin.verifContact'))}</dt><dd>${esc(v.contactEmail)} · ${esc(v.contactPhone)}</dd></div>
                <div><dt>${esc(t('admin.verifDocuments'))}</dt><dd>${esc(
                  t('admin.verifDocCount', { count: (v.documents || []).length }),
                )}</dd></div>
                <div><dt>${esc(t('admin.verifSubmitted'))}</dt><dd>${formatDate(v.submittedAt, true)}</dd></div>
              </dl>
              <div class="row mt-6">
                <button class="btn" data-approve-verification="${esc(v.id)}">${esc(t('admin.approve'))}</button>
                <button class="btn btn-secondary" data-reject-verification="${esc(v.id)}">${esc(t('admin.reject'))}</button>
              </div>
            </section>`,
          )
          .join('')}
      </div>`
    : emptyState({ title: t('admin.verifEmptyTitle'), body: t('admin.verifEmptyBody'), iconName: 'shield' });

  return layout('/touma/admin/verifications', t('admin.verifTitle'), content);
}

// ── Risque ─────────────────────────────────────────────────────────────────
export async function risk() {
  const data = await api('/admin/risk');
  const content = `
    <div class="alert alert-info" style="margin-bottom:var(--space-5)">
      <div>
        <strong>${esc(t('admin.riskNever'))}</strong>
        <div class="small">${esc(t('admin.riskExplain'))}</div>
      </div>
    </div>
    ${data.items.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>${esc(t('admin.col.user'))}</th><th>${esc(t('admin.riskScore'))}</th><th>${esc(t('admin.riskLevel'))}</th><th>${esc(
            t('admin.riskSignals'),
          )}</th><th>${esc(t('admin.riskComputedAt'))}</th></tr></thead>
          <tbody>
            ${data.items
              .map(
                (r) => `<tr>
                  <td><strong>${esc(r.user.name)}</strong><div class="xs muted">${esc(r.user.email)}</div></td>
                  <td><strong>${r.score}</strong></td>
                  <td><span class="badge ${r.level === 'HIGH' ? 'badge-danger' : r.level === 'MEDIUM' ? 'badge-warn' : ''}">${esc(niveauRisque(r.level))}</span></td>
                  <td class="xs">${(r.signals || []).map((s) => esc(s.code)).join(', ') || '—'}</td>
                  <td class="xs muted">${formatDate(r.computedAt, true)}</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table></div>`
      : emptyState({ title: t('admin.riskEmptyTitle'), body: t('admin.riskEmptyBody'), iconName: 'spark' })}`;

  return layout('/touma/admin/risque', t('admin.riskTitle'), content);
}


// ── TOUMA Intelligence ─────────────────────────────────────────────────────
const percent = (value) => `${Math.round(value * 100)} %`;

/**
 * Ce que les transactions réelles apprennent.
 *
 * Règle de cet écran : **aucun taux ni aucune tendance sans son volume**. Quand
 * l'échantillon ne permet pas de conclure, on l'écrit — « +300 % » sur deux
 * commandes tromperait celui qui pilote.
 */
export async function intelligence(_params, query) {
  const days = Number(query.get('jours') ?? 30);
  const data = await api(`/admin/intelligence?days=${days}`);

  const periods = [7, 30, 90]
    .map(
      (d) =>
        `<a class="chip${d === days ? ' chip-active' : ''}" href="/touma/admin/intelligence?jours=${d}" data-link>${esc(
          t('admin.intelDays', { count: d }),
        )}</a>`,
    )
    .join('');

  const content = `
    <div class="chip-row" style="margin-bottom:var(--space-5)">${periods}</div>
    <p class="small muted">${esc(t('admin.intelDisclaimer', { min: data.minVolumeForTrend }))}</p>

    <section class="card">
      <div class="card-head">
        <h2 style="font-size:var(--text-md)">${esc(t('admin.corridors'))}</h2>
        <span class="small muted">${esc(t('admin.corridorsHint'))}</span>
      </div>
      ${data.corridors.length
        ? `<div class="table-wrap" style="border:0"><table>
            <thead><tr><th>${esc(t('admin.colCorridor'))}</th><th>${esc(t('admin.col.orders'))}</th><th>${esc(t('admin.colVolume'))}</th><th>${esc(
              t('admin.colAvgDelay'),
            )}</th><th>${esc(t('admin.colDisputes'))}</th></tr></thead>
            <tbody>
              ${data.corridors
                .map(
                  (c) => `<tr>
                    <td>
                      <strong>${esc(c.from)} → ${esc(c.to)}</strong>
                      ${c.crossBorder ? ` <span class="badge badge-cross">${esc(t('admin.crossBorderBadge'))}</span>` : ''}
                    </td>
                    <td>${c.orders}</td>
                    <td>${Object.entries(c.gmv).map(([currency, value]) => money(value, currency)).join(' · ') || '—'}</td>
                    <td>${c.averageDeliveryDays === null
                      ? `<span class="muted small">${esc(t('admin.noDeliveryYet'))}</span>`
                      : `${esc(t('admin.daysOver', { days: c.averageDeliveryDays }))} <span class="xs muted">${esc(
                          t('admin.overDelivered', { count: c.deliveredOrders }),
                        )}</span>`}</td>
                    <td>${c.disputes}${c.disputeRate === null ? '' : ` <span class="xs muted">(${percent(c.disputeRate)})</span>`}</td>
                  </tr>`,
                )
                .join('')}
            </tbody>
          </table></div>`
        : `<p class="muted small">${esc(t('admin.noPaidOrders'))}</p>`}
    </section>

    <div class="grid grid-2 mt-8" style="align-items:start">
      <section class="card">
        <div class="card-head">
          <h2 style="font-size:var(--text-md)">${esc(t('admin.unservedDemand'))}</h2>
          <span class="small muted">${esc(t('admin.unservedHint'))}</span>
        </div>

        <h3 style="font-size:var(--text-base);margin-bottom:var(--space-2)">${esc(t('admin.emptySearches'))}</h3>
        ${data.demand.emptySearches.length
          ? `<div class="stack" style="gap:var(--space-2)">
              ${data.demand.emptySearches
                .slice(0, 10)
                .map(
                  (s) => `<div class="row-between small">
                    <a href="/touma/produits?q=${encodeURIComponent(s.term)}" data-link>${esc(s.term)}</a>
                    <strong>${s.searches}</strong>
                  </div>`,
                )
                .join('')}
            </div>
            ${data.demand.emptySearchesByCountry.length
              ? `<p class="xs muted" style="margin:var(--space-3) 0 0">${esc(
                  t('admin.searchOrigin', {
                    list: data.demand.emptySearchesByCountry.map((c) => `${c.countryCode} (${c.searches})`).join(' · '),
                  }),
                )}</p>`
              : ''}`
          : `<p class="muted small">${esc(t('admin.noEmptySearch'))}</p>`}

        <h3 style="font-size:var(--text-base);margin:var(--space-5) 0 var(--space-2)">${esc(t('admin.unansweredRfqs'))}</h3>
        ${data.demand.unansweredRfqs.length
          ? `<div class="stack" style="gap:var(--space-2)">
              ${data.demand.unansweredRfqs
                .slice(0, 8)
                .map(
                  (r) => `<a class="row-between small" href="/touma/business/appels-offres/${esc(r.id)}" data-link style="color:inherit">
                    <span>
                      <strong>${esc(r.title)}</strong>
                      <span class="xs muted" style="display:block">
                        ${esc(t('admin.rfqMeta', { reference: r.reference, country: r.countryCode }))}${
                          r.items[0]
                            ? esc(
                                t('admin.rfqFirstItem', {
                                  quantity: r.items[0].quantity,
                                  unit: r.items[0].unit,
                                  name: r.items[0].name,
                                }),
                              )
                            : ''
                        }
                      </span>
                    </span>
                    <span class="xs muted">${formatDate(r.createdAt)}</span>
                  </a>`,
                )
                .join('')}
            </div>`
          : `<p class="muted small">${esc(t('admin.allRfqsAnswered'))}</p>`}
      </section>

      <div class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('admin.paymentReliability'))}</h2>
          ${data.payments.length
            ? `<div class="table-wrap" style="border:0"><table>
                <thead><tr><th>${esc(t('admin.col.method'))}</th><th>${esc(t('admin.colAttempts'))}</th><th>${esc(
                  t('admin.colSucceeded'),
                )}</th><th>${esc(t('admin.colRate'))}</th></tr></thead>
                <tbody>
                  ${data.payments
                    .map(
                      (p) => `<tr>
                        <td>${esc(label(p.method))}</td>
                        <td>${p.total}</td>
                        <td>${p.succeeded}${
                          p.failed
                            ? ` <span class="xs" style="color:var(--danger)">${esc(t('admin.failures', { count: p.failed }))}</span>`
                            : ''
                        }</td>
                        <td>${p.successRate === null
                          ? `<span class="muted small">${esc(t('admin.insufficientVolume'))}</span>`
                          : `<strong>${percent(p.successRate)}</strong>`}</td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table></div>`
            : `<p class="muted small">${esc(t('admin.noPayments'))}</p>`}
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('admin.movingCategories'))}</h2>
          ${data.categories.length
            ? `<div class="table-wrap" style="border:0"><table>
                <thead><tr><th>${esc(t('admin.colCategory'))}</th><th>${esc(t('admin.colSold'))}</th><th>${esc(
                  t('admin.colPreviousPeriod'),
                )}</th><th>${esc(t('admin.colChange'))}</th></tr></thead>
                <tbody>
                  ${data.categories
                    .slice(0, 8)
                    .map(
                      (c) => `<tr>
                        <td>${esc(c.category)}</td>
                        <td>${c.sold}</td>
                        <td class="muted">${c.previousSold}</td>
                        <td>${c.change === null
                          ? `<span class="muted small">${esc(t('admin.insufficientVolume'))}</span>`
                          : `<strong style="color:${c.change >= 0 ? 'var(--success)' : 'var(--danger)'}">${c.change >= 0 ? '+' : ''}${percent(c.change)}</strong>`}</td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table></div>`
            : `<p class="muted small">${esc(t('admin.noSales'))}</p>`}
        </section>
      </div>
    </div>

    <section class="card mt-8">
      <div class="card-head">
        <h2 style="font-size:var(--text-md)">${esc(t('admin.stockTension'))}</h2>
        <span class="small muted">${esc(t('admin.stockTensionHint'))}</span>
      </div>
      ${data.stockTension.length
        ? `<div class="table-wrap" style="border:0"><table>
            <thead><tr><th>${esc(t('admin.colProduct'))}</th><th>${esc(t('admin.col.store'))}</th><th>${esc(t('admin.colSold'))}</th><th>${esc(
              t('admin.col.stock'),
            )}</th><th>${esc(t('admin.colDaysOfStock'))}</th></tr></thead>
            <tbody>
              ${data.stockTension
                .map(
                  // `tension` et non `t` : `t` est désormais la fonction de traduction.
                  (tension) => `<tr>
                    <td><a href="/touma/produits/${esc(tension.product.slug)}" data-link>${esc(tension.product.title)}</a></td>
                    <td class="small">${esc(tension.store.name)}</td>
                    <td>${tension.sold}</td>
                    <td>${
                      tension.stock === 0 ? `<span style="color:var(--danger)">${esc(t('admin.outOfStock'))}</span>` : tension.stock
                    }</td>
                    <td>${tension.daysOfStock === null ? '—' : esc(t('admin.daysOver', { days: tension.daysOfStock }))}</td>
                  </tr>`,
                )
                .join('')}
            </tbody>
          </table></div>`
        : `<p class="muted small">${esc(t('admin.noStockTension'))}</p>`}
    </section>`;

  return layout('/touma/admin/intelligence', t('admin.intelTitle'), content);
}

// ── Modération de la messagerie ────────────────────────────────────────────
const motifSignalement = (code) => t(`report.reason.${code}`);
const categorieSignal = (code) => t(`flag.category.${code}`);
/** Statut d'un signalement : il s'affichait brut dès qu'il n'était plus ouvert. */
const statutSignalement = (code) => t(`report.status.${code}`);

/** L'ordre des états proposés au filtre — l'ordre, pas les libellés. */
const REPORT_STATUSES = ['OPEN', 'REVIEWED', 'ACTIONED', 'DISMISSED'];

/**
 * File de modération.
 *
 * Deux listes volontairement distinctes : ce qu'un **humain** a signalé, et ce
 * qu'une règle a **repéré**. La seconde n'a aucun pouvoir : elle attire
 * l'attention, l'administration tranche.
 */
export async function moderation(_params, searchParams) {
  const status = searchParams?.get('statut') ?? 'OPEN';
  const [reports, flags] = await Promise.all([
    api(`/messaging/reports?status=${encodeURIComponent(status)}`),
    api('/messaging/risk-flags?status=OPEN'),
  ]);

  const content = `
    <div class="chip-row" style="margin-bottom:var(--space-4)">
      ${REPORT_STATUSES.map(
        (code) =>
          `<a class="chip${code === status ? ' chip-active' : ''}" href="/touma/admin/moderation?statut=${code}" data-link>${esc(
            statutSignalement(code),
          )}</a>`,
      ).join('')}
    </div>

    <section class="card">
      <h2 style="font-size:var(--text-base)">${esc(t('admin.reports', { count: reports.total }))}</h2>
      ${reports.items.length
        ? `<div class="stack" style="gap:var(--space-3)">
            ${reports.items
              .map(
                (r) => `<article class="notif-item">
                  <div class="row-between">
                    <strong>${esc(motifSignalement(r.reason))}</strong>
                    <span class="xs muted">${formatDate(r.createdAt, true)}</span>
                  </div>
                  <p class="small">${esc(
                    t('admin.reportedBy', {
                      reporter: r.reporter.name,
                      author: r.message.author?.name ?? 'TOUMA',
                    }),
                  )}</p>
                  <blockquote class="msg-quote"><span>${esc(r.message.excerpt)}</span></blockquote>
                  ${r.details ? `<p class="small muted">« ${esc(r.details)} »</p>` : ''}
                  ${r.status === 'OPEN'
                    ? `<div class="row" style="gap:var(--space-2);flex-wrap:wrap">
                        <button class="btn btn-sm" data-action="resolve-report" data-id="${esc(r.id)}" data-status="ACTIONED">${esc(
                          t('admin.actionAndClose'),
                        )}</button>
                        <button class="btn btn-secondary btn-sm" data-action="resolve-report" data-id="${esc(r.id)}" data-status="REVIEWED">${esc(
                          t('admin.reviewedNoAction'),
                        )}</button>
                        <button class="btn btn-ghost btn-sm" data-action="resolve-report" data-id="${esc(r.id)}" data-status="DISMISSED">${esc(
                          t('admin.dismiss'),
                        )}</button>
                      </div>`
                    : `<span class="badge">${esc(statutSignalement(r.status))}</span>`}
                </article>`,
              )
              .join('')}
          </div>`
        : `<p class="muted small">${esc(t('admin.noReport'))}</p>`}
    </section>

    <section class="card">
      <h2 style="font-size:var(--text-base)">${esc(t('admin.autoSignals', { count: flags.total }))}</h2>
      <p class="small muted">${esc(t('admin.autoSignalsHint'))}</p>
      ${flags.items.length
        ? `<div class="table-wrap"><table class="table-compact">
            <thead><tr><th>${esc(t('admin.colCategory'))}</th><th>${esc(t('admin.riskScore'))}</th><th>${esc(t('admin.colExcerpt'))}</th><th>${esc(
              t('admin.col.date'),
            )}</th><th></th></tr></thead>
            <tbody>
              ${flags.items
                .map(
                  (f) => `<tr>
                    <td>${esc(categorieSignal(f.category))}</td>
                    <td><strong>${esc(String(f.score))}</strong></td>
                    <td class="small">${esc(f.excerpt)}</td>
                    <td class="xs muted">${formatDate(f.createdAt, true)}</td>
                    <td>
                      <button class="link-btn xs" data-action="resolve-risk" data-id="${esc(f.id)}" data-status="CONFIRMED">${esc(
                        t('admin.confirm'),
                      )}</button>
                      ·
                      <button class="link-btn xs" data-action="resolve-risk" data-id="${esc(f.id)}" data-status="CLEARED">${esc(
                        t('admin.clear'),
                      )}</button>
                    </td>
                  </tr>`,
                )
                .join('')}
            </tbody>
          </table></div>`
        : `<p class="muted small">${esc(t('admin.noOpenSignal'))}</p>`}
    </section>`;

  return layout('/touma/admin/moderation', t('admin.moderationTitle'), content);
}

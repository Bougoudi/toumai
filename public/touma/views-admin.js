/**
 * TOUMA — console d'administration : supervision, modération, vérifications,
 * litiges, risque et journal d'audit.
 */
import { api, esc, money, formatDate, label, statusPill, emptyState, svg, toast } from './core.js';
import { barChart, statCard, pagination } from './components.js';

const SECTIONS = [
  { group: 'Pilotage', items: [['/touma/admin', 'Tableau de bord', 'chart']] },
  {
    group: 'Place de marché',
    items: [
      ['/touma/admin/utilisateurs', 'Utilisateurs', 'user'],
      ['/touma/admin/boutiques', 'Boutiques', 'store'],
      ['/touma/admin/produits', 'Produits', 'box'],
    ],
  },
  {
    group: 'Transactions',
    items: [
      ['/touma/admin/commandes', 'Commandes', 'cart'],
      ['/touma/admin/paiements', 'Paiements', 'card'],
      ['/touma/admin/expeditions', 'Expéditions', 'truck'],
    ],
  },
  {
    group: 'Confiance',
    items: [
      ['/touma/admin/verifications', 'Vérifications', 'shield'],
      ['/touma/admin/litiges', 'Litiges', 'alert'],
      ['/touma/admin/assistance', 'Assistance', 'inbox'],
      ['/touma/admin/risque', 'Risque', 'spark'],
      ['/touma/admin/audit', 'Audit', 'inbox'],
    ],
  },
];

/** Enveloppe commune : barre latérale sur grand écran, onglets sur mobile. */
export function layout(current, title, content) {
  const sidebar = SECTIONS.map(
    (section) => `<div class="group-label">${esc(section.group)}</div>
      ${section.items
        .map(([href, text, iconName]) => `<a href="${href}" data-link${href === current ? ' aria-current="page"' : ''}>${svg(iconName)} ${esc(text)}</a>`)
        .join('')}`,
  ).join('');

  const tabs = SECTIONS.flatMap((s) => s.items)
    .map(([href, text]) => `<a href="${href}" data-link${href === current ? ' aria-current="page"' : ''}>${esc(text)}</a>`)
    .join('');

  return `
    <div class="admin-layout">
      <aside class="admin-sidebar"><nav aria-label="Administration">${sidebar}</nav></aside>
      <div>
        <h1 style="font-size:var(--text-xl)">${esc(title)}</h1>
        <nav class="tabs admin-tabs hide-desktop" aria-label="Administration">${tabs}</nav>
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
  if (data.pendingVerifications) alerts.push(['Vérifications en attente', data.pendingVerifications, '/touma/admin/verifications']);
  if (data.openDisputes) alerts.push(['Litiges ouverts', data.openDisputes, '/touma/admin/litiges']);
  if (data.failedPayments) alerts.push(['Paiements échoués', data.failedPayments, '/touma/admin/paiements']);

  const content = `
    ${alerts.length
      ? `<div class="alert alert-warning" style="margin-bottom:var(--space-5)">
          <div>
            <strong>À traiter</strong>
            <div class="small">${alerts.map(([text, count, href]) => `<a href="${href}" data-link>${esc(text)} : ${count}</a>`).join(' · ')}</div>
          </div>
        </div>`
      : ''}

    <div class="grid grid-stats">
      ${statCard('GMV', gmv, 'commandes payées')}
      ${statCard('Panier moyen', basket)}
      ${statCard('Transactions transfrontalières', data.crossBorderOrders, 'métrique clé TOUMA')}
      ${statCard('Commandes payées', `${data.paidOrders} / ${data.orders}`)}
      ${statCard("Taux d'annulation", `${(data.cancellationRate * 100).toFixed(1)} %`)}
      ${statCard('Utilisateurs', data.users, `${data.sellers} vendeur(s)`)}
      ${statCard('Boutiques actives', data.stores)}
      ${statCard('Produits actifs', data.products)}
      ${statCard('Expéditions', data.shipments)}
    </div>

    <section class="card mt-8">
      <div class="card-head"><h2 style="font-size:var(--text-md)">Activité des 30 derniers jours</h2></div>
      ${barChart(chartPoints, { valueKey: 'value', labelKey: 'date', currency })}
    </section>

    <section class="card mt-6">
      <div class="card-head"><h2 style="font-size:var(--text-md)">Produits les plus vendus</h2></div>
      ${series.topProducts.length
        ? `<div class="table-wrap" style="border:0"><table>
            <thead><tr><th>Produit</th><th>Quantité</th></tr></thead>
            <tbody>${series.topProducts.map((p) => `<tr><td>${esc(p.title)}</td><td>${p.quantity}</td></tr>`).join('')}</tbody>
          </table></div>`
        : '<p class="muted small">Aucune vente sur la période.</p>'}
    </section>`;

  return layout('/touma/admin', 'Administration', content);
}

// ── Listes génériques ──────────────────────────────────────────────────────
const LISTS = {
  utilisateurs: {
    title: 'Utilisateurs',
    path: (q) => `/admin/users?limit=25&page=${q.get('page') ?? 1}${q.get('q') ? `&q=${encodeURIComponent(q.get('q'))}` : ''}`,
    search: true,
    columns: ['Utilisateur', 'Rôle', 'Statut', 'Pays', 'Risque', 'Actions'],
    row: (u) => `<tr>
      <td><strong>${esc(u.name)}</strong><div class="xs muted">${esc(u.email)}</div></td>
      <td>${esc(label(u.toumaRole))}</td>
      <td>${statusPill(u.status)}</td>
      <td>${esc(u.countryCode ?? '—')}</td>
      <td>${u.riskScore ? `${u.riskScore.score} <span class="xs muted">(${esc(u.riskScore.level)})</span>` : '—'}</td>
      <td><div class="row" style="gap:var(--space-2);flex-wrap:nowrap">
        <button class="btn btn-ghost btn-sm" data-user-status="${esc(u.id)}" data-status="${u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}">${u.status === 'ACTIVE' ? 'Suspendre' : 'Réactiver'}</button>
        <button class="btn btn-ghost btn-sm" data-user-risk="${esc(u.id)}">Recalculer</button>
      </div></td>
    </tr>`,
  },
  boutiques: {
    title: 'Boutiques',
    path: (q) => `/admin/stores?limit=25&page=${q.get('page') ?? 1}`,
    columns: ['Boutique', 'Propriétaire', 'Pays', 'Produits', 'Commandes', 'Statut', 'Vérification', ''],
    row: (s) => `<tr>
      <td><a href="/touma/boutiques/${esc(s.slug)}" data-link>${esc(s.name)}</a></td>
      <td class="xs muted">${esc(s.owner.email)}</td>
      <td>${esc(s.countryCode)}</td>
      <td>${s._count.products}</td>
      <td>${s._count.orders}</td>
      <td>${statusPill(s.status)}</td>
      <td>${statusPill(s.verificationStatus)}</td>
      <td><button class="btn btn-ghost btn-sm" data-store-status="${esc(s.id)}" data-status="${s.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}">${s.status === 'ACTIVE' ? 'Suspendre' : 'Réactiver'}</button></td>
    </tr>`,
  },
  produits: {
    title: 'Produits',
    path: (q) => `/products?limit=25&page=${q.get('page') ?? 1}${q.get('q') ? `&q=${encodeURIComponent(q.get('q'))}` : ''}`,
    search: true,
    columns: ['Produit', 'Boutique', 'Prix', 'Stock', 'Statut', ''],
    row: (p) => `<tr>
      <td><a href="/touma/produits/${esc(p.slug)}" data-link>${esc(p.title)}</a></td>
      <td class="xs muted">${esc(p.store.name)}</td>
      <td>${money(p.price, p.currency)}</td>
      <td>${p.stock}</td>
      <td>${statusPill(p.status)}</td>
      <td><button class="btn btn-ghost btn-sm" data-product-status="${esc(p.id)}" data-status="${p.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}">${p.status === 'ACTIVE' ? 'Suspendre' : 'Réactiver'}</button></td>
    </tr>`,
  },
  commandes: {
    title: 'Commandes',
    path: (q) => `/admin/orders?limit=25&page=${q.get('page') ?? 1}${q.get('statut') ? `&status=${q.get('statut')}` : ''}`,
    columns: ['Commande', 'Acheteur', 'Boutique', 'Statut', 'Total', 'Commission', 'Date'],
    row: (o) => `<tr>
      <td><strong>${esc(o.orderNumber)}</strong>${o.crossBorder ? ' <span class="badge badge-cross">TF</span>' : ''}</td>
      <td class="xs muted">${esc(o.buyer.email)}</td>
      <td>${esc(o.store.name)}</td>
      <td>${statusPill(o.status)}</td>
      <td>${money(o.total, o.currency)}</td>
      <td>${money(o.commissionTotal, o.currency)}</td>
      <td class="xs muted">${formatDate(o.createdAt)}</td>
    </tr>`,
  },
  paiements: {
    title: 'Paiements',
    path: (q) => `/admin/payments?limit=25&page=${q.get('page') ?? 1}`,
    columns: ['Commande', 'Prestataire', 'Méthode', 'Statut', 'Montant', 'Remboursé', 'Date'],
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
    title: 'Expéditions',
    path: (q) => `/admin/shipments?limit=25&page=${q.get('page') ?? 1}`,
    columns: ['Suivi', 'Commande', 'Transporteur', 'Trajet', 'Statut', 'Coût'],
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
    title: 'Litiges',
    path: (q) => `/admin/disputes?limit=25&page=${q.get('page') ?? 1}`,
    columns: ['Commande', 'Motif', 'Statut', 'Messages', 'Preuves', 'Date', 'Décision'],
    row: (d) => `<tr>
      <td>${esc(d.order.orderNumber)}</td>
      <td>${esc(d.reason)}</td>
      <td>${statusPill(d.status)}</td>
      <td>${d._count.messages}</td>
      <td>${d._count.evidence}</td>
      <td class="xs muted">${formatDate(d.createdAt)}</td>
      <td>${['OPEN', 'UNDER_REVIEW'].includes(d.status)
        ? `<div class="row" style="gap:var(--space-2);flex-wrap:nowrap">
             <button class="btn btn-ghost btn-sm" data-resolve-dispute="${esc(d.id)}" data-decision="RESOLVED_BUYER">Acheteur</button>
             <button class="btn btn-ghost btn-sm" data-resolve-dispute="${esc(d.id)}" data-decision="RESOLVED_SELLER">Vendeur</button>
           </div>`
        : '—'}</td>
    </tr>`,
  },
  audit: {
    title: "Journal d'audit",
    path: (q) => `/admin/audit?limit=30&page=${q.get('page') ?? 1}${q.get('action') ? `&action=${encodeURIComponent(q.get('action'))}` : ''}`,
    columns: ['Action', 'Entité', 'Acteur', 'Détail', 'Date'],
    row: (a) => `<tr>
      <td><strong>${esc(a.action)}</strong></td>
      <td class="xs muted">${esc(a.entity)}</td>
      <td class="xs">${esc(a.actor?.email ?? 'système')}</td>
      <td class="xs muted">${esc(JSON.stringify(a.metadata ?? {}).slice(0, 80))}</td>
      <td class="xs muted">${formatDate(a.createdAt, true)}</td>
    </tr>`,
  },
};

export async function list(params, query) {
  const config = LISTS[params.section];
  if (!config) return layout('/touma/admin', 'Administration', emptyState({ title: 'Section inconnue', body: 'Cette page n’existe pas.', iconName: 'alert' }));

  const data = await api(config.path(query));
  const hrefFor = (page) => {
    const next = new URLSearchParams(query);
    next.set('page', String(page));
    return `/touma/admin/${params.section}?${next.toString()}`;
  };

  const content = `
    ${config.search
      ? `<form class="row" id="admin-search" data-section="${esc(params.section)}" style="margin-bottom:var(--space-4)">
          <input name="q" type="search" placeholder="Rechercher…" value="${esc(query.get('q') || '')}" style="max-width:320px" aria-label="Rechercher" />
          <button class="btn btn-secondary" type="submit">Rechercher</button>
        </form>`
      : ''}
    ${data.items.length
      ? `<div class="table-wrap"><table>
          <thead><tr>${config.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${data.items.map(config.row).join('')}</tbody>
        </table></div>
        ${pagination(data, hrefFor)}`
      : emptyState({ title: 'Aucun élément', body: 'Rien à afficher pour ce filtre.', iconName: 'inbox' })}`;

  return layout(`/touma/admin/${params.section}`, config.title, content);
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
                  <span class="small muted">${esc(v.store.countryCode)} · propriétaire ${esc(v.store.owner.email)}</span>
                </div>
                ${statusPill(v.status)}
              </div>
              <dl class="spec-list">
                <div><dt>Raison sociale</dt><dd>${esc(v.legalName)}</dd></div>
                <div><dt>Type</dt><dd>${v.businessType === 'COMPANY' ? 'Entreprise' : 'Entrepreneur individuel'}</dd></div>
                <div><dt>Enregistrement</dt><dd>${esc(v.registrationNo ?? '—')}</dd></div>
                <div><dt>Contact</dt><dd>${esc(v.contactEmail)} · ${esc(v.contactPhone)}</dd></div>
                <div><dt>Documents</dt><dd>${(v.documents || []).length} pièce(s) privée(s)</dd></div>
                <div><dt>Déposé le</dt><dd>${formatDate(v.submittedAt, true)}</dd></div>
              </dl>
              <div class="row mt-6">
                <button class="btn" data-approve-verification="${esc(v.id)}">Approuver</button>
                <button class="btn btn-secondary" data-reject-verification="${esc(v.id)}">Rejeter</button>
              </div>
            </section>`,
          )
          .join('')}
      </div>`
    : emptyState({ title: 'Aucun dossier en attente', body: 'Tous les dossiers de vérification ont été traités.', iconName: 'shield' });

  return layout('/touma/admin/verifications', 'Vérifications vendeur', content);
}

// ── Risque ─────────────────────────────────────────────────────────────────
export async function risk() {
  const data = await api('/admin/risk');
  const content = `
    <div class="alert alert-info" style="margin-bottom:var(--space-5)">
      <div>
        <strong>Le score n'exclut jamais un compte automatiquement.</strong>
        <div class="small">Il agrège des signaux pondérés et explicables ; toute sanction reste une décision humaine, tracée dans le journal d'audit.</div>
      </div>
    </div>
    ${data.items.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Utilisateur</th><th>Score</th><th>Niveau</th><th>Signaux</th><th>Calculé le</th></tr></thead>
          <tbody>
            ${data.items
              .map(
                (r) => `<tr>
                  <td><strong>${esc(r.user.name)}</strong><div class="xs muted">${esc(r.user.email)}</div></td>
                  <td><strong>${r.score}</strong></td>
                  <td><span class="badge ${r.level === 'HIGH' ? 'badge-danger' : r.level === 'MEDIUM' ? 'badge-warn' : ''}">${esc(r.level)}</span></td>
                  <td class="xs">${(r.signals || []).map((s) => esc(s.code)).join(', ') || '—'}</td>
                  <td class="xs muted">${formatDate(r.computedAt, true)}</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table></div>`
      : emptyState({ title: 'Aucun score calculé', body: 'Les scores apparaissent dès qu’un signal est enregistré.', iconName: 'spark' })}`;

  return layout('/touma/admin/risque', 'Score de risque', content);
}

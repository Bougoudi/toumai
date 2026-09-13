/**
 * TOUMA — Seller Center : tableau de bord, boutique, produits, commandes,
 * expéditions, vérification et analyse des ventes.
 */
import { api, esc, money, formatDate, label, session, statusPill, emptyState, productImage, svg } from './core.js';
import { breadcrumb, barChart, statCard, trackingTimeline } from './components.js';

const TABS = [
  ['/touma/vendeur', 'Tableau de bord'],
  ['/touma/vendeur/produits', 'Produits'],
  ['/touma/vendeur/import', 'Import catalogue'],
  ['/touma/vendeur/commandes', 'Commandes'],
  ['/touma/vendeur/messages', 'Messagerie'],
  ['/touma/vendeur/retours', 'Retours'],
  ['/touma/vendeur/promotions', 'Promotions'],
  ['/touma/vendeur/documents', 'Documents'],
  ['/touma/vendeur/boutique', 'Ma boutique'],
  ['/touma/vendeur/analyses', 'Analyses'],
  ['/touma/vendeur/verification', 'Touma Verified'],
];

export function tabs(current) {
  return `<nav class="tabs" aria-label="Espace vendeur">
    ${TABS.map(([href, text]) => `<a href="${href}" data-link${href === current ? ' aria-current="page"' : ''}>${text}</a>`).join('')}
  </nav>`;
}

function noStore() {
  return emptyState({
    title: 'Ouvrez votre boutique',
    body: 'Créez votre boutique pour publier vos produits et recevoir des commandes du Tchad et du Cameroun.',
    actionLabel: 'Créer ma boutique',
    actionHref: '/touma/vendeur/boutique',
    iconName: 'store',
  });
}

// ── Tableau de bord ────────────────────────────────────────────────────────
const REPUTATION_LEVEL = {
  EXCELLENT: 'Excellent',
  FIABLE: 'Fiable',
  CORRECT: 'Correct',
  A_SURVEILLER: 'À surveiller',
  NOUVEAU: 'Nouvelle boutique',
};

const pct = (value) => `${Math.round(value * 100)} %`;

/**
 * Réputation du vendeur, avec le poids de chaque composante : un vendeur doit
 * pouvoir agir sur son score, donc savoir ce qui le compose.
 */
function reputationPanel(r, store) {
  if (!r.published) {
    return `<section class="card" style="margin-bottom:var(--space-5)">
      <h2 style="font-size:var(--text-md)">Réputation</h2>
      <p class="small muted" style="margin:0">
        Vos indicateurs seront publiés sur votre vitrine à partir de ${r.minimumOrders} commandes livrées
        (${r.ordersDelivered} à ce jour). En dessous, un taux ne voudrait rien dire.
      </p>
    </section>`;
  }

  const m = r.metrics;
  const rows = [
    ['Livraisons dans le délai', m.onTimeRate === null ? null : pct(m.onTimeRate), r.weights.onTime],
    ['Note des acheteurs', r.rating.count ? `${r.rating.average.toFixed(1)}/5 (${r.rating.count})` : null, r.weights.rating],
    ['Commandes non annulées', m.cancellationRate === null ? null : pct(1 - m.cancellationRate), r.weights.cancellation],
    [
      'Sans litige ni retour',
      m.disputeRate === null || m.returnRate === null ? null : pct(Math.max(0, 1 - (m.disputeRate + m.returnRate))),
      r.weights.problems,
    ],
    ['Réponses aux messages', m.responseRate === null ? null : pct(m.responseRate), r.weights.responsiveness],
  ];

  return `<section class="card" style="margin-bottom:var(--space-5)">
    <div class="card-head">
      <div>
        <h2 style="font-size:var(--text-md);margin-bottom:2px">Réputation — ${esc(store.name)}</h2>
        <span class="small muted">Calculée sur ${r.ordersDelivered} commande(s) livrée(s).</span>
      </div>
      <span class="badge badge-verified">${esc(REPUTATION_LEVEL[r.level] ?? r.level)} · ${r.score}/100</span>
    </div>
    <div class="table-wrap" style="border:0"><table>
      <thead><tr><th>Composante</th><th>Votre résultat</th><th>Poids</th></tr></thead>
      <tbody>
        ${rows
          .map(
            ([labelText, value, weight]) => `<tr>
              <td>${esc(labelText)}</td>
              <td>${value === null ? '<span class="muted small">pas encore mesurable</span>' : esc(value)}</td>
              <td class="small muted">${Math.round(weight * 100)} %</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table></div>
    <p class="xs muted" style="margin:var(--space-3) 0 0">
      Une composante non mesurable ne vous pénalise pas : le score est ramené à ce qui a pu être observé.
    </p>
  </section>`;
}

export async function dashboard() {
  const data = await api('/seller/dashboard');
  if (!data.stores.length) return `<h1>Espace vendeur</h1>${tabs('/touma/vendeur')}${noStore()}`;

  const main = data.stores[0];
  const [analytics, reputation] = await Promise.all([
    api(`/seller/stores/${main.id}/analytics?days=30`).catch(() => null),
    // Recalculée à la demande : le vendeur veut voir l'effet de ses actions.
    api(`/reputation/mine/${main.id}`).catch(() => null),
  ]);
  const revenue = Object.entries(main.stats.revenue);
  const user = session.user;

  return `
    <div class="row-between">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px">Bonjour ${esc((user?.name ?? '').split(' ')[0])}</h1>
        <p class="muted small" style="margin:0">Voici l'activité de vos boutiques.</p>
      </div>
      <a class="btn btn-accent" href="/touma/vendeur/produits/nouveau" data-link>Ajouter un produit</a>
    </div>
    ${tabs('/touma/vendeur')}

    ${data.stores
      .map(
        (s) => `<section class="card" style="margin-bottom:var(--space-5)">
          <div class="card-head">
            <div>
              <h2 style="font-size:var(--text-md);margin-bottom:2px">${esc(s.name)}</h2>
              <span class="small muted">${esc(s.countryCode)} · <a href="/touma/boutiques/${esc(s.slug)}" data-link>voir la vitrine</a></span>
            </div>
            <div class="row" style="gap:var(--space-2)">
              ${statusPill(s.status)}
              ${s.verificationStatus === 'APPROVED'
                ? '<span class="badge badge-verified">Vérifiée</span>'
                : `<a class="badge badge-warn" href="/touma/vendeur/verification" data-link>Vérification : ${esc(label(s.verificationStatus))}</a>`}
            </div>
          </div>
          <div class="grid grid-stats">
            ${statCard('Chiffre d’affaires', Object.entries(s.stats.revenue).map(([c, v]) => money(v, c)).join(' · ') || '—', 'commandes payées')}
            ${statCard('Commandes payées', s.stats.paidOrders)}
            ${statCard('À expédier', s.stats.toShip, s.stats.toShip ? 'action requise' : 'rien en attente')}
            ${statCard('Produits actifs', s.stats.activeProducts)}
            ${statCard('Stock faible', s.stats.lowStockItems, s.stats.lowStockItems ? 'à réapprovisionner' : 'stock sain')}
          </div>
        </section>`,
      )
      .join('')}

    ${reputation ? reputationPanel(reputation, main) : ''}

    ${analytics
      ? `<section class="card" style="margin-bottom:var(--space-5)">
          <div class="card-head"><h2 style="font-size:var(--text-md)">Ventes des 30 derniers jours — ${esc(main.name)}</h2></div>
          ${barChart(analytics.series, { valueKey: 'revenue', labelKey: 'date', currency: analytics.series.find((s) => s.currency)?.currency ?? null })}
        </section>`
      : ''}

    <section class="card">
      <div class="card-head">
        <h2 style="font-size:var(--text-md)">Dernières commandes</h2>
        <a class="small" href="/touma/vendeur/commandes" data-link>Tout voir</a>
      </div>
      ${data.recentOrders.length
        ? `<div class="table-wrap" style="border:0"><table>
            <thead><tr><th>Commande</th><th>Client</th><th>Statut</th><th>Total</th><th></th></tr></thead>
            <tbody>
              ${data.recentOrders
                .map(
                  (o) => `<tr>
                    <td><strong>${esc(o.orderNumber)}</strong><div class="xs muted">${formatDate(o.createdAt)}</div></td>
                    <td>${esc(o.buyer)}</td>
                    <td>${statusPill(o.status)}</td>
                    <td>${money(o.total, o.currency)}</td>
                    <td><a class="btn btn-secondary btn-sm" href="/touma/vendeur/commandes/${esc(o.id)}" data-link>Traiter</a></td>
                  </tr>`,
                )
                .join('')}
            </tbody>
          </table></div>`
        : '<p class="muted small">Aucune commande reçue pour l’instant.</p>'}
    </section>`;
}

// ── Boutique ───────────────────────────────────────────────────────────────
export async function storeSettings() {
  const [mine, countries] = await Promise.all([api('/stores/mine'), api('/countries')]);
  return `
    <h1 style="font-size:var(--text-xl)">Ma boutique</h1>
    ${tabs('/touma/vendeur/boutique')}

    ${mine.items
      .map(
        (s) => `<form class="card store-form" data-store="${esc(s.id)}" style="margin-bottom:var(--space-5)">
          <div class="card-head">
            <h2 style="font-size:var(--text-md)">${esc(s.name)}</h2>
            <div class="row" style="gap:var(--space-2)">${statusPill(s.status)}<a class="btn btn-secondary btn-sm" href="/touma/boutiques/${esc(s.slug)}" data-link>Voir la vitrine</a></div>
          </div>
          <div class="grid grid-2">
            <div class="field"><label for="n-${esc(s.id)}">Nom</label><input id="n-${esc(s.id)}" name="name" value="${esc(s.name)}" required /></div>
            <div class="field"><label for="c-${esc(s.id)}">Ville</label><input id="c-${esc(s.id)}" name="city" value="${esc(s.city ?? '')}" /></div>
          </div>
          <div class="field"><label for="d-${esc(s.id)}">Description</label><textarea id="d-${esc(s.id)}" name="description" rows="3" maxlength="2000">${esc(s.description ?? '')}</textarea></div>
          <div class="grid grid-2">
            <div class="field"><label for="l-${esc(s.id)}">Logo (URL)</label><input id="l-${esc(s.id)}" name="logoUrl" type="url" value="${esc(s.logoUrl ?? '')}" placeholder="https://…" /></div>
            <div class="field"><label for="b-${esc(s.id)}">Bannière (URL)</label><input id="b-${esc(s.id)}" name="bannerUrl" type="url" value="${esc(s.bannerUrl ?? '')}" placeholder="https://…" /></div>
          </div>
          <div class="field"><label for="p-${esc(s.id)}">Téléphone</label><input id="p-${esc(s.id)}" name="phone" value="${esc(s.phone ?? '')}" inputmode="tel" /></div>
          <button class="btn" type="submit">Enregistrer</button>
        </form>`,
      )
      .join('')}

    <form class="card" id="create-store-form">
      <h2 style="font-size:var(--text-md)">${mine.items.length ? 'Ouvrir une autre boutique' : 'Ouvrir ma boutique'}</h2>
      <div class="field"><label for="ns-name">Nom de la boutique</label><input id="ns-name" required maxlength="120" /></div>
      <div class="grid grid-2">
        <div class="field"><label for="ns-country">Pays</label>
          <select id="ns-country">${countries.items.map((c) => `<option value="${esc(c.code)}"${c.code === session.user?.countryCode ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="ns-city">Ville</label><input id="ns-city" /></div>
      </div>
      <div class="field"><label for="ns-desc">Description</label><textarea id="ns-desc" rows="3" maxlength="2000" placeholder="Ce que vous vendez, à qui, depuis quand…"></textarea></div>
      <button class="btn btn-accent" type="submit">Créer la boutique</button>
    </form>`;
}

// ── Produits ───────────────────────────────────────────────────────────────
export async function products() {
  const result = await api('/products/mine?limit=50');
  return `
    <div class="row-between">
      <h1 style="font-size:var(--text-xl)">Mes produits</h1>
      <a class="btn btn-accent" href="/touma/vendeur/produits/nouveau" data-link>Ajouter un produit</a>
    </div>
    ${tabs('/touma/vendeur/produits')}
    ${result.items.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Produit</th><th>Prix</th><th>Stock</th><th>Statut</th><th>Actions</th></tr></thead>
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
                  <td><input type="number" min="0" value="${p.stock}" class="stock-input" data-product="${esc(p.id)}" style="width:88px;min-height:38px" aria-label="Stock de ${esc(p.title)}" /></td>
                  <td>${statusPill(p.status)}</td>
                  <td>
                    <div class="row" style="gap:var(--space-2);flex-wrap:nowrap">
                      <a class="btn btn-secondary btn-sm" href="/touma/vendeur/produits/${esc(p.id)}" data-link>Modifier</a>
                      <button class="btn btn-ghost btn-sm" data-toggle-product="${esc(p.id)}" data-status="${p.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE'}">${p.status === 'ACTIVE' ? 'Dépublier' : 'Publier'}</button>
                    </div>
                  </td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table></div>
        <p class="xs muted mt-6">Modifier une valeur de stock l'enregistre immédiatement.</p>`
      : emptyState({
          title: 'Aucun produit',
          body: 'Publiez votre premier produit : titre, prix, stock et quantité minimale de commande suffisent pour démarrer.',
          actionLabel: 'Ajouter un produit',
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
  if (!stores.items.length) return `<h1 style="font-size:var(--text-xl)">Nouveau produit</h1>${tabs('/touma/vendeur/produits')}${noStore()}`;

  const value = (v) => esc(v ?? '');
  return `
    ${breadcrumb([{ label: 'Espace vendeur', href: '/touma/vendeur' }, { label: 'Produits', href: '/touma/vendeur/produits' }, { label: editing ? existing.title : 'Nouveau produit' }])}
    <h1 style="font-size:var(--text-xl)">${editing ? 'Modifier le produit' : 'Nouveau produit'}</h1>
    ${tabs('/touma/vendeur/produits')}

    <form class="card" id="product-form" ${editing ? `data-product="${esc(params.id)}"` : ''}>
      <div class="grid grid-2">
        <div class="field">
          <label for="p-store">Boutique</label>
          <select id="p-store" ${editing ? 'disabled' : ''}>
            ${stores.items.map((s) => `<option value="${esc(s.id)}"${editing && existing.store.id === s.id ? ' selected' : ''}>${esc(s.name)} (${esc(s.countryCode)})</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="p-category">Catégorie</label>
          <select id="p-category">
            <option value="">Non classé</option>
            ${categories.items.map((c) => `<option value="${esc(c.id)}"${editing && existing.category?.id === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="field"><label for="p-title">Titre</label><input id="p-title" required maxlength="200" value="${value(existing?.title)}" /></div>

      <div class="field">
        <label for="p-description">Description</label>
        <textarea id="p-description" rows="6" maxlength="10000">${value(existing?.description)}</textarea>
        <div class="row" style="gap:var(--space-2);margin-top:var(--space-2)">
          <button class="btn btn-secondary btn-sm" type="button" id="ai-description">${svg('spark')} Proposer une description</button>
          <span class="field-hint" style="margin:0">Proposition de Touma AI — à relire et corriger avant publication.</span>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="field"><label for="p-price">Prix unitaire</label><input id="p-price" required inputmode="decimal" placeholder="25000" value="${value(existing?.price)}" /></div>
        <div class="field"><label for="p-quantity">Stock disponible</label><input id="p-quantity" type="number" min="0" value="${existing?.stock ?? 10}" /></div>
        <div class="field"><label for="p-min">Quantité minimale de commande</label><input id="p-min" type="number" min="1" value="${existing?.minOrderQty ?? 1}" /></div>
        <div class="field"><label for="p-weight">Poids unitaire (grammes)</label><input id="p-weight" type="number" min="1" value="${existing?.weightGrams ?? 800}" /></div>
        <div class="field">
          <label for="p-country">Pays d'expédition</label>
          <select id="p-country">${countries.items.map((c) => `<option value="${esc(c.code)}"${existing?.countryCode === c.code ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label for="p-image">Image (URL)</label><input id="p-image" type="url" placeholder="https://…" value="${value(existing?.images?.[0]?.url)}" /></div>
      </div>

      <div class="field"><label for="p-keywords">Mots-clés (recherche)</label><input id="p-keywords" placeholder="sésame, export, gros" value="${value(existing?.keywords)}" /></div>

      <div class="field">
        <label for="p-status">Publication</label>
        <select id="p-status">
          <option value="ACTIVE"${existing?.status === 'ACTIVE' ? ' selected' : ''}>Publié dans le catalogue</option>
          <option value="DRAFT"${existing?.status === 'DRAFT' ? ' selected' : ''}>Brouillon (invisible)</option>
        </select>
      </div>

      <div class="row">
        <button class="btn btn-accent" type="submit">${editing ? 'Enregistrer les modifications' : 'Publier le produit'}</button>
        <a class="btn btn-ghost" href="/touma/vendeur/produits" data-link>Annuler</a>
        ${editing ? `<button class="btn btn-ghost btn-sm" type="button" data-archive-product="${esc(params.id)}">Archiver</button>` : ''}
      </div>
    </form>`;
}

// ── Commandes vendeur ──────────────────────────────────────────────────────
export async function orders(_params, query) {
  const status = query.get('statut');
  const result = await api(`/orders?scope=seller&limit=50${status ? `&status=${status}` : ''}`);
  const filters = ['', 'PAID', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'COMPLETED'];

  return `
    <h1 style="font-size:var(--text-xl)">Commandes reçues</h1>
    ${tabs('/touma/vendeur/commandes')}
    <div class="chip-row" style="margin-bottom:var(--space-5)">
      ${filters.map((f) => `<a class="chip" href="/touma/vendeur/commandes${f ? `?statut=${f}` : ''}" data-link aria-current="${(status ?? '') === f}">${f ? esc(label(f)) : 'Toutes'}</a>`).join('')}
    </div>
    ${result.items.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Commande</th><th>Statut</th><th>Total</th><th>Suivi</th><th></th></tr></thead>
          <tbody>
            ${result.items
              .map(
                (o) => `<tr>
                  <td><strong>${esc(o.orderNumber)}</strong>${o.crossBorder ? ' <span class="badge badge-cross">TF</span>' : ''}<div class="xs muted">${formatDate(o.createdAt)}</div></td>
                  <td>${statusPill(o.status)}</td>
                  <td>${money(o.total, o.currency)}</td>
                  <td class="small">${o.shipment ? esc(o.shipment.trackingNumber) : '—'}</td>
                  <td><a class="btn btn-secondary btn-sm" href="/touma/vendeur/commandes/${esc(o.id)}" data-link>Traiter</a></td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table></div>`
      : emptyState({ title: 'Aucune commande', body: 'Vos ventes apparaîtront ici dès la première commande payée.', iconName: 'box' })}`;
}

export async function order(params) {
  const o = await api(`/orders/${params.id}`);
  const shipment = o.shipments?.[0];
  const net = Number(o.total) - Number(o.commissionTotal);

  return `
    ${breadcrumb([{ label: 'Commandes', href: '/touma/vendeur/commandes' }, { label: o.orderNumber }])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px">Commande ${esc(o.orderNumber)}</h1>
        <p class="small muted" style="margin:0">${esc(o.buyer?.name ?? '')} · ${formatDate(o.createdAt, true)}</p>
      </div>
      ${statusPill(o.status)}
    </div>

    <div class="grid grid-2">
      <div class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">Articles</h2>
          <div class="table-wrap" style="border:0"><table>
            <thead><tr><th>Produit</th><th>Qté</th><th>Total</th></tr></thead>
            <tbody>${o.items.map((i) => `<tr><td>${esc(i.titleSnapshot)}</td><td>${i.quantity}</td><td>${money(i.lineTotal, i.currency)}</td></tr>`).join('')}</tbody>
          </table></div>
          <div class="summary mt-6">
            <div class="summary-line"><span>Sous-total</span><span>${money(o.subtotal, o.currency)}</span></div>
            <div class="summary-line"><span>Livraison</span><span>${money(o.shippingTotal, o.currency)}</span></div>
            <div class="summary-line"><span>Commission TOUMA</span><span>− ${money(o.commissionTotal, o.currency)}</span></div>
            <div class="summary-line summary-total"><span>Net vendeur estimé</span><span>${money(net, o.currency)}</span></div>
          </div>
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">Adresse de livraison</h2>
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
          <h2 style="font-size:var(--text-md)">Expédition</h2>
          ${shipment
            ? `<div class="row" style="gap:var(--space-2)">${statusPill(shipment.status)}<span class="small">${esc(shipment.trackingNumber)}</span></div>
               <div class="field mt-6">
                 <label for="ship-status">Faire avancer le suivi</label>
                 <select id="ship-status">
                   <option value="SHIPPED">Colis remis au transporteur</option>
                   <option value="IN_TRANSIT">En transit</option>
                   <option value="DELIVERED">Livré</option>
                   <option value="RETURNED">Retourné</option>
                 </select>
               </div>
               <button class="btn btn-block" data-update-shipment="${esc(shipment.id)}">Mettre à jour le suivi</button>
               <div class="mt-6">${trackingTimeline(shipment.events)}</div>`
            : ['PAID', 'CONFIRMED', 'PROCESSING', 'READY_TO_SHIP'].includes(o.status)
              ? `<p class="small muted">TOUMA interroge les transporteurs, génère l'étiquette et le numéro de suivi.</p>
                 <button class="btn btn-accent btn-block" data-create-shipment="${esc(o.id)}">Créer l'expédition</button>
                 ${
                   o.status === 'READY_TO_SHIP'
                     ? '<p class="small muted mt-4">Colis signalé prêt : l’acheteur sait que vous attendez le transporteur.</p>'
                     : `<button class="btn btn-secondary btn-block mt-4" data-order-ready="${esc(o.id)}">Colis prêt, transporteur pas encore passé</button>`
                 }`
              : '<p class="small muted">L’expédition sera possible une fois la commande payée.</p>'}
        </section>
      </aside>
    </div>`;
}

// ── Analyses ───────────────────────────────────────────────────────────────
export async function analytics(_params, query) {
  const mine = await api('/stores/mine');
  if (!mine.items.length) return `<h1 style="font-size:var(--text-xl)">Analyses</h1>${tabs('/touma/vendeur/analyses')}${noStore()}`;

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
    <h1 style="font-size:var(--text-xl)">Analyses</h1>
    ${tabs('/touma/vendeur/analyses')}

    <div class="row-between" style="margin-bottom:var(--space-4)">
      <div class="row" style="gap:var(--space-2)">
        ${mine.items.map((s) => `<a class="chip" href="/touma/vendeur/analyses?boutique=${esc(s.id)}&jours=${days}" data-link aria-current="${s.id === storeId}">${esc(s.name)}</a>`).join('')}
      </div>
      <div class="row" style="gap:var(--space-2)">
        ${[7, 30, 90].map((d) => `<a class="chip" href="/touma/vendeur/analyses?boutique=${esc(storeId)}&jours=${d}" data-link aria-current="${d === days}">${d} j</a>`).join('')}
      </div>
    </div>

    <div class="grid grid-stats" style="margin-bottom:var(--space-5)">
      ${statCard('Commandes payées', totalOrders, `sur ${days} jours`)}
      ${statCard('Chiffre d’affaires', currency ? money(totalRevenue, currency) : '—', `sur ${days} jours`)}
      ${statCard('Panier moyen', totalOrders ? money(totalRevenue / totalOrders, currency ?? '') : '—')}
      ${statCard('Produits actifs', stats.activeProducts)}
      ${statCard('Stock faible', stats.lowStockItems)}
    </div>

    <section class="card" style="margin-bottom:var(--space-5)">
      <div class="card-head"><h2 style="font-size:var(--text-md)">Chiffre d’affaires par jour</h2></div>
      ${barChart(data.series, { valueKey: 'revenue', labelKey: 'date', currency })}
    </section>

    <section class="card">
      <div class="card-head"><h2 style="font-size:var(--text-md)">Produits les plus vendus</h2></div>
      ${data.topProducts.length
        ? `<div class="table-wrap" style="border:0"><table>
            <thead><tr><th>Produit</th><th>Quantité vendue</th></tr></thead>
            <tbody>${data.topProducts.map((p) => `<tr><td>${esc(p.title)}</td><td>${p.quantity}</td></tr>`).join('')}</tbody>
          </table></div>`
        : '<p class="muted small">Aucune vente sur la période.</p>'}
    </section>`;
}

// ── Touma Verified ─────────────────────────────────────────────────────────
export async function verification() {
  const [statusData, mine] = await Promise.all([api('/verification/status'), api('/stores/mine')]);
  return `
    <h1 style="font-size:var(--text-xl)">Touma Verified</h1>
    ${tabs('/touma/vendeur/verification')}
    <p class="muted small">
      La vérification atteste que votre entreprise a fourni des justificatifs contrôlés par notre équipe. Vos documents
      restent privés : ils ne sont jamais affichés publiquement.
    </p>

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
                    Dossier du ${formatDate(v.submittedAt)} — ${statusPill(v.status)} · ${v.documentCount} document(s)
                    ${v.reviewerComment ? `<br /><em class="muted">« ${esc(v.reviewerComment)} »</em>` : ''}
                  </p>`,
                )
                .join('')
            : '<p class="small muted" style="margin:0">Aucun dossier déposé.</p>'}
        </section>`,
      )
      .join('')}

    ${mine.items.length
      ? `<form class="card" id="verification-form">
          <h2 style="font-size:var(--text-md)">Déposer un dossier</h2>
          <div class="field"><label for="v-store">Boutique</label>
            <select id="v-store">${mine.items.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="v-type">Type d'activité</label>
            <select id="v-type"><option value="COMPANY">Entreprise enregistrée</option><option value="INDIVIDUAL">Entrepreneur individuel</option></select></div>
          <div class="field"><label for="v-legal">Raison sociale / nom légal</label><input id="v-legal" required maxlength="200" /></div>
          <div class="grid grid-2">
            <div class="field"><label for="v-reg">Numéro d'enregistrement (RCCM…)</label><input id="v-reg" maxlength="80" /></div>
            <div class="field"><label for="v-phone">Téléphone de contact</label><input id="v-phone" required inputmode="tel" /></div>
          </div>
          <div class="field"><label for="v-email">E-mail de contact</label><input id="v-email" type="email" required /></div>
          <div class="field">
            <label for="v-doc">Lien du justificatif</label>
            <input id="v-doc" type="url" required placeholder="https://…" />
            <span class="field-hint">Document privé : seul le comité de revue TOUMA y accède.</span>
          </div>
          <button class="btn btn-accent" type="submit">Envoyer le dossier</button>
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
  if (!stores.items.length) return `<h1 style="font-size:var(--text-xl)">Import catalogue</h1>${tabs('/touma/vendeur/import')}${noStore()}`;

  return `
    <h1 style="font-size:var(--text-xl)">Import de catalogue</h1>
    ${tabs('/touma/vendeur/import')}

    <div class="grid grid-2" style="align-items:start">
      <section class="card">
        <h2 style="font-size:var(--text-md)">Votre fichier</h2>
        <p class="small muted">
          Un tableur exporté en CSV suffit. Les colonnes sont reconnues en français comme en anglais,
          avec ou sans accents, séparées par des virgules ou des points-virgules.
        </p>

        <form id="import-form">
          <div class="field">
            <label for="im-store">Boutique</label>
            <select id="im-store">${stores.items.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>
          </div>

          <div class="field">
            <label for="im-file">Choisir un fichier CSV</label>
            <input id="im-file" type="file" accept=".csv,text/csv,text/plain" />
          </div>

          <div class="field">
            <label for="im-csv">…ou collez le contenu</label>
            <textarea id="im-csv" rows="8" spellcheck="false"
              style="font-family:var(--font-mono);font-size:var(--text-xs)"
              placeholder="sku;titre;prix;stock;statut&#10;CACAO-50;Cacao en fèves;145000;40;ACTIVE"></textarea>
          </div>

          <button class="btn btn-block" type="submit">Analyser le fichier</button>
          <p class="xs muted" style="margin:var(--space-2) 0 0">
            Rien n’est enregistré à cette étape : vous verrez d’abord le résultat ligne par ligne.
          </p>
        </form>
      </section>

      <aside class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">Colonnes attendues</h2>
          <dl class="spec-list">
            <div><dt>sku</dt><dd>votre référence — sert à mettre à jour</dd></div>
            <div><dt>titre</dt><dd>obligatoire</dd></div>
            <div><dt>prix</dt><dd>obligatoire, dans la devise de la boutique</dd></div>
            <div><dt>stock</dt><dd>quantité disponible</dd></div>
            <div><dt>quantite_minimale</dt><dd>commande minimale (gros)</dd></div>
            <div><dt>poids_grammes</dt><dd>sert au calcul du transport</dd></div>
            <div><dt>categorie</dt><dd>identifiant ou nom de catégorie</dd></div>
            <div><dt>statut</dt><dd>ACTIVE ou DRAFT</dd></div>
            <div><dt>image_url</dt><dd>lien vers une photo</dd></div>
          </dl>
          <div class="stack" style="gap:var(--space-2);margin-top:var(--space-4)">
            <a class="btn btn-secondary btn-sm" href="/api/v1/seller/catalogue/modele" data-authed-download>Télécharger un modèle vierge</a>
            <a class="btn btn-secondary btn-sm" href="#" data-export-catalogue>Exporter mon catalogue actuel</a>
          </div>
          <p class="xs muted" style="margin:var(--space-3) 0 0">
            L’export a exactement le même format : exportez, corrigez dans votre tableur, réimportez.
          </p>
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
      <h2 style="font-size:var(--text-md)">${applied ? 'Import terminé' : 'Résultat de l’analyse'}</h2>
      <span class="small muted">${result.summary.rows} ligne(s) lue(s)</span>
    </div>

    <div class="grid grid-stats">
      ${statCard(applied ? 'Produits créés' : 'À créer', applied ? result.summary.created : result.summary.toCreate)}
      ${statCard(applied ? 'Produits mis à jour' : 'À mettre à jour', applied ? result.summary.updated : result.summary.toUpdate)}
      ${statCard('Lignes en erreur', result.summary.errors, result.summary.errors ? 'à corriger dans votre fichier' : 'aucune')}
    </div>

    ${errors.length
      ? `<div class="table-wrap mt-6"><table>
          <thead><tr><th>Ligne</th><th>Référence</th><th>Problème</th></tr></thead>
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
      ? `<a class="btn btn-secondary mt-6" href="/touma/vendeur/produits" data-link>Voir mes produits</a>`
      : result.summary.toCreate + result.summary.toUpdate > 0
        ? `<button class="btn btn-accent mt-6" data-apply-import="${esc(storeId)}">
            Appliquer : ${result.summary.toCreate} création(s), ${result.summary.toUpdate} mise(s) à jour
          </button>`
        : '<p class="small muted mt-6">Aucune ligne exploitable : corrigez votre fichier et relancez l’analyse.</p>'}
  </section>`;
}

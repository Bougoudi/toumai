'use strict';

// ── Helpers ────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
};
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

// ── Authentification (jeton) ───────────────────────────────
const TOKEN_KEY = 'toumai_token';
const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/auth')) {
    setToken(null);
    showAuth();
  }
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

const money = (n, c = 'EUR') =>
  (n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + c;
const dt = (s) => new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

function badge(status) {
  const s = String(status).toUpperCase();
  const ok = ['SHIPPED', 'DELIVERED', 'COMPLETED', 'ACTIVE', 'PAID', 'IMPORTED'];
  const wait = ['FULFILLING', 'RUNNING', 'PENDING', 'EVALUATED', 'NEW', 'DRAFT', 'CREATED', 'PLACED'];
  const cls = ok.includes(s) ? 'ok' : wait.includes(s) ? 'wait' : 'bad';
  return `<span class="badge ${cls}">${s}</span>`;
}

function tableHtml(headers, rows) {
  if (!rows.length) return '<div class="empty">Aucune donnée</div>';
  return (
    '<table><thead><tr>' +
    headers.map((h) => `<th>${h}</th>`).join('') +
    '</tr></thead><tbody>' +
    rows.map((r) => `<tr${r._attr || ''}>` + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') +
    '</tbody></table>'
  );
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

function busy(btn, on, label) {
  if (on) {
    btn.dataset.label = btn.innerHTML;
    btn.innerHTML = `<span class="spin"></span> ${label || '...'}`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.label || btn.innerHTML;
    btn.disabled = false;
  }
}

// ── Modale ─────────────────────────────────────────────────
function openModal(html) {
  $('#modal-content').innerHTML = html;
  $('#modal').hidden = false;
}
function closeModal() {
  $('#modal').hidden = true;
  $('#modal-content').innerHTML = '';
}
document.querySelectorAll('[data-close]').forEach((n) => n.addEventListener('click', closeModal));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// ── Onglets ────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $('#tab-' + tab.dataset.tab).classList.add('active');
    loaders[tab.dataset.tab]?.();
  });
});

// ── Tableau de bord ────────────────────────────────────────
async function loadDashboard() {
  try {
    const d = await api('/api/dashboard');
    const orderCount = Object.values(d.orders.byStatus).reduce((a, b) => a + b, 0);
    $('#kpis').replaceChildren(
      el(`<div class="kpi accent"><div class="label">Opportunités</div><div class="value num">${d.market.opportunities}</div><div class="sub">score moyen ${d.market.avgOpportunityScore}/100</div></div>`),
      el(`<div class="kpi"><div class="label">Produits actifs</div><div class="value num">${d.catalog.active}</div><div class="sub">${d.catalog.generatedToday} générés aujourd'hui</div></div>`),
      el(`<div class="kpi"><div class="label">Commandes</div><div class="value num">${orderCount}</div><div class="sub">${d.suppliers.total} fournisseurs</div></div>`),
      el(`<div class="kpi green"><div class="label">Profit estimé</div><div class="value num">${money(d.finance.estimatedProfit)}</div><div class="sub">CA ${money(d.finance.revenue)}</div></div>`),
    );
    $('#finance').innerHTML = `
      <div class="f"><div class="l">Chiffre d'affaires</div><div class="v num">${money(d.finance.revenue)}</div></div>
      <div class="f"><div class="l">Coût d'achat</div><div class="v num">${money(d.finance.purchaseCost)}</div></div>
      <div class="f"><div class="l">Profit estimé</div><div class="v num" style="color:var(--green)">${money(d.finance.estimatedProfit)}</div></div>`;
    $('#recent-orders').innerHTML = tableHtml(
      ['N°', 'Client', 'Statut', 'Total', 'Articles'],
      d.recent.orders.map((o) => {
        const r = [esc(o.orderNumber), esc(o.customer), badge(o.status), `<span class="num">${money(o.total)}</span>`, o.items];
        r._attr = ` class="clickable" data-order="${o.id}"`;
        return r;
      }),
    );
    bindOrderRows('#recent-orders');
  } catch (e) {
    toast(e.message);
  }
}

// ── Marché ─────────────────────────────────────────────────
async function loadMarket() {
  try {
    const d = await api('/api/market/opportunities?take=25&minScore=0');
    $('#market-table').innerHTML = tableHtml(
      ['Produit', 'Catégorie', 'Score', 'Demande', 'Concur.', 'Prix vente', 'Statut'],
      d.items.map((o) => [
        esc(o.title),
        esc(o.category),
        `<b class="num">${Math.round(o.opportunityScore)}</b>`,
        `<span class="num">${Math.round(o.demandScore)}</span>`,
        `<span class="num">${Math.round(o.competitionScore)}</span>`,
        `<span class="num">${o.estimatedSalePrice ? money(o.estimatedSalePrice) : '—'}</span>`,
        badge(o.status),
      ]),
    );
  } catch (e) {
    toast(e.message);
  }
}

$('#scan-market').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  busy(btn, true, 'Analyse...');
  try {
    const region = $('#market-region').value.trim();
    const r = await api('/api/market/scan', { method: 'POST', body: { region: region || undefined } });
    toast(`${r.discovered} opportunités analysées`);
    await loadMarket();
  } catch (e) {
    toast(e.message);
  } finally {
    busy(btn, false);
  }
});

// ── Produits (avec filtres) ────────────────────────────────
async function loadProducts() {
  try {
    const params = new URLSearchParams({ take: '50' });
    const q = $('#p-search').value.trim();
    const cat = $('#p-category').value.trim();
    const status = $('#p-status').value;
    if (q) params.set('q', q);
    if (cat) params.set('category', cat);
    if (status) params.set('status', status);
    const d = await api('/api/products?' + params.toString());
    $('#products-table').innerHTML =
      `<div class="muted" style="margin-bottom:10px">${d.total} produit(s)</div>` +
      tableHtml(
        ['Nom', 'Catégorie', 'Achat', 'Vente', 'Marge', 'Statut'],
        d.items.map((p) => [
          esc(p.name),
          esc(p.category),
          `<span class="num">${p.costPrice ? money(p.costPrice) : '—'}</span>`,
          `<span class="num">${p.salePrice ? money(p.salePrice) : '—'}</span>`,
          `<span class="num">${p.margin ? money(p.margin) : '—'}</span>`,
          badge(p.status),
        ]),
      );
  } catch (e) {
    toast(e.message);
  }
}
$('#p-filter').addEventListener('click', loadProducts);
$('#p-search').addEventListener('keydown', (e) => e.key === 'Enter' && loadProducts());

$('#generate').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  busy(btn, true, 'Génération...');
  try {
    const limit = Number($('#gen-count').value) || 20;
    const run = await api('/api/products/generate', { method: 'POST', body: { limit, autoPublish: true } });
    $('#gen-status').textContent = `${run.generated} générés, ${run.skipped} ignorés`;
    toast(`${run.generated} produits générés`);
    await loadProducts();
  } catch (e) {
    toast(e.message);
  } finally {
    busy(btn, false);
  }
});

// ── Fournisseurs : recherche par produit ───────────────────
$('#search-suppliers').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  const query = $('#s-query').value.trim();
  const category = $('#s-category').value.trim();
  if (!query && !category) return toast('Saisissez un mot-clé ou une catégorie');
  busy(btn, true, 'Recherche...');
  try {
    const r = await api('/api/search', {
      method: 'POST',
      body: { query, category: category || undefined, region: $('#s-region').value.trim() || undefined, limit: 15, async: false },
    });
    $('#suppliers-table').innerHTML = tableHtml(
      ['#', 'Fournisseur', 'Pays', 'Note', 'Score', 'Meilleure offre'],
      r.results.map((m) => {
        const row = [
          m.rank,
          `<span class="link">${esc(m.supplier.name)}</span>`,
          esc(m.supplier.country || '—'),
          `${m.supplier.rating}/5`,
          `<b class="num">${m.breakdown.total}</b>`,
          m.offer ? `${esc(m.offer.title)} <span class="muted num">(${money(m.offer.unitPrice)})</span>` : '—',
        ];
        row._attr = ` class="clickable" data-supplier="${m.supplier.id}"`;
        return row;
      }),
    );
    bindSupplierRows('#suppliers-table');
    toast(`${r.results.length} fournisseurs classés`);
  } catch (e) {
    toast(e.message);
  } finally {
    busy(btn, false);
  }
});

// ── Fournisseurs : annuaire (liste + filtres) ──────────────
async function loadDirectory() {
  try {
    const params = new URLSearchParams({ take: '50' });
    const region = $('#d-region').value.trim();
    const rating = $('#d-rating').value;
    if (region) params.set('region', region);
    if (rating) params.set('minRating', rating);
    if ($('#d-verified').checked) params.set('verified', 'true');
    const d = await api('/api/suppliers?' + params.toString());
    $('#directory-table').innerHTML =
      `<div class="muted" style="margin-bottom:10px">${d.total} fournisseur(s)</div>` +
      tableHtml(
        ['Fournisseur', 'Pays', 'Région', 'Note', 'Vérifié', 'Offres'],
        d.items.map((s) => {
          const row = [
            `<span class="link">${esc(s.name)}</span>`,
            esc(s.country || '—'),
            esc(s.region || '—'),
            `${s.rating}/5`,
            s.verified ? '✅' : '—',
            s._count?.offers ?? 0,
          ];
          row._attr = ` class="clickable" data-supplier="${s.id}"`;
          return row;
        }),
      );
    bindSupplierRows('#directory-table');
  } catch (e) {
    toast(e.message);
  }
}
$('#d-list').addEventListener('click', loadDirectory);

// ── Détail fournisseur (modale) ────────────────────────────
function bindSupplierRows(sel) {
  document.querySelectorAll(`${sel} [data-supplier]`).forEach((row) =>
    row.addEventListener('click', () => showSupplier(row.dataset.supplier)),
  );
}
async function showSupplier(id) {
  try {
    const s = await api('/api/suppliers/' + id);
    openModal(`
      <h2>${esc(s.name)}</h2>
      <div class="muted">${esc(s.region || '')} ${s.country ? '· ' + esc(s.country) : ''}</div>
      <div class="kv">
        <div class="k">Note</div><div>${s.rating}/5 ${s.verified ? '· ✅ vérifié' : ''}</div>
        <div class="k">Certifications</div><div>${esc(s.certifications || '—')}</div>
        <div class="k">Délai</div><div>${s.leadTimeDays != null ? s.leadTimeDays + ' j' : '—'}</div>
        <div class="k">Commande min.</div><div>${s.minOrderValue != null ? money(s.minOrderValue, s.currency) : '—'}</div>
        <div class="k">Contact</div><div>${esc(s.email || s.website || '—')}</div>
      </div>
      <h4>Offres (${s.offers.length})</h4>
      <div class="table-wrap">${tableHtml(
        ['Titre', 'Catégorie', 'Prix', 'MOQ', 'Délai', 'Stock'],
        s.offers.map((o) => [
          esc(o.title),
          esc(o.category),
          `<span class="num">${o.unitPrice != null ? money(o.unitPrice, o.currency) : '—'}</span>`,
          o.moq ?? '—',
          o.leadTimeDays != null ? o.leadTimeDays + ' j' : '—',
          o.inStock ? '✅' : '❌',
        ]),
      )}</div>`);
  } catch (e) {
    toast(e.message);
  }
}

// ── Commandes (filtre + détail) ────────────────────────────
async function loadOrders() {
  try {
    const params = new URLSearchParams({ take: '40' });
    const status = $('#o-status').value;
    if (status) params.set('status', status);
    const d = await api('/api/orders?' + params.toString());
    $('#orders-table').innerHTML = tableHtml(
      ['N°', 'Client', 'Statut', 'Total', 'Créée'],
      d.items.map((o) => {
        const row = [
          esc(o.orderNumber),
          esc(o.customer?.name || '—'),
          badge(o.status),
          `<span class="num">${money(o.total)}</span>`,
          dt(o.createdAt),
        ];
        row._attr = ` class="clickable" data-order="${o.id}"`;
        return row;
      }),
    );
    bindOrderRows('#orders-table');
  } catch (e) {
    toast(e.message);
  }
}
$('#refresh-orders').addEventListener('click', loadOrders);
$('#o-status').addEventListener('change', loadOrders);

function bindOrderRows(sel) {
  document.querySelectorAll(`${sel} [data-order]`).forEach((row) =>
    row.addEventListener('click', () => showOrder(row.dataset.order)),
  );
}

async function showOrder(id) {
  try {
    const o = await api('/api/orders/' + id);
    const items = tableHtml(
      ['Produit', 'Qté', 'PU vente', 'Sous-total'],
      o.items.map((it) => [
        esc(it.product?.name || it.productId),
        it.quantity,
        `<span class="num">${money(it.unitSalePrice)}</span>`,
        `<span class="num">${money(it.unitSalePrice * it.quantity)}</span>`,
      ]),
    );
    const pos = tableHtml(
      ['Fournisseur', 'Statut', 'Coût', 'Transporteur', 'Suivi'],
      o.purchaseOrders.map((p) => [
        esc(p.supplier?.name || '—'),
        badge(p.status),
        `<span class="num">${money(p.cost, p.currency)}</span>`,
        esc(p.carrier || '—'),
        esc(p.trackingNumber || '—'),
      ]),
    );
    const canCancel = !['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(o.status);
    openModal(`
      <h2>Commande ${esc(o.orderNumber)}</h2>
      <div class="muted">${esc(o.customer?.name || '')} · ${esc(o.customer?.city || '')} ${esc(o.customer?.country || '')}</div>
      <div class="kv">
        <div class="k">Statut</div><div>${badge(o.status)}</div>
        <div class="k">Total</div><div class="num">${money(o.total, o.currency)}</div>
        <div class="k">Créée le</div><div>${dt(o.createdAt)}</div>
      </div>
      <h4>Articles</h4><div class="table-wrap">${items}</div>
      <h4>Achats fournisseurs (expédition)</h4><div class="table-wrap">${pos}</div>
      <div class="form-actions">
        ${o.status === 'PENDING' && paymentsEnabled ? `<button class="btn btn-primary" id="m-pay">💳 Payer par carte</button>` : ''}
        ${o.status === 'PAID' || o.status === 'FULFILLING' ? `<button class="btn btn-primary" id="m-fulfill">Relancer l'expédition</button>` : ''}
        ${canCancel ? `<button class="btn btn-ghost" id="m-cancel">Annuler</button>` : ''}
      </div>`);
    $('#m-pay')?.addEventListener('click', async (ev) => {
      busy(ev.currentTarget, true, 'Redirection...');
      try {
        const { url } = await api(`/api/payments/checkout/${id}`, { method: 'POST' });
        window.location.href = url; // page de paiement sécurisée Stripe
      } catch (e) {
        toast(e.message);
        busy(ev.currentTarget, false);
      }
    });
    $('#m-fulfill')?.addEventListener('click', async (ev) => {
      busy(ev.currentTarget, true, '...');
      try {
        await api(`/api/orders/${id}/fulfill`, { method: 'POST' });
        toast('Expédition relancée');
        showOrder(id);
        loadOrders();
      } catch (e) {
        toast(e.message);
      }
    });
    $('#m-cancel')?.addEventListener('click', async (ev) => {
      busy(ev.currentTarget, true, '...');
      try {
        await api(`/api/orders/${id}/cancel`, { method: 'POST' });
        toast('Commande annulée');
        showOrder(id);
        loadOrders();
      } catch (e) {
        toast(e.message);
      }
    });
  } catch (e) {
    toast(e.message);
  }
}

// ── Nouvelle commande (modale) ─────────────────────────────
$('#new-order').addEventListener('click', openNewOrder);

async function openNewOrder() {
  let products = [];
  try {
    const d = await api('/api/products?status=ACTIVE&take=100');
    products = d.items.filter((p) => p.salePrice);
  } catch (e) {
    return toast(e.message);
  }
  if (!products.length) return toast('Aucun produit actif à vendre. Générez des produits d’abord.');

  const options = products.map((p) => `<option value="${p.id}">${esc(p.name)} — ${money(p.salePrice)}</option>`).join('');
  openModal(`
    <h2>Nouvelle commande</h2>
    <h4>Client</h4>
    <div class="form-grid">
      <div class="field"><label>Nom</label><input class="input" id="c-name" placeholder="Nom du client" /></div>
      <div class="field"><label>Email</label><input class="input" id="c-email" placeholder="email@exemple.com" /></div>
      <div class="field"><label>Ville</label><input class="input" id="c-city" /></div>
      <div class="field"><label>Pays</label><input class="input" id="c-country" /></div>
    </div>
    <h4>Articles</h4>
    <div id="order-lines">
      <div class="line-row">
        <select class="input line-product">${options}</select>
        <input class="input input-sm line-qty" type="number" min="1" value="1" />
      </div>
    </div>
    <button class="btn btn-ghost" id="add-line" type="button">＋ Ajouter un article</button>
    <div class="form-actions">
      <label class="check"><input type="checkbox" id="c-paid" checked /> Marquer payée (expédition auto)</label>
      <button class="btn btn-ghost" data-close>Annuler</button>
      <button class="btn btn-primary" id="create-order">Créer la commande</button>
    </div>`);

  $('#modal-content [data-close]').addEventListener('click', closeModal);
  $('#add-line').addEventListener('click', () => {
    $('#order-lines').appendChild(
      el(`<div class="line-row"><select class="input line-product">${options}</select><input class="input input-sm line-qty" type="number" min="1" value="1" /></div>`),
    );
  });
  $('#create-order').addEventListener('click', async (ev) => {
    const name = $('#c-name').value.trim();
    const email = $('#c-email').value.trim();
    if (!name || !email) return toast('Nom et email du client requis');
    const items = [...document.querySelectorAll('#order-lines .line-row')].map((row) => ({
      productId: row.querySelector('.line-product').value,
      quantity: Number(row.querySelector('.line-qty').value) || 1,
    }));
    busy(ev.currentTarget, true, 'Création...');
    try {
      const order = await api('/api/orders', {
        method: 'POST',
        body: {
          customer: { name, email, city: $('#c-city').value.trim() || undefined, country: $('#c-country').value.trim() || undefined },
          items,
          markPaid: $('#c-paid').checked,
        },
      });
      toast(`Commande ${order.orderNumber} créée`);
      closeModal();
      loadOrders();
    } catch (e) {
      toast(e.message);
      busy(ev.currentTarget, false);
    }
  });
}

const loaders = {
  dashboard: loadDashboard,
  market: loadMarket,
  products: loadProducts,
  suppliers: loadDirectory,
  orders: loadOrders,
};

// ── Cycle complet ──────────────────────────────────────────
$('#run-cycle').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  busy(btn, true, 'Cycle en cours...');
  $('#cycle-status').textContent = '';
  try {
    const { report } = await api('/api/autopilot/run', { method: 'POST' });
    $('#cycle-status').textContent =
      `✓ ${report.productsGenerated} produits · ${report.ordersCreated} commandes · ${report.ordersFulfilled} expédiées (${report.durationMs} ms)`;
    await loadDashboard();
  } catch (e) {
    toast(e.message);
  } finally {
    busy(btn, false);
  }
});

// ── Pilote automatique ─────────────────────────────────────
function renderAutopilot(state) {
  const pill = $('#autopilot-pill');
  const toggle = $('#autopilot-toggle');
  if (state.running) {
    pill.textContent = `● Pilote actif (cycle ${state.intervalSeconds}s)`;
    pill.className = 'pill pill-on';
    toggle.textContent = 'Arrêter le pilote';
  } else {
    pill.textContent = '○ Pilote arrêté';
    pill.className = 'pill pill-off';
    toggle.textContent = 'Démarrer le pilote';
  }
}
async function refreshAutopilot() {
  try {
    renderAutopilot(await api('/api/autopilot'));
  } catch { /* ignore */ }
}
$('#autopilot-toggle').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  busy(btn, true, '...');
  try {
    const state = await api('/api/autopilot');
    const next = state.running ? '/api/autopilot/stop' : '/api/autopilot/start';
    renderAutopilot(await api(next, { method: 'POST' }));
    toast(state.running ? 'Pilote arrêté' : 'Pilote démarré');
  } catch (e) {
    toast(e.message);
  } finally {
    busy(btn, false);
  }
});

// ── Rafraîchissement périodique ────────────────────────────
setInterval(async () => {
  if (!getToken()) return; // seulement une fois connecté
  await refreshAutopilot();
  if ($('#modal').hidden === false) return; // ne pas rafraîchir sous une modale
  const active = document.querySelector('.tab.active')?.dataset.tab;
  if (active === 'dashboard') loadDashboard();
  if (active === 'orders') loadOrders();
}, 5000);

// ── Écran de connexion ─────────────────────────────────────
let authMode = 'login';
function showAuth() {
  $('#auth-screen').hidden = false;
  $('#user-chip').hidden = true;
  $('#logout-btn').hidden = true;
}
function hideAuth() {
  $('#auth-screen').hidden = true;
}
document.querySelectorAll('.auth-tab').forEach((t) =>
  t.addEventListener('click', () => {
    authMode = t.dataset.auth;
    document.querySelectorAll('.auth-tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $('#field-name').hidden = authMode !== 'register';
    $('#a-submit').textContent = authMode === 'register' ? 'Créer le compte' : 'Se connecter';
    $('#a-password').autocomplete = authMode === 'register' ? 'new-password' : 'current-password';
    $('#auth-error').hidden = true;
  }),
);
$('#auth-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = $('#a-email').value.trim();
  const password = $('#a-password').value;
  const name = $('#a-name').value.trim();
  const errBox = $('#auth-error');
  errBox.hidden = true;
  const btn = $('#a-submit');
  busy(btn, true, '...');
  try {
    const path = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const body = authMode === 'register' ? { name, email, password } : { email, password };
    const res = await api(path, { method: 'POST', body });
    setToken(res.token);
    onAuthed(res.user);
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  } finally {
    busy(btn, false);
  }
});
$('#logout-btn').addEventListener('click', () => {
  setToken(null);
  location.reload();
});

function onAuthed(user) {
  hideAuth();
  $('#user-chip').textContent = '👤 ' + user.name + (user.role === 'admin' ? ' (admin)' : '');
  $('#user-chip').hidden = false;
  $('#logout-btn').hidden = false;
  startApp();
}

let appStarted = false;
function startApp() {
  if (appStarted) return;
  appStarted = true;
  api('/api/payments/status').then((s) => (paymentsEnabled = !!s.enabled)).catch(() => {});
  loadDashboard();
  refreshAutopilot();
}

// ── Installation PWA ───────────────────────────────────────
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('#install-btn').hidden = false;
});
$('#install-btn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#install-btn').hidden = true;
});

// ── Paiement (Stripe) ──────────────────────────────────────
let paymentsEnabled = false;

// Retour de paiement (redirection Stripe)
const params = new URLSearchParams(location.search);
if (params.get('paid')) {
  toast(`Paiement réussi — commande ${params.get('paid')}`);
  history.replaceState({}, '', '/');
} else if (params.get('canceled')) {
  toast('Paiement annulé');
  history.replaceState({}, '', '/');
}

// ── Service worker ─────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ── Démarrage : vérifie la session, sinon affiche la connexion ─
(async function init() {
  if (!getToken()) return showAuth();
  try {
    const user = await api('/api/auth/me');
    onAuthed(user);
  } catch {
    showAuth();
  }
})();

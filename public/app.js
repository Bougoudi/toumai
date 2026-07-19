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

async function api(path, { method = 'GET', body, stepUp } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (stepUp) headers['x-step-up'] = stepUp;
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

// ── Canaux de vente (Etsy / eBay / Amazon) ─────────────────
const CHANNEL_LABEL = { etsy: 'Etsy', ebay: 'eBay', amazon: 'Amazon' };
async function loadChannels() {
  try {
    const list = await api('/api/channels');
    const rows = list.map((c) => {
      const actions =
        `<button class="btn btn-ghost btn-xs" data-sync="${c.id}">Synchroniser</button> ` +
        `<button class="btn btn-ghost btn-xs" data-del="${c.id}">Déconnecter</button>`;
      return [
        `<b>${CHANNEL_LABEL[c.type] || c.type}</b>`,
        esc(c.name),
        badge(c.status),
        c.error ? `<span class="muted">${esc(c.error)}</span>` : (c.lastSyncAt ? 'synchro ' + dt(c.lastSyncAt) : '—'),
        actions,
      ];
    });
    $('#channels-table').innerHTML = tableHtml(['Canal', 'Nom', 'Statut', 'Détail', 'Actions'], rows);
    document.querySelectorAll('#channels-table [data-sync]').forEach((b) =>
      b.addEventListener('click', () => syncChannel(b.dataset.sync)),
    );
    document.querySelectorAll('#channels-table [data-del]').forEach((b) =>
      b.addEventListener('click', () => deleteChannel(b.dataset.del)),
    );
  } catch (e) {
    toast(e.message);
  }
}
async function syncChannel(id) {
  try {
    const r = await api(`/api/channels/${id}/sync`, { method: 'POST' });
    toast(`${r.imported} commande(s) importée(s)`);
    loadChannels();
    loadOrders();
  } catch (e) {
    toast(e.message);
  }
}
async function deleteChannel(id) {
  try {
    await api(`/api/channels/${id}`, { method: 'DELETE' });
    toast('Canal déconnecté');
    loadChannels();
  } catch (e) {
    toast(e.message);
  }
}
$('#sync-all-channels').addEventListener('click', async (ev) => {
  busy(ev.currentTarget, true, 'Synchro...');
  try {
    const list = await api('/api/channels');
    let total = 0;
    for (const c of list.filter((x) => x.status === 'CONNECTED')) {
      const r = await api(`/api/channels/${c.id}/sync`, { method: 'POST' }).catch(() => ({ imported: 0 }));
      total += r.imported || 0;
    }
    toast(total + ' commande(s) importée(s)');
    loadChannels();
    loadOrders();
  } catch (e) {
    toast(e.message);
  } finally {
    busy(ev.currentTarget, false);
  }
});
$('#connect-channel').addEventListener('click', async () => {
  let types;
  try {
    types = await api('/api/channels/types');
  } catch (e) {
    return toast(e.message);
  }
  const typeOpts = types.map((t) => `<option value="${t.type}">${t.label}</option>`).join('');
  openModal(
    '<h2>Connecter un canal de vente</h2>' +
      '<div class="field" style="margin-top:12px"><label>Plateforme</label><select class="input" id="ch-type">' + typeOpts + '</select></div>' +
      '<div class="field"><label>Nom (pour vous repérer)</label><input class="input" id="ch-name" placeholder="Ma boutique Etsy"/></div>' +
      '<h4>Identifiants</h4><div id="ch-fields"></div>' +
      '<p class="muted" id="ch-help" style="margin-top:10px"></p>' +
      '<div class="form-actions"><button class="btn btn-ghost" data-close>Annuler</button>' +
      '<button class="btn btn-primary" id="ch-save">Connecter</button></div>',
  );
  $('#modal-content [data-close]').addEventListener('click', closeModal);
  const renderFields = () => {
    const t = types.find((x) => x.type === $('#ch-type').value);
    $('#ch-fields').innerHTML = t.configFields
      .map(
        (f) =>
          `<div class="field"><label>${esc(f.label)}${f.help ? ' <span class="muted">— ' + esc(f.help) + '</span>' : ''}</label>` +
          `<input class="input ch-cfg" data-key="${f.key}" type="${f.secret ? 'password' : 'text'}" placeholder="${f.secret ? '••••••' : ''}"/></div>`,
      )
      .join('');
  };
  renderFields();
  $('#ch-type').addEventListener('change', renderFields);
  $('#ch-save').addEventListener('click', async (ev) => {
    const type = $('#ch-type').value;
    const name = $('#ch-name').value.trim() || (CHANNEL_LABEL[type] || type);
    const config = {};
    document.querySelectorAll('#ch-fields .ch-cfg').forEach((i) => {
      if (i.value.trim()) config[i.dataset.key] = i.value.trim();
    });
    busy(ev.currentTarget, true, 'Connexion...');
    try {
      const c = await api('/api/channels', { method: 'POST', body: { type, name, config } });
      toast(c.status === 'CONNECTED' ? 'Canal connecté ✓' : 'Enregistré — ' + (c.error || 'à compléter'));
      closeModal();
      loadChannels();
    } catch (e) {
      toast(e.message);
      busy(ev.currentTarget, false);
    }
  });
});

// ── Recherche + favoris + titres ───────────────────────────
async function doSearch() {
  const mode = $('#d-mode').value;
  const val = $('#d-input').value.trim();
  try {
    let res;
    if (mode === 'text') res = await api('/api/discovery/search/text?q=' + encodeURIComponent(val));
    else if (mode === 'photo') res = await api('/api/discovery/search/photo', { method: 'POST', body: { hint: val } });
    else res = await api('/api/discovery/search/barcode/' + encodeURIComponent(val));
    const rows = res.results.map((r, i) => {
      const row = [esc(r.title), esc(r.category), `<span class="num">${money(r.estimatedPrice)}</span>`,
        `<button class="btn btn-ghost btn-xs" data-fav="${i}">☆ Favori</button>`];
      return row;
    });
    $('#discovery-results').innerHTML = tableHtml(['Produit', 'Catégorie', 'Prix estimé', ''], rows);
    document.querySelectorAll('#discovery-results [data-fav]').forEach((b) =>
      b.addEventListener('click', async () => {
        const r = res.results[Number(b.dataset.fav)];
        await api('/api/favorites', { method: 'POST', body: { source: r.source, title: r.title, category: r.category, keywords: r.keywords, price: r.estimatedPrice, imageUrl: r.imageUrl } });
        toast('Ajouté aux favoris');
        loadFavorites();
      }),
    );
  } catch (e) {
    toast(e.message);
  }
}
$('#d-go').addEventListener('click', doSearch);
$('#d-input').addEventListener('keydown', (e) => e.key === 'Enter' && doSearch());
$('#t-go').addEventListener('click', async () => {
  const name = $('#t-name').value.trim();
  if (!name) return toast('Entrez un nom de produit');
  try {
    const r = await api('/api/tools/titles', { method: 'POST', body: { name, keywords: $('#t-kw').value.trim() } });
    $('#titles-out').innerHTML = r.titles.map((t) => `<div class="line-copy">${esc(t)}</div>`).join('');
  } catch (e) {
    toast(e.message);
  }
});
async function loadFavorites() {
  try {
    const list = await api('/api/favorites');
    const rows = list.map((f) => [
      esc(f.title), esc(f.category), `<span class="num">${f.price ? money(f.price) : '—'}</span>`,
      f.productId ? '<span class="badge ok">SOURCÉ</span>' : '<span class="badge wait">À SOURCER</span>',
      `<button class="btn btn-ghost btn-xs" data-src="${f.id}">Sourcer</button> <button class="btn btn-ghost btn-xs" data-pub="${f.id}">Publier</button> <button class="btn btn-ghost btn-xs" data-delf="${f.id}">✕</button>`,
    ]);
    $('#favorites-table').innerHTML = tableHtml(['Produit', 'Catégorie', 'Prix', 'Statut', 'Actions'], rows);
    document.querySelectorAll('#favorites-table [data-src]').forEach((b) => b.addEventListener('click', () => sourceFav(b.dataset.src)));
    document.querySelectorAll('#favorites-table [data-pub]').forEach((b) => b.addEventListener('click', () => publishFav(b.dataset.pub)));
    document.querySelectorAll('#favorites-table [data-delf]').forEach((b) => b.addEventListener('click', async () => { await api('/api/favorites/' + b.dataset.delf, { method: 'DELETE' }); loadFavorites(); }));
  } catch (e) {
    toast(e.message);
  }
}
function loadDiscovery() { loadFavorites(); }
async function sourceFav(id) {
  try {
    const r = await api('/api/favorites/' + id + '/source', { method: 'POST' });
    toast(`Produit créé : ${r.product.name}` + (r.bestSupplier ? ` · fournisseur : ${r.bestSupplier.name}` : ''));
    loadFavorites();
  } catch (e) { toast(e.message); }
}
async function publishFav(id) {
  try {
    const channels = await api('/api/channels');
    const connected = channels.filter((c) => c.status === 'CONNECTED');
    if (!connected.length) return toast('Connectez d’abord un canal (onglet Canaux de vente).');
    const c = connected[0];
    await api(`/api/favorites/${id}/publish/${c.id}`, { method: 'POST' });
    toast('Produit sourcé et publié sur ' + c.name);
    loadFavorites();
  } catch (e) { toast(e.message); }
}

// ── Compétiteurs ───────────────────────────────────────────
async function loadCompetitors() {
  try {
    const list = await api('/api/competitors');
    const rows = list.map((c) => [
      `<b>${esc(c.shopName)}</b>`, esc(c.platform),
      `<label class="check"><input type="checkbox" ${c.followed ? 'checked' : ''} data-follow="${c.id}"/> suivi</label>`,
      c.lastScanAt ? dt(c.lastScanAt) : '—', `${c._count?.products ?? 0} produits`,
      `<button class="btn btn-ghost btn-xs" data-scan="${c.id}">Scanner</button> <button class="btn btn-ghost btn-xs" data-delc="${c.id}">✕</button>`,
    ]);
    $('#competitors-table').innerHTML = tableHtml(['Boutique', 'Plateforme', 'Suivi', 'Dernier scan', 'Produits', 'Actions'], rows);
    document.querySelectorAll('#competitors-table [data-scan]').forEach((b) => b.addEventListener('click', async () => { b.textContent = '…'; try { const r = await api(`/api/competitors/${b.dataset.scan}/scan`, { method: 'POST' }); toast(r.found + ' produits gagnants'); loadCompetitors(); } catch (e) { toast(e.message); } }));
    document.querySelectorAll('#competitors-table [data-delc]').forEach((b) => b.addEventListener('click', async () => { await api('/api/competitors/' + b.dataset.delc, { method: 'DELETE' }); loadCompetitors(); }));
    document.querySelectorAll('#competitors-table [data-follow]').forEach((b) => b.addEventListener('change', async () => { await api(`/api/competitors/${b.dataset.follow}/follow`, { method: 'PATCH', body: { followed: b.checked } }); toast(b.checked ? 'Boutique suivie' : 'Suivi arrêté'); }));
    const winning = await api('/api/competitors/winning?take=30');
    const wrows = winning.map((w) => [
      esc(w.title), esc(w.category), `<b class="num">${w.soldCount}</b>`, `<span class="num">${money(w.price)}</span>`,
      esc(w.competitor?.shopName || ''), w.favorited ? '★' : `<button class="btn btn-ghost btn-xs" data-wfav="${w.id}">☆ Favori</button>`,
    ]);
    $('#winning-table').innerHTML = tableHtml(['Produit', 'Catégorie', 'Ventes', 'Prix', 'Boutique', ''], wrows);
    document.querySelectorAll('#winning-table [data-wfav]').forEach((b) => b.addEventListener('click', async () => { await api(`/api/competitors/products/${b.dataset.wfav}/favorite`, { method: 'POST' }); toast('Ajouté aux favoris'); loadCompetitors(); }));
  } catch (e) { toast(e.message); }
}
$('#add-competitor').addEventListener('click', () => {
  openModal('<h2>Ajouter une boutique concurrente</h2>' +
    '<div class="form-grid"><div class="field"><label>Plateforme</label><select class="input" id="nc-plat"><option value="ebay">eBay</option><option value="etsy">Etsy</option><option value="amazon">Amazon</option></select></div>' +
    '<div class="field"><label>Nom de la boutique</label><input class="input" id="nc-name" placeholder="ex: TopDealsFR"/></div>' +
    '<div class="field full"><label>URL (optionnel)</label><input class="input" id="nc-url" placeholder="https://…"/></div></div>' +
    '<div class="form-actions"><label class="check"><input type="checkbox" id="nc-follow" checked/> Suivre pour les nouveautés</label>' +
    '<button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-primary" id="nc-save">Ajouter</button></div>');
  $('#modal-content [data-close]').addEventListener('click', closeModal);
  $('#nc-save').addEventListener('click', async () => {
    const shopName = $('#nc-name').value.trim();
    if (!shopName) return toast('Nom de boutique requis');
    const body = { platform: $('#nc-plat').value, shopName, followed: $('#nc-follow').checked };
    const url = $('#nc-url').value.trim(); if (url) body.shopUrl = url;
    try { const c = await api('/api/competitors', { method: 'POST', body }); await api(`/api/competitors/${c.id}/scan`, { method: 'POST' }).catch(() => {}); toast('Boutique ajoutée et scannée'); closeModal(); loadCompetitors(); }
    catch (e) { toast(e.message); }
  });
});

// ── Publicités ─────────────────────────────────────────────
async function loadAds() {
  try {
    const prods = await api('/api/products?status=ACTIVE&take=100');
    $('#ad-product').innerHTML = prods.items.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    const ads = await api('/api/ads');
    const rows = ads.map((a) => [
      esc(a.product?.name || ''), esc(a.platform), esc(a.headline), badge(a.status),
      `<span class="num">${money(a.budget)}</span>`,
      `<button class="btn btn-ghost btn-xs" data-adstat="${a.id}" data-next="${a.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'}">${a.status === 'ACTIVE' ? 'Pause' : 'Activer'}</button> <button class="btn btn-ghost btn-xs" data-adel="${a.id}">✕</button>`,
    ]);
    $('#ads-table').innerHTML = tableHtml(['Produit', 'Plateforme', 'Accroche', 'Statut', 'Budget/j', 'Actions'], rows);
    document.querySelectorAll('#ads-table [data-adstat]').forEach((b) => b.addEventListener('click', async () => { await api(`/api/ads/${b.dataset.adstat}/status`, { method: 'PATCH', body: { status: b.dataset.next } }); loadAds(); }));
    document.querySelectorAll('#ads-table [data-adel]').forEach((b) => b.addEventListener('click', async () => { await api('/api/ads/' + b.dataset.adel, { method: 'DELETE' }); loadAds(); }));
  } catch (e) { toast(e.message); }
}
$('#ad-generate').addEventListener('click', async (ev) => {
  const productId = $('#ad-product').value;
  if (!productId) return toast('Aucun produit');
  busy(ev.currentTarget, true, '...');
  try { await api('/api/ads/generate', { method: 'POST', body: { productId, platform: $('#ad-platform').value } }); toast('Publicité générée'); loadAds(); }
  catch (e) { toast(e.message); } finally { busy(ev.currentTarget, false); }
});

// ── Tableur (P&L) ──────────────────────────────────────────
async function loadReports() {
  try {
    const r = await api('/api/reports/pnl');
    const t = r.totals;
    $('#pnl-kpis').innerHTML =
      kpiCard('accent', 'Commandes', t.orders, '') +
      kpiCard('', 'Revenus', money(t.revenue), '') +
      kpiCard('', 'Coûts', money(t.cost), '') +
      kpiCard('green', 'Bénéfice', money(t.profit), 'marge ' + t.margin + '%');
    const rows = r.rows.map((x) => [x.date, x.orders, `<span class="num">${money(x.revenue)}</span>`, `<span class="num">${money(x.cost)}</span>`, `<span class="num" style="color:${x.profit >= 0 ? 'var(--green)' : 'var(--red)'}">${money(x.profit)}</span>`]);
    $('#pnl-table').innerHTML = tableHtml(['Date', 'Commandes', 'Revenus', 'Coûts', 'Bénéfice'], rows);
  } catch (e) { toast(e.message); }
}
const kpiCard = (cls, l, v, s) => `<div class="kpi ${cls}"><div class="label">${l}</div><div class="value num">${v}</div><div class="sub">${s}</div></div>`;
$('#export-csv').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/reports/pnl.csv', { headers: { Authorization: 'Bearer ' + getToken() } });
    const blob = await res.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'toumai-pnl.csv'; a.click();
    toast('CSV exporté');
  } catch (e) { toast(e.message); }
});

// ── Paramètres ─────────────────────────────────────────────
const SETTING_FIELDS = [
  { key: 'defaultMarkup', label: 'Marge (multiplicateur prix de vente)', type: 'number', step: '0.1' },
  { key: 'minOpportunityScore', label: 'Score minimum pour générer', type: 'number' },
  { key: 'productsPerRun', label: 'Produits générés par cycle', type: 'number' },
  { key: 'currency', label: 'Devise', type: 'text' },
  { key: 'autopilotIntervalSeconds', label: 'Cadence du pilote (secondes)', type: 'number' },
  { key: 'ordersPerCycle', label: 'Commandes simulées par cycle', type: 'number' },
];
async function loadSettingsTab() {
  try {
    const s = await api('/api/settings');
    $('#settings-form').innerHTML = SETTING_FIELDS.map((f) =>
      `<div class="field"><label>${f.label}</label><input class="input set-f" data-key="${f.key}" type="${f.type}" ${f.step ? 'step=' + f.step : ''} value="${esc(s[f.key])}"/></div>`,
    ).join('') +
      `<div class="field"><label>Demande simulée (démo)</label><select class="input set-f" data-key="simulateDemand"><option value="true" ${s.simulateDemand ? 'selected' : ''}>Activée</option><option value="false" ${!s.simulateDemand ? 'selected' : ''}>Désactivée</option></select></div>`;
  } catch (e) { toast(e.message); }
  loadSecurityPanel();
}
$('#settings-save').addEventListener('click', async (ev) => {
  const patch = {};
  document.querySelectorAll('#settings-form .set-f').forEach((i) => {
    const k = i.dataset.key;
    if (k === 'currency') patch[k] = i.value.trim();
    else if (k === 'simulateDemand') patch[k] = i.value === 'true';
    else patch[k] = Number(i.value);
  });
  busy(ev.currentTarget, true, '...');
  try { await api('/api/settings', { method: 'PATCH', body: patch }); toast('Réglages enregistrés'); }
  catch (e) { toast(e.message); } finally { busy(ev.currentTarget, false); }
});
$('#settings-reset').addEventListener('click', async () => {
  try { await api('/api/settings/reset', { method: 'POST' }); toast('Réglages réinitialisés'); loadSettingsTab(); }
  catch (e) { toast(e.message); }
});

// ── WebAuthn : client natif (sans dépendance, compatible CSP) ──
function b64urlToBuf(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function bufToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function serializeCred(cred, kind) {
  const r = cred.response;
  const out = { id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {}, response: {} };
  out.response.clientDataJSON = bufToB64url(r.clientDataJSON);
  if (kind === 'attestation') {
    out.response.attestationObject = bufToB64url(r.attestationObject);
    if (r.getTransports) out.response.transports = r.getTransports();
  } else {
    out.response.authenticatorData = bufToB64url(r.authenticatorData);
    out.response.signature = bufToB64url(r.signature);
    if (r.userHandle) out.response.userHandle = bufToB64url(r.userHandle);
  }
  return out;
}
async function webauthnCreate(options) {
  const publicKey = { ...options, challenge: b64urlToBuf(options.challenge),
    user: { ...options.user, id: b64urlToBuf(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((c) => ({ ...c, id: b64urlToBuf(c.id) })) };
  const cred = await navigator.credentials.create({ publicKey });
  return serializeCred(cred, 'attestation');
}
async function webauthnGet(options) {
  const publicKey = { ...options, challenge: b64urlToBuf(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((c) => ({ ...c, id: b64urlToBuf(c.id) })) };
  const cred = await navigator.credentials.get({ publicKey });
  return serializeCred(cred, 'assertion');
}

// ── Panneau Sécurité (2FA) ─────────────────────────────────
async function loadSecurityPanel() {
  const el = $('#security-panel');
  if (!el) return;
  try {
    const s = await api('/api/auth/mfa/status');
    let h = '';
    h += secRow('Application d’authentification (TOTP)', s.totpEnabled ? 'Activée ✓' : 'Désactivée',
      s.totpEnabled ? '<button class="btn btn-ghost btn-xs" id="totp-disable">Désactiver</button>'
                    : '<button class="btn btn-primary btn-xs" id="totp-setup">Activer</button>');
    h += secRow('Codes de récupération', s.recoveryCodesRemaining + ' restant(s)',
      s.totpEnabled ? '<button class="btn btn-ghost btn-xs" id="recov-regen">Régénérer</button>' : '');
    h += secRow('Clés de sécurité (WebAuthn)', s.securityKeys.length + ' enregistrée(s)',
      '<button class="btn btn-primary btn-xs" id="key-add">＋ Ajouter</button>');
    h += s.securityKeys.map((k) => secRow('🔑 ' + esc(k.name), '', `<button class="btn btn-ghost btn-xs" data-keydel="${k.id}">✕</button>`, true)).join('');
    h += secRow('Sessions', 'Déconnecter tous les appareils', '<button class="btn btn-ghost btn-xs" id="logout-all">Se déconnecter de partout</button>');
    h += secRow('Supprimer le compte', 'Action irréversible', '<button class="btn btn-ghost btn-xs" id="del-account" style="color:var(--red)">Supprimer</button>');
    h += '<h4 style="margin-top:18px">Journal de connexions</h4><div id="login-history" class="table-wrap"></div>';
    el.innerHTML = h;
    $('#totp-setup')?.addEventListener('click', totpSetupFlow);
    $('#totp-disable')?.addEventListener('click', () => sensitiveAction('Désactiver la double authentification ?', (su) => api('/api/auth/mfa/totp/disable', { method: 'POST', stepUp: su }), 'TOTP désactivé'));
    $('#recov-regen')?.addEventListener('click', () => sensitiveAction('Régénérer les codes ? Les anciens seront invalidés.', async (su) => { const r = await api('/api/auth/mfa/recovery/regenerate', { method: 'POST', stepUp: su }); showRecoveryCodes(r.recoveryCodes); }, ''));
    $('#key-add')?.addEventListener('click', addSecurityKey);
    document.querySelectorAll('#security-panel [data-keydel]').forEach((b) => b.addEventListener('click', () => sensitiveAction('Retirer cette clé de sécurité ?', (su) => api('/api/auth/mfa/webauthn/' + b.dataset.keydel, { method: 'DELETE', stepUp: su }), 'Clé retirée')));
    $('#logout-all')?.addEventListener('click', async () => {
      if (!confirm('Déconnecter tous les appareils (y compris ceux des autres navigateurs) ?')) return;
      const r = await api('/api/auth/security/logout-all', { method: 'POST' });
      setToken(r.token); // conserve l'appareil courant
      toast('Déconnecté de tous les autres appareils');
      loadSecurityPanel();
    });
    $('#del-account')?.addEventListener('click', () => sensitiveAction('Supprimer définitivement votre compte ? Cette action est irréversible.', (su) => api('/api/auth/security/delete-account', { method: 'POST', stepUp: su }), '', () => { setToken(null); location.reload(); }));
    loadLoginHistory();
  } catch (e) {
    el.innerHTML = '<div class="muted">' + esc(e.message) + '</div>';
  }
}

// Journal de connexions
async function loadLoginHistory() {
  try {
    const events = await api('/api/auth/security/history');
    const rows = events.map((e) => [
      new Date(e.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }),
      { password: 'Mot de passe', totp: 'App (TOTP)', recovery: 'Code de récup.', webauthn: 'Clé de sécurité' }[e.method] || e.method,
      esc((e.userAgent || '').split(')')[0].split('(')[1] || e.userAgent || '—').slice(0, 40),
      e.newDevice ? '<span class="badge wait">Nouvel appareil</span>' : '<span class="badge ok">Connu</span>',
    ]);
    $('#login-history').innerHTML = tableHtml(['Date', 'Méthode', 'Appareil', ''], rows);
  } catch (e) { /* ignore */ }
}

/**
 * Exécute une action sensible : demande une ré-authentification (step-up),
 * puis appelle l'action avec le jeton step-up. onDone optionnel après succès.
 */
async function sensitiveAction(confirmMsg, action, successMsg, onDone) {
  if (!confirm(confirmMsg)) return;
  try {
    const su = await promptStepUp();
    if (!su) return;
    await action(su);
    if (successMsg) toast(successMsg);
    if (onDone) onDone(); else loadSecurityPanel();
  } catch (e) { toast(e.message); }
}

// Demande une ré-authentification et renvoie un jeton step-up (ou null si annulé).
function promptStepUp() {
  return new Promise(async (resolve) => {
    let hasTotp = false;
    try { hasTotp = (await api('/api/auth/mfa/status')).totpEnabled; } catch {}
    openModal(
      '<h2>Confirmer votre identité</h2>' +
      `<p class="muted">Pour cette action sensible, ${hasTotp ? 'entrez un code de votre application d’authentification' : 'entrez votre mot de passe'}.</p>` +
      `<div class="field"><input class="input" id="su-value" type="${hasTotp ? 'text' : 'password'}" placeholder="${hasTotp ? 'Code à 6 chiffres' : 'Mot de passe'}"/></div>` +
      '<div id="su-error" class="auth-error" hidden></div>' +
      '<div class="form-actions"><button class="btn btn-ghost" id="su-cancel">Annuler</button><button class="btn btn-primary" id="su-ok">Confirmer</button></div>');
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; closeModal(); resolve(v); } };
    $('#su-cancel').addEventListener('click', () => done(null));
    $('#su-ok').addEventListener('click', async (ev) => {
      busy(ev.currentTarget, true, '...');
      try {
        const r = await api('/api/auth/security/step-up', { method: 'POST', body: { method: hasTotp ? 'totp' : 'password', value: $('#su-value').value.trim() } });
        done(r.stepUpToken);
      } catch (e) {
        $('#su-error').textContent = e.message; $('#su-error').hidden = false; busy(ev.currentTarget, false);
      }
    });
  });
}
const secRow = (title, sub, action, indent) =>
  `<div class="sec-row"${indent ? ' style="padding-left:14px"' : ''}><div><b>${title}</b>${sub ? `<div class="muted">${sub}</div>` : ''}</div><div>${action}</div></div>`;

async function totpSetupFlow() {
  try {
    const s = await api('/api/auth/mfa/totp/setup', { method: 'POST' });
    openModal(
      '<h2>Activer l’application d’authentification</h2>' +
      '<p class="muted">Scannez ce QR code avec Google Authenticator, Authy, 1Password…</p>' +
      `<div style="text-align:center"><img src="${s.qrDataUrl}" alt="QR" width="200" height="200" style="border-radius:10px"/></div>` +
      `<p class="muted">Ou saisissez la clé : <code>${esc(s.secret)}</code></p>` +
      '<div class="field"><label>Entrez le code affiché dans l’app</label><input class="input" id="totp-code" inputmode="numeric" placeholder="123456"/></div>' +
      '<div class="form-actions"><button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-primary" id="totp-confirm">Activer</button></div>');
    $('#modal-content [data-close]').addEventListener('click', closeModal);
    $('#totp-confirm').addEventListener('click', async (ev) => {
      busy(ev.currentTarget, true, '...');
      try {
        const r = await api('/api/auth/mfa/totp/enable', { method: 'POST', body: { code: $('#totp-code').value.trim() } });
        closeModal();
        showRecoveryCodes(r.recoveryCodes);
        loadSecurityPanel();
      } catch (e) { toast(e.message); busy(ev.currentTarget, false); }
    });
  } catch (e) { toast(e.message); }
}
function showRecoveryCodes(codes) {
  openModal(
    '<h2>Vos codes de récupération</h2>' +
    '<p class="muted">Conservez-les en lieu sûr. Chaque code ne fonctionne qu’une fois et sert si vous perdez votre téléphone. Ils ne seront plus jamais affichés.</p>' +
    '<div class="table-wrap">' + codes.map((c) => `<div class="line-copy num">${esc(c)}</div>`).join('') + '</div>' +
    '<div class="form-actions"><button class="btn btn-primary" data-close>J’ai noté mes codes</button></div>');
  $('#modal-content [data-close]').addEventListener('click', closeModal);
}
async function addSecurityKey() {
  if (!window.PublicKeyCredential) return toast('Votre navigateur ne supporte pas les clés de sécurité.');
  const name = prompt('Nom de la clé (ex: YubiKey, Téléphone) :', 'Clé de sécurité');
  if (name === null) return;
  try {
    const options = await api('/api/auth/mfa/webauthn/register/options', { method: 'POST' });
    const attestation = await webauthnCreate(options);
    await api('/api/auth/mfa/webauthn/register/verify', { method: 'POST', body: { response: attestation, name } });
    toast('Clé de sécurité ajoutée ✓');
    loadSecurityPanel();
  } catch (e) {
    toast(e.message || 'Enregistrement de la clé annulé');
  }
}

const loaders = {
  dashboard: loadDashboard,
  market: loadMarket,
  products: loadProducts,
  suppliers: loadDirectory,
  orders: loadOrders,
  channels: loadChannels,
  discovery: loadDiscovery,
  competitors: loadCompetitors,
  ads: loadAds,
  reports: loadReports,
  settings: loadSettingsTab,
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
    if (res.mfaRequired) {
      enterMfaStep(res.mfaToken, res.methods);
    } else {
      setToken(res.token);
      onAuthed(res.user);
    }
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  } finally {
    busy(btn, false);
  }
});

// ── Connexion : étape 2 (second facteur) ───────────────────
let mfaToken = null;
let mfaRecoveryMode = false;
function enterMfaStep(token, methods) {
  mfaToken = token;
  mfaRecoveryMode = false;
  $('#auth-form').hidden = true;
  $('#auth-hint').hidden = true;
  $('#mfa-step').hidden = false;
  $('#mfa-error').hidden = true;
  $('#mfa-code').value = '';
  $('#mfa-webauthn').hidden = !methods.includes('webauthn');
  $('#mfa-recovery-toggle').style.display = methods.includes('recovery') ? '' : 'none';
  setTimeout(() => $('#mfa-code').focus(), 50);
}
function exitMfaStep() {
  mfaToken = null;
  $('#mfa-step').hidden = true;
  $('#auth-form').hidden = false;
  $('#auth-hint').hidden = false;
}
async function mfaVerifyCode() {
  const code = $('#mfa-code').value.trim();
  const err = $('#mfa-error');
  err.hidden = true;
  const btn = $('#mfa-verify');
  busy(btn, true, '...');
  try {
    const res = await api('/api/auth/mfa/verify', {
      method: 'POST',
      body: { mfaToken, method: mfaRecoveryMode ? 'recovery' : 'totp', code },
    });
    setToken(res.token);
    onAuthed(res.user);
    exitMfaStep();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    busy(btn, false);
  }
}
$('#mfa-verify').addEventListener('click', mfaVerifyCode);
$('#mfa-code').addEventListener('keydown', (e) => e.key === 'Enter' && mfaVerifyCode());
$('#mfa-recovery-toggle').addEventListener('click', (e) => {
  e.preventDefault();
  mfaRecoveryMode = !mfaRecoveryMode;
  $('#mfa-prompt').textContent = mfaRecoveryMode
    ? 'Entrez un de vos codes de récupération.'
    : 'Entrez le code de votre application d’authentification.';
  $('#mfa-code').placeholder = mfaRecoveryMode ? 'xxxxxx-xxxxxx' : 'Code à 6 chiffres';
  $('#mfa-recovery-toggle').textContent = mfaRecoveryMode ? 'Utiliser l’application d’authentification' : 'Utiliser un code de récupération';
});
$('#mfa-cancel').addEventListener('click', (e) => { e.preventDefault(); exitMfaStep(); });
$('#mfa-webauthn').addEventListener('click', async (ev) => {
  busy(ev.currentTarget, true, '...');
  try {
    const options = await api('/api/auth/mfa/webauthn/auth/options', { method: 'POST', body: { mfaToken } });
    const assertion = await webauthnGet(options);
    const res = await api('/api/auth/mfa/webauthn/auth/verify', { method: 'POST', body: { mfaToken, response: assertion } });
    setToken(res.token);
    onAuthed(res.user);
    exitMfaStep();
  } catch (e) {
    $('#mfa-error').textContent = e.message || 'Échec de la clé';
    $('#mfa-error').hidden = false;
  } finally {
    busy(ev.currentTarget, false);
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

/** Politique 2FA : obligatoire pour les admins, recommandée aux autres. */
async function enforceMfaPolicy() {
  let me;
  try { me = await api('/api/auth/me'); } catch { return; }
  if (!me.mfa || me.mfa.enabled) return;
  if (me.mfa.enforced) {
    // Admin sans 2FA : modale bloquante.
    openModal(
      '<h2>Sécurisez votre compte administrateur</h2>' +
      '<p class="muted">En tant qu’administrateur, la double authentification est <b>obligatoire</b>. Activez-la maintenant pour continuer.</p>' +
      '<div class="form-actions"><button class="btn btn-primary" id="enforce-go">Activer maintenant</button></div>');
    // Pas de fermeture possible (on retire le backdrop-close).
    $('#modal .modal-backdrop')?.removeAttribute('data-close');
    $('#modal .modal-close')?.setAttribute('hidden', 'true');
    $('#enforce-go').addEventListener('click', () => {
      document.querySelector('[data-tab=settings]').click();
      setTimeout(() => { closeModal(); totpSetupFlow(); }, 200);
    });
  } else if (me.mfa.recommended) {
    toast('🔒 Conseil : activez la double authentification (Paramètres → Sécurité).');
  }
}

let appStarted = false;
function startApp() {
  if (appStarted) return;
  appStarted = true;
  enforceMfaPolicy();
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

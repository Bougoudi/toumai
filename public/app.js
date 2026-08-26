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

let APP_CURRENCY = 'EUR'; // devise de l'app, chargée depuis les réglages à la connexion
const money = (n, c = APP_CURRENCY) =>
  (n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + c;
const dt = (s) => new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

function badge(status) {
  const s = String(status).toUpperCase();
  const ok = ['SHIPPED', 'DELIVERED', 'COMPLETED', 'ACTIVE', 'PAID', 'IMPORTED'];
  const wait = ['FULFILLING', 'RUNNING', 'PENDING', 'EVALUATED', 'NEW', 'DRAFT', 'CREATED', 'PLACED'];
  const cls = ok.includes(s) ? 'ok' : wait.includes(s) ? 'wait' : 'bad';
  // Libellé traduit si disponible, sinon le code brut.
  const lbl = i18n.t('st_' + s);
  return `<span class="badge ${cls}">${lbl === 'st_' + s ? s : lbl}</span>`;
}

function tableHtml(headers, rows) {
  if (!rows.length) return `<div class="empty">${i18n.t('no_data')}</div>`;
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
  if (typeof stopCamera === 'function') stopCamera(); // coupe le flux caméra si ouvert
  $('#modal').hidden = true;
  $('#modal-content').innerHTML = '';
}
document.querySelectorAll('[data-close]').forEach((n) => n.addEventListener('click', closeModal));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// ── Onglets ────────────────────────────────────────────────
// Groupe repliable « Sourcing » : le bouton d'en-tête ouvre/ferme le sous-menu.
const sourcingGroup = $('#group-sourcing');
$('.group-toggle')?.addEventListener('click', () => {
  const open = sourcingGroup.classList.toggle('open');
  $('#sub-sourcing').hidden = !open;
  $('.group-toggle').setAttribute('aria-expanded', String(open));
});

document.querySelectorAll('.tab[data-tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $('#tab-' + tab.dataset.tab).classList.add('active');
    loaders[tab.dataset.tab]?.();
    // Si l'onglet appartient au groupe « Sourcing », on l'ouvre et on le marque actif.
    const inGroup = sourcingGroup && sourcingGroup.contains(tab);
    if (sourcingGroup) sourcingGroup.classList.toggle('has-active', !!inGroup);
    if (inGroup && !sourcingGroup.classList.contains('open')) {
      sourcingGroup.classList.add('open');
      $('#sub-sourcing').hidden = false;
      $('.group-toggle').setAttribute('aria-expanded', 'true');
    }
  });
});

// ── Tableau de bord ────────────────────────────────────────
async function loadDashboard() {
  try {
    const d = await api('/api/dashboard');
    const orderCount = Object.values(d.orders.byStatus).reduce((a, b) => a + b, 0);
    $('#kpis').replaceChildren(
      el(`<div class="kpi accent"><div class="label">${i18n.t('kpi_opportunities')}</div><div class="value num">${d.market.opportunities}</div><div class="sub">${i18n.t('kpi_score_avg')} ${d.market.avgOpportunityScore}/100</div></div>`),
      el(`<div class="kpi"><div class="label">${i18n.t('kpi_active_products')}</div><div class="value num">${d.catalog.active}</div><div class="sub">${d.catalog.generatedToday} ${i18n.t('kpi_generated_today')}</div></div>`),
      el(`<div class="kpi"><div class="label">${i18n.t('kpi_orders')}</div><div class="value num">${orderCount}</div><div class="sub">${d.suppliers.total} ${i18n.t('kpi_suppliers')}</div></div>`),
      el(`<div class="kpi green"><div class="label">${i18n.t('kpi_estimated_profit')}</div><div class="value num">${money(d.finance.estimatedProfit)}</div><div class="sub">${i18n.t('kpi_revenue_short')} ${money(d.finance.revenue)}</div></div>`),
    );
    $('#finance').innerHTML = `
      <div class="f"><div class="l">${i18n.t('fin_revenue')}</div><div class="v num">${money(d.finance.revenue)}</div></div>
      <div class="f"><div class="l">${i18n.t('fin_cost')}</div><div class="v num">${money(d.finance.purchaseCost)}</div></div>
      <div class="f"><div class="l">${i18n.t('kpi_estimated_profit')}</div><div class="v num" style="color:var(--green)">${money(d.finance.estimatedProfit)}</div></div>`;
    $('#recent-orders').innerHTML = tableHtml(
      [i18n.t('th_number'), i18n.t('th_client'), i18n.t('th_status'), i18n.t('th_total'), i18n.t('th_items')],
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
      [i18n.t('th_product'), i18n.t('th_category'), i18n.t('th_score'), i18n.t('th_demand'), i18n.t('th_competition'), i18n.t('th_sale_price'), i18n.t('th_status')],
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
        [i18n.t('th_name'), i18n.t('th_category'), i18n.t('th_purchase'), i18n.t('th_sale'), i18n.t('th_margin'), i18n.t('th_status')],
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
      ['#', i18n.t('th_supplier'), i18n.t('th_country'), i18n.t('th_rating'), i18n.t('th_score'), i18n.t('th_best_offer')],
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
        [i18n.t('th_supplier'), i18n.t('th_country'), i18n.t('th_region'), i18n.t('th_rating'), i18n.t('th_verified'), i18n.t('th_offers')],
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
$('#refresh-suppliers').addEventListener('click', async (ev) => {
  busy(ev.currentTarget, true, 'Import…');
  try {
    const r = await api('/api/suppliers/refresh', { method: 'POST' });
    toast(`${r.count} fournisseurs importés d'AliExpress`);
    await loadDirectory();
  } catch (e) {
    toast(e.message);
  } finally {
    busy(ev.currentTarget, false);
  }
});

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
        [i18n.t('th_title'), i18n.t('th_category'), i18n.t('th_price'), 'MOQ', i18n.t('th_leadtime'), i18n.t('th_stock')],
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
      [i18n.t('th_number'), i18n.t('th_client'), i18n.t('th_status'), i18n.t('th_total'), i18n.t('th_created')],
      d.items.map((o) => {
        const row = [
          esc(o.orderNumber),
          esc(o.customer?.name || '—'),
          badge(o.status) + (o.onHold ? ' <span class="badge wait">À vérifier</span>' : ''),
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

// ── Service clientèle : assistant de résolution ────────────
let _supportOrders = [];
let _supportCurrent = null;

async function loadCustomers() {
  try {
    const d = await api('/api/orders?take=60');
    _supportOrders = d.items || [];
    renderSupportQueue();
  } catch (e) {
    toast(e.message);
  }
}

function renderSupportQueue() {
  const q = ($('#cust-search')?.value || '').trim().toLowerCase();
  const list = q
    ? _supportOrders.filter((o) =>
        [o.orderNumber, o.customer?.name, o.customer?.email, o.status].some((v) => (v || '').toLowerCase().includes(q)),
      )
    : _supportOrders;
  const box = $('#support-orders');
  if (!list.length) { box.innerHTML = `<p class="muted">${i18n.t('cust_empty')}</p>`; return; }
  box.innerHTML = list
    .map(
      (o) => `<button class="support-row${_supportCurrent === o.id ? ' active' : ''}" data-order="${o.id}">
        <div class="support-row-top"><b>${esc(o.customer?.name || '—')}</b>${badge(o.status)}</div>
        <div class="muted support-row-sub">${esc(o.orderNumber)} · ${money(o.total)}</div>
      </button>`,
    )
    .join('');
  box.querySelectorAll('[data-order]').forEach((r) =>
    r.addEventListener('click', () => openSupport(r.dataset.order)),
  );
}

let _csOrder = null;
let _csChat = [];
let _aiConfigured = null;

// Suggestions rapides : pré-remplissent le problème du client pour l'agent IA.
const CS_QUICK = [
  { k: 'cs_p_not_received', msg: "Le client n'a pas reçu son colis." },
  { k: 'cs_p_delay', msg: 'Le client se plaint d\'un retard de livraison.' },
  { k: 'cs_p_damaged', msg: 'Le client dit que le produit est arrivé cassé / défectueux.' },
  { k: 'cs_p_wrong', msg: "Le client a reçu un article différent de sa commande." },
  { k: 'cs_p_refund', msg: 'Le client demande un remboursement.' },
  { k: 'cs_p_cancel', msg: 'Le client veut annuler sa commande.' },
];

async function openSupport(id) {
  _supportCurrent = id;
  _csChat = [];
  renderSupportQueue();
  const panel = $('#support-panel');
  panel.innerHTML = `<p class="muted">…</p>`;
  try {
    const o = await api('/api/orders/' + id);
    _csOrder = o;
    if (_aiConfigured === null) {
      try { _aiConfigured = (await api('/api/support/ai-status')).configured; } catch { _aiConfigured = false; }
    }
    const c = o.customer || {};
    const track = (o.purchaseOrders || []).find((p) => p.trackingNumber);
    const trackLine = track
      ? `${i18n.t('cs_tracking')} : <b>${esc(track.trackingNumber)}</b>${track.carrier ? ' (' + esc(track.carrier) + ')' : ''}`
      : `<span class="muted">${i18n.t('cs_no_tracking')}</span>`;
    const chips = CS_QUICK.map((p) => `<button class="btn btn-ghost btn-sm cs-chip" data-msg="${esc(p.msg)}">${i18n.t(p.k)}</button>`).join(' ');
    const canCancel = !['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(o.status);
    const banner = _aiConfigured
      ? ''
      : `<div class="banner">🤖 ${i18n.t('cs_ai_off')} <button class="btn btn-ghost btn-sm" id="cs-go-settings">${i18n.t('nav_settings')}</button></div>`;
    panel.innerHTML = `
      <div class="cs-head">
        <div><h3 style="margin:0">${esc(c.name || i18n.t('th_client'))}</h3>
          <div class="muted">${esc(o.orderNumber)} · ${badge(o.status)}</div></div>
        <div class="cs-contact">
          ${c.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(c.email)}">✉️ ${i18n.t('cs_email')}</a>` : ''}
          ${c.phone ? `<a class="btn btn-ghost btn-sm" href="https://wa.me/${(c.phone || '').replace(/[^0-9]/g, '')}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
          ${canCancel ? `<button class="btn btn-danger btn-sm" id="cs-cancel">${i18n.t('cs_cancel_order')}</button>` : ''}
        </div>
      </div>
      <div class="cs-track">${trackLine}</div>
      ${banner}
      <p class="muted" style="margin:12px 0 6px">${i18n.t('cs_choose_problem')}</p>
      <div class="cs-problems">${chips}</div>
      <div id="cs-chat" class="cs-chat"></div>
      <div class="cs-inputrow">
        <textarea id="cs-input" class="input" rows="2" data-i18n-ph="cs_input_ph" placeholder="Décris le problème du client, ou colle son message…"></textarea>
        <button class="btn btn-primary" id="cs-send">${i18n.t('cs_send')}</button>
      </div>`;
    renderCsChat();
    panel.querySelectorAll('.cs-chip').forEach((b) =>
      b.addEventListener('click', () => sendCs(b.dataset.msg)),
    );
    $('#cs-send').addEventListener('click', () => {
      const v = $('#cs-input').value.trim();
      if (v) { $('#cs-input').value = ''; sendCs(v); }
    });
    $('#cs-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#cs-send').click(); }
    });
    const goSettings = $('#cs-go-settings');
    if (goSettings) goSettings.addEventListener('click', () => document.querySelector('[data-tab=settings]').click());
    const cancel = $('#cs-cancel');
    if (cancel) cancel.addEventListener('click', async (ev) => {
      if (!confirm(i18n.t('cs_cancel_confirm'))) return;
      busy(ev.currentTarget, true, '...');
      try {
        await api('/api/orders/' + o.id + '/cancel', { method: 'POST' });
        toast(i18n.t('cs_cancelled'));
        await loadCustomers();
        openSupport(o.id);
      } catch (e) { toast(e.message); busy(ev.currentTarget, false); }
    });
  } catch (e) {
    panel.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

function renderCsChat() {
  const box = $('#cs-chat');
  if (!box) return;
  const c = (_csOrder && _csOrder.customer) || {};
  box.innerHTML = _csChat
    .map((m, i) => {
      if (m.role === 'user') return `<div class="cs-msg cs-user">${esc(m.content)}</div>`;
      const wa = (c.phone || '').replace(/[^0-9]/g, '');
      return `<div class="cs-msg cs-ai">
        <div class="cs-ai-text">${esc(m.content)}</div>
        <div class="cs-ai-actions">
          <button class="btn btn-ghost btn-sm cs-copy" data-i="${i}">📋 ${i18n.t('cs_copy')}</button>
          ${c.email ? `<button class="btn btn-ghost btn-sm cs-mail" data-i="${i}">✉️ ${i18n.t('cs_send_email')}</button>` : ''}
          ${c.phone ? `<a class="btn btn-ghost btn-sm" href="https://wa.me/${wa}?text=${encodeURIComponent(m.content)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
        </div>
      </div>`;
    })
    .join('');
  box.querySelectorAll('.cs-copy').forEach((b) =>
    b.addEventListener('click', async () => {
      const txt = _csChat[+b.dataset.i].content;
      try { await navigator.clipboard.writeText(txt); toast(i18n.t('cs_copied')); } catch { toast(txt); }
    }),
  );
  box.querySelectorAll('.cs-mail').forEach((b) =>
    b.addEventListener('click', () => {
      const txt = _csChat[+b.dataset.i].content;
      const subject = encodeURIComponent(`${i18n.t('cs_email_subject')} ${_csOrder.orderNumber}`);
      window.location.href = `mailto:${c.email}?subject=${subject}&body=${encodeURIComponent(txt)}`;
    }),
  );
  box.scrollTop = box.scrollHeight;
}

async function sendCs(content) {
  if (!_csOrder) return;
  _csChat.push({ role: 'user', content });
  _csChat.push({ role: 'assistant', content: '…', pending: true });
  renderCsChat();
  const btn = $('#cs-send');
  if (btn) busy(btn, true, '…');
  try {
    const payload = { orderId: _csOrder.id, messages: _csChat.filter((m) => !m.pending) };
    const { reply } = await api('/api/support/chat', { method: 'POST', body: payload });
    _csChat = _csChat.filter((m) => !m.pending);
    _csChat.push({ role: 'assistant', content: reply });
  } catch (e) {
    _csChat = _csChat.filter((m) => !m.pending);
    _csChat.push({ role: 'assistant', content: '⚠️ ' + e.message });
  } finally {
    if (btn) busy(btn, false);
    renderCsChat();
  }
}

$('#refresh-customers').addEventListener('click', loadCustomers);
$('#cust-search').addEventListener('input', renderSupportQueue);

async function showOrder(id) {
  try {
    const o = await api('/api/orders/' + id);
    const items = tableHtml(
      [i18n.t('th_product'), i18n.t('th_qty'), i18n.t('th_unit_price'), i18n.t('th_subtotal')],
      o.items.map((it) => [
        esc(it.product?.name || it.productId),
        it.quantity,
        `<span class="num">${money(it.unitSalePrice)}</span>`,
        `<span class="num">${money(it.unitSalePrice * it.quantity)}</span>`,
      ]),
    );
    const pos = tableHtml(
      [i18n.t('th_supplier'), i18n.t('th_status'), i18n.t('th_cost'), i18n.t('th_carrier'), i18n.t('th_tracking')],
      o.purchaseOrders.map((p) => [
        esc(p.supplier?.name || '—'),
        badge(p.status),
        `<span class="num">${money(p.cost, p.currency)}</span>`,
        esc(p.carrier || '—'),
        esc(p.trackingNumber || '—'),
      ]),
    );
    const canCancel = !['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(o.status);
    const shipped = o.purchaseOrders.some((p) => ['SHIPPED', 'DELIVERED'].includes(p.status));
    const canEditAddress = canCancel && !shipped;
    const c = o.customer || {};
    const addrLines = [c.address, [c.zip, c.city].filter(Boolean).join(' '), c.country].filter(Boolean);
    const addrHtml = addrLines.length ? addrLines.map(esc).join('<br>') : '<span class="muted">Aucune adresse renseignée</span>';
    openModal(`
      <h2>Commande ${esc(o.orderNumber)}</h2>
      <div class="muted">${esc(o.channel !== 'manual' ? o.channel.toUpperCase() + ' · ' : '')}${esc(c.name || '')}</div>
      ${o.onHold ? '<div class="banner">📦 <b>À vérifier avant envoi.</b> Vérifie l’adresse de livraison, puis confirme pour envoyer la commande au fournisseur.</div>' : ''}
      <div class="kv">
        <div class="k">Statut</div><div>${badge(o.status)}${o.onHold ? ' <span class="badge wait">À vérifier</span>' : ''}</div>
        <div class="k">Total</div><div class="num">${money(o.total, o.currency)}</div>
        <div class="k">Créée le</div><div>${dt(o.createdAt)}</div>
      </div>
      <h4>Adresse de livraison ${canEditAddress ? `<button class="btn btn-ghost btn-xs" id="m-editaddr">✏️ Modifier</button>` : ''}</h4>
      <div class="addr-box">
        <div><b>${esc(c.name || '—')}</b>${c.phone ? ' · ' + esc(c.phone) : ''}</div>
        <div>${addrHtml}</div>
      </div>
      <h4>Articles</h4><div class="table-wrap">${items}</div>
      <h4>Achats fournisseurs (expédition)</h4><div class="table-wrap">${pos}</div>
      <div class="form-actions">
        ${o.onHold ? `<button class="btn btn-primary" id="m-confirm">✅ Confirmer &amp; envoyer</button>` : ''}
        ${o.status === 'PENDING' && paymentsEnabled ? `<button class="btn btn-primary" id="m-pay">💳 Payer par carte</button>` : ''}
        ${!o.onHold && (o.status === 'PAID' || o.status === 'FULFILLING') ? `<button class="btn btn-primary" id="m-fulfill">Relancer l'expédition</button>` : ''}
        ${canCancel ? `<button class="btn btn-ghost" id="m-cancel">Annuler</button>` : ''}
      </div>`);
    $('#m-editaddr')?.addEventListener('click', () => editShipping(id, c));
    $('#m-confirm')?.addEventListener('click', async (ev) => {
      busy(ev.currentTarget, true, 'Envoi…');
      try {
        await api(`/api/orders/${id}/confirm`, { method: 'POST' });
        toast('Commande confirmée et envoyée au fournisseur');
        showOrder(id);
        loadOrders();
      } catch (e) { toast(e.message); busy(ev.currentTarget, false); }
    });
    $('#m-pay')?.addEventListener('click', async (ev) => {
      busy(ev.currentTarget, true, 'Redirection...');
      try {
        const { url } = await api(`/api/payments/checkout/${id}`, { method: 'POST' });
        window.location.href = url; // page de paiement carte sécurisée (iyzico / Stripe)
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

/** Modale d'édition de l'adresse de livraison (avant envoi au fournisseur). */
function editShipping(id, c) {
  c = c || {};
  const f = (k, label, full = false) =>
    `<div class="field${full ? ' full' : ''}"><label>${label}</label><input class="input" id="sa-${k}" value="${esc(c[k] || '')}"/></div>`;
  openModal(`
    <h2>Modifier l'adresse de livraison</h2>
    <p class="muted">Ces informations seront envoyées au fournisseur lors de l'expédition.</p>
    <div class="form-grid">
      ${f('name', 'Nom complet')}
      ${f('phone', 'Téléphone')}
      ${f('address', 'Adresse (rue, n°)', true)}
      ${f('zip', 'Code postal')}
      ${f('city', 'Ville')}
      ${f('country', 'Pays')}
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" data-close>Annuler</button>
      <button class="btn btn-primary" id="sa-save">Enregistrer</button>
    </div>`);
  $('#modal-content [data-close]').addEventListener('click', () => showOrder(id));
  $('#sa-save').addEventListener('click', async (ev) => {
    const body = {};
    for (const k of ['name', 'phone', 'address', 'zip', 'city', 'country']) body[k] = $('#sa-' + k).value.trim();
    if (!body.name) return toast('Le nom est requis');
    busy(ev.currentTarget, true, '…');
    try {
      await api(`/api/orders/${id}/shipping`, { method: 'PATCH', body });
      toast('Adresse mise à jour');
      showOrder(id);
      loadOrders();
    } catch (e) { toast(e.message); busy(ev.currentTarget, false); }
  });
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
      const authorize = c.status !== 'CONNECTED'
        ? `<button class="btn btn-primary btn-xs" data-auth="${c.id}">Autoriser</button> ` : '';
      const actions = authorize +
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
    $('#channels-table').innerHTML = tableHtml([i18n.t('th_channel'), i18n.t('th_name'), i18n.t('th_status'), i18n.t('th_detail'), i18n.t('th_actions')], rows);
    document.querySelectorAll('#channels-table [data-auth]').forEach((b) =>
      b.addEventListener('click', () => authorizeChannel(b.dataset.auth)),
    );
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
async function authorizeChannel(id) {
  try {
    const r = await api(`/api/channels/${id}/oauth/start`, { method: 'POST' });
    // Redirige le navigateur vers la page d'autorisation de la marketplace.
    window.location.href = r.url;
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
      '<h4>Identifiants de votre app développeur</h4><div id="ch-fields"></div>' +
      `<p class="muted" style="margin-top:10px">Dans votre app développeur, enregistrez l’URL de redirection : <code>${location.origin}/api/oauth/callback</code></p>` +
      '<p class="muted" id="ch-help"></p>' +
      '<div class="form-actions"><button class="btn btn-ghost" data-close>Annuler</button>' +
      '<button class="btn btn-primary" id="ch-save">Enregistrer, puis autoriser</button></div>',
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
      closeModal();
      // Enchaîne sur l'autorisation OAuth (redirection vers la marketplace).
      toast('Identifiants enregistrés — redirection vers l’autorisation…');
      await authorizeChannel(c.id);
    } catch (e) {
      toast(e.message);
      busy(ev.currentTarget, false);
    }
  });
});

// ── Recherche + favoris + titres ───────────────────────────
/** Affiche une liste de résultats de recherche (partagée par la saisie et la caméra). */
function renderDiscoveryResults(res) {
  const rows = res.results.map((r, i) => [
    r.imageUrl ? `<img class="thumb" src="${esc(r.imageUrl)}" alt="" loading="lazy" data-detail="${i}"/>` : '',
    `<a href="#" class="prod-link" data-detail="${i}">${esc(r.title)}</a>`,
    esc(r.category), `<span class="num">${money(r.estimatedPrice)}</span>`,
    `<button class="btn btn-ghost btn-xs" data-fav="${i}">☆ Favori</button>`,
  ]);
  $('#discovery-results').innerHTML = tableHtml(['', i18n.t('th_product'), i18n.t('th_category'), i18n.t('th_est_price'), ''], rows);
  // Clic sur la photo ou le titre → fiche produit (grande image + prix modifiable).
  document.querySelectorAll('#discovery-results [data-detail]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openProductDetail(res.results[Number(el.dataset.detail)]);
    }),
  );
  document.querySelectorAll('#discovery-results [data-fav]').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = res.results[Number(b.dataset.fav)];
      await api('/api/favorites', { method: 'POST', body: { source: r.source, title: r.title, category: r.category, keywords: r.keywords, price: r.estimatedPrice, imageUrl: r.imageUrl, url: r.url } });
      toast('Ajouté aux favoris');
      loadFavorites();
    }),
  );
}

/** Fiche produit : grande image + prix de vente modifiable avant l'ajout aux favoris. */
function openProductDetail(r) {
  const price = Number(r.estimatedPrice) || 0;
  openModal(
    `<h2>${esc(r.title)}</h2>` +
      (r.imageUrl ? `<img src="${esc(r.imageUrl)}" alt="" class="prod-detail-img"/>` : '') +
      `<div class="field" style="margin-top:12px"><label>Catégorie</label><div class="muted">${esc(r.category)}</div></div>` +
      `<div class="field"><label>Prix de vente (modifiable avant publication)</label>` +
      `<input class="input" id="pd-price" type="number" min="0" step="0.01" value="${price}"/></div>` +
      (r.url ? `<p><a href="${esc(r.url)}" target="_blank" rel="noopener" class="prod-link">Voir la fiche sur AliExpress ↗</a></p>` : '') +
      `<div class="form-actions"><button class="btn btn-ghost" data-close>Fermer</button>` +
      `<button class="btn btn-primary" id="pd-fav">☆ Ajouter aux favoris</button></div>`,
  );
  $('#modal-content [data-close]').addEventListener('click', closeModal);
  $('#pd-fav').addEventListener('click', async (ev) => {
    const newPrice = parseFloat($('#pd-price').value);
    busy(ev.currentTarget, true, 'Ajout…');
    try {
      await api('/api/favorites', {
        method: 'POST',
        body: { source: r.source, title: r.title, category: r.category, keywords: r.keywords, price: Number.isFinite(newPrice) ? newPrice : price, imageUrl: r.imageUrl, url: r.url },
      });
      toast('Ajouté aux favoris au prix indiqué');
      closeModal();
      loadFavorites();
    } catch (e) {
      toast(e.message);
      busy(ev.currentTarget, false);
    }
  });
}
async function doSearch() {
  const mode = $('#d-mode').value;
  const val = $('#d-input').value.trim();
  try {
    let res;
    if (mode === 'text') res = await api('/api/discovery/search/text?q=' + encodeURIComponent(val));
    else if (mode === 'photo') res = await api('/api/discovery/search/photo', { method: 'POST', body: { hint: val } });
    else res = await api('/api/discovery/search/barcode/' + encodeURIComponent(val));
    renderDiscoveryResults(res);
  } catch (e) {
    toast(e.message);
  }
}
$('#d-go').addEventListener('click', doSearch);
$('#d-input').addEventListener('keydown', (e) => e.key === 'Enter' && doSearch());
$('#d-cam').addEventListener('click', openCamera);

// ── Caméra : scanner code-barres + photo produit ───────────
let camStream = null;
let camScanTimer = null;
function stopCamera() {
  if (camScanTimer) { clearInterval(camScanTimer); camScanTimer = null; }
  if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
}
async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return toast('Caméra non disponible sur cet appareil/navigateur.');
  }
  const scanSupported = 'BarcodeDetector' in window;
  openModal(`
    <h2>📷 Caméra</h2>
    <div class="cam-modes">
      <button class="btn btn-sm ${scanSupported ? 'btn-primary' : ''}" id="cam-mode-scan" ${scanSupported ? '' : 'disabled'}>Scanner code-barres</button>
      <button class="btn btn-sm ${scanSupported ? '' : 'btn-primary'}" id="cam-mode-photo">Prendre une photo</button>
    </div>
    <div class="cam-wrap"><video id="cam-video" playsinline muted></video><div class="cam-frame"></div></div>
    <canvas id="cam-canvas" hidden></canvas>
    <div id="cam-photo-panel" hidden>
      <div class="field"><label>Mot-clé du produit (aide la recherche)</label>
        <input class="input" id="cam-hint" placeholder="ex: gourde, lampe, brosse…"/></div>
      <img id="cam-thumb" alt="" class="cam-thumb" hidden/>
    </div>
    <p class="muted" id="cam-status">${scanSupported ? 'Vise un code-barres — détection automatique.' : 'Le scanner de code-barres n’est pas supporté ici : prends une photo.'}</p>
    <div class="form-actions">
      <button class="btn btn-ghost" data-close>Fermer</button>
      <button class="btn btn-primary" id="cam-capture" hidden>📸 Capturer &amp; rechercher</button>
    </div>`);
  $('#modal-content [data-close]').addEventListener('click', () => { stopCamera(); closeModal(); });

  const video = $('#cam-video');
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = camStream;
    await video.play();
  } catch (e) {
    $('#cam-status').textContent = 'Accès caméra refusé. Autorise la caméra dans le navigateur.';
    return;
  }

  let mode = scanSupported ? 'scan' : 'photo';
  const detector = scanSupported ? new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] }) : null;

  const setMode = (m) => {
    mode = m;
    $('#cam-mode-scan')?.classList.toggle('btn-primary', m === 'scan');
    $('#cam-mode-photo').classList.toggle('btn-primary', m === 'photo');
    $('#cam-photo-panel').hidden = m !== 'photo';
    $('#cam-capture').hidden = m !== 'photo';
    if (camScanTimer) { clearInterval(camScanTimer); camScanTimer = null; }
    if (m === 'scan' && detector) startScanLoop();
    $('#cam-status').textContent = m === 'scan' ? 'Vise un code-barres — détection automatique.' : 'Cadre le produit puis capture.';
  };
  $('#cam-mode-scan')?.addEventListener('click', () => setMode('scan'));
  $('#cam-mode-photo').addEventListener('click', () => setMode('photo'));

  function startScanLoop() {
    camScanTimer = setInterval(async () => {
      if (!camStream || !detector) return;
      try {
        const codes = await detector.detect(video);
        if (codes && codes.length) {
          const code = (codes[0].rawValue || '').replace(/\D/g, '');
          if (code.length >= 6) {
            stopCamera();
            $('#cam-status').textContent = 'Code détecté : ' + code + ' — recherche…';
            const res = await api('/api/discovery/search/barcode/' + encodeURIComponent(code)).catch((e) => { toast(e.message); return null; });
            if (res) { closeModal(); renderDiscoveryResults(res); toast('Code-barres ' + code + ' trouvé'); }
          }
        }
      } catch { /* image pas prête : on réessaie */ }
    }, 600);
  }

  $('#cam-capture').addEventListener('click', async (ev) => {
    const canvas = $('#cam-canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
    const thumb = $('#cam-thumb'); thumb.src = dataUrl; thumb.hidden = false;
    const hint = $('#cam-hint').value.trim();
    busy(ev.currentTarget, true, '…');
    try {
      // Envoie la photo (reconnaissance d'image si le service est configuré) + mot-clé optionnel.
      const res = await api('/api/discovery/search/photo', { method: 'POST', body: { image: dataUrl, hint } });
      stopCamera(); closeModal(); renderDiscoveryResults(res);
      toast(res.mode === 'ai' && res.detectedLabels?.length
        ? 'Détecté : ' + res.detectedLabels.slice(0, 3).join(', ')
        : 'Recherche par photo effectuée');
    } catch (e) { toast(e.message); busy(ev.currentTarget, false); }
  });

  if (mode === 'scan') startScanLoop(); else setMode('photo');
}
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
    $('#favorites-table').innerHTML = tableHtml([i18n.t('th_product'), i18n.t('th_category'), i18n.t('th_price'), i18n.t('th_status'), i18n.t('th_actions')], rows);
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
    $('#competitors-table').innerHTML = tableHtml([i18n.t('th_shop'), i18n.t('th_platform'), i18n.t('th_followed'), i18n.t('th_last_scan'), i18n.t('th_products'), i18n.t('th_actions')], rows);
    document.querySelectorAll('#competitors-table [data-scan]').forEach((b) => b.addEventListener('click', async () => { b.textContent = '…'; try { const r = await api(`/api/competitors/${b.dataset.scan}/scan`, { method: 'POST' }); toast(r.found + ' produits gagnants'); loadCompetitors(); } catch (e) { toast(e.message); } }));
    document.querySelectorAll('#competitors-table [data-delc]').forEach((b) => b.addEventListener('click', async () => { await api('/api/competitors/' + b.dataset.delc, { method: 'DELETE' }); loadCompetitors(); }));
    document.querySelectorAll('#competitors-table [data-follow]').forEach((b) => b.addEventListener('change', async () => { await api(`/api/competitors/${b.dataset.follow}/follow`, { method: 'PATCH', body: { followed: b.checked } }); toast(b.checked ? 'Boutique suivie' : 'Suivi arrêté'); }));
    const winning = await api('/api/competitors/winning?take=30');
    const wrows = winning.map((w) => [
      esc(w.title), esc(w.category), `<b class="num">${w.soldCount}</b>`, `<span class="num">${money(w.price)}</span>`,
      esc(w.competitor?.shopName || ''), w.favorited ? '★' : `<button class="btn btn-ghost btn-xs" data-wfav="${w.id}">☆ Favori</button>`,
    ]);
    $('#winning-table').innerHTML = tableHtml([i18n.t('th_product'), i18n.t('th_category'), i18n.t('th_sales'), i18n.t('th_price'), i18n.t('th_shop'), ''], wrows);
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
    $('#ads-table').innerHTML = tableHtml([i18n.t('th_product'), i18n.t('th_platform'), i18n.t('th_hook'), i18n.t('th_status'), i18n.t('th_budget_day'), i18n.t('th_actions')], rows);
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
    $('#pnl-table').innerHTML = tableHtml([i18n.t('th_date'), i18n.t('th_orders'), i18n.t('th_revenue'), i18n.t('th_costs'), i18n.t('th_profit')], rows);
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

// ── Portefeuille / Retrait ─────────────────────────────────
async function loadWallet() {
  try {
    const w = await api('/api/wallet');
    $('#wallet-kpis').innerHTML =
      kpiCard('green', 'Solde disponible', money(w.available, w.currency), 'retirable maintenant') +
      kpiCard('', 'Bénéfices totaux', money(w.profit, w.currency), '') +
      kpiCard('', 'En cours de retrait', money(w.reserved, w.currency), 'demandes en attente');
    renderPayoutStatus(w.payouts);
    const rows = w.withdrawals.map((x) => [
      new Date(x.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }),
      `<span class="num">${money(x.amount, x.currency)}</span>`,
      { paypal: 'PayPal', card: 'Carte', bank: 'Virement', stripe: 'Stripe Payouts' }[x.method] || x.method,
      esc(x.destination),
      badge(x.status),
      x.status === 'PENDING' ? `<button class="btn btn-ghost btn-xs" data-wcancel="${x.id}">Annuler</button>` : '',
    ]);
    $('#withdrawals-table').innerHTML = tableHtml([i18n.t('th_date'), i18n.t('th_amount'), i18n.t('th_method'), i18n.t('th_destination'), i18n.t('th_status'), ''], rows);
    document.querySelectorAll('#withdrawals-table [data-wcancel]').forEach((b) =>
      b.addEventListener('click', async () => { await api('/api/wallet/' + b.dataset.wcancel + '/cancel', { method: 'POST' }); toast('Demande annulée'); loadWallet(); }),
    );
  } catch (e) { toast(e.message); }
}

/** Bandeau d'état des retraits (iyzico → IBAN, ou Stripe Payouts). */
function renderPayoutStatus(p) {
  const el = $('#payout-status');
  if (!el) return;
  // Modèle iyzico (Turquie) : le client paie par carte, l'argent arrive dans le
  // portefeuille de l'appli, puis vous retirez vers votre IBAN.
  if (paymentProvider === 'iyzico') {
    el.innerHTML =
      '<div class="banner ok">💳 Paiement par carte <b>iyzico</b> actif — l’argent des ventes arrive dans votre portefeuille. ' +
      'Utilisez « Demander un retrait » pour l’envoyer sur votre <b>IBAN</b>.</div>';
    return;
  }
  if (!p || !p.configured) {
    el.innerHTML = '<div class="banner muted">Stripe Payouts non configuré (ajoutez <code>STRIPE_SECRET_KEY</code>). Les retraits sont enregistrés en mode manuel.</div>';
    return;
  }
  if (p.payoutsEnabled) {
    el.innerHTML = '<div class="banner ok">✅ Stripe Payouts connecté — virements automatiques activés.</div>';
    return;
  }
  const label = p.connected ? 'Terminer la configuration Stripe' : 'Connecter Stripe Payouts';
  el.innerHTML = `<div class="banner">💳 Recevez vos retraits automatiquement sur votre compte bancaire. <button class="btn btn-primary btn-xs" id="stripe-connect-btn">${label}</button></div>`;
  $('#stripe-connect-btn')?.addEventListener('click', async (ev) => {
    busy(ev.currentTarget, true, '...');
    try {
      const su = await promptStepUp();
      if (!su) { busy(ev.currentTarget, false); return; }
      const r = await api('/api/wallet/connect', { method: 'POST', stepUp: su });
      if (r.url) window.location.href = r.url; // page d'onboarding hébergée par Stripe
    } catch (e) { toast(e.message); busy(ev.currentTarget, false); }
  });
}
$('#withdraw-btn').addEventListener('click', async () => {
  const w = await api('/api/wallet').catch(() => null);
  if (!w) return;
  const stripeReady = !!(w.payouts && w.payouts.payoutsEnabled);
  const stripeOpt = stripeReady
    ? '<option value="stripe">Stripe Payouts (virement automatique)</option>'
    : '';
  const ibanOpt = '<option value="bank">Virement bancaire (IBAN)</option>';
  const cardOpt = '<option value="card">Carte (Visa / Mastercard)</option>';
  const paypalOpt = '<option value="paypal">PayPal</option>';
  // Avec iyzico (Turquie), le retrait vers l'IBAN est la méthode principale : on la met en premier.
  const methodOpts = paymentProvider === 'iyzico'
    ? ibanOpt + cardOpt + paypalOpt
    : stripeOpt + cardOpt + ibanOpt + paypalOpt;
  openModal(
    '<h2>Demander un retrait</h2>' +
    `<p class="muted">Solde disponible : <b>${money(w.available, w.currency)}</b></p>` +
    '<div class="form-grid">' +
    '<div class="field"><label>Montant</label><input class="input" id="wd-amount" type="number" min="1" step="0.01"/></div>' +
    `<div class="field"><label>Méthode</label><select class="input" id="wd-method">${methodOpts}</select></div>` +
    '<div class="field full" id="wd-dest-field"><label id="wd-dest-label">Numéro de carte</label><input class="input" id="wd-dest" placeholder="4242 4242 4242 4242"/></div>' +
    '</div>' +
    '<div class="form-actions"><button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-primary" id="wd-submit">Confirmer le retrait</button></div>');
  $('#modal-content [data-close]').addEventListener('click', closeModal);
  const ibanPh = paymentProvider === 'iyzico' ? 'TR33 0006 1005 1978 6457 8413 26' : 'FR76…';
  const DEST = { card: ['Numéro de carte', '4242 4242 4242 4242'], bank: ['IBAN', ibanPh], paypal: ['Email PayPal', 'email@exemple.com'] };
  const syncDest = () => {
    const m = $('#wd-method').value;
    if (m === 'stripe') { $('#wd-dest-field').style.display = 'none'; return; }
    $('#wd-dest-field').style.display = '';
    const [l, ph] = DEST[m];
    $('#wd-dest-label').textContent = l;
    $('#wd-dest').placeholder = ph;
    $('#wd-dest').value = '';
  };
  $('#wd-method').addEventListener('change', syncDest);
  syncDest();
  $('#wd-submit').addEventListener('click', async (ev) => {
    const amount = Number($('#wd-amount').value);
    const method = $('#wd-method').value;
    const destination = $('#wd-dest').value.trim();
    if (!amount || amount <= 0) return toast('Montant invalide');
    if (method !== 'stripe' && !destination) return toast('Indiquez une destination');
    busy(ev.currentTarget, true, '...');
    try {
      // Action sensible → ré-authentification (step-up) avant le retrait.
      const su = await promptStepUp();
      if (!su) { busy(ev.currentTarget, false); return; }
      const body = method === 'stripe' ? { amount, method } : { amount, method, destination };
      await api('/api/wallet/withdraw', { method: 'POST', body, stepUp: su });
      toast(method === 'stripe' ? 'Virement Stripe envoyé' : 'Demande de retrait enregistrée');
      closeModal();
      loadWallet();
    } catch (e) { toast(e.message); busy(ev.currentTarget, false); }
  });
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
  loadAliexpressStatus();
  loadAiStatus();
}

async function loadAiStatus() {
  const box = $('#ai-status');
  if (!box) return;
  try {
    const s = await api('/api/support/ai-status');
    _aiConfigured = s.configured;
    box.innerHTML = s.configured
      ? `<span class="pill pill-on">✅ ${i18n.t('ai_on')}</span> (${esc(s.provider)})`
      : `<span class="pill pill-off">${i18n.t('ai_off')}</span>`;
  } catch { box.textContent = ''; }
}
$('#ai-save')?.addEventListener('click', async (ev) => {
  const apiKey = $('#ai-key').value.trim();
  const provider = $('#ai-provider').value;
  if (!apiKey) return toast(i18n.t('ai_key_missing'));
  busy(ev.currentTarget, true, '...');
  try {
    const r = await api('/api/settings/ai', { method: 'POST', body: { apiKey, provider } });
    _aiConfigured = r.configured;
    $('#ai-key').value = '';
    toast(i18n.t('ai_saved'));
    loadAiStatus();
  } catch (e) { toast(e.message); } finally { busy(ev.currentTarget, false); }
});
// Le lien « obtenir une clé » pointe vers la bonne plateforme selon le fournisseur.
$('#ai-provider')?.addEventListener('change', () => {
  const link = $('#ai-getkey');
  const p = $('#ai-provider').value;
  const map = {
    gemini: ['https://aistudio.google.com/app/apikey', '🔑 Obtenir une clé Gemini gratuite'],
    openai: ['https://platform.openai.com/api-keys', '🔑 Obtenir une clé OpenAI'],
    anthropic: ['https://console.anthropic.com/settings/keys', '🔑 Obtenir une clé Anthropic'],
  };
  if (link && map[p]) { link.href = map[p][0]; link.textContent = map[p][1]; }
});

async function loadAliexpressStatus() {
  const box = $('#ali-status');
  if (!box) return;
  try {
    const s = await api('/api/aliexpress/status');
    if (s.connected) {
      const exp = s.expiresAt ? ` (${i18n.t('ali_until')} ${dt(s.expiresAt)})` : '';
      box.innerHTML = `<span class="pill pill-on">✅ ${i18n.t('ali_connected')}</span>${exp}`;
    } else if (s.configured) {
      box.innerHTML = `<span class="pill pill-off">${i18n.t('ali_not_connected')}</span>`;
    } else {
      box.innerHTML = `<span class="pill pill-off">${i18n.t('ali_not_configured')}</span>`;
    }
  } catch { box.textContent = ''; }
}
$('#ali-connect')?.addEventListener('click', async (ev) => {
  busy(ev.currentTarget, true, '...');
  try {
    const { url } = await api('/api/aliexpress/oauth/start');
    window.open(url, '_blank', 'noopener');
    toast(i18n.t('ali_opening'));
  } catch (e) { toast(e.message); } finally { busy(ev.currentTarget, false); }
});
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
$('#settings-purge').addEventListener('click', () => {
  openModal(
    '<h2>Réinitialiser les données ?</h2>' +
    '<p class="muted">Toutes les données de démonstration (commandes, produits, fournisseurs, ' +
    'clients, chiffres) seront <b>définitivement supprimées</b>. Ton compte et tes réglages sont conservés.</p>' +
    '<div class="form-actions"><button class="btn btn-ghost" data-close>Annuler</button>' +
    '<button class="btn btn-danger" id="purge-confirm">Oui, tout supprimer</button></div>');
  $('#modal-content [data-close]').addEventListener('click', closeModal);
  $('#purge-confirm').addEventListener('click', async (ev) => {
    busy(ev.currentTarget, true, 'Suppression...');
    try {
      await api('/api/settings/purge', { method: 'POST' });
      toast('✅ Données réinitialisées — tu pars sur une base propre !');
      closeModal();
      loadDashboard();
    } catch (e) { toast(e.message); busy(ev.currentTarget, false); }
  });
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
    h += secRow('Mot de passe', 'Modifier votre mot de passe', '<button class="btn btn-primary btn-xs" id="change-password">Changer</button>');
    h += secRow('Sessions', 'Déconnecter tous les appareils', '<button class="btn btn-ghost btn-xs" id="logout-all">Se déconnecter de partout</button>');
    h += secRow('Supprimer le compte', 'Action irréversible', '<button class="btn btn-ghost btn-xs" id="del-account" style="color:var(--red)">Supprimer</button>');
    h += '<h4 style="margin-top:18px">Journal de connexions</h4><div id="login-history" class="table-wrap"></div>';
    el.innerHTML = h;
    $('#totp-setup')?.addEventListener('click', totpSetupFlow);
    $('#totp-disable')?.addEventListener('click', () => sensitiveAction('Désactiver la double authentification ?', (su) => api('/api/auth/mfa/totp/disable', { method: 'POST', stepUp: su }), 'TOTP désactivé'));
    $('#recov-regen')?.addEventListener('click', () => sensitiveAction('Régénérer les codes ? Les anciens seront invalidés.', async (su) => { const r = await api('/api/auth/mfa/recovery/regenerate', { method: 'POST', stepUp: su }); showRecoveryCodes(r.recoveryCodes); }, ''));
    $('#key-add')?.addEventListener('click', addSecurityKey);
    document.querySelectorAll('#security-panel [data-keydel]').forEach((b) => b.addEventListener('click', () => sensitiveAction('Retirer cette clé de sécurité ?', (su) => api('/api/auth/mfa/webauthn/' + b.dataset.keydel, { method: 'DELETE', stepUp: su }), 'Clé retirée')));
    $('#change-password')?.addEventListener('click', () => {
      openModal(
        '<h2>Changer de mot de passe</h2>' +
        '<div class="form-grid">' +
        '<div class="field full"><label>Mot de passe actuel</label><input class="input" id="cp-cur" type="password" autocomplete="current-password"/></div>' +
        '<div class="field full"><label>Nouveau mot de passe (≥ 10 caractères)</label><input class="input" id="cp-new" type="password" autocomplete="new-password"/></div>' +
        '<div class="field full"><label>Confirmer le nouveau mot de passe</label><input class="input" id="cp-new2" type="password" autocomplete="new-password"/></div>' +
        '</div>' +
        '<div class="form-actions"><button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-primary" id="cp-submit">Enregistrer</button></div>');
      $('#modal-content [data-close]').addEventListener('click', closeModal);
      $('#cp-submit').addEventListener('click', async (ev) => {
        const cur = $('#cp-cur').value, nw = $('#cp-new').value, nw2 = $('#cp-new2').value;
        if (nw.length < 10) return toast('Le nouveau mot de passe doit faire au moins 10 caractères');
        if (nw !== nw2) return toast('Les deux nouveaux mots de passe ne correspondent pas');
        busy(ev.currentTarget, true, '...');
        try {
          const r = await api('/api/auth/security/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: nw } });
          setToken(r.token); // garde l'appareil courant connecté (les autres sont déconnectés)
          toast('✅ Mot de passe changé');
          closeModal();
        } catch (e) { toast(e.message); busy(ev.currentTarget, false); }
      });
    });
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
    $('#login-history').innerHTML = tableHtml([i18n.t('th_date'), i18n.t('th_method'), i18n.t('th_device'), ''], rows);
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
  customers: loadCustomers,
  channels: loadChannels,
  discovery: loadDiscovery,
  competitors: loadCompetitors,
  ads: loadAds,
  reports: loadReports,
  wallet: loadWallet,
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
    pill.textContent = i18n.t('pilot_active', { s: state.intervalSeconds });
    pill.className = 'pill pill-on';
    toggle.textContent = i18n.t('stop_pilot');
  } else {
    pill.textContent = i18n.t('pilot_off');
    pill.className = 'pill pill-off';
    toggle.textContent = i18n.t('start_pilot');
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
    $('#a-submit').textContent = authMode === 'register' ? i18n.t('register_btn') : i18n.t('signin_btn');
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

// ── Mot de passe oublié → envoi du lien de réinitialisation ─
$('#forgot-link')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const email = ($('#a-email').value || '').trim() || (prompt('Votre adresse e-mail :') || '').trim();
  if (!email) return;
  try {
    await api('/api/auth/forgot-password', { method: 'POST', body: { email } });
    toast('Si un compte existe, un e-mail de réinitialisation vous a été envoyé. 📧');
  } catch (err) { toast(err.message); }
});

// ── Écran de réinitialisation (ouvert via le lien e-mail ?reset=…) ─
function showResetScreen(token) {
  $('#auth-screen').hidden = false;
  $('#auth-form').hidden = true;
  $('#auth-hint').hidden = true;
  $('#forgot-row') && ($('#forgot-row').hidden = true);
  document.querySelector('.auth-tabs') && (document.querySelector('.auth-tabs').hidden = true);
  $('#reset-step').hidden = false;
  $('#reset-submit').addEventListener('click', async (ev) => {
    const nw = $('#reset-new').value, nw2 = $('#reset-new2').value;
    const err = $('#reset-error'); err.hidden = true;
    if (nw.length < 10) { err.textContent = 'Le mot de passe doit faire au moins 10 caractères.'; err.hidden = false; return; }
    if (nw !== nw2) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; err.hidden = false; return; }
    busy(ev.currentTarget, true, '...');
    try {
      const res = await api('/api/auth/reset-password', { method: 'POST', body: { token, newPassword: nw } });
      setToken(res.token);
      history.replaceState({}, '', '/');
      toast('✅ Mot de passe réinitialisé — vous êtes connecté.');
      onAuthed(res.user);
    } catch (e) { err.textContent = e.message; err.hidden = false; busy(ev.currentTarget, false); }
  });
}

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

async function onAuthed(user) {
  hideAuth();
  $('#user-chip').textContent = '👤 ' + user.name + (user.role === 'admin' ? ' (admin)' : '');
  $('#user-chip').hidden = false;
  $('#logout-btn').hidden = false;
  // Charge la devise de l'app pour l'affichage des prix (évite un « EUR » erroné).
  try { const s = await api('/api/settings'); if (s && s.currency) APP_CURRENCY = s.currency; } catch {}
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
  api('/api/payments/status').then((s) => { paymentsEnabled = !!s.enabled; paymentProvider = s.provider || 'none'; }).catch(() => {});
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

// ── Paiement (iyzico / Stripe) ─────────────────────────────
let paymentsEnabled = false;
let paymentProvider = 'none'; // 'iyzico' | 'stripe' | 'none'

// Retour de paiement (redirection iyzico / Stripe)
const params = new URLSearchParams(location.search);
if (params.get('paid')) {
  toast(`Paiement réussi — commande ${params.get('paid')}`);
  history.replaceState({}, '', '/');
} else if (params.get('canceled')) {
  toast('Paiement annulé');
  history.replaceState({}, '', '/');
} else if (params.get('connected')) {
  toast(`Canal ${params.get('channel') || ''} autorisé ✓`);
  history.replaceState({}, '', '/');
} else if (params.get('aliexpress') === 'connected') {
  toast('✅ AliExpress connecté — la recherche par mot-clé est activée !');
  history.replaceState({}, '', '/');
} else if (params.get('aliexpress') === 'error') {
  toast('AliExpress : ' + (params.get('msg') || 'échec de la connexion'));
  history.replaceState({}, '', '/');
}

// ── Service worker ─────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ── Démarrage : vérifie la session, sinon affiche la connexion ─
(async function init() {
  // Lien de réinitialisation par e-mail : affiche l'écran « nouveau mot de passe ».
  const resetToken = params.get('reset');
  if (resetToken) { showResetScreen(resetToken); return; }
  // Masque « Mot de passe oublié ? » si l'envoi d'e-mails n'est pas configuré.
  api('/api/auth/config').then((c) => { if (!c.emailReset) $('#forgot-row') && ($('#forgot-row').hidden = true); }).catch(() => {});
  if (!getToken()) return showAuth();
  try {
    const user = await api('/api/auth/me');
    onAuthed(user);
  } catch {
    showAuth();
  }
})();

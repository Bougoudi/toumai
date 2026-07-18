'use strict';

// ── Helpers ────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

const money = (n, c = 'EUR') =>
  (n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + c;

function badge(status) {
  const s = String(status).toUpperCase();
  const ok = ['SHIPPED', 'DELIVERED', 'COMPLETED', 'ACTIVE', 'PAID', 'IMPORTED'];
  const wait = ['FULFILLING', 'RUNNING', 'PENDING', 'EVALUATED', 'NEW', 'DRAFT'];
  const cls = ok.includes(s) ? 'ok' : wait.includes(s) ? 'wait' : 'bad';
  return `<span class="badge ${cls}">${s}</span>`;
}

function tableHtml(headers, rows) {
  if (!rows.length) return '<div class="empty">Aucune donnée</div>';
  return (
    '<table><thead><tr>' +
    headers.map((h) => `<th>${h}</th>`).join('') +
    '</tr></thead><tbody>' +
    rows.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') +
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
      d.recent.orders.map((o) => [o.orderNumber, o.customer, badge(o.status), `<span class="num">${money(o.total)}</span>`, o.items]),
    );
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
        o.title,
        o.category,
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

// ── Produits ───────────────────────────────────────────────
async function loadProducts() {
  try {
    const d = await api('/api/products?take=25');
    $('#products-table').innerHTML = tableHtml(
      ['Nom', 'Catégorie', 'Achat', 'Vente', 'Marge', 'Statut'],
      d.items.map((p) => [
        p.name,
        p.category,
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

// ── Fournisseurs ───────────────────────────────────────────
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
      r.results.map((m) => [
        m.rank,
        m.supplier.name,
        m.supplier.country || '—',
        `${m.supplier.rating}/5`,
        `<b class="num">${m.breakdown.total}</b>`,
        m.offer ? `${m.offer.title} <span class="muted num">(${money(m.offer.unitPrice)})</span>` : '—',
      ]),
    );
    toast(`${r.results.length} fournisseurs classés`);
  } catch (e) {
    toast(e.message);
  } finally {
    busy(btn, false);
  }
});

// ── Commandes ──────────────────────────────────────────────
async function loadOrders() {
  try {
    const d = await api('/api/orders?take=30');
    $('#orders-table').innerHTML = tableHtml(
      ['N°', 'Client', 'Statut', 'Total', 'Créée'],
      d.items.map((o) => [
        o.orderNumber,
        o.customer?.name || '—',
        badge(o.status),
        `<span class="num">${money(o.total)}</span>`,
        new Date(o.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }),
      ]),
    );
  } catch (e) {
    toast(e.message);
  }
}
$('#refresh-orders').addEventListener('click', loadOrders);

const loaders = { dashboard: loadDashboard, market: loadMarket, products: loadProducts, orders: loadOrders };

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

// ── Rafraîchissement périodique (quand le pilote tourne) ───
setInterval(async () => {
  await refreshAutopilot();
  const active = document.querySelector('.tab.active')?.dataset.tab;
  if (active === 'dashboard') loadDashboard();
  if (active === 'orders') loadOrders();
}, 5000);

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

// ── Service worker ─────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ── Démarrage ──────────────────────────────────────────────
loadDashboard();
refreshAutopilot();

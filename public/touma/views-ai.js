/**
 * TOUMA — Intelligence : assistant acheteur, copilote vendeur, assistant
 * professionnel, agent d'administration.
 *
 * Ce n'est pas une fenêtre de discussion générique posée sur le site. Chaque
 * réponse est accompagnée de ce qui l'a produite : les outils appelés, les
 * cartes de produits réelles, et ce que l'assistant **n'a pas pu établir**.
 *
 * Deux choses sont dites à l'écran plutôt que tues :
 *
 * 1. **D'où vient la réponse.** Tant qu'aucun modèle de langage n'est
 *    configuré, ce sont des règles locales et des requêtes en base. L'écrire
 *    évite qu'un utilisateur croie parler à un modèle qui n'existe pas.
 * 2. **Ce qui manque.** Un délai de livraison non calculable, un vendeur sans
 *    historique, une caractéristique non saisie : chacun apparaît dans un bloc
 *    à part, au lieu d'être comblé par une phrase plausible.
 */
import { api, esc, formatDate, label, money, productImage, svg, toast } from './core.js';
import { breadcrumb } from './components.js';
import { t } from './i18n.js';

/** Carte produit (§63) : tout vient de l'API, rien n'est composé ici. */
function productCard(c) {
  const dispo =
    c.inStock === null ? t('ia.stockUnknown') : c.inStock ? t('ia.inStock') : t('ia.outOfStock');
  return `<a class="card" data-link href="/touma/produits/${esc(c.id)}" style="display:flex;gap:var(--space-3);align-items:center">
    <span class="cart-thumb" style="width:64px;height:64px;flex:0 0 auto">${productImage(c.image, c.title)}</span>
    <div style="flex:1;min-width:0">
      <div class="ellipsis"><strong>${esc(c.title)}</strong></div>
      <div dir="ltr"><strong>${esc(money(c.price, c.currency))}</strong></div>
      <div class="xs muted">
        ${c.store ? esc(c.store.name) : ''}
        ${c.store ? `<span class="badge">${esc(c.store.verified ? t('ia.verified') : t('ia.notVerified'))}</span>` : ''}
      </div>
      <div class="xs muted">
        ${esc(dispo)}
        · ${c.ratingCount > 0 ? esc(t('ia.rating', { rating: Number(c.rating).toFixed(1), count: c.ratingCount })) : esc(t('ia.noReviews'))}
      </div>
    </div>
  </a>`;
}

/** Carte fournisseur (§64). Ce que Touma ne mesure pas n'est pas affiché. */
function supplierCard(c) {
  return `<a class="card" data-link href="/touma/boutiques/${esc(c.id)}">
    <div class="row-between">
      <strong>${esc(c.name)}</strong>
      <span class="badge">${esc(c.verified ? t('ia.verified') : t('ia.notVerified'))}</span>
    </div>
    <div class="xs muted">${esc(c.countryCode ?? '')}</div>
    <div class="xs muted">
      ${esc(t('ia.supplierProducts', { count: c.activeProducts ?? 0 }))}
      ${c.minOrderQuantity ? `· ${esc(t('ia.supplierMoq', { count: c.minOrderQuantity }))}` : ''}
      ${c.trustLevel ? `· ${esc(t('ia.trustLevel', { level: t(`trust.level.${c.trustLevel}`) }))}` : `· ${esc(t('ia.trustUnpublished'))}`}
    </div>
  </a>`;
}

function sellerCard(c) {
  return `<div class="card">
    <div class="row-between">
      <strong>${esc(c.name)}</strong>
      <span class="badge">${esc(c.verified ? t('ia.verified') : t('ia.notVerified'))}</span>
    </div>
    <div class="xs muted">${esc(t('ia.trustLevel', { level: t(`trust.level.${c.trustLevel}`) }))}</div>
  </div>`;
}

function orderCard(c) {
  return `<a class="card" data-link href="/touma/compte/commandes/${esc(c.id)}">
    <div class="row-between">
      <strong dir="ltr">${esc(c.orderNumber)}</strong>
      <span class="badge">${esc(label(c.status))}</span>
    </div>
    <div class="xs muted" dir="ltr">${esc(money(c.total, c.currency))} · ${esc(formatDate(c.createdAt))}</div>
  </a>`;
}

/** Bloc de données brutes, réservé à l'administration. */
function dataCard(c) {
  return `<details class="card">
    <summary><strong>${esc(c.summary ?? c.tool)}</strong></summary>
    <pre class="xs" style="overflow:auto;max-height:18rem;white-space:pre-wrap">${esc(JSON.stringify(c.data, null, 2))}</pre>
  </details>`;
}

function renderCards(cards) {
  if (!cards || cards.length === 0) return '';
  return `<div class="stack" style="margin-top:var(--space-3)">${cards
    .map((c) => {
      if (c.type === 'PRODUCT') return productCard(c);
      if (c.type === 'SUPPLIER') return supplierCard(c);
      if (c.type === 'SELLER') return sellerCard(c);
      if (c.type === 'ORDER') return orderCard(c);
      if (c.type === 'DATA') return dataCard(c);
      return '';
    })
    .join('')}</div>`;
}

/**
 * Un tour de conversation.
 *
 * La trace des outils est repliée mais présente : §36 demande que les appels
 * soient auditables, et le premier public de cet audit est la personne dont on
 * vient de lire les données.
 */
export function renderTurn(question, reponse) {
  const outils =
    reponse.toolCalls && reponse.toolCalls.length > 0
      ? `<details class="xs muted" style="margin-top:var(--space-2)">
          <summary>${esc(t('ia.toolsTitle', { count: reponse.toolCalls.length }))}</summary>
          <ul style="margin:var(--space-2) 0 0;padding-inline-start:var(--space-4)">
            ${reponse.toolCalls
              .map((c) => `<li>${esc(c.tool)} — ${esc(c.ok ? t('ia.toolOk') : t('ia.toolFail'))} (${c.latencyMs} ms)</li>`)
              .join('')}
          </ul>
        </details>`
      : '';

  const manquant =
    reponse.unavailable && reponse.unavailable.length > 0
      ? `<div class="card" style="border-inline-start:3px solid var(--warning);margin-top:var(--space-3)">
          <strong class="small">${esc(t('ia.unavailableTitle'))}</strong>
          <ul class="xs muted" style="margin:var(--space-2) 0 0;padding-inline-start:var(--space-4)">
            ${reponse.unavailable.map((u) => `<li>${esc(u)}</li>`).join('')}
          </ul>
        </div>`
      : '';

  const confirmation = reponse.confirmation
    ? `<div class="card" style="border-inline-start:3px solid var(--danger);margin-top:var(--space-3)">
        <strong class="small">${esc(t('ia.confirmTitle'))}</strong>
        <p class="small">${esc(reponse.confirmation.summary)}</p>
        <p class="xs muted">${esc(t('ia.confirmExpires', { date: formatDate(reponse.confirmation.expiresAt, true) }))}</p>
        <div class="row" style="gap:var(--space-2)">
          <button class="btn btn-primary" data-ai-confirm="${esc(reponse.confirmation.id)}">${esc(t('ia.confirm'))}</button>
          <button class="btn" data-ai-reject="${esc(reponse.confirmation.id)}">${esc(t('ia.reject'))}</button>
        </div>
      </div>`
    : '';

  const suggestions =
    reponse.suggestions && reponse.suggestions.length > 0
      ? `<div class="row" style="gap:var(--space-2);flex-wrap:wrap;margin-top:var(--space-3)">
          ${reponse.suggestions.map((s) => `<button class="btn btn-sm" data-ai-suggest="${esc(s)}">${esc(s)}</button>`).join('')}
        </div>`
      : '';

  const retour = reponse.messageId
    ? `<div class="row xs muted" style="gap:var(--space-2);margin-top:var(--space-2);align-items:center">
        <span>${esc(t('ia.feedbackTitle'))}</span>
        <button class="btn btn-sm" data-ai-feedback="HELPFUL" data-message="${esc(reponse.messageId)}">${esc(t('ia.helpful'))}</button>
        <button class="btn btn-sm" data-ai-feedback="NOT_HELPFUL" data-message="${esc(reponse.messageId)}">${esc(t('ia.notHelpful'))}</button>
        <button class="btn btn-sm" data-ai-feedback="INCORRECT" data-message="${esc(reponse.messageId)}">${esc(t('ia.report'))}</button>
      </div>`
    : '';

  return `<div class="stack" style="margin-bottom:var(--space-5)">
    <div class="card" style="background:var(--surface-2)">
      <strong class="small">${esc(question)}</strong>
    </div>
    ${reponse.understood ? `<p class="xs muted">${esc(t('ia.understood', { understood: reponse.understood }))}</p>` : ''}
    <div class="card">
      <div class="small" style="white-space:pre-wrap">${esc(reponse.answer)}</div>
      ${renderCards(reponse.cards)}
    </div>
    ${confirmation}
    ${manquant}
    ${suggestions}
    ${retour}
    ${outils}
  </div>`;
}

/** Bandeau de provenance, affiché une fois en haut de chaque écran. */
function sourceBanner(provider) {
  return `<div class="card" style="border-inline-start:3px solid var(--accent)">
    <strong class="small">${esc(t('ia.sourceTitle'))}</strong>
    <p class="xs muted" style="margin:var(--space-1) 0 0">
      ${esc(provider.realProviderConfigured ? t('ia.sourceModel', { name: provider.name }) : t('ia.sourceRules'))}
    </p>
    <p class="xs muted" style="margin:var(--space-1) 0 0">${esc(t('ia.frenchOnly'))}</p>
  </div>`;
}

/** Ce que l'assistant ne fera jamais seul — affiché, pas enfoui (§41, §42). */
function boundaries(list) {
  return `<details class="card">
    <summary class="small"><strong>${esc(t('ia.neverAutomatic'))}</strong></summary>
    <p class="xs muted">${esc(t('ia.neverAutomaticBody'))}</p>
    <ul class="xs muted" style="margin:var(--space-2) 0 0;padding-inline-start:var(--space-4)">
      ${list.map((n) => `<li>${esc(n)}</li>`).join('')}
    </ul>
  </details>`;
}

function chatShell({ crumb, titre, intro, placeholder, endpoint, exemples, provider, capacites }) {
  return `${crumb}
  <h1>${esc(titre)}</h1>
  <p class="muted">${esc(intro)}</p>
  ${sourceBanner(provider)}
  <div id="ai-transcript" class="stack" style="margin-top:var(--space-4)"></div>
  <form id="ai-chat-form" class="card" data-endpoint="${esc(endpoint)}" style="margin-top:var(--space-4)">
    <label class="sr-only" for="ai-message">${esc(t('ia.messageLabel'))}</label>
    <textarea id="ai-message" name="message" rows="2" required maxlength="2000" placeholder="${esc(placeholder)}"></textarea>
    <button class="btn btn-primary" type="submit">${svg('send')} ${esc(t('ia.send'))}</button>
  </form>
  <div class="row" style="gap:var(--space-2);flex-wrap:wrap;margin-top:var(--space-3)">
    ${exemples.map((e) => `<button class="btn btn-sm" data-ai-suggest="${esc(e)}">${esc(e)}</button>`).join('')}
  </div>
  ${boundaries(capacites.neverAutomatic ?? [])}
  <details class="card">
    <summary class="small"><strong>${esc(t('ia.toolsAvailable', { count: (capacites.tools ?? []).length }))}</strong></summary>
    <ul class="xs muted" style="margin:var(--space-2) 0 0;padding-inline-start:var(--space-4)">
      ${(capacites.tools ?? []).map((o) => `<li><code>${esc(o.name)}</code> — ${esc(o.description)}</li>`).join('')}
    </ul>
  </details>`;
}

export async function aiChat() {
  const [provider, capacites] = await Promise.all([api('/ai/provider'), api('/ai/capabilities')]);
  return chatShell({
    crumb: breadcrumb([{ label: t('ia.nav') }]),
    titre: t('ia.title'),
    intro: t('ia.intro'),
    placeholder: t('ia.placeholder'),
    endpoint: '/ai/chat',
    exemples: [t('ia.ex.search'), t('ia.ex.orders'), t('ia.ex.spending'), t('ia.ex.reorder')],
    provider,
    capacites,
  });
}

export async function sellerAi() {
  const [provider, capacites, boutiques] = await Promise.all([api('/ai/provider'), api('/seller/ai/capabilities'), api('/stores/mine').catch(() => ({ items: [] }))]);
  const liste = boutiques.items ?? boutiques ?? [];
  const rappel =
    liste.length > 0
      ? `<p class="xs muted">${esc(t('ia.sellerStoreHint'))}</p>
         <div class="row" style="gap:var(--space-2);flex-wrap:wrap">
           ${liste.map((b) => `<button class="btn btn-sm" data-ai-suggest="${esc(t('ia.ex.sellerSales', { id: b.id }))}">${esc(b.name)}</button>`).join('')}
         </div>`
      : `<p class="xs muted">${esc(t('ia.sellerNoStore'))}</p>`;
  return `${chatShell({
    crumb: breadcrumb([{ label: t('seller.area'), href: '/touma/vendeur' }, { label: t('ia.nav') }]),
    titre: t('ia.sellerTitle'),
    intro: t('ia.sellerIntro'),
    placeholder: t('ia.sellerPlaceholder'),
    endpoint: '/seller/ai',
    exemples: [t('ia.ex.sellerStock'), t('ia.ex.sellerListing')],
    provider,
    capacites,
  })}${rappel}`;
}

export async function businessAi() {
  const [provider, capacites] = await Promise.all([api('/ai/provider'), api('/business/ai/capabilities')]);
  return chatShell({
    crumb: breadcrumb([{ label: t('biz.nav'), href: '/touma/business' }, { label: t('ia.nav') }]),
    titre: t('ia.businessTitle'),
    intro: t('ia.businessIntro'),
    placeholder: t('ia.businessPlaceholder'),
    endpoint: '/business/ai',
    exemples: [t('ia.ex.suppliers'), t('ia.ex.rfq')],
    provider,
    capacites,
  });
}

export async function adminAi() {
  const [provider, capacites, usage, qualite] = await Promise.all([
    api('/ai/provider'),
    api('/ai/capabilities'),
    api('/admin/ai/usage?days=30'),
    api('/admin/ai/quality?days=30'),
  ]);

  const tableau = `<div class="grid grid-3" style="margin-top:var(--space-4)">
    <div class="card"><div class="xs muted">${esc(t('ia.usageRequests'))}</div><strong dir="ltr">${usage.totals.requests}</strong></div>
    <div class="card"><div class="xs muted">${esc(t('ia.usageTokens'))}</div><strong dir="ltr">${usage.totals.inputTokens + usage.totals.outputTokens}</strong></div>
    <div class="card"><div class="xs muted">${esc(t('ia.usageCost'))}</div><strong dir="ltr">${esc(usage.totals.estimatedCost)}</strong></div>
    <div class="card"><div class="xs muted">${esc(t('ia.usageLatency'))}</div><strong dir="ltr">${usage.totals.avgLatencyMs} ms</strong></div>
    <div class="card"><div class="xs muted">${esc(t('ia.qualityToolFailures'))}</div><strong dir="ltr">${qualite.toolCalls.failed}/${qualite.toolCalls.total}</strong></div>
    <div class="card"><div class="xs muted">${esc(t('ia.qualityReports'))}</div><strong dir="ltr">${qualite.feedback.factualReports}</strong></div>
  </div>
  <p class="xs muted">${esc(usage.costDisclaimer)}</p>
  <details class="card">
    <summary class="small"><strong>${esc(t('ia.qualityByTool'))}</strong></summary>
    <table class="table xs">
      <thead><tr><th>${esc(t('ia.tool'))}</th><th>${esc(t('ia.calls'))}</th><th>${esc(t('ia.failures'))}</th><th>${esc(t('ia.latency'))}</th></tr></thead>
      <tbody>
        ${qualite.byTool
          .map((o) => `<tr><td><code>${esc(o.tool)}</code></td><td dir="ltr">${o.calls}</td><td dir="ltr">${o.failures}</td><td dir="ltr">${o.avgLatencyMs} ms</td></tr>`)
          .join('')}
      </tbody>
    </table>
  </details>`;

  return `${chatShell({
    crumb: breadcrumb([{ label: t('nav.admin'), href: '/touma/admin' }, { label: t('ia.nav') }]),
    titre: t('ia.adminTitle'),
    intro: t('ia.adminIntro'),
    placeholder: t('ia.adminPlaceholder'),
    endpoint: '/admin/ai/query',
    exemples: [t('ia.ex.adminProvinces'), t('ia.ex.adminPayments'), t('ia.ex.adminStock')],
    provider,
    capacites,
  })}${tableau}`;
}

/** Mes conversations, et ce que l'assistant a retenu de moi. */
export async function aiConversations() {
  const [liste, memoire] = await Promise.all([api('/ai/conversations'), api('/ai/memory')]);
  const conversations =
    liste.length === 0
      ? `<p class="muted">${esc(t('ia.noConversations'))}</p>`
      : `<div class="stack">${liste
          .map(
            (c) => `<a class="card" data-link href="/touma/ia/conversations/${esc(c.id)}">
              <div class="row-between"><strong>${esc(c.title ?? t('ia.untitled'))}</strong><span class="badge">${esc(t(`ia.surface.${c.surface}`))}</span></div>
              <div class="xs muted">${esc(formatDate(c.lastMessageAt, true))} · ${esc(t('ia.messageCount', { count: c._count.messages }))}</div>
            </a>`,
          )
          .join('')}</div>`;

  const items = memoire.items ?? [];
  const memoires =
    items.length === 0
      ? `<p class="xs muted">${esc(t('ia.memoryEmpty'))}</p>`
      : `<ul class="small" style="padding-inline-start:var(--space-4)">
          ${items
            .map((m) => `<li>${esc(t(`ia.memoryKey.${m.key}`) || m.key)} : <strong>${esc(m.value)}</strong> <span class="xs muted">${esc(t('ia.memoryExpires', { date: formatDate(m.expiresAt) }))}</span></li>`)
            .join('')}
        </ul>
        <button class="btn btn-sm" data-ai-forget="all">${esc(t('ia.memoryForget'))}</button>`;

  return `${breadcrumb([{ label: t('ia.nav'), href: '/touma/ia' }, { label: t('ia.conversations') }])}
    <h1>${esc(t('ia.conversations'))}</h1>
    ${conversations}
    <h2>${esc(t('ia.memoryTitle'))}</h2>
    <p class="xs muted">${esc(t('ia.memoryIntro'))}</p>
    ${memoires}`;
}

/** Une conversation passée, messages et trace d'outils. */
export async function aiConversation(params) {
  const c = await api(`/ai/conversations/${params.id}`);
  const messages = c.messages
    .map(
      (m) => `<div class="card" style="${m.role === 'USER' ? 'background:var(--surface-2)' : ''}">
        <div class="xs muted">${esc(t(`ia.role.${m.role}`))} · ${esc(formatDate(m.createdAt, true))}</div>
        <div class="small" style="white-space:pre-wrap">${esc(m.content)}</div>
        ${renderCards(Array.isArray(m.attachments) ? m.attachments : [])}
      </div>`,
    )
    .join('');

  const outils =
    c.toolCalls.length === 0
      ? ''
      : `<details class="card">
          <summary class="small"><strong>${esc(t('ia.toolsTitle', { count: c.toolCalls.length }))}</strong></summary>
          <ul class="xs muted" style="margin:var(--space-2) 0 0;padding-inline-start:var(--space-4)">
            ${c.toolCalls
              .map((a) => `<li><code>${esc(a.tool)}</code> (${esc(a.riskLevel)}) — ${esc(a.ok ? a.summary ?? t('ia.toolOk') : a.error ?? t('ia.toolFail'))}</li>`)
              .join('')}
          </ul>
        </details>`;

  return `${breadcrumb([{ label: t('ia.nav'), href: '/touma/ia' }, { label: t('ia.conversations'), href: '/touma/ia/conversations' }, { label: c.title ?? t('ia.untitled') }])}
    <h1>${esc(c.title ?? t('ia.untitled'))}</h1>
    <div class="stack">${messages}</div>
    ${outils}
    <button class="btn btn-danger btn-sm" data-ai-delete="${esc(c.id)}">${esc(t('ia.deleteConversation'))}</button>`;
}

/** Actions en attente de ma confirmation. */
export async function aiConfirmations() {
  const items = await api('/ai/confirmations');
  if (items.length === 0) {
    return `${breadcrumb([{ label: t('ia.nav'), href: '/touma/ia' }, { label: t('ia.confirmations') }])}
      <h1>${esc(t('ia.confirmations'))}</h1>
      <p class="muted">${esc(t('ia.noConfirmations'))}</p>`;
  }
  return `${breadcrumb([{ label: t('ia.nav'), href: '/touma/ia' }, { label: t('ia.confirmations') }])}
    <h1>${esc(t('ia.confirmations'))}</h1>
    <p class="muted">${esc(t('ia.confirmationsIntro'))}</p>
    <div class="stack">
      ${items
        .map(
          (c) => `<div class="card">
            <div class="row-between"><strong>${esc(c.summary)}</strong><span class="badge">${esc(c.riskLevel)}</span></div>
            <pre class="xs" style="white-space:pre-wrap">${esc(JSON.stringify(c.parameters, null, 2))}</pre>
            <p class="xs muted">${esc(t('ia.confirmExpires', { date: formatDate(c.expiresAt, true) }))}</p>
            <div class="row" style="gap:var(--space-2)">
              <button class="btn btn-primary btn-sm" data-ai-confirm="${esc(c.id)}">${esc(t('ia.confirm'))}</button>
              <button class="btn btn-sm" data-ai-reject="${esc(c.id)}">${esc(t('ia.reject'))}</button>
            </div>
          </div>`,
        )
        .join('')}
    </div>`;
}

/** Signale une réponse. Exporté pour que le shell y branche ses boutons. */
export async function sendFeedback(messageId, verdict) {
  await api('/ai/feedback', { method: 'POST', body: { messageId, verdict } });
  toast(t('ia.reportSent'), 'success');
}

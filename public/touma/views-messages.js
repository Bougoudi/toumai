/**
 * Messagerie commerciale TOUMA.
 *
 * Ce n'est pas une messagerie instantanée : c'est un outil de négociation. Un
 * fournisseur qui ouvre un fil doit comprendre en trois secondes **qui** le
 * contacte, **pour quoi**, **combien** et **quelle est la prochaine action**.
 * D'où le contexte permanent en en-tête, les cartes d'offre dans le fil, et
 * les raccourcis qui posent les bonnes questions commerciales.
 */
import { api, esc, formatDate, emptyState, money, session, svg } from './core.js';
import { breadcrumb } from './components.js';
import { t } from './i18n.js';

const KIND_ICON = { BUYER_SELLER: 'inbox', RFQ: 'chart', QUOTE: 'chart', ORDER: 'box', SUPPORT: 'alert' };

/**
 * Type de fil. Un type inconnu du serveur retombe sur « Conversation » plutôt
 * que d'afficher son code : c'est le même principe que la traduction, une
 * valeur inattendue ne doit pas se retrouver telle quelle à l'écran.
 */
const typeDeFil = (kind) => {
  const cle = `msg.kind.${kind}`;
  const libelle = t(cle);
  return libelle === cle ? t('msg.kind.fallback') : libelle;
};

/** Filtres de la boîte de réception : ce que l'on cherche vraiment. */
const FILTERS = [
  { code: '', cle: 'msg.filter.all' },
  { code: 'unread', cle: 'msg.filter.unread' },
  { code: 'RFQ', cle: 'msg.filter.rfq' },
  { code: 'QUOTE', cle: 'msg.filter.quotes' },
  { code: 'ORDER', cle: 'msg.filter.orders' },
];

/** Taille d'un fichier joint, dite comme on la dit à quelqu'un. */
const tailleFichier = (bytes) =>
  bytes > 1024 * 1024
    ? t('unit.mb', { value: (bytes / (1024 * 1024)).toFixed(1) })
    : t('unit.kb', { value: Math.max(1, Math.round(bytes / 1024)) });

function filterQuery(params) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.filter === 'unread') search.set('unread', '1');
  else if (params.filter) search.set('kind', params.filter);
  return search;
}

/** Barre de recherche et de filtres, commune aux trois espaces. */
function toolbar(base, { q = '', filter = '' } = {}) {
  return `
    <form class="conv-search" id="conv-search" data-base="${esc(base)}" role="search">
      <label class="sr-only" for="conv-q">${esc(t('msg.searchLabel'))}</label>
      <input id="conv-q" name="q" type="search" value="${esc(q)}" placeholder="${esc(t('msg.searchPlaceholder'))}" />
      <button class="btn btn-secondary btn-sm" type="submit">${svg('search')} ${esc(t('search.submit'))}</button>
    </form>
    <div class="chip-row" role="tablist" aria-label="${esc(t('msg.filterAria'))}">
      ${FILTERS.map((f) => {
        const search = new URLSearchParams();
        if (q) search.set('q', q);
        if (f.code) search.set('filter', f.code);
        const href = `${base}${search.toString() ? `?${search}` : ''}`;
        return `<a class="chip${filter === f.code ? ' chip-active' : ''}" href="${esc(href)}" data-link role="tab" aria-selected="${filter === f.code}">${esc(t(f.cle))}</a>`;
      }).join('')}
    </div>`;
}

/** Une ligne de la liste : contexte d'abord, dernier message ensuite. */
function conversationRow(c, base, activeId) {
  const context =
    (c.quote
      ? esc(t('msg.ctxQuote', { reference: c.quote.reference, total: money(c.quote.total, c.quote.currency) }))
      : null) ??
    (c.rfq ? esc(t('msg.ctxRfq', { title: c.rfq.title })) : null) ??
    (c.order ? esc(t('msg.ctxOrder', { number: c.order.orderNumber })) : null) ??
    (c.store ? esc(c.store.name) : '');

  return `
    <a class="conv-row${c.id === activeId ? ' conv-row-active' : ''}" href="${base}/${esc(c.id)}" data-link aria-current="${c.id === activeId ? 'page' : 'false'}">
      <span class="conv-row-icon" aria-hidden="true">${svg(KIND_ICON[c.kind] ?? 'inbox')}</span>
      <span class="conv-row-main">
        <span class="conv-row-top">
          <strong>${esc(c.title)}</strong>
          <span class="xs muted">${formatDate(c.lastMessageAt, true)}</span>
        </span>
        <span class="xs muted conv-row-context">${context}</span>
        ${
          c.lastMessage
            ? `<span class="small conv-row-preview">${c.lastMessage.mine ? esc(t('msg.youPrefix')) : ''}${esc(c.lastMessage.body)}</span>`
            : `<span class="small muted">${esc(t('msg.noMessage'))}</span>`
        }
      </span>
      ${c.unreadCount ? `<span class="conv-unread" aria-label="${esc(t('msg.unreadAria', { count: c.unreadCount }))}">${c.unreadCount}</span>` : ''}
    </a>`;
}

/** Liste latérale, partagée par la boîte de réception et le fil ouvert. */
async function conversationList(base, { q = '', filter = '', activeId = null } = {}) {
  const search = filterQuery({ q, filter });
  const data = await api(`/conversations${search.toString() ? `?${search}` : ''}`);
  if (data.items.length === 0) {
    return `<p class="muted small" style="padding:var(--space-4)">${esc(t(q || filter ? 'msg.noMatch' : 'msg.noneYet'))}</p>`;
  }
  return `<div class="conv-list">${data.items.map((c) => conversationRow(c, base, activeId)).join('')}</div>`;
}

// ── Boîte de réception ──────────────────────────────────────────────────────

async function inboxFor(base, title, searchParams) {
  const q = searchParams?.get('q') ?? '';
  const filter = searchParams?.get('filter') ?? '';
  const list = await conversationList(base, { q, filter });

  return `
    ${breadcrumb([{ label: t('nav.home'), href: '/touma/' }, { label: title }])}
    <div class="row-between" style="margin-bottom:var(--space-3)">
      <h1 style="font-size:var(--text-xl);margin:0">${esc(title)}</h1>
      <a class="btn btn-secondary btn-sm" href="/touma/messages/reglages" data-link>${svg('user')} ${esc(t('msg.preferences'))}</a>
    </div>
    <div class="messaging">
      <aside class="messaging-side" aria-label="${esc(t('msg.conversationsAria'))}">
        ${toolbar(base, { q, filter })}
        ${list}
      </aside>
      <section class="messaging-main messaging-empty">
        ${emptyState({
          title: t('msg.pickTitle'),
          body: t('msg.pickBody'),
          actionLabel: t('msg.pickAction'),
          actionHref: '/touma/sourcing',
          iconName: 'inbox',
        })}
      </section>
    </div>`;
}

export async function inbox(_params, searchParams) {
  return inboxFor('/touma/messages', t('msg.inbox'), searchParams);
}

export async function businessInbox(_params, searchParams) {
  return inboxFor('/touma/business/messages', t('msg.businessInbox'), searchParams);
}

export async function sellerInbox(_params, searchParams) {
  // Le vendeur garde la navigation de son espace : la messagerie en fait
  // partie, elle n'est pas une application à côté.
  const { tabs } = await import('./views-seller.js');
  return `${tabs('/touma/vendeur/messages')}${await inboxFor('/touma/vendeur/messages', t('msg.sellerInbox'), searchParams)}`;
}

// ── Fil de discussion ───────────────────────────────────────────────────────

/** Carte d'offre : ce que l'acheteur doit lire avant de décider. */
function offerCard(message, currency) {
  const o = message.offer;
  const lines = Array.isArray(o?.items) ? o.items : [];
  const meta = message.metadata ?? {};
  const total = o?.total ?? meta.total;
  const shipping = o?.shipping ?? meta.shipping;
  const itemsTotal = o?.itemsTotal ?? meta.itemsTotal;
  const leadTime = o?.leadTimeDays ?? meta.leadTimeDays;
  const expires = o?.expiresAt ?? meta.validUntil;
  const cur = currency ?? meta.currency ?? 'XAF';

  return `
    <article class="offer-card${o?.expired ? ' offer-card-expired' : ''}">
      <header class="row-between">
        <strong>${esc(
          t(message.type === 'QUOTE' ? 'msg.offerCommercial' : message.mine ? 'msg.offerYours' : 'msg.offerReceived'),
        )}</strong>
        ${o?.expired ? `<span class="badge badge-cross">${esc(t('msg.expired'))}</span>` : ''}
      </header>
      ${lines.length
        ? `<div class="table-scroll"><table class="offer-lines"><tbody>
            ${lines
              .map(
                (l) => `<tr>
                  <td>${esc(l.name)}</td>
                  <td class="num">${esc(String(l.quantity))} ${esc(l.unit ?? '')}</td>
                  <td class="num">${money(l.unitPrice, cur)}</td>
                  <td class="num"><strong>${money(l.lineTotal, cur)}</strong></td>
                </tr>`,
              )
              .join('')}
          </tbody></table></div>`
        : ''}
      <dl class="offer-figures">
        ${itemsTotal ? `<div><dt>${esc(t('msg.subtotal'))}</dt><dd>${money(itemsTotal, cur)}</dd></div>` : ''}
        ${shipping ? `<div><dt>${esc(t('msg.shipping'))}</dt><dd>${money(shipping, cur)}</dd></div>` : ''}
        ${leadTime ? `<div><dt>${esc(t('msg.leadTime'))}</dt><dd>${esc(t('msg.days', { count: leadTime }))}</dd></div>` : ''}
        ${expires ? `<div><dt>${esc(t('msg.validUntil'))}</dt><dd>${formatDate(expires)}</dd></div>` : ''}
        ${total ? `<div class="offer-total"><dt>${esc(t('msg.total'))}</dt><dd>${money(total, cur)}</dd></div>` : ''}
      </dl>
    </article>`;
}

function attachmentLink(a) {
  return `<a class="attachment" href="${esc(a.url)}" rel="noopener noreferrer" target="_blank" download>
      ${svg('inbox')} <span>${esc(a.name)}</span> <span class="xs muted">${esc(tailleFichier(a.sizeBytes))}</span>
    </a>`;
}

function messageBubble(m, currency) {
  if (m.type === 'SYSTEM') {
    return `<div class="msg-system" role="note">${svg('shield')} ${esc(m.body)} <span class="xs muted">${formatDate(m.createdAt, true)}</span></div>`;
  }

  const isOffer = ['OFFER', 'COUNTER_OFFER', 'QUOTE'].includes(m.type);
  return `
    <article class="msg${m.mine ? ' msg-mine' : ''}" data-message="${esc(m.id)}" tabindex="0">
      <header class="msg-head">
        <strong>${esc(m.mine ? t('msg.you') : (m.author?.name ?? 'TOUMA'))}</strong>
        <time class="xs muted" datetime="${esc(m.createdAt)}">${formatDate(m.createdAt, true)}</time>
        ${m.editedAt ? `<span class="xs muted">${esc(t('msg.edited'))}</span>` : ''}
      </header>
      ${m.replyTo
        ? `<blockquote class="msg-quote"><strong>${esc(m.replyTo.author)}</strong><span>${esc(m.replyTo.body)}</span></blockquote>`
        : ''}
      ${m.deleted ? `<p class="msg-deleted"><em>${esc(t('msg.deleted'))}</em></p>` : `<p class="msg-body">${esc(m.body)}</p>`}
      ${isOffer ? offerCard(m, currency) : ''}
      ${m.attachments?.length ? `<div class="attachment-row">${m.attachments.map(attachmentLink).join('')}</div>` : ''}
      ${m.deleted
        ? ''
        : `<div class="msg-actions">
            <button class="link-btn xs" data-action="reply-message" data-id="${esc(m.id)}" data-author="${esc(
              m.mine ? t('msg.you') : (m.author?.name ?? 'TOUMA'),
            )}" data-body="${esc(m.body.slice(0, 120))}">${esc(t('msg.reply'))}</button>
            ${m.editable ? `<button class="link-btn xs" data-action="edit-message" data-id="${esc(m.id)}">${esc(t('msg.edit'))}</button>` : ''}
            ${m.mine && ['TEXT', 'ATTACHMENT'].includes(m.type) ? `<button class="link-btn xs" data-action="delete-message" data-id="${esc(m.id)}">${esc(t('msg.delete'))}</button>` : ''}
            ${m.mine ? '' : `<button class="link-btn xs" data-action="report-message" data-id="${esc(m.id)}">${esc(t('msg.report'))}</button>`}
          </div>`}
    </article>`;
}

/** Rendu d'une série de messages, réutilisé au chargement de l'historique. */
export function messagesHtml(items, currency) {
  return items.map((m) => messageBubble(m, currency)).join('');
}

/** En-tête du fil : le contexte commercial, toujours visible. */
function threadHeader(data, negotiation) {
  const chips = [];
  if (data.store) chips.push(`<a class="chip" href="/touma/boutiques/${esc(data.store.slug)}" data-link>${svg('store')} ${esc(data.store.name)}</a>`);
  if (data.store?.countryCode) chips.push(`<span class="chip">${esc(data.store.countryCode)}</span>`);
  if (data.store?.verificationStatus === 'APPROVED') chips.push(`<span class="chip chip-verified">${svg('shield')} ${esc(t('msg.verified'))}</span>`);
  if (data.rfq) chips.push(`<a class="chip" href="/touma/business/appels-offres/${esc(data.rfq.id)}" data-link>${svg('chart')} ${esc(data.rfq.reference)}</a>`);
  if (data.quote)
    chips.push(
      `<a class="chip" href="/touma/negociations/${esc(data.quote.id)}" data-link>${svg('chart')} ${esc(
        t('msg.offerChip', { reference: data.quote.reference }),
      )}</a>`,
    );
  if (data.order) chips.push(`<a class="chip" href="/touma/commandes/${esc(data.order.id)}" data-link>${svg('box')} ${esc(data.order.orderNumber)}</a>`);

  const presence = data.participants.map((p) => `${esc(p.name)}${p.presence === 'ONLINE' ? esc(t('msg.online')) : ''}`).join(', ');

  return `
    <header class="thread-head">
      <div class="row-between">
        <div style="min-width:0">
          <p class="xs muted" style="margin:0">${esc(typeDeFil(data.kind))}</p>
          <h1 style="font-size:var(--text-lg);margin:2px 0">${esc(data.title)}</h1>
          <p class="small muted" style="margin:0">${presence || esc(t('msg.defaultPresence'))}</p>
        </div>
        <div class="thread-head-actions">
          <button class="btn btn-secondary btn-sm" data-action="toggle-mute" data-id="${esc(data.id)}" data-muted="${data.muted}">${esc(
            t(data.muted ? 'msg.muteOff' : 'msg.muteOn'),
          )}</button>
          <button class="btn btn-secondary btn-sm" data-action="toggle-archive" data-id="${esc(data.id)}" data-archived="${data.archived}">${esc(
            t(data.archived ? 'msg.unarchive' : 'msg.archive'),
          )}</button>
        </div>
      </div>
      ${chips.length ? `<div class="chip-row">${chips.join('')}</div>` : ''}
      ${negotiation ? negotiationBar(negotiation) : ''}
    </header>`;
}

/**
 * Statut d'une offre. Il s'affichait tel quel — « SUBMITTED » en travers de
 * l'écran d'un acheteur : une constante technique n'est pas un libellé, et la
 * règle vaut dans les deux langues.
 */
const statutOffre = (code) => t(`quote.status.${code}`);

/** Bandeau d'action de négociation : la prochaine étape, jamais ambiguë. */
function negotiationBar(n) {
  const actions = [];
  if (n.permissions.canAccept)
    actions.push(`<a class="btn btn-sm" href="/touma/negociations/${esc(n.id)}" data-link>${esc(t('msg.acceptOffer'))}</a>`);
  if (n.permissions.canApplyProposal)
    actions.push(`<button class="btn btn-sm" data-action="apply-proposal" data-id="${esc(n.id)}">${esc(t('msg.applyProposal'))}</button>`);
  if (n.permissions.canCounter)
    actions.push(`<a class="btn btn-secondary btn-sm" href="/touma/negociations/${esc(n.id)}" data-link>${esc(t('msg.counter'))}</a>`);
  if (n.permissions.canReject)
    actions.push(`<button class="btn btn-secondary btn-sm" data-action="reject-offer" data-id="${esc(n.id)}">${esc(t('msg.rejectOffer'))}</button>`);

  return `
    <div class="negotiation-bar">
      <div>
        <span class="badge">${esc(statutOffre(n.status))}</span>
        <strong>${money(n.total, n.currency)}</strong>
        <span class="small muted">${esc(t('msg.leadLine', { days: n.leadTimeDays }))}${esc(
          n.expired ? t('msg.offerExpired') : t('msg.validUntilInline', { date: formatDate(n.validUntil) }),
        )}</span>
      </div>
      ${actions.length ? `<div class="row" style="gap:var(--space-2);flex-wrap:wrap">${actions.join('')}</div>` : ''}
    </div>`;
}

/** Raccourcis commerciaux : poser la bonne question d'un clic. */
function composer(data, templates) {
  if (!data.canWrite) {
    return `<p class="muted small thread-closed">${esc(t(data.status === 'BLOCKED' ? 'msg.blocked' : 'msg.closed'))}</p>`;
  }

  const shortcuts = templates?.shortcuts ?? [];
  const saved = templates?.saved ?? [];
  return `
    <form id="message-form" class="composer" data-conversation="${esc(data.id)}">
      <div class="chip-row composer-shortcuts">
        ${shortcuts
          .map((s) => `<button type="button" class="chip" data-action="use-template" data-content="${esc(s.content)}">${esc(s.label)}</button>`)
          .join('')}
        ${saved.map((s) => `<button type="button" class="chip" data-action="use-template" data-content="${esc(s.content)}">${esc(s.title)}</button>`).join('')}
      </div>
      <div id="reply-banner" class="reply-banner" hidden>
        <span></span>
        <button type="button" class="link-btn xs" data-action="cancel-reply">${esc(t('msg.cancelReply'))}</button>
      </div>
      <div class="composer-row">
        <label class="sr-only" for="m-body">${esc(t('msg.yourMessage'))}</label>
        <textarea id="m-body" rows="2" maxlength="4000" required placeholder="${esc(t('msg.composerPlaceholder'))}"></textarea>
        <div class="composer-buttons">
          <label class="btn btn-secondary btn-sm attach-btn">
            ${svg('inbox')} <span class="sr-only">${esc(t('msg.attach'))}</span>
            <input type="file" id="m-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.csv" hidden />
          </label>
          <button class="btn btn-sm" type="submit">${esc(t('msg.send'))}</button>
        </div>
      </div>
      <p class="xs muted" style="margin:var(--space-1) 0 0">${esc(t('msg.formats'))}</p>
    </form>`;
}

async function threadFor(base, params, searchParams) {
  const data = await api(`/conversations/${params.id}`);

  // Le contexte de négociation n'est chargé que s'il existe réellement.
  const [negotiation, templates] = await Promise.all([
    data.quote ? api(`/negotiations/${data.quote.id}`).catch(() => null) : Promise.resolve(null),
    api('/messaging/templates').catch(() => null),
  ]);

  const list = await conversationList(base, { q: searchParams?.get('q') ?? '', filter: searchParams?.get('filter') ?? '', activeId: data.id });
  const currency = data.quote?.currency ?? data.order?.currency ?? null;

  return `
    <div class="messaging messaging-thread">
      <aside class="messaging-side" aria-label="${esc(t('msg.conversationsAria'))}">
        ${toolbar(base, { q: searchParams?.get('q') ?? '', filter: searchParams?.get('filter') ?? '' })}
        ${list}
      </aside>
      <section class="messaging-main" aria-label="${esc(t('msg.conversationAria'))}">
        <a class="btn btn-secondary btn-sm thread-back" href="${base}" data-link>${svg('arrow-left')} ${esc(t('msg.backToList'))}</a>
        ${threadHeader(data, negotiation)}
        <div class="thread-scroll" id="thread-scroll" data-conversation="${esc(data.id)}">
          ${data.hasMore ? `<button class="btn btn-secondary btn-sm" data-action="load-older" data-conversation="${esc(data.id)}" data-cursor="${esc(data.olderCursor ?? '')}">${esc(t('msg.loadOlder'))}</button>` : ''}
          <div id="thread-messages">
            ${data.messages.length
              ? data.messages.map((m) => messageBubble(m, currency)).join('')
              : `<p class="muted small">${esc(t('msg.firstMessage'))}</p>`}
          </div>
        </div>
        ${composer(data, templates)}
      </section>
    </div>`;
}

export async function thread(params, searchParams) {
  return threadFor('/touma/messages', params, searchParams);
}

export async function businessThread(params, searchParams) {
  return threadFor('/touma/business/messages', params, searchParams);
}

export async function sellerThread(params, searchParams) {
  return threadFor('/touma/vendeur/messages', params, searchParams);
}

// ── Page de négociation ─────────────────────────────────────────────────────

function timelineEntry(entry, currency) {
  const label = t(
    entry.kind === 'COUNTER_OFFER'
      ? entry.side === 'BUYER'
        ? 'nego.counterBuyer'
        : 'nego.counterSeller'
      : entry.kind === 'ACCEPT'
        ? 'nego.accept'
        : entry.kind === 'REJECT'
          ? 'nego.reject'
          : 'nego.message',
  );

  return `
    <li class="timeline-entry" data-side="${esc(entry.side)}">
      <div class="timeline-when">
        <time datetime="${esc(entry.createdAt)}">${formatDate(entry.createdAt, true)}</time>
        <span class="xs muted">${esc(entry.author?.name ?? 'TOUMA')}</span>
      </div>
      <div class="timeline-body">
        <strong>${esc(label)}</strong>
        ${entry.total ? `<span class="timeline-total">${money(entry.total, currency)}</span>` : ''}
        <p class="small" style="margin:var(--space-1) 0 0">${esc(entry.body)}</p>
        ${Array.isArray(entry.items) && entry.items.length
          ? `<ul class="xs muted timeline-lines">${entry.items
              .map((l) => `<li>${esc(l.name)} — ${esc(String(l.quantity))} ${esc(l.unit ?? '')} × ${money(l.unitPrice, currency)}</li>`)
              .join('')}</ul>`
          : ''}
        ${entry.expiresAt ? `<p class="xs muted" style="margin:2px 0 0">${esc(t('nego.validUntilLine', { date: formatDate(entry.expiresAt) }))}</p>` : ''}
      </div>
    </li>`;
}

/** Formulaire de contre-offre : le total est calculé par le serveur. */
function counterForm(n) {
  const lines = n.items.length ? n.items : [{ name: '', quantity: 1, unit: t('nego.unitDefault'), unitPrice: '0' }];
  return `
    <form id="counter-form" class="card" data-negotiation="${esc(n.id)}" data-currency="${esc(n.currency)}">
      <h2 style="font-size:var(--text-base)">${esc(t(session.isSeller ? 'nego.reviseTitle' : 'nego.counterTitle'))}</h2>
      <p class="small muted">${esc(t('nego.counterHint'))}</p>
      <div id="counter-lines">
        ${lines.map((l, i) => counterLine(l, i)).join('')}
      </div>
      <button type="button" class="btn btn-secondary btn-sm" data-action="add-counter-line">${esc(t('nego.addLine'))}</button>

      <div class="form-grid" style="margin-top:var(--space-3)">
        <div class="field">
          <label for="c-shipping">${esc(t('nego.shippingField', { currency: n.currency }))}</label>
          <input id="c-shipping" type="text" inputmode="decimal" value="${esc(n.shippingTotal)}" />
        </div>
        <div class="field">
          <label for="c-lead">${esc(t('nego.leadField'))}</label>
          <input id="c-lead" type="number" min="1" max="365" value="${esc(String(n.leadTimeDays))}" />
        </div>
        <div class="field">
          <label for="c-validity">${esc(t('nego.validityField'))}</label>
          <input id="c-validity" type="number" min="1" max="120" placeholder="30" />
        </div>
      </div>
      <div class="field">
        <label for="c-note">${esc(t('nego.noteField'))}</label>
        <textarea id="c-note" rows="2" maxlength="2000" placeholder="${esc(t('nego.notePlaceholder'))}"></textarea>
      </div>
      <p class="small"><strong>${esc(t('nego.estimatedTotal'))}</strong> <span id="counter-total">—</span> <span class="xs muted">${esc(
        t('nego.recomputed'),
      )}</span></p>
      <button class="btn" type="submit">${esc(t('nego.sendProposal'))}</button>
    </form>`;
}

function counterLine(line, index) {
  return `
    <div class="counter-line" data-index="${index}">
      <div class="field">
        <label class="sr-only" for="cl-name-${index}">${esc(t('nego.designation'))}</label>
        <input id="cl-name-${index}" class="cl-name" type="text" value="${esc(line.name ?? '')}" placeholder="${esc(t('nego.designation'))}" required />
      </div>
      <div class="field">
        <label class="sr-only" for="cl-qty-${index}">${esc(t('nego.quantity'))}</label>
        <input id="cl-qty-${index}" class="cl-qty" type="number" min="1" value="${esc(String(line.quantity ?? 1))}" required />
      </div>
      <div class="field">
        <label class="sr-only" for="cl-unit-${index}">${esc(t('nego.unit'))}</label>
        <input id="cl-unit-${index}" class="cl-unit" type="text" value="${esc(line.unit ?? t('nego.unitDefault'))}" required />
      </div>
      <div class="field">
        <label class="sr-only" for="cl-price-${index}">${esc(t('nego.unitPrice'))}</label>
        <input id="cl-price-${index}" class="cl-price" type="text" inputmode="decimal" value="${esc(String(line.unitPrice ?? '0'))}" required />
      </div>
      <button type="button" class="link-btn xs" data-action="remove-counter-line">${esc(t('nego.removeLine'))}</button>
    </div>`;
}

export async function negotiation(params) {
  const n = await api(`/negotiations/${params.id}`);
  const addresses = n.permissions.canAccept ? await api('/auth/me/addresses').catch(() => ({ items: [] })) : { items: [] };

  return `
    ${breadcrumb([
      { label: t('nego.crumbBusiness'), href: '/touma/business' },
      { label: t('nego.crumbNegotiations'), href: '/touma/messages?filter=QUOTE' },
      { label: n.reference },
    ])}

    <div class="row-between" style="margin-bottom:var(--space-4)">
      <div>
        <h1 style="font-size:var(--text-xl);margin:0">${esc(t('nego.title', { reference: n.reference }))}</h1>
        <p class="small muted" style="margin:2px 0 0">${esc(n.rfq.title)} · ${esc(n.store.name)} (${esc(n.store.countryCode)})</p>
      </div>
      ${
        n.conversationId
          ? `<a class="btn btn-secondary btn-sm" href="/touma/messages/${esc(n.conversationId)}" data-link>${svg('inbox')} ${esc(
              t('nego.openConversation'),
            )}</a>`
          : ''
      }
    </div>

    <div class="card">
      <div class="row-between">
        <div>
          <span class="badge">${esc(statutOffre(n.status))}</span>
          ${n.expired ? `<span class="badge badge-cross">${esc(t('msg.expired'))}</span>` : ''}
        </div>
        <div class="xs muted">${esc(t('nego.validUntilShort', { date: formatDate(n.validUntil) }))}</div>
      </div>
      <div class="table-scroll" style="margin-top:var(--space-3)">
      <table class="offer-lines">
        <thead><tr><th>${esc(t('nego.designation'))}</th><th class="num">${esc(t('nego.quantity'))}</th><th class="num">${esc(
          t('nego.unitPrice'),
        )}</th><th class="num">${esc(t('nego.lineTotal'))}</th></tr></thead>
        <tbody>
          ${n.items
            .map(
              (i) => `<tr>
                <td>${esc(i.name)}</td>
                <td class="num">${esc(String(i.quantity))} ${esc(i.unit)}</td>
                <td class="num">${money(i.unitPrice, n.currency)}</td>
                <td class="num"><strong>${money(i.lineTotal, n.currency)}</strong></td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      </div>
      <dl class="offer-figures">
        <div><dt>${esc(t('msg.subtotal'))}</dt><dd>${money(n.itemsTotal, n.currency)}</dd></div>
        <div><dt>${esc(t('msg.shipping'))}</dt><dd>${money(n.shippingTotal, n.currency)}</dd></div>
        <div><dt>${esc(t('msg.leadTime'))}</dt><dd>${esc(t('msg.days', { count: n.leadTimeDays }))}</dd></div>
        <div class="offer-total"><dt>${esc(t('msg.total'))}</dt><dd>${money(n.total, n.currency)}</dd></div>
      </dl>

      <div class="row" style="gap:var(--space-2);flex-wrap:wrap;margin-top:var(--space-3)">
        ${n.permissions.canApplyProposal
          ? `<button class="btn" data-action="apply-proposal" data-id="${esc(n.id)}">${esc(t('msg.applyProposal'))}</button>`
          : ''}
        ${n.permissions.canReject ? `<button class="btn btn-secondary" data-action="reject-offer" data-id="${esc(n.id)}">${esc(t('msg.rejectOffer'))}</button>` : ''}
      </div>
    </div>

    ${n.permissions.canAccept
      ? `<form id="accept-offer-form" class="card" data-negotiation="${esc(n.id)}">
          <h2 style="font-size:var(--text-base)">${esc(t('nego.acceptTitle'))}</h2>
          <p class="small muted">${esc(t('nego.acceptHint', { total: money(n.total, n.currency) }))}</p>
          <div class="field">
            <label for="a-address">${esc(t('nego.addressLabel'))}</label>
            <select id="a-address" required>
              ${(addresses.items ?? [])
                .map((a) => `<option value="${esc(a.id)}">${esc(a.fullName)} — ${esc(a.line1)}, ${esc(a.city)} (${esc(a.countryCode)})</option>`)
                .join('')}
            </select>
          </div>
          ${(addresses.items ?? []).length === 0
            ? `<p class="small muted">${esc(t('nego.needAddress'))}</p>`
            : `<button class="btn" type="submit">${esc(t('msg.acceptOffer'))}</button>`}
        </form>`
      : ''}

    ${n.permissions.canCounter ? counterForm(n) : ''}

    <section class="card">
      <h2 style="font-size:var(--text-base)">${esc(t('nego.timeline'))}</h2>
      ${n.timeline.length
        ? `<ol class="timeline">${n.timeline.map((e) => timelineEntry(e, n.currency)).join('')}</ol>`
        : `<p class="muted small">${esc(t('nego.noExchange'))}</p>`}
    </section>`;
}

// ── Préférences de notification et blocages ─────────────────────────────────

const categorieLabel = (code) => t(`prefs.category.${code}`);

export async function settings() {
  const [prefs, blocks, templates] = await Promise.all([
    api('/messaging/preferences'),
    api('/messaging/blocks'),
    api('/messaging/templates'),
  ]);

  return `
    ${breadcrumb([{ label: t('msg.inbox'), href: '/touma/messages' }, { label: t('prefs.crumb') }])}
    <h1 style="font-size:var(--text-xl)">${esc(t('prefs.title'))}</h1>

    <section class="card">
      <h2 style="font-size:var(--text-base)">${esc(t('prefs.notifications'))}</h2>
      ${prefs.emailAvailable ? '' : `<p class="small muted">${esc(t('prefs.noEmailSender'))}</p>`}
      <table class="table-compact">
        <thead><tr><th>${esc(t('prefs.colCategory'))}</th><th>${esc(t('prefs.colInApp'))}</th><th>${esc(t('prefs.colEmail'))}</th></tr></thead>
        <tbody>
          ${prefs.items
            .map(
              (p) => `<tr>
                <td>${esc(categorieLabel(p.category))}</td>
                <td><input type="checkbox" data-action="set-preference" data-category="${esc(p.category)}" data-channel="inApp" ${p.inApp ? 'checked' : ''} aria-label="${esc(
                  t('prefs.inAppAria', { category: categorieLabel(p.category) }),
                )}" /></td>
                <td><input type="checkbox" data-action="set-preference" data-category="${esc(p.category)}" data-channel="email" ${p.email ? 'checked' : ''} ${prefs.emailAvailable ? '' : 'disabled'} aria-label="${esc(
                  t('prefs.emailAria', { category: categorieLabel(p.category) }),
                )}" /></td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2 style="font-size:var(--text-base)">${esc(t('prefs.savedReplies'))}</h2>
      <p class="small muted">${esc(t('prefs.savedRepliesHint'))}</p>
      ${templates.saved.length
        ? `<ul class="stack" style="gap:var(--space-2)">${templates.saved
            .map(
              // `modele` et non `t` : `t` est désormais la fonction de traduction.
              (modele) => `<li class="row-between">
                <span><strong>${esc(modele.title)}</strong><br /><span class="small muted">${esc(modele.content)}</span></span>
                <button class="link-btn xs" data-action="delete-template" data-id="${esc(modele.id)}">${esc(t('prefs.deleteReply'))}</button>
              </li>`,
            )
            .join('')}</ul>`
        : `<p class="muted small">${esc(t('prefs.noSavedReply'))}</p>`}
      <form id="template-form" class="mt-6">
        <div class="field">
          <label for="t-title">${esc(t('prefs.replyTitle'))}</label>
          <input id="t-title" type="text" maxlength="120" required placeholder="${esc(t('prefs.replyTitlePlaceholder'))}" />
        </div>
        <div class="field">
          <label for="t-content">${esc(t('prefs.replyContent'))}</label>
          <textarea id="t-content" rows="2" maxlength="2000" required placeholder="${esc(t('prefs.replyContentPlaceholder'))}"></textarea>
        </div>
        <button class="btn btn-sm" type="submit">${esc(t('action.save'))}</button>
      </form>
    </section>

    <section class="card">
      <h2 style="font-size:var(--text-base)">${esc(t('prefs.blocked'))}</h2>
      ${blocks.items.length
        ? `<ul class="stack" style="gap:var(--space-2)">${blocks.items
            .map(
              (b) => `<li class="row-between">
                <span><strong>${esc(b.user.name)}</strong> <span class="xs muted">${formatDate(b.createdAt)}</span></span>
                <button class="link-btn xs" data-action="unblock-user" data-id="${esc(b.user.id)}">${esc(t('prefs.unblock'))}</button>
              </li>`,
            )
            .join('')}</ul>`
        : `<p class="muted small">${esc(t('prefs.noBlocked'))}</p>`}
    </section>`;
}

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

/** Étiquette lisible d'un type de fil. */
const KIND_LABEL = {
  BUYER_SELLER: 'Échange direct',
  RFQ: 'Appel d’offres',
  QUOTE: 'Offre',
  ORDER: 'Commande',
  SUPPORT: 'Assistance',
};

const KIND_ICON = { BUYER_SELLER: 'inbox', RFQ: 'chart', QUOTE: 'chart', ORDER: 'box', SUPPORT: 'alert' };

/** Filtres de la boîte de réception : ce que l'on cherche vraiment. */
const FILTERS = [
  { code: '', label: 'Tous' },
  { code: 'unread', label: 'Non lus' },
  { code: 'RFQ', label: 'Appels d’offres' },
  { code: 'QUOTE', label: 'Offres' },
  { code: 'ORDER', label: 'Commandes' },
];

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
      <label class="sr-only" for="conv-q">Rechercher dans mes conversations</label>
      <input id="conv-q" name="q" type="search" value="${esc(q)}" placeholder="Rechercher un fournisseur, une offre, un message…" />
      <button class="btn btn-secondary btn-sm" type="submit">${svg('search')} Rechercher</button>
    </form>
    <div class="chip-row" role="tablist" aria-label="Filtrer les conversations">
      ${FILTERS.map((f) => {
        const search = new URLSearchParams();
        if (q) search.set('q', q);
        if (f.code) search.set('filter', f.code);
        const href = `${base}${search.toString() ? `?${search}` : ''}`;
        return `<a class="chip${filter === f.code ? ' chip-active' : ''}" href="${esc(href)}" data-link role="tab" aria-selected="${filter === f.code}">${esc(f.label)}</a>`;
      }).join('')}
    </div>`;
}

/** Une ligne de la liste : contexte d'abord, dernier message ensuite. */
function conversationRow(c, base, activeId) {
  const context =
    (c.quote ? `Offre ${esc(c.quote.reference)} · ${money(c.quote.total, c.quote.currency)}` : null) ??
    (c.rfq ? `Appel d’offres · ${esc(c.rfq.title)}` : null) ??
    (c.order ? `Commande ${esc(c.order.orderNumber)}` : null) ??
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
        ${c.lastMessage ? `<span class="small conv-row-preview">${c.lastMessage.mine ? 'Vous : ' : ''}${esc(c.lastMessage.body)}</span>` : '<span class="small muted">Aucun message</span>'}
      </span>
      ${c.unreadCount ? `<span class="conv-unread" aria-label="${c.unreadCount} message(s) non lu(s)">${c.unreadCount}</span>` : ''}
    </a>`;
}

/** Liste latérale, partagée par la boîte de réception et le fil ouvert. */
async function conversationList(base, { q = '', filter = '', activeId = null } = {}) {
  const search = filterQuery({ q, filter });
  const data = await api(`/conversations${search.toString() ? `?${search}` : ''}`);
  if (data.items.length === 0) {
    return `<p class="muted small" style="padding:var(--space-4)">${q || filter ? 'Aucune conversation ne correspond.' : 'Aucune conversation pour l’instant.'}</p>`;
  }
  return `<div class="conv-list">${data.items.map((c) => conversationRow(c, base, activeId)).join('')}</div>`;
}

// ── Boîte de réception ──────────────────────────────────────────────────────

async function inboxFor(base, title, searchParams) {
  const q = searchParams?.get('q') ?? '';
  const filter = searchParams?.get('filter') ?? '';
  const list = await conversationList(base, { q, filter });

  return `
    ${breadcrumb([{ label: 'Accueil', href: '/touma/' }, { label: title }])}
    <div class="row-between" style="margin-bottom:var(--space-3)">
      <h1 style="font-size:var(--text-xl);margin:0">${esc(title)}</h1>
      <a class="btn btn-secondary btn-sm" href="/touma/messages/reglages" data-link>${svg('user')} Préférences</a>
    </div>
    <div class="messaging">
      <aside class="messaging-side" aria-label="Conversations">
        ${toolbar(base, { q, filter })}
        ${list}
      </aside>
      <section class="messaging-main messaging-empty">
        ${emptyState({
          title: 'Choisissez une conversation',
          body: 'Chaque fil porte son contexte : la boutique, l’appel d’offres, l’offre ou la commande dont il parle.',
          actionLabel: 'Trouver un fournisseur',
          actionHref: '/touma/sourcing',
          iconName: 'inbox',
        })}
      </section>
    </div>`;
}

export async function inbox(_params, searchParams) {
  return inboxFor('/touma/messages', 'Messages', searchParams);
}

export async function businessInbox(_params, searchParams) {
  return inboxFor('/touma/business/messages', 'Messagerie Business', searchParams);
}

export async function sellerInbox(_params, searchParams) {
  // Le vendeur garde la navigation de son espace : la messagerie en fait
  // partie, elle n'est pas une application à côté.
  const { tabs } = await import('./views-seller.js');
  return `${tabs('/touma/vendeur/messages')}${await inboxFor('/touma/vendeur/messages', 'Messagerie vendeur', searchParams)}`;
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
        <strong>${message.type === 'QUOTE' ? 'Offre commerciale' : message.mine ? 'Votre proposition' : 'Proposition reçue'}</strong>
        ${o?.expired ? '<span class="badge badge-cross">Expirée</span>' : ''}
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
        ${itemsTotal ? `<div><dt>Sous-total</dt><dd>${money(itemsTotal, cur)}</dd></div>` : ''}
        ${shipping ? `<div><dt>Livraison</dt><dd>${money(shipping, cur)}</dd></div>` : ''}
        ${leadTime ? `<div><dt>Délai</dt><dd>${esc(String(leadTime))} jours</dd></div>` : ''}
        ${expires ? `<div><dt>Valable jusqu’au</dt><dd>${formatDate(expires)}</dd></div>` : ''}
        ${total ? `<div class="offer-total"><dt>Total</dt><dd>${money(total, cur)}</dd></div>` : ''}
      </dl>
    </article>`;
}

function attachmentLink(a) {
  const size = a.sizeBytes > 1024 * 1024 ? `${(a.sizeBytes / (1024 * 1024)).toFixed(1)} Mo` : `${Math.max(1, Math.round(a.sizeBytes / 1024))} Ko`;
  return `<a class="attachment" href="${esc(a.url)}" rel="noopener noreferrer" target="_blank" download>
      ${svg('inbox')} <span>${esc(a.name)}</span> <span class="xs muted">${size}</span>
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
        <strong>${esc(m.mine ? 'Vous' : m.author?.name ?? 'TOUMA')}</strong>
        <time class="xs muted" datetime="${esc(m.createdAt)}">${formatDate(m.createdAt, true)}</time>
        ${m.editedAt ? '<span class="xs muted">· modifié</span>' : ''}
      </header>
      ${m.replyTo
        ? `<blockquote class="msg-quote"><strong>${esc(m.replyTo.author)}</strong><span>${esc(m.replyTo.body)}</span></blockquote>`
        : ''}
      ${m.deleted ? '<p class="msg-deleted"><em>Message supprimé</em></p>' : `<p class="msg-body">${esc(m.body)}</p>`}
      ${isOffer ? offerCard(m, currency) : ''}
      ${m.attachments?.length ? `<div class="attachment-row">${m.attachments.map(attachmentLink).join('')}</div>` : ''}
      ${m.deleted
        ? ''
        : `<div class="msg-actions">
            <button class="link-btn xs" data-action="reply-message" data-id="${esc(m.id)}" data-author="${esc(m.mine ? 'Vous' : m.author?.name ?? 'TOUMA')}" data-body="${esc(m.body.slice(0, 120))}">Répondre</button>
            ${m.editable ? `<button class="link-btn xs" data-action="edit-message" data-id="${esc(m.id)}">Modifier</button>` : ''}
            ${m.mine && ['TEXT', 'ATTACHMENT'].includes(m.type) ? `<button class="link-btn xs" data-action="delete-message" data-id="${esc(m.id)}">Supprimer</button>` : ''}
            ${m.mine ? '' : `<button class="link-btn xs" data-action="report-message" data-id="${esc(m.id)}">Signaler</button>`}
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
  if (data.store?.verificationStatus === 'APPROVED') chips.push(`<span class="chip chip-verified">${svg('shield')} Vérifié</span>`);
  if (data.rfq) chips.push(`<a class="chip" href="/touma/business/appels-offres/${esc(data.rfq.id)}" data-link>${svg('chart')} ${esc(data.rfq.reference)}</a>`);
  if (data.quote) chips.push(`<a class="chip" href="/touma/negociations/${esc(data.quote.id)}" data-link>${svg('chart')} Offre ${esc(data.quote.reference)}</a>`);
  if (data.order) chips.push(`<a class="chip" href="/touma/commandes/${esc(data.order.id)}" data-link>${svg('box')} ${esc(data.order.orderNumber)}</a>`);

  const presence = data.participants.map((p) => `${esc(p.name)}${p.presence === 'ONLINE' ? ' · en ligne' : ''}`).join(', ');

  return `
    <header class="thread-head">
      <div class="row-between">
        <div style="min-width:0">
          <p class="xs muted" style="margin:0">${esc(KIND_LABEL[data.kind] ?? 'Conversation')}</p>
          <h1 style="font-size:var(--text-lg);margin:2px 0">${esc(data.title)}</h1>
          <p class="small muted" style="margin:0">${presence || 'Conversation TOUMA'}</p>
        </div>
        <div class="thread-head-actions">
          <button class="btn btn-secondary btn-sm" data-action="toggle-mute" data-id="${esc(data.id)}" data-muted="${data.muted}">${data.muted ? 'Réactiver' : 'Couper'} les alertes</button>
          <button class="btn btn-secondary btn-sm" data-action="toggle-archive" data-id="${esc(data.id)}" data-archived="${data.archived}">${data.archived ? 'Désarchiver' : 'Archiver'}</button>
        </div>
      </div>
      ${chips.length ? `<div class="chip-row">${chips.join('')}</div>` : ''}
      ${negotiation ? negotiationBar(negotiation) : ''}
    </header>`;
}

/** Bandeau d'action de négociation : la prochaine étape, jamais ambiguë. */
function negotiationBar(n) {
  const actions = [];
  if (n.permissions.canAccept) actions.push(`<a class="btn btn-sm" href="/touma/negociations/${esc(n.id)}" data-link>Accepter l’offre</a>`);
  if (n.permissions.canApplyProposal) actions.push(`<button class="btn btn-sm" data-action="apply-proposal" data-id="${esc(n.id)}">Entériner la contre-proposition</button>`);
  if (n.permissions.canCounter) actions.push(`<a class="btn btn-secondary btn-sm" href="/touma/negociations/${esc(n.id)}" data-link>Contre-proposer</a>`);
  if (n.permissions.canReject) actions.push(`<button class="btn btn-secondary btn-sm" data-action="reject-offer" data-id="${esc(n.id)}">Refuser</button>`);

  return `
    <div class="negotiation-bar">
      <div>
        <span class="badge">${esc(n.status)}</span>
        <strong>${money(n.total, n.currency)}</strong>
        <span class="small muted">· livraison sous ${esc(String(n.leadTimeDays))} jours · ${n.expired ? 'offre expirée' : `valable jusqu’au ${formatDate(n.validUntil)}`}</span>
      </div>
      ${actions.length ? `<div class="row" style="gap:var(--space-2);flex-wrap:wrap">${actions.join('')}</div>` : ''}
    </div>`;
}

/** Raccourcis commerciaux : poser la bonne question d'un clic. */
function composer(data, templates) {
  if (!data.canWrite) {
    return `<p class="muted small thread-closed">${
      data.status === 'BLOCKED'
        ? 'Cette conversation est bloquée : elle reste lisible, mais n’accepte plus de message.'
        : 'Cette conversation est close : elle reste consultable.'
    }</p>`;
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
        <button type="button" class="link-btn xs" data-action="cancel-reply">Annuler</button>
      </div>
      <div class="composer-row">
        <label class="sr-only" for="m-body">Votre message</label>
        <textarea id="m-body" rows="2" maxlength="4000" required placeholder="Écrivez votre message… (Entrée pour envoyer, Maj+Entrée pour aller à la ligne)"></textarea>
        <div class="composer-buttons">
          <label class="btn btn-secondary btn-sm attach-btn">
            ${svg('inbox')} <span class="sr-only">Joindre un fichier</span>
            <input type="file" id="m-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.csv" hidden />
          </label>
          <button class="btn btn-sm" type="submit">Envoyer</button>
        </div>
      </div>
      <p class="xs muted" style="margin:var(--space-1) 0 0">Formats acceptés : PDF, JPEG, PNG, WebP, XLSX, CSV — 10 Mo maximum.</p>
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
      <aside class="messaging-side" aria-label="Conversations">
        ${toolbar(base, { q: searchParams?.get('q') ?? '', filter: searchParams?.get('filter') ?? '' })}
        ${list}
      </aside>
      <section class="messaging-main" aria-label="Conversation">
        <a class="btn btn-secondary btn-sm thread-back" href="${base}" data-link>${svg('arrow-left')} Conversations</a>
        ${threadHeader(data, negotiation)}
        <div class="thread-scroll" id="thread-scroll" data-conversation="${esc(data.id)}">
          ${data.hasMore ? `<button class="btn btn-secondary btn-sm" data-action="load-older" data-conversation="${esc(data.id)}" data-cursor="${esc(data.olderCursor ?? '')}">Charger les messages plus anciens</button>` : ''}
          <div id="thread-messages">
            ${data.messages.length
              ? data.messages.map((m) => messageBubble(m, currency)).join('')
              : '<p class="muted small">Aucun message. Écrivez le premier — présentez votre besoin, la quantité et l’échéance.</p>'}
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
  const label =
    entry.kind === 'COUNTER_OFFER'
      ? entry.side === 'BUYER'
        ? 'Contre-proposition de l’acheteur'
        : 'Offre révisée du fournisseur'
      : entry.kind === 'ACCEPT'
        ? 'Acceptation'
        : entry.kind === 'REJECT'
          ? 'Refus'
          : 'Message';

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
        ${entry.expiresAt ? `<p class="xs muted" style="margin:2px 0 0">Valable jusqu’au ${formatDate(entry.expiresAt)}</p>` : ''}
      </div>
    </li>`;
}

/** Formulaire de contre-offre : le total est calculé par le serveur. */
function counterForm(n) {
  const lines = n.items.length ? n.items : [{ name: '', quantity: 1, unit: 'pièce', unitPrice: '0' }];
  return `
    <form id="counter-form" class="card" data-negotiation="${esc(n.id)}" data-currency="${esc(n.currency)}">
      <h2 style="font-size:var(--text-base)">${session.isSeller ? 'Proposer une offre révisée' : 'Faire une contre-proposition'}</h2>
      <p class="small muted">Indiquez quantités et prix unitaires : le total est calculé par TOUMA, pas par votre navigateur.</p>
      <div id="counter-lines">
        ${lines.map((l, i) => counterLine(l, i)).join('')}
      </div>
      <button type="button" class="btn btn-secondary btn-sm" data-action="add-counter-line">Ajouter une ligne</button>

      <div class="form-grid" style="margin-top:var(--space-3)">
        <div class="field">
          <label for="c-shipping">Frais de livraison (${esc(n.currency)})</label>
          <input id="c-shipping" type="text" inputmode="decimal" value="${esc(n.shippingTotal)}" />
        </div>
        <div class="field">
          <label for="c-lead">Délai (jours)</label>
          <input id="c-lead" type="number" min="1" max="365" value="${esc(String(n.leadTimeDays))}" />
        </div>
        <div class="field">
          <label for="c-validity">Validité (jours, facultatif)</label>
          <input id="c-validity" type="number" min="1" max="120" placeholder="30" />
        </div>
      </div>
      <div class="field">
        <label for="c-note">Message</label>
        <textarea id="c-note" rows="2" maxlength="2000" placeholder="Expliquez votre proposition."></textarea>
      </div>
      <p class="small"><strong>Total estimé :</strong> <span id="counter-total">—</span> <span class="xs muted">(recalculé par le serveur à l’envoi)</span></p>
      <button class="btn" type="submit">Envoyer la proposition</button>
    </form>`;
}

function counterLine(line, index) {
  return `
    <div class="counter-line" data-index="${index}">
      <div class="field">
        <label class="sr-only" for="cl-name-${index}">Désignation</label>
        <input id="cl-name-${index}" class="cl-name" type="text" value="${esc(line.name ?? '')}" placeholder="Désignation" required />
      </div>
      <div class="field">
        <label class="sr-only" for="cl-qty-${index}">Quantité</label>
        <input id="cl-qty-${index}" class="cl-qty" type="number" min="1" value="${esc(String(line.quantity ?? 1))}" required />
      </div>
      <div class="field">
        <label class="sr-only" for="cl-unit-${index}">Unité</label>
        <input id="cl-unit-${index}" class="cl-unit" type="text" value="${esc(line.unit ?? 'pièce')}" required />
      </div>
      <div class="field">
        <label class="sr-only" for="cl-price-${index}">Prix unitaire</label>
        <input id="cl-price-${index}" class="cl-price" type="text" inputmode="decimal" value="${esc(String(line.unitPrice ?? '0'))}" required />
      </div>
      <button type="button" class="link-btn xs" data-action="remove-counter-line">Retirer</button>
    </div>`;
}

export async function negotiation(params) {
  const n = await api(`/negotiations/${params.id}`);
  const addresses = n.permissions.canAccept ? await api('/auth/me/addresses').catch(() => ({ items: [] })) : { items: [] };

  return `
    ${breadcrumb([
      { label: 'Business', href: '/touma/business' },
      { label: 'Négociations', href: '/touma/messages?filter=QUOTE' },
      { label: n.reference },
    ])}

    <div class="row-between" style="margin-bottom:var(--space-4)">
      <div>
        <h1 style="font-size:var(--text-xl);margin:0">Négociation ${esc(n.reference)}</h1>
        <p class="small muted" style="margin:2px 0 0">${esc(n.rfq.title)} · ${esc(n.store.name)} (${esc(n.store.countryCode)})</p>
      </div>
      ${n.conversationId ? `<a class="btn btn-secondary btn-sm" href="/touma/messages/${esc(n.conversationId)}" data-link>${svg('inbox')} Ouvrir la conversation</a>` : ''}
    </div>

    <div class="card">
      <div class="row-between">
        <div>
          <span class="badge">${esc(n.status)}</span>
          ${n.expired ? '<span class="badge badge-cross">Expirée</span>' : ''}
        </div>
        <div class="xs muted">Valable jusqu’au ${formatDate(n.validUntil)}</div>
      </div>
      <div class="table-scroll" style="margin-top:var(--space-3)">
      <table class="offer-lines">
        <thead><tr><th>Désignation</th><th class="num">Quantité</th><th class="num">Prix unitaire</th><th class="num">Total</th></tr></thead>
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
        <div><dt>Sous-total</dt><dd>${money(n.itemsTotal, n.currency)}</dd></div>
        <div><dt>Livraison</dt><dd>${money(n.shippingTotal, n.currency)}</dd></div>
        <div><dt>Délai</dt><dd>${esc(String(n.leadTimeDays))} jours</dd></div>
        <div class="offer-total"><dt>Total</dt><dd>${money(n.total, n.currency)}</dd></div>
      </dl>

      <div class="row" style="gap:var(--space-2);flex-wrap:wrap;margin-top:var(--space-3)">
        ${n.permissions.canApplyProposal
          ? `<button class="btn" data-action="apply-proposal" data-id="${esc(n.id)}">Entériner la contre-proposition</button>`
          : ''}
        ${n.permissions.canReject ? `<button class="btn btn-secondary" data-action="reject-offer" data-id="${esc(n.id)}">Refuser</button>` : ''}
      </div>
    </div>

    ${n.permissions.canAccept
      ? `<form id="accept-offer-form" class="card" data-negotiation="${esc(n.id)}">
          <h2 style="font-size:var(--text-base)">Accepter et créer la commande</h2>
          <p class="small muted">L’acceptation crée une commande payable de ${money(n.total, n.currency)}. Les offres concurrentes sont alors écartées.</p>
          <div class="field">
            <label for="a-address">Adresse de livraison</label>
            <select id="a-address" required>
              ${(addresses.items ?? [])
                .map((a) => `<option value="${esc(a.id)}">${esc(a.fullName)} — ${esc(a.line1)}, ${esc(a.city)} (${esc(a.countryCode)})</option>`)
                .join('')}
            </select>
          </div>
          ${(addresses.items ?? []).length === 0
            ? '<p class="small muted">Ajoutez d’abord une adresse depuis votre compte.</p>'
            : '<button class="btn" type="submit">Accepter l’offre</button>'}
        </form>`
      : ''}

    ${n.permissions.canCounter ? counterForm(n) : ''}

    <section class="card">
      <h2 style="font-size:var(--text-base)">Chronologie</h2>
      ${n.timeline.length
        ? `<ol class="timeline">${n.timeline.map((e) => timelineEntry(e, n.currency)).join('')}</ol>`
        : '<p class="muted small">Aucun échange pour l’instant.</p>'}
    </section>`;
}

// ── Préférences de notification et blocages ─────────────────────────────────

const CATEGORY_LABEL = {
  MESSAGES: 'Messages',
  NEGOTIATION: 'Négociations et offres',
  RFQ: 'Appels d’offres',
  ORDERS: 'Commandes et paiements',
  MARKETING: 'Nouveautés TOUMA',
};

export async function settings() {
  const [prefs, blocks, templates] = await Promise.all([
    api('/messaging/preferences'),
    api('/messaging/blocks'),
    api('/messaging/templates'),
  ]);

  return `
    ${breadcrumb([{ label: 'Messages', href: '/touma/messages' }, { label: 'Préférences' }])}
    <h1 style="font-size:var(--text-xl)">Préférences de messagerie</h1>

    <section class="card">
      <h2 style="font-size:var(--text-base)">Notifications</h2>
      ${prefs.emailAvailable ? '' : '<p class="small muted">Aucun expéditeur d’e-mail n’est configuré : seule la notification dans l’application est disponible pour l’instant.</p>'}
      <table class="table-compact">
        <thead><tr><th>Catégorie</th><th>Dans l’application</th><th>E-mail</th></tr></thead>
        <tbody>
          ${prefs.items
            .map(
              (p) => `<tr>
                <td>${esc(CATEGORY_LABEL[p.category] ?? p.category)}</td>
                <td><input type="checkbox" data-action="set-preference" data-category="${esc(p.category)}" data-channel="inApp" ${p.inApp ? 'checked' : ''} aria-label="Notification dans l’application pour ${esc(CATEGORY_LABEL[p.category] ?? p.category)}" /></td>
                <td><input type="checkbox" data-action="set-preference" data-category="${esc(p.category)}" data-channel="email" ${p.email ? 'checked' : ''} ${prefs.emailAvailable ? '' : 'disabled'} aria-label="Notification par e-mail pour ${esc(CATEGORY_LABEL[p.category] ?? p.category)}" /></td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2 style="font-size:var(--text-base)">Réponses enregistrées</h2>
      <p class="small muted">Vos formulations récurrentes, proposées au-dessus du champ de saisie.</p>
      ${templates.saved.length
        ? `<ul class="stack" style="gap:var(--space-2)">${templates.saved
            .map(
              (t) => `<li class="row-between">
                <span><strong>${esc(t.title)}</strong><br /><span class="small muted">${esc(t.content)}</span></span>
                <button class="link-btn xs" data-action="delete-template" data-id="${esc(t.id)}">Supprimer</button>
              </li>`,
            )
            .join('')}</ul>`
        : '<p class="muted small">Aucune réponse enregistrée.</p>'}
      <form id="template-form" class="mt-6">
        <div class="field">
          <label for="t-title">Intitulé</label>
          <input id="t-title" type="text" maxlength="120" required placeholder="Délai de livraison N’Djamena" />
        </div>
        <div class="field">
          <label for="t-content">Message</label>
          <textarea id="t-content" rows="2" maxlength="2000" required placeholder="Le délai vers N’Djamena est de 12 jours, transport inclus."></textarea>
        </div>
        <button class="btn btn-sm" type="submit">Enregistrer</button>
      </form>
    </section>

    <section class="card">
      <h2 style="font-size:var(--text-base)">Comptes bloqués</h2>
      ${blocks.items.length
        ? `<ul class="stack" style="gap:var(--space-2)">${blocks.items
            .map(
              (b) => `<li class="row-between">
                <span><strong>${esc(b.user.name)}</strong> <span class="xs muted">${formatDate(b.createdAt)}</span></span>
                <button class="link-btn xs" data-action="unblock-user" data-id="${esc(b.user.id)}">Débloquer</button>
              </li>`,
            )
            .join('')}</ul>`
        : '<p class="muted small">Aucun compte bloqué.</p>'}
    </section>`;
}

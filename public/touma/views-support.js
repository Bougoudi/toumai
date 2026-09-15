/**
 * Après-vente et assistance : retours, remboursements, tickets.
 *
 * Aucune décision n'est prise ici : l'interface propose ce que l'API autorise
 * réellement (fenêtre de retour, quantités restantes, montants validés) et
 * affiche les montants tels que le serveur les a calculés.
 */
import { api, esc, emptyState, formatDate, money, session, statusPill, svg } from './core.js';
import { breadcrumb, pagination } from './components.js';
import { t } from './i18n.js';

/**
 * Les libellés de l'après-vente vivent dans `i18n.js`, dans leur propre
 * famille : « accepté » ne veut pas dire la même chose pour un retour et pour
 * une boutique vérifiée, et les confondre ferait dire à l'écran autre chose que
 * le moteur.
 */
const retour = (famille, code) => t(`ret.${famille}.${code}`);
const ticketLabel = (famille, code) => t(`ticket.${famille}.${code}`);

/** L'ordre des filtres et des options — l'ordre, pas les libellés. */
const RETURN_FILTERS = ['', 'REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'REFUNDED', 'REJECTED'];
const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'PENDING_USER', 'RESOLVED', 'CLOSED'];
const TICKET_CATEGORIES = ['ORDER', 'PAYMENT', 'DELIVERY', 'RETURN', 'ACCOUNT', 'STORE', 'VERIFICATION', 'OTHER'];
const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

const pill = (value, libelle) => `<span class="status status-${esc(value)}">${esc(libelle)}</span>`;

/** Étapes réelles d'un retour, dans l'ordre où l'acheteur les vit. */
const RETURN_FLOW = [
  { key: 'REQUESTED', at: 'requestedAt' },
  { key: 'APPROVED', at: 'decidedAt' },
  { key: 'IN_TRANSIT', at: null },
  { key: 'RECEIVED', at: 'receivedAt' },
  { key: 'REFUNDED', at: 'refundedAt' },
];

function returnTimeline(r) {
  if (['REJECTED', 'CANCELLED'].includes(r.status)) {
    return `<ul class="timeline">
      <li data-done="true"><strong>${esc(retour('status', 'REQUESTED'))}</strong><span>${formatDate(r.requestedAt, true)}</span></li>
      <li data-current="true"><strong>${esc(retour('status', r.status))}</strong><span>${formatDate(r.decidedAt ?? r.closedAt ?? r.requestedAt, true)}</span></li>
    </ul>`;
  }
  const currentIndex = Math.max(0, RETURN_FLOW.findIndex((s) => s.key === r.status));
  return `<ul class="timeline">
    ${RETURN_FLOW.map((step, i) => {
      const done = i < currentIndex;
      const current = i === currentIndex;
      const at = step.at ? r[step.at] : null;
      return `<li data-done="${done}" data-current="${current}">
        <strong>${esc(retour('status', step.key))}</strong>
        <span>${at ? formatDate(at, true) : esc(t(done ? 'ret.done' : current ? 'ret.inProgress' : 'ret.upcoming'))}</span>
      </li>`;
    }).join('')}
  </ul>`;
}

// ── Retours ────────────────────────────────────────────────────────────────

/** Liste des retours : côté acheteur par défaut, côté vendeur avec `scope`. */
export async function returns(_params, query, options = {}) {
  const scope = options.scope ?? 'buyer';
  const page = Number(query.get('page') || 1);
  const status = query.get('statut') || '';
  const data = await api(`/returns?scope=${scope}&page=${page}${status ? `&status=${status}` : ''}`);
  const base = scope === 'seller' ? '/touma/vendeur/retours' : '/touma/retours';
  const title = t(scope === 'seller' ? 'ret.received' : 'ret.mine');

  const header = options.embedded
    ? ''
    : `${breadcrumb([{ label: t('nav.home'), href: '/touma/' }, { label: title }])}
      <h1 style="font-size:var(--text-xl)">${esc(title)}</h1>`;

  if (!data.items.length && !status) {
    return `
      ${header}
      ${emptyState({
        title: t('ret.emptyTitle'),
        body: t(scope === 'seller' ? 'ret.emptyBodySeller' : 'ret.emptyBodyBuyer'),
        actionLabel: t(scope === 'seller' ? 'ret.emptyActionSeller' : 'ret.emptyActionBuyer'),
        actionHref: scope === 'seller' ? '/touma/vendeur/commandes' : '/touma/commandes',
        iconName: 'box',
      })}`;
  }

  return `
    ${header}
    <div class="chip-row" style="margin-bottom:var(--space-5)">
      ${RETURN_FILTERS.map(
        (f) =>
          `<a class="chip${status === f ? ' chip-active' : ''}" href="${base}${f ? `?statut=${f}` : ''}" data-link>${
            f ? esc(retour('status', f)) : esc(t('ret.all'))
          }</a>`,
      ).join('')}
    </div>

    <div class="stack">
      ${data.items
        .map(
          (r) => `<a class="card" href="/touma/retours/${esc(r.id)}" data-link style="display:block;color:inherit;text-decoration:none">
            <div class="row-between">
              <div style="min-width:0">
                <strong>${esc(r.reference)}</strong>
                <div class="small muted">${esc(
                  t('ret.orderAndReason', { number: r.order.orderNumber, reason: retour('reason', r.reason) }),
                )}</div>
                <div class="xs muted">${esc(
                  t('ret.itemsAndDate', { count: r.items.length, date: formatDate(r.requestedAt) }),
                )}</div>
              </div>
              <div class="row" style="gap:var(--space-3)">
                ${pill(r.status, retour('status', r.status))}
                <strong>${money(r.approvedAmount ?? r.requestedAmount, r.currency)}</strong>
              </div>
            </div>
          </a>`,
        )
        .join('')}
    </div>
    ${pagination(data, (p) => `${base}?page=${p}${status ? `&statut=${status}` : ''}`)}`;
}

/** Formulaire de demande : les articles et le délai viennent de l'API. */
export async function newReturn(_params, query) {
  const orderId = query.get('commande');
  if (!orderId) {
    return emptyState({
      title: t('ret.pickOrderTitle'),
      body: t('ret.pickOrderBody'),
      actionLabel: t('ret.emptyActionBuyer'),
      actionHref: '/touma/commandes',
      iconName: 'box',
    });
  }

  const info = await api(`/returns/eligibility/${orderId}`);
  const returnable = info.items.filter((i) => i.returnable > 0);

  if (!info.eligible || !returnable.length) {
    return `
      ${breadcrumb([{ label: t('ret.emptyActionBuyer'), href: '/touma/commandes' }, { label: t('ret.crumb') }])}
      ${emptyState({
        title: t('ret.impossibleTitle'),
        body: info.deadline
          ? t('ret.windowExpired', { days: info.windowDays, date: formatDate(info.deadline) })
          : t('ret.notEligible'),
        actionLabel: t('ret.viewOrder'),
        actionHref: `/touma/commandes/${esc(info.orderId)}`,
        iconName: 'alert',
      })}`;
  }

  return `
    ${breadcrumb([
      { label: t('ret.emptyActionBuyer'), href: '/touma/commandes' },
      { label: info.orderNumber, href: `/touma/commandes/${info.orderId}` },
      { label: t('ret.askTitle') },
    ])}
    <h1 style="font-size:var(--text-xl)">${esc(t('ret.askTitle'))}</h1>
    <p class="small muted">${esc(
      t('ret.askIntro', {
        number: info.orderNumber,
        deadline: info.deadline ? t('ret.askDeadline', { date: formatDate(info.deadline) }) : '',
      }),
    )}</p>

    <form id="return-form" data-order="${esc(info.orderId)}" class="card">
      <div class="field">
        <label for="rr-reason">${esc(t('ret.reasonLabel'))}</label>
        <select id="rr-reason" required>
          ${info.reasons.map((r) => `<option value="${esc(r)}">${esc(retour('reason', r))}</option>`).join('')}
        </select>
      </div>

      <fieldset style="border:0;padding:0;margin:0 0 var(--space-4)">
        <legend class="small" style="font-weight:600;padding:0">${esc(t('ret.itemsLegend'))}</legend>
        <div class="stack" style="gap:var(--space-2)">
          ${returnable
            .map(
              (i) => `<div class="row-between card" style="box-shadow:none;padding:var(--space-3)">
                <label class="check" style="border:0;padding:0;min-width:0;margin:0">
                  <input type="checkbox" class="rr-pick" data-item="${esc(i.orderItemId)}" />
                  <span style="min-width:0">
                    <strong>${esc(i.title)}</strong>
                    <span class="small muted" style="display:block">${money(i.unitPrice, i.currency)} · ${esc(
                      t('ret.returnable', { count: i.returnable }),
                    )}${i.alreadyReturned ? esc(t('ret.alreadyAsked', { count: i.alreadyReturned })) : ''}</span>
                  </span>
                </label>
                <input type="number" class="rr-qty" data-item="${esc(i.orderItemId)}" min="1" max="${i.returnable}" value="1"
                  style="width:76px" aria-label="${esc(t('ret.qtyAria', { title: i.title }))}" />
              </div>`,
            )
            .join('')}
        </div>
      </fieldset>

      <div class="field">
        <label for="rr-comment">${esc(t('ret.commentLabel'))}</label>
        <textarea id="rr-comment" rows="3" maxlength="2000" placeholder="${esc(t('ret.commentPlaceholder'))}"></textarea>
      </div>

      <div class="field">
        <label for="rr-photo">${esc(t('ret.photoLabel'))}</label>
        <input id="rr-photo" type="url" maxlength="2000" placeholder="https://…" />
        <p class="xs muted" style="margin:var(--space-1) 0 0">${esc(t('ret.photoHint'))}</p>
      </div>

      <button class="btn btn-block" type="submit">${esc(t('ret.submit'))}</button>
    </form>`;
}

/** Détail d'un retour, avec les actions réellement permises à ce stade. */
export async function returnDetail(params) {
  const r = await api(`/returns/${params.id}`);
  const mine = session.user && r.buyer.id === session.user.id;
  const seller = session.user && !mine;
  const amount = r.approvedAmount ?? r.requestedAmount;

  const waitingNote = ['REQUESTED', 'RECEIVED', 'IN_TRANSIT'].includes(r.status) ? t(`ret.wait${r.status}`) : null;

  const buyerActions = [
    waitingNote ? `<p class="small muted" style="margin-top:0">${esc(waitingNote)}</p>` : '',
    r.status === 'APPROVED'
      ? `<form id="return-ship-form" data-return="${esc(r.id)}">
           <div class="field"><label for="rs-tracking">${esc(t('ret.trackingLabel'))}</label>
             <input id="rs-tracking" required minlength="3" maxlength="80" placeholder="CM-TD-889201" /></div>
           <button class="btn btn-block" type="submit">${esc(t('ret.shipped'))}</button>
         </form>`
      : '',
    ['REQUESTED', 'APPROVED', 'IN_TRANSIT'].includes(r.status)
      ? `<button class="btn btn-ghost btn-block btn-sm" data-cancel-return="${esc(r.id)}">${esc(t('ret.withdraw'))}</button>`
      : '',
  ].join('');

  const sellerActions = [
    r.status === 'REQUESTED'
      ? `<form id="return-approve-form" data-return="${esc(r.id)}">
           <div class="field"><label for="ra-amount">${esc(t('ret.acceptedAmount', { currency: r.currency }))}</label>
             <input id="ra-amount" type="text" inputmode="decimal" value="${esc(r.requestedAmount)}" />
             <p class="xs muted" style="margin:var(--space-1) 0 0">${esc(
               t('ret.atMost', { amount: money(r.requestedAmount, r.currency) }),
             )}</p></div>
           <div class="field"><label for="ra-note">${esc(t('ret.noteToBuyer'))}</label><input id="ra-note" maxlength="1000" /></div>
           <button class="btn btn-block" type="submit">${esc(t('ret.accept'))}</button>
         </form>
         <form id="return-reject-form" data-return="${esc(r.id)}" class="mt-6">
           <div class="field"><label for="rj-note">${esc(t('ret.rejectReason'))}</label>
             <textarea id="rj-note" rows="2" required minlength="5" maxlength="1000"></textarea></div>
           <button class="btn btn-secondary btn-block" type="submit">${esc(t('ret.reject'))}</button>
         </form>`
      : '',
    ['APPROVED', 'IN_TRANSIT'].includes(r.status)
      ? `<form id="return-receive-form" data-return="${esc(r.id)}">
           <div class="field"><label for="rc-condition">${esc(t('ret.conditionLabel'))}</label>
             <input id="rc-condition" maxlength="200" placeholder="${esc(t('ret.conditionPlaceholder'))}" /></div>
           <label class="check" style="margin-bottom:var(--space-4)">
             <input id="rc-restock" type="checkbox" checked /><span class="small">${esc(t('ret.restock'))}</span>
           </label>
           <button class="btn btn-block" type="submit">${esc(t('ret.received1'))}</button>
         </form>`
      : '',
    ['APPROVED', 'RECEIVED'].includes(r.status)
      ? `<form id="return-refund-form" data-return="${esc(r.id)}" class="mt-6">
           <div class="field"><label for="rf-amount">${esc(t('ret.refundAmount', { currency: r.currency }))}</label>
             <input id="rf-amount" type="text" inputmode="decimal" value="${esc(amount)}" /></div>
           <button class="btn btn-accent btn-block" type="submit">${esc(
             t('ret.refundAction', { amount: money(amount, r.currency) }),
           )}</button>
           <p class="xs muted" style="margin:var(--space-2) 0 0">${esc(t('ret.refundWarning'))}</p>
         </form>`
      : '',
  ].join('');

  const actions = seller ? sellerActions : buyerActions;

  return `
    ${breadcrumb([{ label: t('ret.tab'), href: seller ? '/touma/vendeur/retours' : '/touma/retours' }, { label: r.reference }])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px">${esc(t('ret.detailTitle', { reference: r.reference }))}</h1>
        <p class="small muted" style="margin:0">
          ${esc(t('ret.orderLine'))} <a href="/touma/commandes/${esc(r.order.id)}" data-link>${esc(r.order.orderNumber)}</a>
          · ${esc(r.store.name)} · ${esc(t('ret.requestedOn', { date: formatDate(r.requestedAt, true) }))}
        </p>
      </div>
      ${pill(r.status, retour('status', r.status))}
    </div>

    <div class="grid grid-2">
      <div class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('ret.itemsTitle'))}</h2>
          <div class="table-wrap" style="border:0">
            <table>
              <thead><tr><th>${esc(t('ret.col.item'))}</th><th>${esc(t('ret.col.qty'))}</th><th>${esc(t('ret.col.price'))}</th><th>${esc(
                t('ret.col.total'),
              )}</th></tr></thead>
              <tbody>
                ${r.items
                  .map(
                    (i) => `<tr>
                      <td>${esc(i.title)}${i.condition ? `<div class="xs muted">${esc(t('ret.itemCondition', { condition: i.condition }))}</div>` : ''}</td>
                      <td>${i.quantity}</td><td>${money(i.unitPrice, i.currency)}</td><td>${money(i.lineTotal, i.currency)}</td>
                    </tr>`,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
          <div class="summary mt-6">
            <div class="summary-line"><span>${esc(t('ret.requestedAmount'))}</span><span>${money(r.requestedAmount, r.currency)}</span></div>
            ${r.refundShipping
              ? `<div class="summary-line"><span>${esc(t('ret.ofWhichShipping'))}</span><span>${money(r.order.shippingTotal, r.currency)}</span></div>`
              : ''}
            ${r.approvedAmount !== null
              ? `<div class="summary-line summary-total"><span>${esc(t('ret.approvedAmount'))}</span><span>${money(r.approvedAmount, r.currency)}</span></div>`
              : ''}
          </div>
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('ret.reasonTitle'))}</h2>
          <p style="margin:0"><strong>${esc(retour('reason', r.reason))}</strong></p>
          ${r.comment ? `<p class="small" style="white-space:pre-line">${esc(r.comment)}</p>` : ''}
          ${Array.isArray(r.evidence) && r.evidence.length
            ? `<div class="row" style="gap:var(--space-2);flex-wrap:wrap">${r.evidence
                .map((e) => `<a class="badge" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${svg('inbox')} ${esc(e.name)}</a>`)
                .join('')}</div>`
            : ''}
          ${r.sellerNote ? `<p class="small muted">${esc(t('ret.sellerReply', { note: r.sellerNote }))}</p>` : ''}
          ${r.rejectionNote ? `<p class="small" style="color:var(--danger)">${esc(t('ret.rejection', { note: r.rejectionNote }))}</p>` : ''}
          ${r.trackingNumber ? `<p class="small muted">${esc(t('ret.shippedTracking', { tracking: r.trackingNumber }))}</p>` : ''}
        </section>

        ${r.refunds.length
          ? `<section class="card">
              <h2 style="font-size:var(--text-md)">${esc(t('ret.refundsTitle'))}</h2>
              <div class="stack" style="gap:var(--space-2)">
                ${r.refunds
                  .map(
                    (f) => `<div class="row-between">
                      <span class="small">${esc(f.reference)} · ${formatDate(f.processedAt ?? f.createdAt, true)}</span>
                      <span class="row" style="gap:var(--space-2)">${statusPill(f.status)}<strong>${money(f.amount, f.currency)}</strong></span>
                    </div>`,
                  )
                  .join('')}
              </div>
            </section>`
          : ''}
      </div>

      <aside class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('ret.whereTitle'))}</h2>
          ${returnTimeline(r)}
          ${['REJECTED', 'CANCELLED'].includes(r.status)
            ? `<p class="small" style="color:var(--danger);margin:var(--space-3) 0 0">${esc(retour('status', r.status))}.</p>`
            : ''}
        </section>

        ${actions ? `<section class="card"><h2 style="font-size:var(--text-md)">${esc(t('ret.actionsTitle'))}</h2>${actions}</section>` : ''}

        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('ret.helpTitle'))}</h2>
          <p class="small muted">${esc(t('ret.helpBody'))}</p>
          <a class="btn btn-secondary btn-block btn-sm" href="/touma/aide/nouveau?commande=${esc(r.order.id)}&sujet=RETURN" data-link>${esc(
            t('ret.contactSupport'),
          )}</a>
        </section>
      </aside>
    </div>`;
}

// ── Assistance ─────────────────────────────────────────────────────────────

export async function tickets(_params, query, options = {}) {
  const scope = options.scope ?? 'mine';
  const page = Number(query.get('page') || 1);
  const status = query.get('statut') || '';
  const data = await api(`/support/tickets?scope=${scope}&page=${page}${status ? `&status=${status}` : ''}`);
  const base = scope === 'all' ? '/touma/admin/assistance' : '/touma/aide';
  const title = t(scope === 'all' ? 'ticket.queue' : 'ticket.support');

  // Intégrée à la console d'administration, la vue n'apporte pas son propre titre.
  const header = options.embedded
    ? ''
    : `${breadcrumb([{ label: t('nav.home'), href: '/touma/' }, { label: title }])}
      <div class="row-between" style="margin-bottom:var(--space-4)">
        <h1 style="font-size:var(--text-xl);margin:0">${esc(title)}</h1>
        <a class="btn btn-sm" href="/touma/aide/nouveau" data-link>${esc(t('ticket.new'))}</a>
      </div>`;

  return `
    ${header}
    <div class="chip-row" style="margin-bottom:var(--space-5)">
      ${['', ...TICKET_STATUSES]
        .map(
          (f) =>
            `<a class="chip${status === f ? ' chip-active' : ''}" href="${base}${f ? `?statut=${f}` : ''}" data-link>${
              f ? esc(ticketLabel('status', f)) : esc(t('ticket.all'))
            }</a>`,
        )
        .join('')}
    </div>

    ${data.items.length
      ? `<div class="stack">
          ${data.items
            .map(
              // `billet` et non `t` : `t` est désormais la fonction de traduction.
              (billet) => `<a class="card" href="/touma/aide/${esc(billet.id)}" data-link style="display:block;color:inherit;text-decoration:none">
                <div class="row-between">
                  <div style="min-width:0">
                    <strong>${esc(billet.subject)}</strong>
                    <div class="small muted">${esc(
                      t('ticket.meta', {
                        reference: billet.reference,
                        category: ticketLabel('category', billet.category),
                        count: billet.messageCount,
                      }),
                    )}</div>
                    ${scope === 'all' ? `<div class="xs muted">${esc(billet.requester.name)}</div>` : ''}
                  </div>
                  <div class="row" style="gap:var(--space-2)">
                    ${pill(billet.priority, ticketLabel('priority', billet.priority))}
                    ${pill(billet.status, ticketLabel('status', billet.status))}
                    <span class="xs muted">${formatDate(billet.lastReplyAt, true)}</span>
                  </div>
                </div>
              </a>`,
            )
            .join('')}
        </div>
        ${pagination(data, (p) => `${base}?page=${p}${status ? `&statut=${status}` : ''}`)}`
      : emptyState({
          title: t(scope === 'all' ? 'ticket.emptyQueueTitle' : 'ticket.emptyMineTitle'),
          body: t(scope === 'all' ? 'ticket.emptyQueueBody' : 'ticket.emptyMineBody'),
          actionLabel: t(scope === 'all' ? 'ticket.emptyQueueAction' : 'ticket.emptyMineAction'),
          actionHref: scope === 'all' ? '/touma/admin' : '/touma/aide/nouveau',
          iconName: 'inbox',
        })}`;
}

export async function newTicket(_params, query) {
  const orderId = query.get('commande') || '';
  const category = query.get('sujet') || (orderId ? 'ORDER' : 'OTHER');

  return `
    ${breadcrumb([{ label: t('ticket.support'), href: '/touma/aide' }, { label: t('ticket.new') }])}
    <h1 style="font-size:var(--text-xl)">${esc(t('ticket.howHelp'))}</h1>
    <p class="small muted">${esc(t('ticket.replyLanguage'))}</p>

    <form id="ticket-form" class="card"${orderId ? ` data-order="${esc(orderId)}"` : ''}>
      <div class="field">
        <label for="t-subject">${esc(t('ticket.subject'))}</label>
        <input id="t-subject" required minlength="5" maxlength="200" placeholder="${esc(t('ticket.subjectPlaceholder'))}" />
      </div>
      <div class="field">
        <label for="t-category">${esc(t('ticket.categoryLabel'))}</label>
        <select id="t-category">
          ${TICKET_CATEGORIES.map(
            (code) => `<option value="${code}"${code === category ? ' selected' : ''}>${esc(ticketLabel('category', code))}</option>`,
          ).join('')}
        </select>
      </div>
      <div class="field">
        <label for="t-message">${esc(t('ticket.yourMessage'))}</label>
        <textarea id="t-message" rows="6" required minlength="10" maxlength="5000"></textarea>
      </div>
      <button class="btn btn-block" type="submit">${esc(t('ticket.submit'))}</button>
    </form>`;
}

export async function ticket(params) {
  // Le ticket s'appelle `billet` : `t` est la fonction de traduction.
  const billet = await api(`/support/tickets/${params.id}`);
  const isAdmin = session.user?.role === 'ADMIN';

  return `
    ${breadcrumb([
      { label: t('ticket.support'), href: isAdmin ? '/touma/admin/assistance' : '/touma/aide' },
      { label: billet.reference },
    ])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div>
        <h1 style="font-size:var(--text-lg);margin-bottom:2px">${esc(billet.subject)}</h1>
        <p class="small muted" style="margin:0">
          ${esc(billet.reference)} · ${esc(ticketLabel('category', billet.category))} · ${esc(
            t('ticket.openedOn', { date: formatDate(billet.createdAt) }),
          )}
          ${billet.order ? ` · ${esc(t('ticket.orderLine', { number: billet.order.orderNumber }))}` : ''}
        </p>
      </div>
      <div class="row" style="gap:var(--space-2)">${pill(billet.priority, ticketLabel('priority', billet.priority))}${pill(
        billet.status,
        ticketLabel('status', billet.status),
      )}</div>
    </div>

    <div class="grid grid-2">
      <section class="card">
        <div class="stack" style="gap:var(--space-3)">
          ${billet.messages
            .map(
              (m) => `<div class="notif-item"${m.internal ? ' style="border-left:3px solid var(--warning)"' : ''}>
                <strong>${esc(m.fromSupport ? t('ticket.fromSupport') : m.author.name)}</strong>
                ${m.internal ? `<span class="badge">${esc(t('ticket.internalBadge'))}</span>` : ''}
                <p style="white-space:pre-line">${esc(m.body)}</p>
                <span class="xs muted">${formatDate(m.createdAt, true)}</span>
              </div>`,
            )
            .join('')}
        </div>

        ${billet.status !== 'CLOSED'
          ? `<form id="ticket-reply-form" data-ticket="${esc(billet.id)}" class="mt-6">
              <div class="field"><label for="tr-body">${esc(t('ticket.yourReply'))}</label>
                <textarea id="tr-body" rows="3" required maxlength="5000"></textarea></div>
              ${isAdmin
                ? `<label class="check" style="margin-bottom:var(--space-4)">
                     <input id="tr-internal" type="checkbox" /><span class="small">${esc(t('ticket.internalCheckbox'))}</span>
                   </label>`
                : ''}
              <button class="btn" type="submit">${esc(t('ticket.reply'))}</button>
            </form>`
          : `<p class="small muted mt-6">${esc(t('ticket.closedNote'))}</p>`}
      </section>

      <aside class="stack">
        ${isAdmin
          ? `<section class="card">
              <h2 style="font-size:var(--text-md)">${esc(t('ticket.handling'))}</h2>
              <form id="ticket-update-form" data-ticket="${esc(billet.id)}">
                <div class="field"><label for="tu-status">${esc(t('ticket.statusLabel'))}</label>
                  <select id="tu-status">
                    ${TICKET_STATUSES.map(
                      (code) =>
                        `<option value="${code}"${code === billet.status ? ' selected' : ''}>${esc(ticketLabel('status', code))}</option>`,
                    ).join('')}
                  </select></div>
                <div class="field"><label for="tu-priority">${esc(t('ticket.priorityLabel'))}</label>
                  <select id="tu-priority">
                    ${TICKET_PRIORITIES.map(
                      (code) =>
                        `<option value="${code}"${code === billet.priority ? ' selected' : ''}>${esc(ticketLabel('priority', code))}</option>`,
                    ).join('')}
                  </select></div>
                <button class="btn btn-block" type="submit">${esc(t('ticket.update'))}</button>
              </form>
            </section>`
          : ''}

        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('ticket.summary'))}</h2>
          <p class="small muted" style="margin:0">${esc(t('ticket.requester', { name: billet.requester.name }))}</p>
          ${billet.assignedTo ? `<p class="small muted" style="margin:0">${esc(t('ticket.assignedTo', { name: billet.assignedTo.name }))}</p>` : ''}
          ${billet.order ? `<a class="btn btn-secondary btn-block btn-sm mt-6" href="/touma/commandes/${esc(billet.order.id)}" data-link>${esc(t('ticket.viewOrder'))}</a>` : ''}
          ${billet.status !== 'CLOSED' && !isAdmin
            ? `<button class="btn btn-ghost btn-block btn-sm mt-6" data-close-ticket="${esc(billet.id)}">${esc(t('ticket.closeIt'))}</button>`
            : ''}
        </section>
      </aside>
    </div>`;
}

/**
 * Vue vendeur : retours reçus, présentée avec les onglets de l'espace vendeur
 * pour que le vendeur ne change pas d'univers en traitant un retour.
 */
export async function sellerReturns(params, query) {
  const [{ tabs }, content] = await Promise.all([
    import('./views-seller.js'),
    returns(params, query, { scope: 'seller', embedded: true }),
  ]);
  return `<h1 style="font-size:var(--text-xl)">${esc(t('ret.received'))}</h1>${tabs('/touma/vendeur/retours')}${content}`;
}
/**
 * Vue administration : file complète des tickets, rendue dans la console
 * d'administration pour garder une seule barre latérale.
 */
export async function adminTickets(params, query) {
  const [{ layout }, content] = await Promise.all([
    import('./views-admin.js'),
    tickets(params, query, { scope: 'all', embedded: true }),
  ]);
  return layout('/touma/admin/assistance', t('ticket.support'), content);
}

/**
 * Après-vente et assistance : retours, remboursements, tickets.
 *
 * Aucune décision n'est prise ici : l'interface propose ce que l'API autorise
 * réellement (fenêtre de retour, quantités restantes, montants validés) et
 * affiche les montants tels que le serveur les a calculés.
 */
import { api, esc, emptyState, formatDate, money, session, statusPill, svg } from './core.js';
import { breadcrumb, pagination } from './components.js';

/** Libellés propres à l'après-vente (le mot « approuvé » n'y a pas le même sens qu'ailleurs). */
const RETURN_STATUS = {
  REQUESTED: 'Demande envoyée',
  APPROVED: 'Retour accepté',
  REJECTED: 'Retour refusé',
  IN_TRANSIT: 'Colis renvoyé',
  RECEIVED: 'Colis reçu',
  REFUNDED: 'Remboursé',
  CANCELLED: 'Demande annulée',
};

const RETURN_REASON = {
  DAMAGED: 'Article endommagé',
  NOT_AS_DESCRIBED: 'Non conforme à la description',
  WRONG_ITEM: 'Mauvais article livré',
  MISSING_PARTS: 'Pièces manquantes',
  NOT_DELIVERED: 'Jamais reçu',
  CHANGED_MIND: 'Je ne le souhaite plus',
  OTHER: 'Autre motif',
};

const TICKET_STATUS = {
  OPEN: 'Ouvert',
  IN_PROGRESS: 'En cours de traitement',
  PENDING_USER: 'En attente de votre réponse',
  RESOLVED: 'Résolu',
  CLOSED: 'Clos',
};

const TICKET_CATEGORY = {
  ORDER: 'Commande',
  PAYMENT: 'Paiement',
  DELIVERY: 'Livraison',
  RETURN: 'Retour',
  ACCOUNT: 'Compte',
  STORE: 'Boutique',
  VERIFICATION: 'Vérification',
  OTHER: 'Autre',
};

const TICKET_PRIORITY = { LOW: 'Basse', NORMAL: 'Normale', HIGH: 'Haute', URGENT: 'Urgente' };

const pill = (value, dict) => `<span class="status status-${esc(value)}">${esc(dict[value] ?? value)}</span>`;

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
      <li data-done="true"><strong>${esc(RETURN_STATUS.REQUESTED)}</strong><span>${formatDate(r.requestedAt, true)}</span></li>
      <li data-current="true"><strong>${esc(RETURN_STATUS[r.status])}</strong><span>${formatDate(r.decidedAt ?? r.closedAt ?? r.requestedAt, true)}</span></li>
    </ul>`;
  }
  const currentIndex = Math.max(0, RETURN_FLOW.findIndex((s) => s.key === r.status));
  return `<ul class="timeline">
    ${RETURN_FLOW.map((step, i) => {
      const done = i < currentIndex;
      const current = i === currentIndex;
      const at = step.at ? r[step.at] : null;
      return `<li data-done="${done}" data-current="${current}">
        <strong>${esc(RETURN_STATUS[step.key])}</strong>
        <span>${at ? formatDate(at, true) : done ? 'Effectué' : current ? 'En cours' : 'À venir'}</span>
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
  const title = scope === 'seller' ? 'Retours reçus' : 'Mes retours';

  const header = options.embedded
    ? ''
    : `${breadcrumb([{ label: 'Accueil', href: '/touma/' }, { label: title }])}
      <h1 style="font-size:var(--text-xl)">${title}</h1>`;

  if (!data.items.length && !status) {
    return `
      ${header}
      ${emptyState({
        title: 'Aucune demande de retour',
        body:
          scope === 'seller'
            ? 'Les demandes de vos acheteurs apparaîtront ici, avec le détail des articles concernés.'
            : 'Une commande ne vous convient pas ? Ouvrez une demande depuis le détail de la commande.',
        actionLabel: scope === 'seller' ? 'Voir mes ventes' : 'Mes commandes',
        actionHref: scope === 'seller' ? '/touma/vendeur/commandes' : '/touma/commandes',
        iconName: 'box',
      })}`;
  }

  const filters = ['', 'REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'REFUNDED', 'REJECTED'];
  return `
    ${header}
    <div class="chip-row" style="margin-bottom:var(--space-5)">
      ${filters
        .map(
          (f) =>
            `<a class="chip${status === f ? ' chip-active' : ''}" href="${base}${f ? `?statut=${f}` : ''}" data-link>${
              f ? esc(RETURN_STATUS[f]) : 'Tous'
            }</a>`,
        )
        .join('')}
    </div>

    <div class="stack">
      ${data.items
        .map(
          (r) => `<a class="card" href="/touma/retours/${esc(r.id)}" data-link style="display:block;color:inherit;text-decoration:none">
            <div class="row-between">
              <div style="min-width:0">
                <strong>${esc(r.reference)}</strong>
                <div class="small muted">Commande ${esc(r.order.orderNumber)} · ${esc(RETURN_REASON[r.reason] ?? r.reason)}</div>
                <div class="xs muted">${r.items.length} article(s) · demandé le ${formatDate(r.requestedAt)}</div>
              </div>
              <div class="row" style="gap:var(--space-3)">
                ${pill(r.status, RETURN_STATUS)}
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
      title: 'Choisissez une commande',
      body: 'Une demande de retour part toujours d’une commande livrée.',
      actionLabel: 'Mes commandes',
      actionHref: '/touma/commandes',
      iconName: 'box',
    });
  }

  const info = await api(`/returns/eligibility/${orderId}`);
  const returnable = info.items.filter((i) => i.returnable > 0);

  if (!info.eligible || !returnable.length) {
    return `
      ${breadcrumb([{ label: 'Mes commandes', href: '/touma/commandes' }, { label: 'Retour' }])}
      ${emptyState({
        title: 'Retour impossible pour cette commande',
        body: info.deadline
          ? `Le délai de ${info.windowDays} jours après livraison a expiré le ${formatDate(info.deadline)}.`
          : 'Cette commande n’est pas (ou plus) éligible à un retour. Ouvrez un litige ou contactez l’assistance.',
        actionLabel: 'Voir la commande',
        actionHref: `/touma/commandes/${esc(info.orderId)}`,
        iconName: 'alert',
      })}`;
  }

  return `
    ${breadcrumb([
      { label: 'Mes commandes', href: '/touma/commandes' },
      { label: info.orderNumber, href: `/touma/commandes/${info.orderId}` },
      { label: 'Demander un retour' },
    ])}
    <h1 style="font-size:var(--text-xl)">Demander un retour</h1>
    <p class="small muted">
      Commande ${esc(info.orderNumber)}${info.deadline ? ` · à faire avant le ${formatDate(info.deadline)}` : ''}.
      Le montant est calculé par TOUMA à partir des prix payés.
    </p>

    <form id="return-form" data-order="${esc(info.orderId)}" class="card">
      <div class="field">
        <label for="rr-reason">Motif du retour</label>
        <select id="rr-reason" required>
          ${info.reasons.map((r) => `<option value="${esc(r)}">${esc(RETURN_REASON[r] ?? r)}</option>`).join('')}
        </select>
      </div>

      <fieldset style="border:0;padding:0;margin:0 0 var(--space-4)">
        <legend class="small" style="font-weight:600;padding:0">Articles à retourner</legend>
        <div class="stack" style="gap:var(--space-2)">
          ${returnable
            .map(
              (i) => `<div class="row-between card" style="box-shadow:none;padding:var(--space-3)">
                <label class="check" style="border:0;padding:0;min-width:0;margin:0">
                  <input type="checkbox" class="rr-pick" data-item="${esc(i.orderItemId)}" />
                  <span style="min-width:0">
                    <strong>${esc(i.title)}</strong>
                    <span class="small muted" style="display:block">${money(i.unitPrice, i.currency)} · ${i.returnable} retournable(s)${
                      i.alreadyReturned ? ` · ${i.alreadyReturned} déjà demandé(s)` : ''
                    }</span>
                  </span>
                </label>
                <input type="number" class="rr-qty" data-item="${esc(i.orderItemId)}" min="1" max="${i.returnable}" value="1"
                  style="width:76px" aria-label="Quantité à retourner pour ${esc(i.title)}" />
              </div>`,
            )
            .join('')}
        </div>
      </fieldset>

      <div class="field">
        <label for="rr-comment">Précisions pour le vendeur</label>
        <textarea id="rr-comment" rows="3" maxlength="2000" placeholder="Décrivez le problème constaté."></textarea>
      </div>

      <div class="field">
        <label for="rr-photo">Photo justificative (lien)</label>
        <input id="rr-photo" type="url" maxlength="2000" placeholder="https://…" />
        <p class="xs muted" style="margin:var(--space-1) 0 0">Facultatif, mais une photo accélère nettement l’acceptation.</p>
      </div>

      <button class="btn btn-block" type="submit">Envoyer la demande</button>
    </form>`;
}

/** Détail d'un retour, avec les actions réellement permises à ce stade. */
export async function returnDetail(params) {
  const r = await api(`/returns/${params.id}`);
  const mine = session.user && r.buyer.id === session.user.id;
  const seller = session.user && !mine;
  const amount = r.approvedAmount ?? r.requestedAmount;

  const waitingNote = {
    REQUESTED: 'Le vendeur a été prévenu. Vous serez notifié dès qu’il aura répondu.',
    RECEIVED: 'Le vendeur a reçu votre colis : le remboursement est en cours de traitement.',
    IN_TRANSIT: 'Votre colis est en route vers le vendeur.',
  }[r.status];

  const buyerActions = [
    waitingNote ? `<p class="small muted" style="margin-top:0">${esc(waitingNote)}</p>` : '',
    r.status === 'APPROVED'
      ? `<form id="return-ship-form" data-return="${esc(r.id)}">
           <div class="field"><label for="rs-tracking">Numéro de suivi du colis renvoyé</label>
             <input id="rs-tracking" required minlength="3" maxlength="80" placeholder="Ex. CM-TD-889201" /></div>
           <button class="btn btn-block" type="submit">J’ai réexpédié le colis</button>
         </form>`
      : '',
    ['REQUESTED', 'APPROVED', 'IN_TRANSIT'].includes(r.status)
      ? `<button class="btn btn-ghost btn-block btn-sm" data-cancel-return="${esc(r.id)}">Retirer ma demande</button>`
      : '',
  ].join('');

  const sellerActions = [
    r.status === 'REQUESTED'
      ? `<form id="return-approve-form" data-return="${esc(r.id)}">
           <div class="field"><label for="ra-amount">Montant accepté (${esc(r.currency)})</label>
             <input id="ra-amount" type="text" inputmode="decimal" value="${esc(r.requestedAmount)}" />
             <p class="xs muted" style="margin:var(--space-1) 0 0">Au plus ${money(r.requestedAmount, r.currency)}.</p></div>
           <div class="field"><label for="ra-note">Note pour l’acheteur</label><input id="ra-note" maxlength="1000" /></div>
           <button class="btn btn-block" type="submit">Accepter le retour</button>
         </form>
         <form id="return-reject-form" data-return="${esc(r.id)}" class="mt-6">
           <div class="field"><label for="rj-note">Motif du refus</label>
             <textarea id="rj-note" rows="2" required minlength="5" maxlength="1000"></textarea></div>
           <button class="btn btn-secondary btn-block" type="submit">Refuser le retour</button>
         </form>`
      : '',
    ['APPROVED', 'IN_TRANSIT'].includes(r.status)
      ? `<form id="return-receive-form" data-return="${esc(r.id)}">
           <div class="field"><label for="rc-condition">État constaté</label>
             <input id="rc-condition" maxlength="200" placeholder="Ex. neuf, emballage ouvert" /></div>
           <label class="check" style="margin-bottom:var(--space-4)">
             <input id="rc-restock" type="checkbox" checked /><span class="small">Remettre les articles en stock</span>
           </label>
           <button class="btn btn-block" type="submit">J’ai reçu le colis</button>
         </form>`
      : '',
    ['APPROVED', 'RECEIVED'].includes(r.status)
      ? `<form id="return-refund-form" data-return="${esc(r.id)}" class="mt-6">
           <div class="field"><label for="rf-amount">Montant à rembourser (${esc(r.currency)})</label>
             <input id="rf-amount" type="text" inputmode="decimal" value="${esc(amount)}" /></div>
           <button class="btn btn-accent btn-block" type="submit">Rembourser ${money(amount, r.currency)}</button>
           <p class="xs muted" style="margin:var(--space-2) 0 0">Mouvement d’argent réel, tracé et irréversible : vérifiez le montant.</p>
         </form>`
      : '',
  ].join('');

  const actions = seller ? sellerActions : buyerActions;

  return `
    ${breadcrumb([{ label: 'Retours', href: seller ? '/touma/vendeur/retours' : '/touma/retours' }, { label: r.reference }])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px">Retour ${esc(r.reference)}</h1>
        <p class="small muted" style="margin:0">
          Commande <a href="/touma/commandes/${esc(r.order.id)}" data-link>${esc(r.order.orderNumber)}</a>
          · ${esc(r.store.name)} · demandé le ${formatDate(r.requestedAt, true)}
        </p>
      </div>
      ${pill(r.status, RETURN_STATUS)}
    </div>

    <div class="grid grid-2">
      <div class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">Articles retournés</h2>
          <div class="table-wrap" style="border:0">
            <table>
              <thead><tr><th>Article</th><th>Qté</th><th>Prix</th><th>Total</th></tr></thead>
              <tbody>
                ${r.items
                  .map(
                    (i) => `<tr>
                      <td>${esc(i.title)}${i.condition ? `<div class="xs muted">État : ${esc(i.condition)}</div>` : ''}</td>
                      <td>${i.quantity}</td><td>${money(i.unitPrice, i.currency)}</td><td>${money(i.lineTotal, i.currency)}</td>
                    </tr>`,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
          <div class="summary mt-6">
            <div class="summary-line"><span>Montant demandé</span><span>${money(r.requestedAmount, r.currency)}</span></div>
            ${r.refundShipping
              ? `<div class="summary-line"><span>dont frais de livraison</span><span>${money(r.order.shippingTotal, r.currency)}</span></div>`
              : ''}
            ${r.approvedAmount !== null
              ? `<div class="summary-line summary-total"><span>Montant accepté</span><span>${money(r.approvedAmount, r.currency)}</span></div>`
              : ''}
          </div>
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">Motif</h2>
          <p style="margin:0"><strong>${esc(RETURN_REASON[r.reason] ?? r.reason)}</strong></p>
          ${r.comment ? `<p class="small" style="white-space:pre-line">${esc(r.comment)}</p>` : ''}
          ${Array.isArray(r.evidence) && r.evidence.length
            ? `<div class="row" style="gap:var(--space-2);flex-wrap:wrap">${r.evidence
                .map((e) => `<a class="badge" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${svg('inbox')} ${esc(e.name)}</a>`)
                .join('')}</div>`
            : ''}
          ${r.sellerNote ? `<p class="small muted">Réponse du vendeur : ${esc(r.sellerNote)}</p>` : ''}
          ${r.rejectionNote ? `<p class="small" style="color:var(--danger)">Refus : ${esc(r.rejectionNote)}</p>` : ''}
          ${r.trackingNumber ? `<p class="small muted">Colis renvoyé — suivi ${esc(r.trackingNumber)}</p>` : ''}
        </section>

        ${r.refunds.length
          ? `<section class="card">
              <h2 style="font-size:var(--text-md)">Remboursements</h2>
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
          <h2 style="font-size:var(--text-md)">Où en est ma demande ?</h2>
          ${returnTimeline(r)}
          ${['REJECTED', 'CANCELLED'].includes(r.status)
            ? `<p class="small" style="color:var(--danger);margin:var(--space-3) 0 0">${esc(RETURN_STATUS[r.status])}.</p>`
            : ''}
        </section>

        ${actions ? `<section class="card"><h2 style="font-size:var(--text-md)">Actions</h2>${actions}</section>` : ''}

        <section class="card">
          <h2 style="font-size:var(--text-md)">Besoin d’aide ?</h2>
          <p class="small muted">L’assistance TOUMA peut intervenir si vous ne trouvez pas d’accord.</p>
          <a class="btn btn-secondary btn-block btn-sm" href="/touma/aide/nouveau?commande=${esc(r.order.id)}&sujet=RETURN" data-link>Contacter l’assistance</a>
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
  const title = scope === 'all' ? 'File d’assistance' : 'Assistance';

  // Intégrée à la console d'administration, la vue n'apporte pas son propre titre.
  const header = options.embedded
    ? ''
    : `${breadcrumb([{ label: 'Accueil', href: '/touma/' }, { label: title }])}
      <div class="row-between" style="margin-bottom:var(--space-4)">
        <h1 style="font-size:var(--text-xl);margin:0">${title}</h1>
        <a class="btn btn-sm" href="/touma/aide/nouveau" data-link>Nouvelle demande</a>
      </div>`;

  return `
    ${header}
    <div class="chip-row" style="margin-bottom:var(--space-5)">
      ${['', 'OPEN', 'IN_PROGRESS', 'PENDING_USER', 'RESOLVED', 'CLOSED']
        .map(
          (f) =>
            `<a class="chip${status === f ? ' chip-active' : ''}" href="${base}${f ? `?statut=${f}` : ''}" data-link>${
              f ? esc(TICKET_STATUS[f]) : 'Tous'
            }</a>`,
        )
        .join('')}
    </div>

    ${data.items.length
      ? `<div class="stack">
          ${data.items
            .map(
              (t) => `<a class="card" href="/touma/aide/${esc(t.id)}" data-link style="display:block;color:inherit;text-decoration:none">
                <div class="row-between">
                  <div style="min-width:0">
                    <strong>${esc(t.subject)}</strong>
                    <div class="small muted">${esc(t.reference)} · ${esc(TICKET_CATEGORY[t.category] ?? t.category)} · ${t.messageCount} message(s)</div>
                    ${scope === 'all' ? `<div class="xs muted">${esc(t.requester.name)}</div>` : ''}
                  </div>
                  <div class="row" style="gap:var(--space-2)">
                    ${pill(t.priority, TICKET_PRIORITY)}
                    ${pill(t.status, TICKET_STATUS)}
                    <span class="xs muted">${formatDate(t.lastReplyAt, true)}</span>
                  </div>
                </div>
              </a>`,
            )
            .join('')}
        </div>
        ${pagination(data, (p) => `${base}?page=${p}${status ? `&statut=${status}` : ''}`)}`
      : emptyState({
          title: scope === 'all' ? 'Aucun ticket dans la file' : 'Aucune demande en cours',
          body:
            scope === 'all'
              ? 'Les demandes des acheteurs et des vendeurs arriveront ici.'
              : 'Une question sur une commande, un paiement ou votre boutique ? Écrivez-nous.',
          actionLabel: scope === 'all' ? 'Tableau de bord' : 'Ouvrir une demande',
          actionHref: scope === 'all' ? '/touma/admin' : '/touma/aide/nouveau',
          iconName: 'inbox',
        })}`;
}

export async function newTicket(_params, query) {
  const orderId = query.get('commande') || '';
  const category = query.get('sujet') || (orderId ? 'ORDER' : 'OTHER');

  return `
    ${breadcrumb([{ label: 'Assistance', href: '/touma/aide' }, { label: 'Nouvelle demande' }])}
    <h1 style="font-size:var(--text-xl)">Comment pouvons-nous aider ?</h1>
    <p class="small muted">Nous répondons en français. Décrivez le problème le plus précisément possible.</p>

    <form id="ticket-form" class="card"${orderId ? ` data-order="${esc(orderId)}"` : ''}>
      <div class="field">
        <label for="t-subject">Sujet</label>
        <input id="t-subject" required minlength="5" maxlength="200" placeholder="Ex. Mon colis est bloqué à la frontière" />
      </div>
      <div class="field">
        <label for="t-category">Catégorie</label>
        <select id="t-category">
          ${Object.entries(TICKET_CATEGORY)
            .map(([value, text]) => `<option value="${esc(value)}"${value === category ? ' selected' : ''}>${esc(text)}</option>`)
            .join('')}
        </select>
      </div>
      <div class="field">
        <label for="t-message">Votre message</label>
        <textarea id="t-message" rows="6" required minlength="10" maxlength="5000"></textarea>
      </div>
      <button class="btn btn-block" type="submit">Envoyer ma demande</button>
    </form>`;
}

export async function ticket(params) {
  const t = await api(`/support/tickets/${params.id}`);
  const isAdmin = session.user?.role === 'ADMIN';

  return `
    ${breadcrumb([{ label: 'Assistance', href: isAdmin ? '/touma/admin/assistance' : '/touma/aide' }, { label: t.reference }])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div>
        <h1 style="font-size:var(--text-lg);margin-bottom:2px">${esc(t.subject)}</h1>
        <p class="small muted" style="margin:0">
          ${esc(t.reference)} · ${esc(TICKET_CATEGORY[t.category] ?? t.category)} · ouvert le ${formatDate(t.createdAt)}
          ${t.order ? ` · commande ${esc(t.order.orderNumber)}` : ''}
        </p>
      </div>
      <div class="row" style="gap:var(--space-2)">${pill(t.priority, TICKET_PRIORITY)}${pill(t.status, TICKET_STATUS)}</div>
    </div>

    <div class="grid grid-2">
      <section class="card">
        <div class="stack" style="gap:var(--space-3)">
          ${t.messages
            .map(
              (m) => `<div class="notif-item"${m.internal ? ' style="border-left:3px solid var(--warning)"' : ''}>
                <strong>${esc(m.fromSupport ? 'Assistance TOUMA' : m.author.name)}</strong>
                ${m.internal ? '<span class="badge">Note interne</span>' : ''}
                <p style="white-space:pre-line">${esc(m.body)}</p>
                <span class="xs muted">${formatDate(m.createdAt, true)}</span>
              </div>`,
            )
            .join('')}
        </div>

        ${t.status !== 'CLOSED'
          ? `<form id="ticket-reply-form" data-ticket="${esc(t.id)}" class="mt-6">
              <div class="field"><label for="tr-body">Votre réponse</label>
                <textarea id="tr-body" rows="3" required maxlength="5000"></textarea></div>
              ${isAdmin
                ? `<label class="check" style="margin-bottom:var(--space-4)">
                     <input id="tr-internal" type="checkbox" /><span class="small">Note interne (invisible pour le demandeur)</span>
                   </label>`
                : ''}
              <button class="btn" type="submit">Répondre</button>
            </form>`
          : '<p class="small muted mt-6">Ce ticket est clos. Ouvrez une nouvelle demande si besoin.</p>'}
      </section>

      <aside class="stack">
        ${isAdmin
          ? `<section class="card">
              <h2 style="font-size:var(--text-md)">Traitement</h2>
              <form id="ticket-update-form" data-ticket="${esc(t.id)}">
                <div class="field"><label for="tu-status">Statut</label>
                  <select id="tu-status">
                    ${Object.entries(TICKET_STATUS)
                      .map(([v, text]) => `<option value="${esc(v)}"${v === t.status ? ' selected' : ''}>${esc(text)}</option>`)
                      .join('')}
                  </select></div>
                <div class="field"><label for="tu-priority">Priorité</label>
                  <select id="tu-priority">
                    ${Object.entries(TICKET_PRIORITY)
                      .map(([v, text]) => `<option value="${esc(v)}"${v === t.priority ? ' selected' : ''}>${esc(text)}</option>`)
                      .join('')}
                  </select></div>
                <button class="btn btn-block" type="submit">Mettre à jour</button>
              </form>
            </section>`
          : ''}

        <section class="card">
          <h2 style="font-size:var(--text-md)">Récapitulatif</h2>
          <p class="small muted" style="margin:0">Demandeur : ${esc(t.requester.name)}</p>
          ${t.assignedTo ? `<p class="small muted" style="margin:0">Pris en charge par ${esc(t.assignedTo.name)}</p>` : ''}
          ${t.order ? `<a class="btn btn-secondary btn-block btn-sm mt-6" href="/touma/commandes/${esc(t.order.id)}" data-link>Voir la commande</a>` : ''}
          ${t.status !== 'CLOSED' && !isAdmin
            ? `<button class="btn btn-ghost btn-block btn-sm mt-6" data-close-ticket="${esc(t.id)}">C’est réglé, fermer</button>`
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
  return `<h1 style="font-size:var(--text-xl)">Retours reçus</h1>${tabs('/touma/vendeur/retours')}${content}`;
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
  return layout('/touma/admin/assistance', 'Assistance', content);
}

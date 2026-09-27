/**
 * Litiges : le dossier, tel que chaque partie a le droit de le voir.
 *
 * Le moteur existait déjà entièrement — preuves empreintes, registre, délais,
 * escalade, décision figée — et **personne ne pouvait le regarder**. Un acheteur
 * ouvrait un litige, recevait un message de confirmation, et n'avait plus aucun
 * écran : ni l'avancement, ni la possibilité de verser une pièce, ni la réponse
 * du vendeur. L'administration tranchait depuis une ligne de liste, avec deux
 * boutons et une invite du navigateur, sans voir les preuves sur lesquelles elle
 * décidait.
 *
 * Trois règles tenues ici, parce qu'elles viennent du moteur et qu'une interface
 * qui les contredit ferait mentir le produit :
 *
 * - **Rien ne se décide tout seul.** Un délai dépassé porte le dossier devant un
 *   humain ; il ne rembourse ni ne sanctionne personne. L'écran le dit avec ces
 *   mots.
 * - **Une pièce écartée reste au dossier**, avec son motif, visible de tous. On
 *   ne fait pas disparaître une pièce d'un écran après qu'une décision a été
 *   prise dessus.
 * - **Le registre est une réponse à « où est passé mon argent »**, pas un
 *   tableau comptable. Les deux parties y ont accès, et personne d'autre.
 */
import { api, esc, emptyState, formatDate, money, session, svg } from './core.js';
import { breadcrumb } from './components.js';
import { t } from './i18n.js';

/**
 * Les codes du moteur — statut, catégorie, motif, priorité, nature de l'issue,
 * type de pièce, type de mouvement — sont traduits dans `i18n.js` comme les
 * statuts de commande : une seule table, tous les écrans.
 *
 * Le statut d'un litige a sa propre famille de clés, séparée des statuts de
 * commande, et ce n'est pas un doublon : un litige « rejeté » n'est pas une
 * boutique « refusée », un litige « clos » n'est pas une commande « fermée ».
 */
const libelle = (famille, code) => t(`dispute.${famille}.${code}`);

const CLOSED = ['RESOLVED_BUYER', 'RESOLVED_SELLER', 'REJECTED', 'CLOSED'];

/** L'ordre des natures d'issue proposées — l'ordre, pas les libellés. */
const RESOLUTION_TYPES = [
  'BUYER_REFUND_FULL',
  'BUYER_REFUND_PARTIAL',
  'RETURN_AND_REFUND',
  'REPLACEMENT',
  'NO_REFUND',
  'SELLER_FAVOR',
  'BUYER_FAVOR',
  'MUTUAL_AGREEMENT',
  'OTHER',
];

const pill = (value, famille = 'status') => `<span class="status status-${esc(value)}">${esc(libelle(famille, value))}</span>`;

/** Taille d'un fichier, dite comme on la dit à quelqu'un. */
const fileSize = (bytes) =>
  bytes > 1024 * 1024
    ? t('unit.mb', { value: (bytes / (1024 * 1024)).toFixed(1) })
    : t('unit.kb', { value: Math.max(1, Math.round(bytes / 1024)) });

/**
 * Délai restant, en clair. Un compte à rebours affiché en heures et en minutes
 * donnerait l'illusion d'une horloge qui tranche ; ce délai n'a qu'un effet,
 * porter le dossier devant un humain.
 */
function deadlineNote(d) {
  const limite = d.status === 'SELLER_RESPONSE_REQUIRED' ? d.sellerResponseDeadline : d.status === 'BUYER_RESPONSE_REQUIRED' ? d.buyerResponseDeadline : null;
  if (!limite) return '';
  const reste = new Date(limite).getTime() - Date.now();
  const who = t(d.status === 'SELLER_RESPONSE_REQUIRED' ? 'dispute.whoSeller' : 'dispute.whoBuyer');
  if (reste <= 0) {
    return `<p class="small muted">${esc(t('dispute.deadlineMissed', { who }))} <strong>${esc(t('dispute.noDecision'))}</strong></p>`;
  }
  const heures = Math.round(reste / 3_600_000);
  const approx = heures <= 48 ? t('dispute.approxHours', { hours: heures }) : '';
  return `<p class="small muted">${esc(t('dispute.deadlineOpen', { who, date: formatDate(limite, true), approx }))}</p>`;
}

// ── Listes ─────────────────────────────────────────────────────────────────

/** Liste des litiges. Le serveur décide déjà de la portée selon le rôle. */
export async function disputes(_params, _query, options = {}) {
  const data = await api('/disputes');
  const base = options.base ?? '/touma/litiges';
  const title = options.title ?? t('dispute.mine');

  const header = options.embedded
    ? ''
    : `${breadcrumb([{ label: t('nav.home'), href: '/touma/' }, { label: title }])}
       <h1 style="font-size:var(--text-xl)">${esc(title)}</h1>`;

  if (!data.items.length) {
    return `${header}${emptyState({
      title: t('dispute.emptyTitle'),
      body: t(options.scope === 'seller' ? 'dispute.emptyBodySeller' : 'dispute.emptyBodyBuyer'),
      actionLabel: t(options.scope === 'seller' ? 'dispute.emptyActionSeller' : 'dispute.emptyActionBuyer'),
      actionHref: options.scope === 'seller' ? '/touma/vendeur/commandes' : '/touma/commandes',
      iconName: 'shield',
    })}`;
  }

  return `${header}
    <div class="stack">
      ${data.items
        .map(
          (d) => `<a class="card" href="${base}/${esc(d.id)}" data-link style="display:block;color:inherit;text-decoration:none">
            <div class="row-between">
              <div style="min-width:0">
                <strong>${esc(t('dispute.orderLine', { number: d.order.orderNumber }))}</strong>
                <div class="small muted">${esc(libelle('category', d.category))} · ${esc(t('dispute.openedOn', { date: formatDate(d.createdAt) }))}</div>
                ${d.escalatedAt ? `<div class="xs muted">${esc(t('dispute.escalatedOn', { date: formatDate(d.escalatedAt) }))}</div>` : ''}
              </div>
              <div class="row" style="gap:var(--space-3)">
                ${pill(d.status)}
                <strong>${money(d.order.total, d.order.currency)}</strong>
              </div>
            </div>
          </a>`,
        )
        .join('')}
    </div>`;
}

// ── Le dossier ─────────────────────────────────────────────────────────────

function evidenceBlock(d, items, { canRemove, canAdd }) {
  const actives = items.filter((e) => !e.removedAt);
  const ecartees = items.filter((e) => e.removedAt);

  return `<section class="card">
    <h2 style="font-size:var(--text-md)">${esc(t('dispute.evidenceTitle'))}</h2>
    <p class="xs muted">${esc(t('dispute.evidenceHint'))}</p>

    ${
      actives.length
        ? `<ul class="evidence-list">
            ${actives
              .map(
                (e) => `<li>
                  <a class="attachment" href="${esc(e.url)}" rel="noopener noreferrer" target="_blank" download>
                    ${svg('inbox')} <span>${esc(e.filename)}</span> <span class="xs muted">${fileSize(e.sizeBytes)}</span>
                  </a>
                  <div class="xs muted">
                    ${esc(
                      t('dispute.evidenceMeta', {
                        kind: libelle('evidenceKind', e.kind),
                        name: e.uploadedBy?.name ?? t('dispute.unknownUploader'),
                        date: formatDate(e.createdAt, true),
                      }),
                    )}
                  </div>
                  ${e.note ? `<div class="small">${esc(e.note)}</div>` : ''}
                  <div class="xs muted evidence-sum" dir="ltr" title="${esc(t('dispute.checksumTitle'))}">${esc(e.checksum.slice(0, 16))}…</div>
                  ${canRemove ? `<button class="btn btn-ghost btn-sm" data-remove-evidence="${esc(e.id)}">${esc(t('dispute.removeEvidence'))}</button>` : ''}
                </li>`,
              )
              .join('')}
          </ul>`
        : `<p class="small muted">${esc(t('dispute.noEvidence'))}</p>`
    }

    ${
      ecartees.length
        ? `<div class="mt-6">
            <h3 class="small" style="margin:0 0 var(--space-2)">${esc(t('dispute.removedTitle'))}</h3>
            <p class="xs muted">${esc(t('dispute.removedHint'))}</p>
            <ul class="evidence-list">
              ${ecartees
                .map(
                  (e) => `<li data-removed="true">
                    <span>${esc(e.filename)}</span>
                    <div class="xs muted">${esc(
                      t('dispute.removedOn', {
                        date: formatDate(e.removedAt, true),
                        reason: e.removalReason ?? t('dispute.noReason'),
                      }),
                    )}</div>
                  </li>`,
                )
                .join('')}
            </ul>
          </div>`
        : ''
    }

    ${
      canAdd
        ? `<div class="mt-6">
            <label class="btn btn-secondary btn-block btn-sm" for="d-file">${esc(t('dispute.addEvidence'))}</label>
            <input id="d-file" type="file" data-dispute="${esc(d.id)}" hidden />
            <p class="xs muted">${esc(t('dispute.addEvidenceHint'))}</p>
          </div>`
        : ''
    }
  </section>`;
}

function ledgerBlock(entries, currency) {
  if (!entries.length) return '';
  return `<section class="card">
    <h2 style="font-size:var(--text-md)">${esc(t('dispute.ledgerTitle'))}</h2>
    <p class="xs muted">${esc(t('dispute.ledgerHint'))}</p>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>${esc(t('dispute.col.movement'))}</th><th>${esc(t('dispute.col.amount'))}</th><th>${esc(t('dispute.col.state'))}</th><th>${esc(t('dispute.col.date'))}</th></tr></thead>
        <tbody>
          ${entries
            .map(
              (e) => `<tr>
                <td>${esc(libelle('ledgerType', e.type))}</td>
                <td>${e.direction === 'DEBIT' ? '−' : '+'} ${money(e.amount, e.currency ?? currency)}</td>
                <td>${
                  e.heldByDisputeId && !e.releasedAt
                    ? `<span class="status status-ESCALATED">${esc(t('dispute.held'))}</span>`
                    : e.releasedAt
                      ? `<span class="xs muted">${esc(t('dispute.heldUntil', { date: formatDate(e.releasedAt) }))}</span>`
                      : `<span class="xs muted">${esc(t('dispute.available'))}</span>`
                }</td>
                <td class="xs muted">${formatDate(e.createdAt)}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  </section>`;
}

function resolutionBlock(d) {
  if (!d.resolvedAt) return '';
  const snap = d.resolutionSnapshot ?? {};
  return `<section class="card" data-resolution>
    <h2 style="font-size:var(--text-md)">${esc(t('dispute.decisionTitle'))}</h2>
    <div class="row" style="gap:var(--space-3);flex-wrap:wrap">
      ${pill(d.status)}
      ${d.resolutionType ? `<span class="chip">${esc(libelle('resolutionType', d.resolutionType))}</span>` : ''}
      ${d.refundAmount ? `<strong>${money(d.refundAmount, d.order.currency)}</strong>` : ''}
    </div>
    ${d.resolution ? `<p class="small" style="white-space:pre-wrap">${esc(d.resolution)}</p>` : ''}
    <p class="xs muted">${esc(t('dispute.decidedOn', { date: formatDate(d.resolvedAt, true) }))}</p>
    ${
      Array.isArray(snap.evidence) && snap.evidence.length
        ? `<p class="xs muted">${esc(
            t('dispute.evidenceAtDecision', {
              // La liste est construite d'abord : la phrase ne place pas
              // forcément l'énumération au même endroit d'une langue à l'autre.
              list: snap.evidence.map((e) => `${e.filename} (${String(e.checksum).slice(0, 12)}…)`).join(', '),
            }),
          )}</p>`
        : ''
    }
  </section>`;
}

/** Le dossier complet. La même vue pour l'acheteur et le vendeur : ils voient le même dossier. */
export async function disputeDetail(params, _query, options = {}) {
  const isAdmin = options.admin === true;
  const [d, ledger, pieces] = await Promise.all([
    api(`/disputes/${params.id}`),
    api(`/disputes/${params.id}/ledger`).catch(() => ({ items: [] })),
    // Les pièces viennent de leur propre route : c'est elle qui rend les liens
    // signés, valables quelques minutes. Un lien ordinaire suffit alors — pas
    // de jeton à transporter dans l'URL, pas de téléchargement à réécrire.
    api(`/disputes/${params.id}/evidence`).catch(() => ({ items: [] })),
  ]);

  const clos = CLOSED.includes(d.status);
  const moi = session.user?.id;
  const jeSuisAcheteur = d.order.buyerId === moi;

  const base = isAdmin ? '/touma/admin/litiges' : jeSuisAcheteur ? '/touma/litiges' : '/touma/vendeur/litiges';

  const fil = d.messages.length
    ? `<ul class="dispute-thread">
        ${d.messages
          .map(
            (m) => `<li${m.internal ? ' data-internal="true"' : ''}${m.authorId === moi ? ' data-mine="true"' : ''}>
              <div class="xs muted">${esc(m.author?.name ?? t('dispute.participant'))}${
                m.internal ? ` · ${esc(t('dispute.internalNote'))}` : ''
              } · ${formatDate(m.createdAt, true)}</div>
              <div class="msg-body" style="white-space:pre-wrap">${esc(m.body)}</div>
            </li>`,
          )
          .join('')}
      </ul>`
    : `<p class="small muted">${esc(t('dispute.noMessages'))}</p>`;

  return `
    ${breadcrumb([
      { label: t(isAdmin ? 'dispute.tab' : 'dispute.mine'), href: base },
      { label: t('dispute.orderLine', { number: d.order.orderNumber }) },
    ])}

    <div class="row-between" style="flex-wrap:wrap;gap:var(--space-3)">
      <h1 style="font-size:var(--text-xl);margin:0">${esc(t('dispute.detailTitle', { number: d.order.orderNumber }))}</h1>
      ${pill(d.status)}
    </div>
    <p class="small muted">
      ${esc(libelle('category', d.category))} · ${esc(t('dispute.openedOn', { date: formatDate(d.createdAt) }))}
      ${isAdmin ? ` · ${esc(t('dispute.priorityLine', { priority: libelle('priority', d.priority) }))}` : ''}
    </p>
    ${deadlineNote(d)}
    ${
      d.escalatedAt && !clos
        ? `<div class="alert alert-info">${svg('shield')} ${esc(t('dispute.escalatedBanner', { date: formatDate(d.escalatedAt) }))} <strong>${esc(
            t('dispute.escalatedNoDecision'),
          )}</strong> ${esc(t('dispute.humanReviews'))}</div>`
        : ''
    }

    <div class="grid grid-2">
      <div class="stack">
        ${resolutionBlock(d)}

        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('dispute.complaint'))}</h2>
          <p class="small"><strong>${esc(libelle('reason', d.reason))}</strong></p>
          ${d.details ? `<p class="small" style="white-space:pre-wrap">${esc(d.details)}</p>` : ''}
          <p class="xs muted">${esc(t(d.openedById === d.order.buyerId ? 'dispute.openedByBuyer' : 'dispute.openedBySeller'))}</p>
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('dispute.exchanges'))}</h2>
          ${fil}
          ${
            clos
              ? `<p class="small muted mt-6">${esc(t('dispute.closedNoMessages'))}</p>`
              : `<form id="dispute-message-form" data-dispute="${esc(d.id)}" class="mt-6">
                  <div class="field">
                    <label for="dm-body">${esc(t('dispute.yourMessage'))}</label>
                    <textarea id="dm-body" rows="3" maxlength="2000" required placeholder="${esc(t('dispute.messagePlaceholder'))}"></textarea>
                  </div>
                  ${
                    isAdmin
                      ? `<label class="check"><input type="checkbox" id="dm-internal" /> ${esc(t('dispute.internalCheckbox'))}</label>`
                      : ''
                  }
                  <button class="btn btn-primary btn-block btn-sm" type="submit">${esc(t('action.send'))}</button>
                </form>`
          }
        </section>

        ${isAdmin && !clos ? adminDecisionForm(d) : ''}
      </div>

      <aside class="stack">
        ${evidenceBlock(d, pieces.items ?? [], { canRemove: isAdmin, canAdd: !clos })}
        ${ledgerBlock(ledger.items ?? [], d.order.currency)}
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('dispute.orderCard'))}</h2>
          <p class="small"><strong>${money(d.order.total, d.order.currency)}</strong></p>
          <a class="btn btn-ghost btn-block btn-sm" href="${jeSuisAcheteur ? `/touma/commandes/${esc(d.orderId)}` : `/touma/vendeur/commandes/${esc(d.orderId)}`}" data-link>${esc(t('dispute.viewOrder'))}</a>
        </section>
      </aside>
    </div>`;
}

/**
 * Formulaire de décision. Réservé à l'administration, et volontairement
 * exigeant : une motivation est obligatoire — c'est elle que les deux parties
 * liront, et c'est elle qui reste au dossier quand tout le monde aura oublié le
 * contexte.
 */
function adminDecisionForm(d) {
  return `<section class="card" id="dispute-decision">
    <h2 style="font-size:var(--text-md)">${esc(t('dispute.decide'))}</h2>
    <p class="xs muted">${esc(t('dispute.decideHint'))}</p>
    <form id="dispute-resolve-form" data-dispute="${esc(d.id)}" data-currency="${esc(d.order.currency)}">
      <div class="field">
        <label for="dr-decision">${esc(t('dispute.outcome'))}</label>
        <select id="dr-decision" required>
          ${['RESOLVED_BUYER', 'RESOLVED_SELLER', 'REJECTED', 'CLOSED']
            .map((code) => `<option value="${code}">${esc(libelle('decision', code))}</option>`)
            .join('')}
        </select>
      </div>
      <div class="field">
        <label for="dr-type">${esc(t('dispute.natureOfOutcome'))}</label>
        <select id="dr-type">
          <option value="">${esc(t('dispute.unspecified'))}</option>
          ${RESOLUTION_TYPES.map((code) => `<option value="${code}">${esc(libelle('resolutionType', code))}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="dr-amount">${esc(t('dispute.refundAmount', { currency: d.order.currency }))}</label>
        <input id="dr-amount" type="text" inputmode="decimal" placeholder="${esc(t('dispute.refundPlaceholder'))}" />
        <p class="xs muted">${esc(t('dispute.refundHint'))}</p>
      </div>
      <div class="field">
        <label for="dr-resolution">${esc(t('dispute.motivation'))}</label>
        <textarea id="dr-resolution" rows="4" maxlength="2000" required></textarea>
      </div>
      <button class="btn btn-primary btn-block" type="submit">${esc(t('dispute.saveDecision'))}</button>
    </form>
  </section>`;
}

// ── Enveloppes par rôle ────────────────────────────────────────────────────

/** Vendeur : ses litiges, dans les onglets de l'espace vendeur. */
export async function sellerDisputes(params, query) {
  const [{ tabs }, content] = await Promise.all([
    import('./views-seller.js'),
    disputes(params, query, { scope: 'seller', base: '/touma/vendeur/litiges', title: t('dispute.tab'), embedded: true }),
  ]);
  return `<h1 style="font-size:var(--text-xl)">${esc(t('dispute.sellerTitle'))}</h1>${tabs('/touma/vendeur/litiges')}${content}`;
}

export async function sellerDisputeDetail(params, query) {
  return disputeDetail(params, query);
}

/*
 * La file d'administration reste celle de la console (paginée, avec les
 * compteurs de messages et de pièces) : elle était bonne. Ce qui manquait, et
 * qui suit, c'est le dossier — on n'y tranchait qu'avec deux boutons et une
 * invite du navigateur, sans voir une seule pièce.
 */

export async function adminDisputeDetail(params, query) {
  const [{ layout }, content] = await Promise.all([
    import('./views-admin.js'),
    disputeDetail(params, query, { admin: true }),
  ]);
  return layout('/touma/admin/litiges', t('dispute.tab'), content);
}

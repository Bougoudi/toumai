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

const STATUS = {
  OPEN: 'Ouvert',
  SELLER_RESPONSE_REQUIRED: 'En attente du vendeur',
  BUYER_RESPONSE_REQUIRED: 'En attente de l’acheteur',
  UNDER_REVIEW: 'En cours d’examen',
  MEDIATION: 'En médiation',
  ESCALATED: 'Confié à l’assistance',
  RESOLVED_BUYER: 'Tranché en faveur de l’acheteur',
  RESOLVED_SELLER: 'Tranché en faveur du vendeur',
  REJECTED: 'Litige rejeté',
  CLOSED: 'Clos',
};

const CATEGORY = {
  NON_DELIVERY: 'Jamais livré',
  LATE_DELIVERY: 'Livré en retard',
  DAMAGED_ITEM: 'Marchandise endommagée',
  WRONG_ITEM: 'Mauvais article',
  NOT_AS_DESCRIBED: 'Non conforme à la description',
  QUALITY: 'Qualité insuffisante',
  MISSING_QUANTITY: 'Quantité manquante',
  PAYMENT: 'Problème de paiement',
  REFUND: 'Problème de remboursement',
  FRAUD: 'Suspicion de fraude',
  OTHER: 'Autre',
};

const REASON = {
  NOT_RECEIVED: 'Commande non reçue',
  DAMAGED: 'Marchandise endommagée',
  NOT_AS_DESCRIBED: 'Non conforme à la description',
  WRONG_ITEM: 'Mauvais article',
  OTHER: 'Autre',
};

/** Ordre de passage de l'assistance — jamais une décision. */
const PRIORITY = { LOW: 'Basse', NORMAL: 'Normale', HIGH: 'Haute', CRITICAL: 'Critique' };

const RESOLUTION_TYPE = {
  BUYER_REFUND_FULL: 'Remboursement intégral à l’acheteur',
  BUYER_REFUND_PARTIAL: 'Remboursement partiel',
  RETURN_AND_REFUND: 'Retour puis remboursement',
  REPLACEMENT: 'Remplacement de l’article',
  NO_REFUND: 'Aucun remboursement',
  SELLER_FAVOR: 'En faveur du vendeur',
  BUYER_FAVOR: 'En faveur de l’acheteur',
  MUTUAL_AGREEMENT: 'Accord amiable',
  OTHER: 'Autre',
};

const EVIDENCE_KIND = {
  PHOTO: 'Photo',
  VIDEO: 'Vidéo',
  DOCUMENT: 'Document',
  INVOICE: 'Facture',
  TRACKING: 'Preuve de suivi',
  OTHER: 'Autre',
};

const LEDGER_TYPE = {
  SALE: 'Vente',
  COMMISSION: 'Commission TOUMA',
  REFUND: 'Remboursement',
  COMMISSION_REVERSAL: 'Commission rendue',
  PAYOUT: 'Versement',
  ADJUSTMENT: 'Ajustement',
};

const CLOSED = ['RESOLVED_BUYER', 'RESOLVED_SELLER', 'REJECTED', 'CLOSED'];

const pill = (value, dict) => `<span class="status status-${esc(value)}">${esc(dict[value] ?? value)}</span>`;

/** Taille d'un fichier, dite comme on la dit à quelqu'un. */
const fileSize = (bytes) =>
  bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;

/**
 * Délai restant, en clair. Un compte à rebours affiché en heures et en minutes
 * donnerait l'illusion d'une horloge qui tranche ; ce délai n'a qu'un effet,
 * porter le dossier devant un humain.
 */
function deadlineNote(d) {
  const limite = d.status === 'SELLER_RESPONSE_REQUIRED' ? d.sellerResponseDeadline : d.status === 'BUYER_RESPONSE_REQUIRED' ? d.buyerResponseDeadline : null;
  if (!limite) return '';
  const reste = new Date(limite).getTime() - Date.now();
  const qui = d.status === 'SELLER_RESPONSE_REQUIRED' ? 'Le vendeur' : 'L’acheteur';
  if (reste <= 0) {
    return `<p class="small muted">${qui} n’a pas répondu dans le délai. Le dossier part vers l’assistance TOUMA — <strong>aucune décision n’est prise pour autant</strong>.</p>`;
  }
  const heures = Math.round(reste / 3_600_000);
  return `<p class="small muted">${qui} a jusqu’au ${formatDate(limite, true)} pour répondre${
    heures <= 48 ? ` (environ ${heures} h)` : ''
  }. Passé ce délai, le dossier est confié à l’assistance — ce n’est pas une décision.</p>`;
}

// ── Listes ─────────────────────────────────────────────────────────────────

/** Liste des litiges. Le serveur décide déjà de la portée selon le rôle. */
export async function disputes(_params, _query, options = {}) {
  const data = await api('/disputes');
  const base = options.base ?? '/touma/litiges';
  const title = options.title ?? 'Mes litiges';

  const header = options.embedded
    ? ''
    : `${breadcrumb([{ label: 'Accueil', href: '/touma/' }, { label: title }])}
       <h1 style="font-size:var(--text-xl)">${title}</h1>`;

  if (!data.items.length) {
    return `${header}${emptyState({
      title: 'Aucun litige',
      body:
        options.scope === 'seller'
          ? 'Les litiges ouverts sur vos ventes apparaîtront ici, avec le délai dont vous disposez pour répondre.'
          : 'Un problème sur une commande se règle d’abord avec le vendeur. Si rien n’avance, ouvrez un litige depuis le détail de la commande.',
      actionLabel: options.scope === 'seller' ? 'Mes ventes' : 'Mes commandes',
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
                <strong>Commande ${esc(d.order.orderNumber)}</strong>
                <div class="small muted">${esc(CATEGORY[d.category] ?? d.category)} · ouvert le ${formatDate(d.createdAt)}</div>
                ${d.escalatedAt ? `<div class="xs muted">Confié à l’assistance le ${formatDate(d.escalatedAt)}</div>` : ''}
              </div>
              <div class="row" style="gap:var(--space-3)">
                ${pill(d.status, STATUS)}
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
    <h2 style="font-size:var(--text-md)">Pièces du dossier</h2>
    <p class="xs muted">
      Chaque pièce est reconnue à son contenu et empreintée à son dépôt. L’empreinte
      est ce qui permettra de prouver, plus tard, que la pièce consultée est bien
      celle qui a été versée.
    </p>

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
                    ${esc(EVIDENCE_KIND[e.kind] ?? e.kind)} · versée par ${esc(e.uploadedBy?.name ?? 'inconnu')} le ${formatDate(e.createdAt, true)}
                  </div>
                  ${e.note ? `<div class="small">${esc(e.note)}</div>` : ''}
                  <div class="xs muted evidence-sum" title="Empreinte SHA-256">${esc(e.checksum.slice(0, 16))}…</div>
                  ${canRemove ? `<button class="btn btn-ghost btn-sm" data-remove-evidence="${esc(e.id)}">Écarter cette pièce</button>` : ''}
                </li>`,
              )
              .join('')}
          </ul>`
        : '<p class="small muted">Aucune pièce versée pour l’instant.</p>'
    }

    ${
      ecartees.length
        ? `<div class="mt-6">
            <h3 class="small" style="margin:0 0 var(--space-2)">Pièces écartées</h3>
            <p class="xs muted">Elles restent au dossier : leur contenu n’est plus servi, et le motif du retrait est visible de tous.</p>
            <ul class="evidence-list">
              ${ecartees
                .map(
                  (e) => `<li data-removed="true">
                    <span>${esc(e.filename)}</span>
                    <div class="xs muted">Écartée le ${formatDate(e.removedAt, true)} — ${esc(e.removalReason ?? 'sans motif consigné')}</div>
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
            <label class="btn btn-secondary btn-block btn-sm" for="d-file">Verser une pièce</label>
            <input id="d-file" type="file" data-dispute="${esc(d.id)}" hidden />
            <p class="xs muted">Photo, facture, preuve de suivi. Le fichier part tel quel : c’est son contenu qui décide de son type.</p>
          </div>`
        : ''
    }
  </section>`;
}

function ledgerBlock(entries, currency) {
  if (!entries.length) return '';
  return `<section class="card">
    <h2 style="font-size:var(--text-md)">Où est l’argent</h2>
    <p class="xs muted">Chaque mouvement laisse une ligne ; une correction est une ligne de sens inverse, jamais une réécriture.</p>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Mouvement</th><th>Montant</th><th>État</th><th>Date</th></tr></thead>
        <tbody>
          ${entries
            .map(
              (e) => `<tr>
                <td>${esc(LEDGER_TYPE[e.type] ?? e.type)}</td>
                <td>${e.direction === 'DEBIT' ? '−' : '+'} ${money(e.amount, e.currency ?? currency)}</td>
                <td>${
                  e.heldByDisputeId && !e.releasedAt
                    ? '<span class="status status-ESCALATED">Retenu</span>'
                    : e.releasedAt
                      ? `<span class="xs muted">Retenu jusqu’au ${formatDate(e.releasedAt)}</span>`
                      : '<span class="xs muted">Disponible</span>'
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
    <h2 style="font-size:var(--text-md)">Décision</h2>
    <div class="row" style="gap:var(--space-3);flex-wrap:wrap">
      ${pill(d.status, STATUS)}
      ${d.resolutionType ? `<span class="chip">${esc(RESOLUTION_TYPE[d.resolutionType] ?? d.resolutionType)}</span>` : ''}
      ${d.refundAmount ? `<strong>${money(d.refundAmount, d.order.currency)}</strong>` : ''}
    </div>
    ${d.resolution ? `<p class="small" style="white-space:pre-wrap">${esc(d.resolution)}</p>` : ''}
    <p class="xs muted">Rendue le ${formatDate(d.resolvedAt, true)}. Une décision ne se réécrit pas.</p>
    ${
      Array.isArray(snap.evidence) && snap.evidence.length
        ? `<p class="xs muted">Pièces retenues au moment de la décision : ${snap.evidence
            .map((e) => `${esc(e.filename)} (${esc(String(e.checksum).slice(0, 12))}…)`)
            .join(', ')}</p>`
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
              <div class="xs muted">${esc(m.author?.name ?? 'Participant')}${m.internal ? ' · note interne' : ''} · ${formatDate(m.createdAt, true)}</div>
              <div class="msg-body" style="white-space:pre-wrap">${esc(m.body)}</div>
            </li>`,
          )
          .join('')}
      </ul>`
    : '<p class="small muted">Aucun échange pour l’instant.</p>';

  return `
    ${breadcrumb([{ label: isAdmin ? 'Litiges' : 'Mes litiges', href: base }, { label: `Commande ${d.order.orderNumber}` }])}

    <div class="row-between" style="flex-wrap:wrap;gap:var(--space-3)">
      <h1 style="font-size:var(--text-xl);margin:0">Litige · commande ${esc(d.order.orderNumber)}</h1>
      ${pill(d.status, STATUS)}
    </div>
    <p class="small muted">
      ${esc(CATEGORY[d.category] ?? d.category)} · ouvert le ${formatDate(d.createdAt)}
      ${isAdmin ? ` · ordre de passage : ${esc(PRIORITY[d.priority] ?? d.priority)}` : ''}
    </p>
    ${deadlineNote(d)}
    ${
      d.escalatedAt && !clos
        ? `<div class="alert alert-info">${svg('shield')} Dossier confié à l’assistance TOUMA le ${formatDate(d.escalatedAt)}. <strong>Aucune décision n’a été prise</strong> : un humain l’examine.</div>`
        : ''
    }

    <div class="grid grid-2">
      <div class="stack">
        ${resolutionBlock(d)}

        <section class="card">
          <h2 style="font-size:var(--text-md)">Ce qui est reproché</h2>
          <p class="small"><strong>${esc(REASON[d.reason] ?? d.reason)}</strong></p>
          ${d.details ? `<p class="small" style="white-space:pre-wrap">${esc(d.details)}</p>` : ''}
          <p class="xs muted">Ouvert par ${d.openedById === d.order.buyerId ? 'l’acheteur' : 'le vendeur'}.</p>
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">Échanges</h2>
          ${fil}
          ${
            clos
              ? '<p class="small muted mt-6">Ce dossier est clos : il ne reçoit plus de message.</p>'
              : `<form id="dispute-message-form" data-dispute="${esc(d.id)}" class="mt-6">
                  <div class="field">
                    <label for="dm-body">Votre message</label>
                    <textarea id="dm-body" rows="3" maxlength="2000" required placeholder="Expliquez la situation, ou répondez à l’autre partie."></textarea>
                  </div>
                  ${
                    isAdmin
                      ? `<label class="check"><input type="checkbox" id="dm-internal" /> Note interne — invisible pour l’acheteur et le vendeur</label>`
                      : ''
                  }
                  <button class="btn btn-primary btn-block btn-sm" type="submit">Envoyer</button>
                </form>`
          }
        </section>

        ${isAdmin && !clos ? adminDecisionForm(d) : ''}
      </div>

      <aside class="stack">
        ${evidenceBlock(d, pieces.items ?? [], { canRemove: isAdmin, canAdd: !clos })}
        ${ledgerBlock(ledger.items ?? [], d.order.currency)}
        <section class="card">
          <h2 style="font-size:var(--text-md)">Commande</h2>
          <p class="small"><strong>${money(d.order.total, d.order.currency)}</strong></p>
          <a class="btn btn-ghost btn-block btn-sm" href="${jeSuisAcheteur ? `/touma/commandes/${esc(d.orderId)}` : `/touma/vendeur/commandes/${esc(d.orderId)}`}" data-link>Voir la commande</a>
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
    <h2 style="font-size:var(--text-md)">Trancher</h2>
    <p class="xs muted">
      La décision est figée avec les empreintes des pièces retenues, et notifiée
      aux deux parties. Elle ne se réécrit pas.
    </p>
    <form id="dispute-resolve-form" data-dispute="${esc(d.id)}" data-currency="${esc(d.order.currency)}">
      <div class="field">
        <label for="dr-decision">Issue</label>
        <select id="dr-decision" required>
          <option value="RESOLVED_BUYER">En faveur de l’acheteur</option>
          <option value="RESOLVED_SELLER">En faveur du vendeur</option>
          <option value="REJECTED">Litige rejeté</option>
          <option value="CLOSED">Clore sans suite</option>
        </select>
      </div>
      <div class="field">
        <label for="dr-type">Nature de l’issue</label>
        <select id="dr-type">
          <option value="">— non précisée —</option>
          ${Object.entries(RESOLUTION_TYPE)
            .map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`)
            .join('')}
        </select>
      </div>
      <div class="field">
        <label for="dr-amount">Montant remboursé (${esc(d.order.currency)})</label>
        <input id="dr-amount" type="text" inputmode="decimal" placeholder="laisser vide si aucun remboursement" />
        <p class="xs muted">Le mouvement d’argent reste un acte distinct : ce champ consigne le montant décidé.</p>
      </div>
      <div class="field">
        <label for="dr-resolution">Motivation (obligatoire, lue par les deux parties)</label>
        <textarea id="dr-resolution" rows="4" maxlength="2000" required></textarea>
      </div>
      <button class="btn btn-primary btn-block" type="submit">Enregistrer la décision</button>
    </form>
  </section>`;
}

// ── Enveloppes par rôle ────────────────────────────────────────────────────

/** Vendeur : ses litiges, dans les onglets de l'espace vendeur. */
export async function sellerDisputes(params, query) {
  const [{ tabs }, content] = await Promise.all([
    import('./views-seller.js'),
    disputes(params, query, { scope: 'seller', base: '/touma/vendeur/litiges', title: 'Litiges', embedded: true }),
  ]);
  return `<h1 style="font-size:var(--text-xl)">Litiges sur mes ventes</h1>${tabs('/touma/vendeur/litiges')}${content}`;
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
  return layout('/touma/admin/litiges', 'Litiges', content);
}

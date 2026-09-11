/**
 * Documents commerciaux : facture, avoir, reçu, bon de commande, bon de livraison.
 *
 * Le document est rendu tel qu'il a été **figé** à l'émission : rien n'est
 * recalculé à l'affichage. La page est pensée pour l'impression (et donc pour
 * l'export PDF du navigateur, qui est la façon dont un PDF se produit ici).
 */
import { api, esc, emptyState, formatDate, money } from './core.js';
import { breadcrumb, pagination } from './components.js';

const TYPE_LABEL = {
  INVOICE: 'Facture',
  CREDIT_NOTE: 'Avoir',
  PAYMENT_RECEIPT: 'Reçu de paiement',
  PURCHASE_ORDER: 'Bon de commande',
  DELIVERY_NOTE: 'Bon de livraison',
};

/** Bloc d'identité d'une partie, sans jamais inventer ce qui manque. */
function party(title, p) {
  if (!p) return '';
  const lines = [
    p.legalName && p.legalName !== p.name ? esc(p.legalName) : '',
    p.address?.line1 ? esc(p.address.line1) : '',
    p.address?.district ? esc(p.address.district) : '',
    [p.city, p.countryCode].filter(Boolean).map(esc).join(' — '),
    p.phone ? esc(p.phone) : '',
    p.email ? esc(p.email) : '',
    p.registrationNo ? `RCCM ${esc(p.registrationNo)}` : '',
    p.taxId ? `NIF ${esc(p.taxId)}` : '',
  ].filter(Boolean);

  return `<div>
    <div class="xs muted" style="text-transform:uppercase;letter-spacing:.04em">${esc(title)}</div>
    <strong>${esc(p.name ?? '—')}</strong>
    ${p.verified === false ? '<div class="xs muted">Identité légale non vérifiée</div>' : ''}
    ${p.configured === false ? '<div class="xs muted">Identité légale non renseignée</div>' : ''}
    <div class="small" style="line-height:1.5">${lines.join('<br />')}</div>
  </div>`;
}

export async function documents(_params, query, options = {}) {
  const scope = options.scope ?? 'buyer';
  const page = Number(query.get('page') || 1);
  const type = query.get('type') || '';
  const data = await api(`/documents?scope=${scope}&page=${page}${type ? `&type=${type}` : ''}`);
  const base = scope === 'seller' ? '/touma/vendeur/documents' : '/touma/documents';
  const title = scope === 'seller' ? 'Documents émis' : 'Mes documents';

  const header = options.embedded
    ? ''
    : `${breadcrumb([{ label: 'Accueil', href: '/touma/' }, { label: title }])}
       <h1 style="font-size:var(--text-xl)">${title}</h1>`;

  if (!data.items.length && !type) {
    return `${header}${emptyState({
      title: 'Aucun document pour l’instant',
      body:
        scope === 'seller'
          ? 'Vos factures et bons de livraison seront émis automatiquement à chaque commande payée puis expédiée.'
          : 'Vos factures et reçus apparaîtront ici dès votre première commande payée.',
      actionLabel: scope === 'seller' ? 'Voir mes ventes' : 'Explorer le catalogue',
      actionHref: scope === 'seller' ? '/touma/vendeur/commandes' : '/touma/produits',
      iconName: 'inbox',
    })}`;
  }

  return `
    ${header}
    <div class="chip-row" style="margin-bottom:var(--space-5)">
      ${['', 'INVOICE', 'CREDIT_NOTE', 'PAYMENT_RECEIPT', 'DELIVERY_NOTE', 'PURCHASE_ORDER']
        .map(
          (t) =>
            `<a class="chip${type === t ? ' chip-active' : ''}" href="${base}${t ? `?type=${t}` : ''}" data-link>${
              t ? esc(TYPE_LABEL[t]) : 'Tous'
            }</a>`,
        )
        .join('')}
    </div>

    <div class="table-wrap"><table>
      <!-- « Contrepartie » et non « émetteur » : sur un bon de commande, c'est
           l'acheteur qui émet et la boutique qui reçoit. -->
      <thead><tr><th>Numéro</th><th>Type</th><th>Contrepartie</th><th>Montant</th><th>Date</th><th></th></tr></thead>
      <tbody>
        ${data.items
          .map(
            (d) => `<tr>
              <td><strong style="font-family:var(--font-mono)">${esc(d.number)}</strong></td>
              <td>${esc(d.title)}</td>
              <td class="small">${esc(d.storeName ?? 'TOUMA')}</td>
              <td>${d.type === 'DELIVERY_NOTE' ? '<span class="muted">—</span>' : money(d.totalAmount, d.currency)}</td>
              <td class="small muted">${formatDate(d.issuedAt)}</td>
              <td style="text-align:right"><a class="btn btn-secondary btn-sm" href="/touma/documents/${esc(d.id)}" data-link>Ouvrir</a></td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table></div>
    ${pagination(data, (p) => `${base}?page=${p}${type ? `&type=${type}` : ''}`)}`;
}

/** Document imprimable. Le contenu vient du document figé, jamais recalculé. */
export async function documentView(params) {
  const d = await api(`/documents/${params.id}`);
  const p = d.payload;
  const showPrices = d.type !== 'DELIVERY_NOTE';

  return `
    <div class="no-print">
      ${breadcrumb([{ label: 'Mes documents', href: '/touma/documents' }, { label: d.number }])}
      <div class="row-between" style="margin-bottom:var(--space-4)">
        <p class="small muted" style="margin:0">Document figé à l’émission. Pour l’enregistrer en PDF, utilisez l’impression de votre navigateur.</p>
        <button class="btn btn-sm" data-print>Imprimer / enregistrer en PDF</button>
      </div>
    </div>

    <article class="card document">
      <header class="row-between" style="align-items:flex-start;margin-bottom:var(--space-6)">
        <div>
          <div class="brand-mark" aria-hidden="true">T</div>
          <h1 style="font-size:var(--text-xl);margin:var(--space-3) 0 2px">${esc(p.title ?? TYPE_LABEL[d.type])}</h1>
          <p class="small muted" style="margin:0;font-family:var(--font-mono)">${esc(d.number)}</p>
        </div>
        <div style="text-align:right">
          <div class="small"><strong>Émis le</strong> ${formatDate(d.issuedAt, true)}</div>
          ${p.reference ? `<div class="small"><strong>Référence</strong> ${esc(p.reference)}</div>` : ''}
          ${p.orderNumber ? `<div class="small"><strong>Commande</strong> ${esc(p.orderNumber)}</div>` : ''}
          ${p.correctsInvoice ? `<div class="small"><strong>Corrige la facture</strong> ${esc(p.correctsInvoice)}</div>` : ''}
        </div>
      </header>

      <div class="grid grid-2" style="gap:var(--space-6);margin-bottom:var(--space-6)">
        ${party(d.type === 'PURCHASE_ORDER' ? 'Donneur d’ordre' : 'Émetteur', p.issuer)}
        ${party(d.type === 'PURCHASE_ORDER' ? 'Fournisseur' : 'Destinataire', p.recipient)}
      </div>

      ${p.lines?.length
        ? `<div class="table-wrap" style="border:0">
            <table>
              <thead><tr>
                <th>Désignation</th><th>Qté</th>${showPrices ? '<th>Prix unitaire</th><th>Total</th>' : ''}
              </tr></thead>
              <tbody>
                ${p.lines
                  .map(
                    (l) => `<tr>
                      <td>${esc(l.label)}${l.variant ? `<div class="xs muted">${esc(l.variant)}</div>` : ''}</td>
                      <td>${l.quantity}${l.unit ? ` ${esc(l.unit)}` : ''}</td>
                      ${showPrices ? `<td>${money(l.unitPrice, d.currency)}</td><td>${money(l.lineTotal, d.currency)}</td>` : ''}
                    </tr>`,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>`
        : ''}

      ${showPrices && p.totals
        ? `<div class="summary" style="margin-left:auto;max-width:340px;margin-top:var(--space-5)">
            ${p.totals.subtotal ? `<div class="summary-line"><span>Sous-total</span><span>${money(p.totals.subtotal, d.currency)}</span></div>` : ''}
            ${p.totals.shipping ? `<div class="summary-line"><span>Livraison</span><span>${money(p.totals.shipping, d.currency)}</span></div>` : ''}
            ${Number(p.totals.discount ?? 0) > 0 ? `<div class="summary-line"><span>Remise</span><span>− ${money(p.totals.discount, d.currency)}</span></div>` : ''}
            <div class="summary-line"><span>Taxes</span><span>${money(d.taxAmount, d.currency)}</span></div>
            <div class="summary-line summary-total"><span>Total</span><span>${money(p.totals.total ?? d.totalAmount, d.currency)}</span></div>
          </div>`
        : ''}

      ${d.type === 'PAYMENT_RECEIPT'
        ? `<p class="small" style="margin-top:var(--space-5)">
            Réglé par <strong>${esc(p.method ?? '—')}</strong>${p.paidAt ? ` le ${formatDate(p.paidAt, true)}` : ''}
            ${p.providerRef ? `<br /><span class="muted">Référence prestataire : ${esc(p.providerRef)}</span>` : ''}
          </p>`
        : ''}

      ${d.type === 'DELIVERY_NOTE'
        ? `<p class="small" style="margin-top:var(--space-5)">
            Transporteur <strong>${esc(p.carrier ?? '—')}</strong> · suivi ${esc(p.reference ?? '—')}
            ${p.etaMaxDays ? `<br /><span class="muted">Livraison estimée en ${p.etaMinDays} à ${p.etaMaxDays} jours.</span>` : ''}
          </p>`
        : ''}

      <footer style="margin-top:var(--space-6);border-top:1px solid var(--border);padding-top:var(--space-4)">
        <p class="xs muted" style="margin:0">${esc(p.taxNotice ?? '')}</p>
        <p class="xs muted" style="margin:var(--space-2) 0 0">Document émis via TOUMA — ${esc(d.number)}.</p>
      </footer>
    </article>`;
}

/** Vue vendeur : documents émis par ses boutiques. */
export async function sellerDocuments(params, query) {
  const [{ tabs }, content] = await Promise.all([
    import('./views-seller.js'),
    documents(params, query, { scope: 'seller', embedded: true }),
  ]);
  return `<h1 style="font-size:var(--text-xl)">Documents</h1>${tabs('/touma/vendeur/documents')}${content}`;
}

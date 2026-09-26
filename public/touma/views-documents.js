/**
 * Documents commerciaux : facture, avoir, reçu, bon de commande, bon de livraison.
 *
 * Le document est rendu tel qu'il a été **figé** à l'émission : rien n'est
 * recalculé à l'affichage. La page est pensée pour l'impression (et donc pour
 * l'export PDF du navigateur, qui est la façon dont un PDF se produit ici).
 */
import { api, esc, emptyState, formatDate, money } from './core.js';
import { breadcrumb, pagination } from './components.js';
import { t } from './i18n.js';

/**
 * **Le document ne se traduit pas, l'écran autour de lui si.** Le titre, les
 * libellés de lignes et la mention fiscale viennent du contenu figé à
 * l'émission : les retraduire ferait qu'un document consulté en arabe ne dirait
 * plus la même chose que celui qui a été émis, et qu'un vendeur et son acheteur
 * ne regarderaient plus la même pièce. Seuls l'ossature — colonnes, boutons,
 * intitulés de champs — et le libellé de type quand le document n'en porte pas
 * suivent la langue de lecture.
 */
const typeLabel = (type) => t(`doc.type.${type}`);

/** Les types proposés au filtre — l'ordre, pas les libellés. */
const TYPES = ['INVOICE', 'CREDIT_NOTE', 'PAYMENT_RECEIPT', 'DELIVERY_NOTE', 'PURCHASE_ORDER'];

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
    p.registrationNo ? esc(t('doc.rccm', { number: p.registrationNo })) : '',
    p.taxId ? esc(t('doc.nif', { number: p.taxId })) : '',
  ].filter(Boolean);

  return `<div>
    <div class="xs muted" style="text-transform:uppercase;letter-spacing:.04em">${esc(title)}</div>
    <strong>${esc(p.name ?? '—')}</strong>
    ${p.verified === false ? `<div class="xs muted">${esc(t('doc.notVerified'))}</div>` : ''}
    ${p.configured === false ? `<div class="xs muted">${esc(t('doc.notConfigured'))}</div>` : ''}
    <div class="small" style="line-height:1.5">${lines.join('<br />')}</div>
  </div>`;
}

export async function documents(_params, query, options = {}) {
  const scope = options.scope ?? 'buyer';
  const page = Number(query.get('page') || 1);
  const type = query.get('type') || '';
  const data = await api(`/documents?scope=${scope}&page=${page}${type ? `&type=${type}` : ''}`);
  const base = scope === 'seller' ? '/touma/vendeur/documents' : '/touma/documents';
  const title = t(scope === 'seller' ? 'doc.issued' : 'doc.mine');

  const header = options.embedded
    ? ''
    : `${breadcrumb([{ label: t('nav.home'), href: '/touma/' }, { label: title }])}
       <h1 style="font-size:var(--text-xl)">${esc(title)}</h1>`;

  if (!data.items.length && !type) {
    return `${header}${emptyState({
      title: t('doc.emptyTitle'),
      body: t(scope === 'seller' ? 'doc.emptyBodySeller' : 'doc.emptyBodyBuyer'),
      actionLabel: t(scope === 'seller' ? 'doc.emptyActionSeller' : 'doc.emptyActionBuyer'),
      actionHref: scope === 'seller' ? '/touma/vendeur/commandes' : '/touma/produits',
      iconName: 'inbox',
    })}`;
  }

  return `
    ${header}
    <div class="chip-row" style="margin-bottom:var(--space-5)">
      ${['', ...TYPES]
        .map(
          (code) =>
            `<a class="chip${type === code ? ' chip-active' : ''}" href="${base}${code ? `?type=${code}` : ''}" data-link>${
              code ? esc(typeLabel(code)) : esc(t('doc.all'))
            }</a>`,
        )
        .join('')}
    </div>

    <div class="table-wrap"><table>
      <!-- « Contrepartie » et non « émetteur » : sur un bon de commande, c'est
           l'acheteur qui émet et la boutique qui reçoit. -->
      <thead><tr><th>${esc(t('doc.col.number'))}</th><th>${esc(t('doc.col.type'))}</th><th>${esc(t('doc.col.counterparty'))}</th><th>${esc(
        t('doc.col.amount'),
      )}</th><th>${esc(t('doc.col.date'))}</th><th></th></tr></thead>
      <tbody>
        ${data.items
          .map(
            (d) => `<tr>
              <td><strong style="font-family:var(--font-mono)">${esc(d.number)}</strong></td>
              <td>${esc(d.title)}</td>
              <td class="small">${esc(d.storeName ?? 'TOUMA')}</td>
              <td>${d.type === 'DELIVERY_NOTE' ? '<span class="muted">—</span>' : money(d.totalAmount, d.currency)}</td>
              <td class="small muted">${formatDate(d.issuedAt)}</td>
              <td style="text-align:right"><a class="btn btn-secondary btn-sm" href="/touma/documents/${esc(d.id)}" data-link>${esc(
                t('doc.open'),
              )}</a></td>
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
      ${breadcrumb([{ label: t('doc.mine'), href: '/touma/documents' }, { label: d.number }])}
      <div class="row-between" style="margin-bottom:var(--space-4)">
        <p class="small muted" style="margin:0">${esc(t('doc.frozenNote'))}</p>
        <button class="btn btn-sm" data-print>${esc(t('doc.print'))}</button>
      </div>
    </div>

    <article class="card document">
      <header class="row-between" style="align-items:flex-start;margin-bottom:var(--space-6)">
        <div>
          <!-- Version à une encre : une facture s’imprime souvent en noir,
               et un dégradé y devient un aplat gris illisible. -->
          <img class="brand-mark" src="/touma/img/logo-mono.svg" alt="" width="38" height="38" />
          <h1 style="font-size:var(--text-xl);margin:var(--space-3) 0 2px">${esc(p.title ?? typeLabel(d.type))}</h1>
          <p class="small muted" style="margin:0;font-family:var(--font-mono)">${esc(d.number)}</p>
        </div>
        <div style="text-align:right">
          <div class="small"><strong>${esc(t('doc.issuedOn'))}</strong> ${formatDate(d.issuedAt, true)}</div>
          ${p.reference ? `<div class="small"><strong>${esc(t('doc.reference'))}</strong> ${esc(p.reference)}</div>` : ''}
          ${p.orderNumber ? `<div class="small"><strong>${esc(t('doc.order'))}</strong> ${esc(p.orderNumber)}</div>` : ''}
          ${p.correctsInvoice ? `<div class="small"><strong>${esc(t('doc.corrects'))}</strong> ${esc(p.correctsInvoice)}</div>` : ''}
        </div>
      </header>

      <div class="grid grid-2" style="gap:var(--space-6);margin-bottom:var(--space-6)">
        ${party(t(d.type === 'PURCHASE_ORDER' ? 'doc.principal' : 'doc.issuer'), p.issuer)}
        ${party(t(d.type === 'PURCHASE_ORDER' ? 'doc.supplier' : 'doc.recipient'), p.recipient)}
      </div>

      ${p.lines?.length
        ? `<div class="table-wrap" style="border:0">
            <table>
              <thead><tr>
                <th>${esc(t('doc.col.designation'))}</th><th>${esc(t('doc.col.qty'))}</th>${
                  showPrices ? `<th>${esc(t('doc.col.unitPrice'))}</th><th>${esc(t('doc.col.lineTotal'))}</th>` : ''
                }
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
            ${p.totals.subtotal ? `<div class="summary-line"><span>${esc(t('cart.subtotal'))}</span><span>${money(p.totals.subtotal, d.currency)}</span></div>` : ''}
            ${p.totals.shipping ? `<div class="summary-line"><span>${esc(t('cart.shipping'))}</span><span>${money(p.totals.shipping, d.currency)}</span></div>` : ''}
            ${Number(p.totals.discount ?? 0) > 0 ? `<div class="summary-line"><span>${esc(t('doc.discount'))}</span><span>− ${money(p.totals.discount, d.currency)}</span></div>` : ''}
            <div class="summary-line"><span>${esc(t('doc.taxes'))}</span><span>${money(d.taxAmount, d.currency)}</span></div>
            <div class="summary-line summary-total"><span>${esc(t('doc.total'))}</span><span>${money(p.totals.total ?? d.totalAmount, d.currency)}</span></div>
          </div>`
        : ''}

      ${d.type === 'PAYMENT_RECEIPT'
        ? `<p class="small" style="margin-top:var(--space-5)">
            ${esc(t('doc.settledByLabel'))} <strong>${esc(p.method ?? '—')}</strong>${
              p.paidAt ? ` ${esc(t('doc.settledOn', { date: formatDate(p.paidAt, true) }))}` : ''
            }
            ${p.providerRef ? `<br /><span class="muted">${esc(t('doc.providerRef', { ref: p.providerRef }))}</span>` : ''}
          </p>`
        : ''}

      ${d.type === 'DELIVERY_NOTE'
        ? `<p class="small" style="margin-top:var(--space-5)">
            ${esc(t('doc.carrierLabel'))} <strong>${esc(p.carrier ?? '—')}</strong> · ${esc(
              t('doc.trackingLabel', { ref: p.reference ?? '—' }),
            )}
            ${
              p.etaMaxDays
                ? `<br /><span class="muted">${esc(t('doc.etaDays', { min: p.etaMinDays, max: p.etaMaxDays }))}</span>`
                : ''
            }
          </p>`
        : ''}

      <footer style="margin-top:var(--space-6);border-top:1px solid var(--border);padding-top:var(--space-4)">
        <p class="xs muted" style="margin:0">${esc(p.taxNotice ?? '')}</p>
        <p class="xs muted" style="margin:var(--space-2) 0 0">${esc(t('doc.issuedVia', { number: d.number }))}</p>
      </footer>
    </article>`;
}

/** Vue vendeur : documents émis par ses boutiques. */
export async function sellerDocuments(params, query) {
  const [{ tabs }, content] = await Promise.all([
    import('./views-seller.js'),
    documents(params, query, { scope: 'seller', embedded: true }),
  ]);
  return `<h1 style="font-size:var(--text-xl)">${esc(t('doc.tab'))}</h1>${tabs('/touma/vendeur/documents')}${content}`;
}

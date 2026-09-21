/**
 * TOUMA — commerce transfrontalier : corridors, éligibilité, coûts, commandes
 * internationales, centre d'administration.
 *
 * Une seule idée tient ces écrans : **ne jamais promettre ce qui n'est pas
 * confirmé** (§47). Concrètement, trois habitudes qu'on retrouve partout ici :
 *
 * 1. Un corridor affiche son statut déclaré **et** ce qui lui manque
 *    réellement. Les deux, côte à côte, jamais fondus en un seul voyant vert.
 * 2. Une ligne de coût affiche sa fiabilité. Un montant inconnu s'écrit
 *    « inconnu », pas « 0 ».
 * 3. Un délai est une estimation de transporteur, et l'écran le dit à chaque
 *    fois qu'il en montre un.
 */
import { api, esc, formatDate, label, money, svg, toast } from './core.js';
import { breadcrumb } from './components.js';
import { t } from './i18n.js';

/** Pastille de corridor : le déclaré et le réel, séparés. */
function corridorCard(c) {
  const operationnel = c.operational;
  return `<article class="card">
    <div class="row-between">
      <strong dir="ltr">${esc(c.originCountry)} → ${esc(c.destinationCountry)}</strong>
      <span class="badge" style="background:${operationnel ? 'var(--success)' : 'var(--surface-2)'};color:${operationnel ? '#fff' : 'var(--text)'}">
        ${esc(operationnel ? t('trade.operational') : t('trade.notOperational'))}
      </span>
    </div>
    <div class="xs muted">${esc(t('trade.declaredStatus', { status: t(`trade.status.${c.declaredStatus}`) }))}</div>
    ${
      c.missing && c.missing.length > 0
        ? `<ul class="xs muted" style="margin:var(--space-2) 0 0;padding-inline-start:var(--space-4)">
             ${c.missing.map((m) => `<li>${esc(m)}</li>`).join('')}
           </ul>`
        : `<div class="xs muted">${esc(t('trade.paymentMethods', { list: c.paymentMethods.join(', ') || '—' }))}</div>
           <div class="xs muted">${esc(t('trade.carriers', { list: c.shippingProviders.join(', ') || '—' }))}</div>`
    }
    ${
      c.estimatedTransitMinDays !== null && c.estimatedTransitMaxDays !== null
        ? `<div class="xs muted">${esc(t('trade.transitEstimate', { min: c.estimatedTransitMinDays, max: c.estimatedTransitMaxDays }))}</div>`
        : ''
    }
  </article>`;
}

/** Ligne de coût : le montant **et** sa fiabilité, jamais l'un sans l'autre. */
function costRow(l) {
  const couleur = l.confidence === 'CONFIRMED' ? 'var(--success)' : l.confidence === 'ESTIMATED' ? 'var(--warning)' : 'var(--muted)';
  return `<tr>
    <td>${esc(l.label)}</td>
    <td dir="ltr">${l.amount === null ? `<span class="muted">${esc(t('trade.unknownAmount'))}</span>` : esc(l.amount)}</td>
    <td><span class="badge" style="border-inline-start:3px solid ${couleur}">${esc(t(`trade.confidence.${l.confidence}`))}</span></td>
    <td class="xs muted">${esc(l.source ?? '—')}</td>
  </tr>`;
}

/** Page d'accueil du commerce transfrontalier. */
export async function tradeHome() {
  const [etat, corridors] = await Promise.all([api('/trade'), api('/trade/corridors')]);
  const operationnels = corridors.items.filter((c) => c.operational);

  return `${breadcrumb([{ label: t('trade.nav') }])}
    <h1>${esc(t('trade.title'))}</h1>
    <p class="muted">${esc(t('trade.intro'))}</p>

    ${
      etat.enabled
        ? ''
        : `<div class="card" style="border-inline-start:3px solid var(--warning)">
             <strong class="small">${esc(t('trade.disabledTitle'))}</strong>
             <p class="xs muted">${esc(t('trade.disabledBody'))}</p>
           </div>`
    }

    <div class="grid grid-3" style="margin-top:var(--space-4)">
      <div class="card"><div class="xs muted">${esc(t('trade.corridorsConfigured'))}</div><strong dir="ltr">${etat.corridors}</strong></div>
      <div class="card"><div class="xs muted">${esc(t('trade.corridorsOperational'))}</div><strong dir="ltr">${etat.operational}</strong></div>
      <div class="card"><div class="xs muted">${esc(t('trade.fxSource'))}</div><strong>${esc(etat.fx.configured ? etat.fx.provider : t('trade.fxNone'))}</strong></div>
    </div>
    ${etat.fx.message ? `<p class="xs muted">${esc(etat.fx.message)}</p>` : ''}

    <h2>${esc(t('trade.corridors'))}</h2>
    <p class="xs muted">${esc(corridors.note)}</p>
    ${
      corridors.items.length === 0
        ? `<p class="muted">${esc(t('trade.noCorridors'))}</p>`
        : `<div class="stack">${corridors.items.map(corridorCard).join('')}</div>`
    }

    ${
      operationnels.length === 0 && corridors.items.length > 0
        ? `<div class="card" style="border-inline-start:3px solid var(--warning)">
             <p class="small">${esc(t('trade.noneOperational'))}</p>
           </div>`
        : ''
    }

    <h2>${esc(t('trade.checkTitle'))}</h2>
    <form id="trade-eligibility-form" class="card">
      <div class="grid grid-2">
        <label>${esc(t('trade.sellerCountry'))}
          <input name="sellerCountry" maxlength="2" required placeholder="TD" style="text-transform:uppercase" />
        </label>
        <label>${esc(t('trade.buyerCountry'))}
          <input name="buyerCountry" maxlength="2" required placeholder="CM" style="text-transform:uppercase" />
        </label>
      </div>
      <button class="btn btn-primary" type="submit">${svg('search')} ${esc(t('trade.check'))}</button>
    </form>
    <div id="trade-eligibility-result"></div>`;
}

/** Rendu d'un verdict d'éligibilité. Exporté : le shell l'appelle après appel. */
export function renderEligibility(r) {
  const couleurs = { ELIGIBLE: 'var(--success)', REQUIRES_REVIEW: 'var(--warning)', REQUIRES_DOCUMENT: 'var(--warning)', NOT_ELIGIBLE: 'var(--danger)' };
  return `<div class="card" style="border-inline-start:3px solid ${couleurs[r.verdict] ?? 'var(--muted)'};margin-top:var(--space-3)">
    <div class="row-between">
      <strong>${esc(t(`trade.verdict.${r.verdict}`))}</strong>
      ${r.corridor ? `<span class="badge" dir="ltr">${esc(r.corridor.code)}</span>` : ''}
    </div>
    <p class="small">${esc(r.reason)}</p>
    <details>
      <summary class="xs muted">${esc(t('trade.criteria', { count: r.criteria.length }))}</summary>
      <ul class="xs" style="margin:var(--space-2) 0 0;padding-inline-start:var(--space-4)">
        ${r.criteria.map((c) => `<li>${c.ok ? '✓' : '✗'} <strong>${esc(c.code)}</strong> — ${esc(c.detail)}</li>`).join('')}
      </ul>
    </details>
    ${
      r.requiredDocuments.length > 0
        ? `<div class="xs muted">${esc(t('trade.requiredDocuments', { list: r.requiredDocuments.join(', ') }))}</div>`
        : ''
    }
    ${
      r.unknown && r.unknown.length > 0
        ? `<div style="margin-top:var(--space-2)">
             <strong class="xs">${esc(t('trade.unknownTitle'))}</strong>
             <ul class="xs muted" style="margin:var(--space-1) 0 0;padding-inline-start:var(--space-4)">
               ${r.unknown.map((u) => `<li>${esc(u)}</li>`).join('')}
             </ul>
           </div>`
        : ''
    }
  </div>`;
}

/** Détail d'un corridor, avec ses itinéraires et leur attribution. */
export async function tradeCorridor(params) {
  const c = await api(`/trade/corridors/${encodeURIComponent(params.code)}`);
  return `${breadcrumb([{ label: t('trade.nav'), href: '/touma/commerce' }, { label: c.code }])}
    <h1 dir="ltr">${esc(c.originCountry)} → ${esc(c.destinationCountry)}</h1>
    ${corridorCard({ ...c, ...c.capability, originCountry: c.originCountry, destinationCountry: c.destinationCountry, declaredStatus: c.status })}

    <h2>${esc(t('trade.routes'))}</h2>
    ${
      c.routes.length === 0
        ? `<p class="muted">${esc(t('trade.noRoutes'))}</p>`
        : `<div class="stack">${c.routes
            .map(
              (r) => `<div class="card">
                <strong>${esc(r.name)}</strong>
                <div class="xs muted">${(Array.isArray(r.legs) ? r.legs : []).map((l) => esc(l.name ?? '')).join(' → ')}</div>
                <div class="xs muted">
                  ${
                    r.attributed
                      ? esc(t('trade.routeSource', { source: r.sourceName }))
                      : `<span style="color:var(--warning)">${esc(t('trade.routeUnattributed'))}</span>`
                  }
                </div>
              </div>`,
            )
            .join('')}</div>`
    }

    ${
      c.requiredDocuments.length > 0
        ? `<h2>${esc(t('trade.documents'))}</h2>
           <ul class="small">${c.requiredDocuments.map((d) => `<li>${esc(t(`trade.doc.${d}`) || d)}</li>`).join('')}</ul>`
        : ''
    }`;
}

/** Mes commandes transfrontalières. */
export async function tradeOrders() {
  const { items } = await api('/trade/orders');
  if (items.length === 0) {
    return `${breadcrumb([{ label: t('trade.nav'), href: '/touma/commerce' }, { label: t('trade.myOrders') }])}
      <h1>${esc(t('trade.myOrders'))}</h1>
      <p class="muted">${esc(t('trade.noOrders'))}</p>`;
  }
  return `${breadcrumb([{ label: t('trade.nav'), href: '/touma/commerce' }, { label: t('trade.myOrders') }])}
    <h1>${esc(t('trade.myOrders'))}</h1>
    <div class="stack">
      ${items
        .map(
          (o) => `<a class="card" data-link href="/touma/commerce/commandes/${esc(o.id)}">
            <div class="row-between">
              <strong dir="ltr">${esc(o.order.orderNumber)}</strong>
              <span class="badge">${esc(label(o.order.status))}</span>
            </div>
            <div class="xs muted" dir="ltr">
              ${esc(money(o.order.total, o.order.currency))} · ${esc(o.order.store.name)} (${esc(o.order.store.countryCode)})
              ${o.corridor ? `· ${esc(o.corridor.code)}` : ''}
            </div>
            <div class="xs muted">${esc(formatDate(o.order.createdAt))}</div>
          </a>`,
        )
        .join('')}
    </div>`;
}

/** Une commande transfrontalière : chronologie, contrôle, incidents, coûts. */
export async function tradeOrder(params) {
  const [detail, chronologie, controle, documents] = await Promise.all([
    api(`/trade/orders/${params.id}`),
    api(`/trade/orders/${params.id}/timeline`),
    api(`/trade/orders/${params.id}/checklist`),
    api(`/trade/orders/${params.id}/documents`),
  ]);

  const cout = detail.costs?.[0] ?? null;

  return `${breadcrumb([
    { label: t('trade.nav'), href: '/touma/commerce' },
    { label: t('trade.myOrders'), href: '/touma/commerce/commandes' },
    { label: detail.order.orderNumber },
  ])}
    <h1 dir="ltr">${esc(detail.order.orderNumber)}</h1>
    <div class="card">
      <div class="row-between"><span>${esc(t('trade.route'))}</span><strong dir="ltr">${esc(detail.order.sellerCountry ?? '—')} → ${esc(detail.order.buyerCountry ?? '—')}</strong></div>
      <div class="row-between"><span>${esc(t('trade.amount'))}</span><strong dir="ltr">${esc(money(detail.order.total, detail.order.currency))}</strong></div>
      <div class="row-between"><span>${esc(t('trade.seller'))}</span><strong>${esc(detail.order.store.name)}</strong></div>
      ${detail.corridor ? `<div class="row-between"><span>${esc(t('trade.corridor'))}</span><strong dir="ltr">${esc(detail.corridor.code)}</strong></div>` : ''}
    </div>

    <h2>${esc(t('trade.timeline'))}</h2>
    ${
      chronologie.events.length === 0
        ? `<p class="muted">${esc(t('trade.noEvents'))}</p>`
        : `<ol class="stack" style="padding-inline-start:var(--space-4)">
             ${chronologie.events
               .map(
                 (e) => `<li class="small">
                   <strong>${esc(e.label)}</strong>
                   <span class="xs muted">${esc(formatDate(e.occurredAt, true))} · ${esc(e.origin)}</span>
                 </li>`,
               )
               .join('')}
           </ol>`
    }
    <p class="xs muted">${esc(t('trade.timelineNote'))}</p>

    <h2>${esc(t('trade.checklist'))}</h2>
    <ul class="stack" style="list-style:none;padding:0">
      ${controle.items
        .map(
          (i) => `<li class="card" style="padding:var(--space-2) var(--space-3)">
            <span>${i.done ? '✓' : '○'} ${esc(i.label)}</span>
            ${i.detail ? `<div class="xs muted">${esc(i.detail)}</div>` : ''}
          </li>`,
        )
        .join('')}
    </ul>

    ${
      documents.items.length > 0
        ? `<h2>${esc(t('trade.documents'))}</h2>
           <div class="stack">
             ${documents.items
               .map(
                 (d) => `<div class="card">
                   <div class="row-between">
                     <strong>${esc(t(`trade.doc.${d.kind}`) || d.kind)}</strong>
                     <span class="badge">${esc(t(`trade.docStatus.${d.status}`) || d.status)}</span>
                   </div>
                   ${d.number ? `<div class="xs muted" dir="ltr">${esc(d.number)}</div>` : ''}
                   ${d.rejectionReason ? `<div class="xs" style="color:var(--danger)">${esc(d.rejectionReason)}</div>` : ''}
                 </div>`,
               )
               .join('')}
           </div>`
        : ''
    }

    ${
      detail.exceptions.length > 0
        ? `<h2>${esc(t('trade.exceptions'))}</h2>
           <div class="stack">
             ${detail.exceptions
               .map(
                 (e) => `<div class="card" style="border-inline-start:3px solid var(--warning)">
                   <strong class="small">${esc(e.sourceName ? t(`trade.exception.${e.kind}`) || e.kind : t('trade.causeUnknown'))}</strong>
                   ${e.detail ? `<div class="xs muted">${esc(e.detail)}</div>` : ''}
                   <div class="xs muted">
                     ${e.sourceName ? esc(t('trade.exceptionSource', { source: e.sourceName })) : esc(t('trade.exceptionNoSource'))}
                   </div>
                 </div>`,
               )
               .join('')}
           </div>`
        : ''
    }

    ${
      cout
        ? `<h2>${esc(t('trade.cost'))}</h2>
           <table class="table small">
             <thead><tr><th>${esc(t('trade.costLine'))}</th><th>${esc(t('trade.costAmount'))}</th><th>${esc(t('trade.costConfidence'))}</th><th>${esc(t('trade.costSource'))}</th></tr></thead>
             <tbody>${(Array.isArray(cout.lines) ? cout.lines : []).map(costRow).join('')}</tbody>
           </table>
           ${
             cout.unknownComponents.length > 0
               ? `<p class="xs muted">${esc(t('trade.costIncomplete', { list: cout.unknownComponents.join(' ; ') }))}</p>`
               : ''
           }`
        : ''
    }`;
}

/** Centre d'administration du commerce. */
export async function adminTrade() {
  const vue = await api('/admin/trade/overview');
  return `${breadcrumb([{ label: t('nav.admin'), href: '/touma/admin' }, { label: t('trade.nav') }])}
    <h1>${esc(t('trade.adminTitle'))}</h1>

    <div class="grid grid-3">
      <div class="card"><div class="xs muted">${esc(t('trade.adminOrders'))}</div><strong dir="ltr">${vue.tradeOrders}</strong></div>
      <div class="card"><div class="xs muted">${esc(t('trade.adminDocuments'))}</div><strong dir="ltr">${vue.documents}</strong></div>
      <div class="card"><div class="xs muted">${esc(t('trade.adminExceptions'))}</div><strong dir="ltr">${vue.openExceptions}</strong></div>
    </div>

    <h2>${esc(t('trade.corridors'))}</h2>
    ${
      vue.corridors.length === 0
        ? `<p class="muted">${esc(t('trade.noCorridors'))}</p>`
        : `<div class="stack">
             ${vue.corridors
               .map(
                 (c) => `<div class="card">
                   <div class="row-between">
                     <strong dir="ltr">${esc(c.code)}</strong>
                     <span class="badge">${esc(c.operational ? t('trade.operational') : t('trade.notOperational'))}</span>
                   </div>
                   <div class="xs muted">${esc(t('trade.declaredStatus', { status: t(`trade.status.${c.declaredStatus}`) }))}</div>
                   ${
                     c.missing.length > 0
                       ? `<ul class="xs muted" style="margin:var(--space-2) 0 0;padding-inline-start:var(--space-4)">
                            ${c.missing.map((m) => `<li>${esc(m)}</li>`).join('')}
                          </ul>`
                       : ''
                   }
                 </div>`,
               )
               .join('')}
           </div>`
    }

    <h2>${esc(t('trade.eligibilityStats'))}</h2>
    <ul class="small">
      ${Object.entries(vue.eligibilityByVerdict)
        .map(([v, n]) => `<li>${esc(t(`trade.verdict.${v}`) || v)} : <strong dir="ltr">${n}</strong></li>`)
        .join('') || `<li class="muted">${esc(t('trade.noChecks'))}</li>`}
    </ul>

    <h2>${esc(t('trade.fxSource'))}</h2>
    <p class="small">${esc(vue.fx.message ?? t('trade.fxConfigured', { provider: vue.fx.provider }))}</p>`;
}

export { toast };

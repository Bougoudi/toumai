/**
 * TOUMA Business — espace des acheteurs professionnels : profil entreprise,
 * appels d'offres, comparaison des offres et négociation.
 */
import { api, esc, money, formatDate, label, session, statusPill, stars, emptyState, svg, toast } from './core.js';
import { breadcrumb, statCard } from './components.js';
import { t } from './i18n.js';

const TABS = [
  ['/touma/business', 'biz.tab.overview'],
  ['/touma/business/appels-offres', 'biz.tab.rfqs'],
  ['/touma/business/messages', 'biz.tab.messages'],
  ['/touma/business/appels-offres/nouveau', 'biz.tab.publish'],
  ['/touma/sourcing', 'biz.tab.sourcing'],
  ['/touma/business/profil', 'biz.tab.profile'],
];

function tabs(current) {
  return `<nav class="tabs" aria-label="${esc(t('biz.nav'))}">
    ${TABS.map(([href, cle]) => `<a href="${href}" data-link${href === current ? ' aria-current="page"' : ''}>${esc(t(cle))}</a>`).join('')}
  </nav>`;
}

/**
 * Un appel d'offres et une offre ont chacun leur famille de statuts : « EXPIRED »
 * se dit d'une demande dont le délai est passé et d'une offre dont la validité
 * l'est — ce n'est pas le même objet, et le genre diffère en français.
 */
const etatDemande = (code) => t(`biz.rfq.${code}`);
const etatOffre = (code) => t(`biz.quote.${code}`);

// ── Vue d'ensemble ─────────────────────────────────────────────────────────
export async function dashboard() {
  const [profile, mine, open] = await Promise.all([
    api('/business/profile'),
    api('/rfqs?scope=mine&limit=5'),
    api('/rfqs?scope=open&limit=5'),
  ]);
  const awaiting = mine.items.filter((r) => ['OPEN', 'QUOTED'].includes(r.status));
  const quotesReceived = mine.items.reduce((acc, r) => acc + r.quoteCount, 0);

  return `
    ${breadcrumb([{ label: t('nav.home'), href: '/touma/' }, { label: t('biz.title') }])}
    <div class="row-between">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px">${esc(t('biz.title'))}</h1>
        <p class="muted small" style="margin:0">${esc(t('biz.intro'))}</p>
      </div>
      <a class="btn btn-accent" href="/touma/business/appels-offres/nouveau" data-link>${esc(t('biz.tab.publish'))}</a>
    </div>
    ${tabs('/touma/business')}

    ${profile
      ? ''
      : `<div class="alert alert-info" style="margin-bottom:var(--space-5)">
          <div>
            <strong>${esc(t('biz.completeProfile'))}</strong>
            <div class="small">${esc(t('biz.completeProfileHint'))}
              <a href="/touma/business/profil" data-link>${esc(t('biz.fillProfile'))}</a></div>
          </div>
        </div>`}

    <div class="grid grid-stats">
      ${statCard(t('biz.openRfqs'), awaiting.length)}
      ${statCard(t('biz.quotesReceived'), quotesReceived)}
      ${statCard(t('biz.company'), profile ? profile.legalName : t('biz.noCompany'), profile?.sector ?? '')}
    </div>

    <section class="section mt-8">
      <div class="section-head">
        <h2>${esc(t('biz.myLastRequests'))}</h2>
        <a class="small" href="/touma/business/appels-offres" data-link>${esc(t('action.seeAll'))}</a>
      </div>
      ${mine.items.length ? rfqList(mine.items) : emptyState({
        title: t('biz.noRfqTitle'),
        body: t('biz.noRfqBody'),
        actionLabel: t('biz.tab.publish'),
        actionHref: '/touma/business/appels-offres/nouveau',
        iconName: 'inbox',
      })}
    </section>

    ${session.isSeller && open.items.length
      ? `<section class="section">
          <div class="section-head"><h2>${esc(t('biz.canAnswer'))}</h2></div>
          ${rfqList(open.items)}
        </section>`
      : ''}`;
}

function rfqList(items) {
  return `<div class="stack">
    ${items
      .map(
        (r) => `<article class="card">
          <div class="row-between">
            <div style="min-width:0">
              <h3 style="margin-bottom:2px"><a href="/touma/business/appels-offres/${esc(r.id)}" data-link>${esc(r.title)}</a></h3>
              <div class="product-meta">
                <span class="badge">${esc(r.reference)}</span>
                <span class="badge badge-country">${esc(t('biz.deliveryBadge', { country: r.countryCode }))}${
                  r.city ? ` · ${esc(r.city)}` : ''
                }</span>
                ${r.sourceCountry ? `<span class="badge badge-cross">${esc(t('biz.originBadge', { country: r.sourceCountry }))}</span>` : ''}
                <span>${esc(t('biz.linesAndQuotes', { lines: r.items.length, quotes: r.quoteCount }))}</span>
              </div>
            </div>
            <div class="row" style="gap:var(--space-3)">
              <span class="status status-${esc(r.status)}">${esc(etatDemande(r.status))}</span>
              <a class="btn btn-secondary btn-sm" href="/touma/business/appels-offres/${esc(r.id)}" data-link>${esc(t('biz.open'))}</a>
            </div>
          </div>
          <p class="small muted mt-6" style="margin-bottom:0">
            ${r.items.map((i) => `${i.quantity} ${esc(i.unit)} — ${esc(i.name)}`).join(' · ')}
            ${r.deadline ? esc(t('biz.answersUntil', { date: formatDate(r.deadline) })) : ''}
          </p>
        </article>`,
      )
      .join('')}
  </div>`;
}

// ── Liste des appels d'offres ──────────────────────────────────────────────
export async function rfqs(_params, query) {
  const requested = query.get('scope');
  const scope = ['open', 'invited'].includes(requested) ? requested : 'mine';
  const data = await api(`/rfqs?scope=${scope}&limit=25`);

  const EMPTY = {
    mine: { title: t('biz.noRfqTitle'), body: t('biz.noRfqSimpleBody'), actionLabel: t('biz.tab.publish') },
    open: { title: t('biz.noOpenRfqTitle'), body: t('biz.noOpenRfqBody') },
    invited: { title: t('biz.noInviteTitle'), body: t('biz.noInviteBody') },
  }[scope];

  return `
    <h1 style="font-size:var(--text-xl)">${esc(t('biz.rfqsTitle'))}</h1>
    ${tabs('/touma/business/appels-offres')}
    <div class="chip-row" style="margin-bottom:var(--space-5)">
      <a class="chip" href="/touma/business/appels-offres" data-link aria-current="${scope === 'mine'}">${esc(t('biz.myRequests'))}</a>
      <a class="chip" href="/touma/business/appels-offres?scope=open" data-link aria-current="${scope === 'open'}">${esc(
        t('biz.openRequests'),
      )}</a>
      ${session.isSeller
        ? `<a class="chip" href="/touma/business/appels-offres?scope=invited" data-link aria-current="${scope === 'invited'}">${esc(
            t('biz.invitations'),
          )}</a>`
        : ''}
    </div>
    ${data.items.length
      ? rfqList(data.items)
      : emptyState({
          ...EMPTY,
          actionHref: '/touma/business/appels-offres/nouveau',
          iconName: 'inbox',
        })}`;
}

// ── Formulaire de publication ──────────────────────────────────────────────
export async function newRfq() {
  const [countries, categories] = await Promise.all([api('/countries'), api('/categories')]);
  const option = (c) => `<option value="${esc(c.code)}"${c.code === session.user?.countryCode ? ' selected' : ''}>${esc(c.name)}</option>`;

  return `
    <h1 style="font-size:var(--text-xl)">${esc(t('biz.publishTitle'))}</h1>
    ${tabs('/touma/business/appels-offres/nouveau')}
    <p class="muted small">${esc(t('biz.publishIntro'))}</p>

    <form class="card" id="rfq-form">
      <div class="field">
        <label for="q-title">${esc(t('biz.rfqTitle'))}</label>
        <input id="q-title" required maxlength="200" placeholder="${esc(t('biz.rfqTitlePlaceholder'))}" />
      </div>
      <div class="field">
        <label for="q-description">${esc(t('biz.details'))}</label>
        <textarea id="q-description" rows="4" maxlength="4000" placeholder="${esc(t('biz.detailsPlaceholder'))}"></textarea>
      </div>
      <div class="grid grid-2">
        <div class="field">
          <label for="q-country">${esc(t('biz.deliveryCountry'))}</label>
          <select id="q-country">${countries.items.map(option).join('')}</select>
        </div>
        <div class="field"><label for="q-city">${esc(t('biz.deliveryCity'))}</label><input id="q-city" maxlength="120" /></div>
        <div class="field">
          <label for="q-source">${esc(t('biz.sourceCountry'))}</label>
          <select id="q-source"><option value="">${esc(t('biz.anySource'))}</option>${countries.items.map((c) => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label for="q-currency">${esc(t('biz.currency'))}</label>
          <select id="q-currency"><option value="XAF">XAF</option><option value="EUR">EUR</option></select>
        </div>
        <div class="field">
          <label for="q-deadline">${esc(t('biz.deadline'))}</label>
          <input id="q-deadline" type="date" />
        </div>
      </div>

      <fieldset>
        <legend class="label">${esc(t('biz.wantedProducts'))}</legend>
        <div id="rfq-items">${rfqItemRow(0, categories.items)}</div>
        <button class="btn btn-secondary btn-sm" type="button" id="add-rfq-item">${esc(t('biz.addLine'))}</button>
      </fieldset>

      <div class="row mt-6">
        <button class="btn btn-accent" type="submit">${esc(t('biz.publish'))}</button>
        <a class="btn btn-ghost" href="/touma/business/appels-offres" data-link>${esc(t('action.cancel'))}</a>
      </div>
    </form>`;
}

export function rfqItemRow(index, categories) {
  return `<div class="card rfq-item" style="box-shadow:none;margin-bottom:var(--space-3)">
    <div class="grid grid-2">
      <div class="field"><label for="i-name-${index}">${esc(t('biz.itemName'))}</label><input id="i-name-${index}" class="i-name" required maxlength="200" placeholder="${esc(
        t('biz.itemNamePlaceholder'),
      )}" /></div>
      <div class="field">
        <label for="i-category-${index}">${esc(t('biz.itemCategory'))}</label>
        <select id="i-category-${index}" class="i-category"><option value="">${esc(t('biz.itemCategoryNone'))}</option>${categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label for="i-qty-${index}">${esc(t('biz.itemQty'))}</label><input id="i-qty-${index}" class="i-qty" type="number" min="1" value="100" required /></div>
      <div class="field"><label for="i-unit-${index}">${esc(t('biz.itemUnit'))}</label><input id="i-unit-${index}" class="i-unit" value="kg" maxlength="30" /></div>
      <div class="field"><label for="i-target-${index}">${esc(t('biz.itemTarget'))}</label><input id="i-target-${index}" class="i-target" inputmode="decimal" placeholder="2800" /></div>
    </div>
    <div class="field" style="margin-bottom:0"><label for="i-desc-${index}">${esc(t('biz.itemDetail'))}</label><input id="i-desc-${index}" class="i-desc" maxlength="1000" placeholder="${esc(
      t('biz.itemDetailPlaceholder'),
    )}" /></div>
  </div>`;
}

// ── Détail d'un appel d'offres et comparaison des offres ───────────────────
export async function rfq(params) {
  const [data, me] = await Promise.all([api(`/rfqs/${params.id}`), session.user ? api('/auth/me') : Promise.resolve(null)]);
  const canQuote = session.isSeller && !data.isOwner && ['OPEN', 'QUOTED'].includes(data.status);
  const stores = canQuote ? await api('/stores/mine') : { items: [] };
  const alreadyQuoted = data.quotes.some((q) => stores.items.some((s) => s.id === q.store.id));

  return `
    ${breadcrumb([
      { label: t('biz.title'), href: '/touma/business' },
      { label: t('biz.rfqsTitle'), href: '/touma/business/appels-offres' },
      { label: data.reference },
    ])}
    <div class="row-between" style="margin-bottom:var(--space-4)">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px">${esc(data.title)}</h1>
        <p class="small muted" style="margin:0">
          ${esc(data.reference)} · ${esc(t('biz.publishedOn', { date: formatDate(data.createdAt) }))}
          ${data.deadline ? esc(t('biz.answersUntil', { date: formatDate(data.deadline) })) : ''}
        </p>
      </div>
      <span class="status status-${esc(data.status)}">${esc(etatDemande(data.status))}</span>
    </div>

    <div class="grid grid-2">
      <section class="card">
        <h2 style="font-size:var(--text-md)">${esc(t('biz.needExpressed'))}</h2>
        ${data.description ? `<p class="small" style="white-space:pre-line">${esc(data.description)}</p>` : ''}
        <div class="table-wrap" style="border:0">
          <table>
            <thead><tr><th>${esc(t('biz.col.product'))}</th><th>${esc(t('biz.col.quantity'))}</th><th>${esc(
              t('biz.col.targetPrice'),
            )}</th></tr></thead>
            <tbody>
              ${data.items
                .map(
                  (i) => `<tr>
                    <td>${esc(i.name)}${i.description ? `<div class="xs muted">${esc(i.description)}</div>` : ''}</td>
                    <td>${i.quantity} ${esc(i.unit)}</td>
                    <td>${i.targetUnitPrice ? money(i.targetUnitPrice, data.currency) : '—'}</td>
                  </tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>
        <dl class="spec-list mt-6">
          <div><dt>${esc(t('biz.deliveryLabel'))}</dt><dd>${esc(data.countryCode)}${data.city ? ` · ${esc(data.city)}` : ''}</dd></div>
          ${data.sourceCountry ? `<div><dt>${esc(t('biz.originLabel'))}</dt><dd>${esc(data.sourceCountry)}</dd></div>` : ''}
          <div><dt>${esc(t('biz.currencyLabel'))}</dt><dd>${esc(data.currency)}</dd></div>
          ${data.business ? `<div><dt>${esc(t('biz.buyerLabel'))}</dt><dd>${esc(data.business.legalName)}${data.business.sector ? ` — ${esc(data.business.sector)}` : ''}</dd></div>` : ''}
        </dl>
        ${data.isOwner && ['OPEN', 'QUOTED'].includes(data.status)
          ? `<button class="btn btn-secondary btn-sm mt-6" data-close-rfq="${esc(data.id)}">${esc(t('biz.closeRfq'))}</button>`
          : ''}
      </section>

      <section>
        ${canQuote && !alreadyQuoted
          ? `<form class="card" id="quote-form" data-rfq="${esc(data.id)}">
              <h2 style="font-size:var(--text-md)">${esc(t('biz.proposeQuote'))}</h2>
              <div class="field">
                <label for="qf-store">${esc(t('biz.quoteStore'))}</label>
                <select id="qf-store">${stores.items.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${esc(s.countryCode)})</option>`).join('')}</select>
              </div>
              <div id="quote-lines">
                ${data.items
                  .map(
                    (i, index) => `<div class="card quote-line" style="box-shadow:none;margin-bottom:var(--space-3)" data-rfq-item="${esc(i.id)}">
                      <strong class="small">${esc(i.name)} — ${i.quantity} ${esc(i.unit)}</strong>
                      <div class="grid grid-2 mt-6">
                        <div class="field" style="margin-bottom:0"><label for="ql-qty-${index}">${esc(
                          t('biz.proposedQty'),
                        )}</label><input id="ql-qty-${index}" class="ql-qty" type="number" min="1" value="${i.quantity}" /></div>
                        <div class="field" style="margin-bottom:0"><label for="ql-price-${index}">${esc(
                          t('biz.unitPriceField', { currency: data.currency }),
                        )}</label><input id="ql-price-${index}" class="ql-price" inputmode="decimal" required placeholder="2750" /></div>
                      </div>
                      <input type="hidden" class="ql-name" value="${esc(i.name)}" />
                      <input type="hidden" class="ql-unit" value="${esc(i.unit)}" />
                    </div>`,
                  )
                  .join('')}
              </div>
              <div class="grid grid-2">
                <div class="field"><label for="qf-shipping">${esc(
                  t('biz.shippingField', { currency: data.currency }),
                )}</label><input id="qf-shipping" inputmode="decimal" value="0" /></div>
                <div class="field"><label for="qf-lead">${esc(t('biz.leadDays'))}</label><input id="qf-lead" type="number" min="0" value="10" /></div>
                <div class="field"><label for="qf-validity">${esc(t('biz.validityDays'))}</label><input id="qf-validity" type="number" min="1" max="120" value="14" /></div>
              </div>
              <div class="field"><label for="qf-message">${esc(t('biz.messageToClient'))}</label><textarea id="qf-message" rows="3" maxlength="2000"></textarea></div>
              <button class="btn btn-accent" type="submit">${esc(t('biz.sendQuote'))}</button>
            </form>`
          : ''}

        <div class="card${canQuote && !alreadyQuoted ? ' mt-6' : ''}">
          <h2 style="font-size:var(--text-md)">
            ${esc(data.isOwner ? t('biz.quotesReceivedCount', { count: data.quotes.length }) : t('biz.myQuote'))}
          </h2>
          ${data.quotes.length
            ? `<div class="stack">${data.quotes.map((q) => quoteCard(q, data, me)).join('')}</div>`
            : `<p class="muted small" style="margin:0">${esc(
                t(data.isOwner ? 'biz.noQuoteYetOwner' : 'biz.noQuoteYetSupplier'),
              )}</p>`}
        </div>
      </section>
    </div>`;
}

function quoteCard(q, rfqData, me) {
  const canDecide = rfqData.isOwner && ['SUBMITTED', 'COUNTERED'].includes(q.status) && !q.expired;
  const addresses = me?.addresses ?? [];
  return `<article class="card" style="box-shadow:none">
    <div class="row-between">
      <div>
        <strong>${esc(q.store.name)}</strong>
        <div class="product-meta">
          <span class="badge badge-country">${esc(q.store.countryCode)}</span>
          ${q.store.verificationStatus === 'APPROVED' ? `<span class="badge badge-verified">${esc(t('biz.verified'))}</span>` : ''}
          ${stars(q.store.ratingAverage, q.store.ratingCount)}
        </div>
      </div>
      <span class="status status-${esc(q.status)}">${esc(etatOffre(q.status))}</span>
    </div>

    <div class="summary mt-6">
      <div class="summary-line"><span>${esc(t('biz.goods'))}</span><span>${money(q.itemsTotal, q.currency)}</span></div>
      <div class="summary-line"><span>${esc(t('biz.transport'))}</span><span>${money(q.shippingTotal, q.currency)}</span></div>
      <div class="summary-line summary-total"><span>${esc(t('biz.total'))}</span><span>${money(q.total, q.currency)}</span></div>
    </div>
    <p class="xs muted">
      ${esc(t('biz.leadAndValidity', { days: q.leadTimeDays, date: formatDate(q.validUntil) }))}
      ${q.expired ? ` · <span class="badge badge-danger">${esc(t('biz.expiredBadge'))}</span>` : ''}
    </p>
    ${q.message ? `<p class="small">« ${esc(q.message)} »</p>` : ''}

    <div class="row" style="gap:var(--space-2);flex-wrap:wrap;margin-top:var(--space-3)">
      <a class="btn btn-secondary btn-sm" href="/touma/negociations/${esc(q.id)}" data-link>${svg('chart')} ${esc(
        t('biz.openNegotiation'),
      )}</a>
      ${q.conversationId ? `<a class="btn btn-ghost btn-sm" href="/touma/messages/${esc(q.conversationId)}" data-link>${svg('inbox')} ${esc(t('biz.discuss'))}</a>` : ''}
    </div>

    ${q.negotiations.length
      ? `<details style="margin-top:var(--space-3)">
          <summary class="small strong">${esc(t('biz.negotiationCount', { count: q.negotiations.length }))}</summary>
          <div class="stack" style="margin-top:var(--space-3);gap:var(--space-2)">
            ${q.negotiations
              .map(
                (n) => `<div class="notif-item">
                  <strong>${esc(n.author.name)}${n.kind === 'COUNTER_OFFER' ? esc(t('biz.counterSuffix')) : ''}</strong>
                  <p>${esc(n.body)}${n.proposedTotal ? ` <strong>${money(n.proposedTotal, q.currency)}</strong>` : ''}</p>
                  <span class="xs muted">${formatDate(n.createdAt, true)}</span>
                </div>`,
              )
              .join('')}
          </div>
        </details>`
      : ''}

    ${['ACCEPTED', 'REJECTED', 'WITHDRAWN'].includes(q.status) || q.expired
      ? q.orderGroupId
        ? `<a class="btn btn-secondary btn-sm mt-6" href="/touma/commandes/groupe/${esc(q.orderGroupId)}" data-link>${esc(
            t('biz.viewOrder'),
          )}</a>`
        : ''
      : `<form class="mt-6 negotiate-form" data-quote="${esc(q.id)}">
          <div class="field" style="margin-bottom:var(--space-2)">
            <label for="neg-${esc(q.id)}">${esc(t('biz.counterLabel'))}</label>
            <textarea id="neg-${esc(q.id)}" class="neg-body" rows="2" maxlength="2000" placeholder="${esc(
              t('biz.counterPlaceholder'),
            )}"></textarea>
          </div>
          <div class="row" style="gap:var(--space-2)">
            <input class="neg-total" inputmode="decimal" placeholder="${esc(t('biz.proposedTotal'))}" style="max-width:220px" />
            <button class="btn btn-secondary btn-sm" type="submit">${esc(t('action.send'))}</button>
          </div>
        </form>
        ${canDecide
          ? `<div class="row mt-6">
              ${addresses.length
                ? `<select class="accept-address" style="max-width:260px" aria-label="${esc(t('biz.addressAria'))}">
                    ${addresses.map((a) => `<option value="${esc(a.id)}">${esc(a.city)} — ${esc(a.line1)}</option>`).join('')}
                  </select>
                  <button class="btn btn-accent btn-sm" data-accept-quote="${esc(q.id)}">${esc(t('biz.acceptAndOrder'))}</button>`
                : `<a class="btn btn-secondary btn-sm" href="/touma/compte" data-link>${esc(t('biz.needAddress'))}</a>`}
              <button class="btn btn-ghost btn-sm" data-reject-quote="${esc(q.id)}">${esc(t('biz.rejectQuote'))}</button>
            </div>`
          : ''}`}
  </article>`;
}

// ── Profil entreprise ──────────────────────────────────────────────────────
export async function profile() {
  const [profileData, countries] = await Promise.all([api('/business/profile'), api('/countries')]);
  const value = (v) => esc(v ?? '');
  return `
    <h1 style="font-size:var(--text-xl)">${esc(t('biz.profileTitle'))}</h1>
    ${tabs('/touma/business/profil')}
    <p class="muted small">${esc(t('biz.profileIntro'))}</p>

    <form class="card" id="business-form">
      <div class="field"><label for="b-legal">${esc(t('biz.legalName'))}</label><input id="b-legal" required maxlength="200" value="${value(profileData?.legalName)}" /></div>
      <div class="grid grid-2">
        <div class="field"><label for="b-reg">${esc(t('biz.registrationNo'))}</label><input id="b-reg" maxlength="80" value="${value(profileData?.registrationNo)}" /></div>
        <div class="field"><label for="b-tax">${esc(t('biz.taxId'))}</label><input id="b-tax" maxlength="80" value="${value(profileData?.taxId)}" /></div>
        <div class="field"><label for="b-sector">${esc(t('biz.sector'))}</label><input id="b-sector" maxlength="120" value="${value(profileData?.sector)}" placeholder="${esc(
          t('biz.sectorPlaceholder'),
        )}" /></div>
        <div class="field">
          <label for="b-country">${esc(t('biz.country'))}</label>
          <select id="b-country">${countries.items.map((c) => `<option value="${esc(c.code)}"${profileData?.countryCode === c.code ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label for="b-city">${esc(t('biz.city'))}</label><input id="b-city" maxlength="120" value="${value(profileData?.city)}" /></div>
        <div class="field"><label for="b-phone">${esc(t('biz.phone'))}</label><input id="b-phone" inputmode="tel" maxlength="30" value="${value(profileData?.phone)}" /></div>
        <div class="field"><label for="b-website">${esc(t('biz.website'))}</label><input id="b-website" type="url" maxlength="200" value="${value(profileData?.website)}" placeholder="https://…" /></div>
        <div class="field"><label for="b-volume">${esc(t('biz.annualVolume'))}</label><input id="b-volume" maxlength="60" value="${value(profileData?.annualVolume)}" placeholder="${esc(
          t('biz.annualVolumePlaceholder'),
        )}" /></div>
      </div>
      <button class="btn btn-accent" type="submit">${esc(t('action.save'))}</button>
    </form>`;
}

// ── Offres du fournisseur ──────────────────────────────────────────────────
export async function myQuotes() {
  const data = await api('/quotes/mine');
  return `
    <h1 style="font-size:var(--text-xl)">${esc(t('biz.myQuotes'))}</h1>
    <p class="muted small">${esc(t('biz.myQuotesIntro'))}</p>
    ${data.items.length
      ? `<div class="stack">
          ${data.items
            .map(
              (q) => `<article class="card">
                <div class="row-between">
                  <div>
                    <h3 style="margin-bottom:2px"><a href="/touma/business/appels-offres/${esc(q.rfq.id)}" data-link>${esc(q.rfq.title)}</a></h3>
                    <div class="product-meta">
                      <span class="badge">${esc(q.reference)}</span>
                      <span class="badge badge-country">${esc(q.rfq.countryCode)}</span>
                      <span>${q.leadTimeDays} j de délai</span>
                    </div>
                  </div>
                  <div class="row" style="gap:var(--space-3)">
                    <strong>${money(q.total, q.currency)}</strong>
                    <span class="status status-${esc(q.status)}">${esc(QUOTE_STATUS[q.status] ?? q.status)}</span>
                  </div>
                </div>
                <div class="row" style="gap:var(--space-2);flex-wrap:wrap;margin-top:var(--space-3)">
                  <a class="btn btn-secondary btn-sm" href="/touma/vendeur/negociations/${esc(q.id)}" data-link>${svg('chart')} Négociation</a>
                  ${q.orderGroupId ? `<a class="btn btn-ghost btn-sm" href="/touma/vendeur/commandes" data-link>${svg('box')} Commande gagnée</a>` : ''}
                </div>
              </article>`,
            )
            .join('')}
        </div>`
      : emptyState({
          title: t('biz.noQuoteSentTitle'),
          body: t('biz.noQuoteSentBody'),
          actionLabel: t('biz.seeRequests'),
          actionHref: '/touma/business/appels-offres?scope=open',
          iconName: 'inbox',
        })}`;
}

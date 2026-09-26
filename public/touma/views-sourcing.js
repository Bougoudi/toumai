/**
 * Sourcing fournisseurs.
 *
 * Un acheteur en gros ne cherche pas un article : il cherche **qui peut le
 * fournir**, au bon volume, depuis le bon pays, dans un délai tenable. Tout ce
 * qui est affiché ici est observé — capacité réellement en stock, pays
 * réellement desservis, délais réellement annoncés — jamais déclaré.
 */
import { api, esc, emptyState, formatDate, money, session, stars, svg, toast } from './core.js';
import { breadcrumb, pagination } from './components.js';
import { t, formatNumber } from './i18n.js';

// Les paliers de réputation sont ceux de la vitrine : une seule table.
const niveau = (code) => t(`rep.level.${code}`);

/** L'ordre des tris proposés — l'ordre, pas les libellés. */
const SORTS = ['relevance', 'capacity', 'price', 'reputation'];

/** Carte d'un fournisseur : ce qu'on sait de lui, et ce qu'on ne sait pas. */
function supplierCard(item, { selectable }) {
  const s = item.store;
  const initial = (s.name || 'T').trim().charAt(0).toUpperCase();

  const facts = [
    [t('src.capacity'), t('src.units', { count: formatNumber(item.capacity) })],
    item.minOrderQty !== null ? [t('src.minQty'), `${item.minOrderQty}`] : null,
    item.bestPrice ? [t('src.from'), money(item.bestPrice.amount, item.bestPrice.currency)] : null,
    item.medianLeadTimeDays !== null ? [t('src.medianLead'), t('src.days', { count: item.medianLeadTimeDays })] : null,
    [t('src.matchingProducts'), String(item.matchingProducts)],
  ].filter(Boolean);

  return `<article class="card">
    <div class="row-between" style="align-items:flex-start;gap:var(--space-3)">
      <div class="row" style="gap:var(--space-3);min-width:0">
        <span class="store-logo" style="width:44px;height:44px;font-size:var(--text-md)">${esc(initial)}</span>
        <div style="min-width:0">
          <h3 style="font-size:var(--text-md);margin:0 0 2px">
            <a href="/touma/sourcing/${esc(s.slug)}" data-link style="color:inherit">${esc(s.name)}</a>
          </h3>
          <div class="product-meta">
            <span class="badge badge-country">${esc(s.countryCode)}${s.city ? ` · ${esc(s.city)}` : ''}</span>
            ${s.verified ? `<span class="badge badge-verified">${esc(t('src.verified'))}</span>` : ''}
            ${item.reputationScore !== null ? `<span class="badge badge-verified">${esc(niveau(item.reputationLevel))} · ${item.reputationScore}/100</span>` : ''}
            ${s.rating.count ? stars(s.rating.average, s.rating.count) : ''}
          </div>
        </div>
      </div>
      ${selectable
        ? `<label class="check" style="border:0;padding:0;margin:0">
            <input type="checkbox" class="supplier-pick" data-store="${esc(s.id)}" />
            <span class="small">${esc(t('src.solicit'))}</span>
          </label>`
        : ''}
    </div>

    <dl class="spec-list mt-6">
      ${facts.map(([labelText, value]) => `<div><dt>${esc(labelText)}</dt><dd>${esc(value)}</dd></div>`).join('')}
    </dl>

    ${item.servesRequestedQuantity !== null
      ? `<p class="small" style="margin:var(--space-3) 0 0;color:${item.servesRequestedQuantity ? 'var(--success)' : 'var(--warning)'}">
          ${esc(t(item.servesRequestedQuantity ? 'src.canServe' : 'src.cannotServe'))}
        </p>`
      : ''}

    ${item.servesDestination !== null
      ? `<p class="xs muted" style="margin:var(--space-2) 0 0">
          ${esc(t(item.servesDestination ? 'src.hasShippedThere' : 'src.hasNotShippedThere'))}
        </p>`
      : ''}

    ${item.samples.length
      ? `<div class="chip-row mt-6">
          ${item.samples
            .map((p) => `<a class="chip" href="/touma/produits/${esc(p.slug)}" data-link>${esc(p.title)} · ${money(p.price, p.currency)}</a>`)
            .join('')}
        </div>`
      : ''}
  </article>`;
}

/** Recherche de fournisseurs, avec ses filtres métier. */
export async function suppliers(_params, query) {
  const search = new URLSearchParams();
  for (const key of ['q', 'category', 'country', 'destination', 'minQuantity', 'verifiedOnly', 'sort', 'page']) {
    const value = query.get(key);
    if (value) search.set(key, value);
  }
  search.set('limit', '12');

  const [data, categories, countries] = await Promise.all([
    api(`/sourcing/suppliers?${search.toString()}`),
    api('/categories'),
    api('/countries'),
  ]);

  // Sollicitation : réservée aux appels d'offres de l'acheteur connecté.
  const rfqs = session.user ? await api('/rfqs?scope=mine&status=OPEN&limit=20').catch(() => ({ items: [] })) : { items: [] };
  const selectable = rfqs.items.length > 0;

  const opt = (value, text, current) => `<option value="${esc(value)}"${current === value ? ' selected' : ''}>${esc(text)}</option>`;
  const hrefFor = (page) => {
    const next = new URLSearchParams(query);
    next.set('page', String(page));
    return `/touma/sourcing?${next.toString()}`;
  };

  return `
    ${breadcrumb([{ label: t('src.businessCrumb'), href: '/touma/business' }, { label: t('src.crumb') }])}
    <h1 style="font-size:var(--text-xl)">${esc(t('src.title'))}</h1>
    <p class="small muted">${esc(t('src.intro'))}</p>

    <form id="sourcing-filters" class="card" style="margin-bottom:var(--space-5)">
      <div class="grid grid-2" style="gap:var(--space-3)">
        <div class="field" style="margin:0"><label for="so-q">${esc(t('src.whatAreYouLookingFor'))}</label>
          <input id="so-q" name="q" value="${esc(query.get('q') ?? '')}" placeholder="${esc(t('src.searchPlaceholder'))}" />
        </div>
        <div class="field" style="margin:0"><label for="so-category">${esc(t('src.category'))}</label>
          <select id="so-category" name="category">
            <option value="">${esc(t('src.allCategories'))}</option>
            ${categories.items.map((c) => opt(c.slug, c.name, query.get('category'))).join('')}
          </select>
        </div>
      </div>
      <div class="grid grid-2" style="gap:var(--space-3)">
        <div class="field" style="margin:0"><label for="so-country">${esc(t('src.supplierCountry'))}</label>
          <select id="so-country" name="country">
            <option value="">${esc(t('src.allCountries'))}</option>
            ${countries.items.map((c) => opt(c.code, c.name, query.get('country'))).join('')}
          </select>
        </div>
        <div class="field" style="margin:0"><label for="so-destination">${esc(t('src.deliverTo'))}</label>
          <select id="so-destination" name="destination">
            <option value="">${esc(t('src.anyDestination'))}</option>
            ${countries.items.map((c) => opt(c.code, c.name, query.get('destination'))).join('')}
          </select>
        </div>
      </div>
      <div class="grid grid-2" style="gap:var(--space-3)">
        <div class="field" style="margin:0"><label for="so-quantity">${esc(t('src.volume'))}</label>
          <input id="so-quantity" name="minQuantity" type="number" min="1" value="${esc(query.get('minQuantity') ?? '')}" placeholder="2000" />
        </div>
        <div class="field" style="margin:0"><label for="so-sort">${esc(t('src.sortBy'))}</label>
          <select id="so-sort" name="sort">${SORTS.map((code) => opt(code, t(`src.sort.${code}`), query.get('sort'))).join('')}</select>
        </div>
      </div>
      <label class="check" style="margin:var(--space-3) 0">
        <input type="checkbox" name="verifiedOnly" value="true" ${query.get('verifiedOnly') ? 'checked' : ''} />
        <span class="small">${esc(t('src.verifiedOnly'))}</span>
      </label>
      <button class="btn" type="submit">${esc(t('src.search'))}</button>
    </form>

    ${selectable
      ? `<form id="invite-form" class="card" style="margin-bottom:var(--space-5)">
          <div class="row-between" style="gap:var(--space-3);flex-wrap:wrap">
            <div class="field" style="flex:1;min-width:220px;margin:0">
              <label for="so-rfq">${esc(t('src.solicitFor'))}</label>
              <select id="so-rfq">
                ${rfqs.items.map((r) => `<option value="${esc(r.id)}">${esc(r.reference)} — ${esc(r.title)}</option>`).join('')}
              </select>
            </div>
            <button class="btn btn-accent" type="submit">${esc(t('src.sendInvitation'))}</button>
          </div>
          <p class="xs muted" style="margin:var(--space-2) 0 0">${esc(t('src.invitationNote'))}</p>
        </form>`
      : session.user
        ? `<p class="small muted">${esc(t('src.needRfq'))}
            <a href="/touma/business/appels-offres/nouveau" data-link>${esc(t('src.publishRfq'))}</a>.</p>`
        : ''}

    ${data.items.length
      ? `<div class="grid grid-cards">${data.items.map((i) => supplierCard(i, { selectable })).join('')}</div>
         ${pagination(data, hrefFor)}`
      : emptyState({
          title: t('src.emptyTitle'),
          body: t('src.emptyBody'),
          actionLabel: t('src.allStores'),
          actionHref: '/touma/boutiques',
          iconName: 'store',
        })}`;
}

/** Fiche fournisseur : catalogue par catégorie, faits observés, réputation. */
export async function supplier(params) {
  const d = await api(`/sourcing/suppliers/${params.slug}`);
  const r = d.reputation;

  return `
    ${breadcrumb([{ label: t('src.crumb'), href: '/touma/sourcing' }, { label: d.store.name }])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px">${esc(d.store.name)}</h1>
        <p class="small muted" style="margin:0">
          ${esc(d.store.countryCode)}${d.store.city ? ` · ${esc(d.store.city)}` : ''} · ${esc(
            t('src.memberSince', { date: formatDate(d.store.memberSince) }),
          )}
        </p>
      </div>
      <div class="row" style="gap:var(--space-2)">
        ${
          d.store.verified
            ? `<span class="badge badge-verified">${esc(t('src.verified'))}</span>`
            : `<span class="badge">${esc(t('src.notVerified'))}</span>`
        }
        ${r.published ? `<span class="badge badge-verified">${esc(niveau(r.level))} · ${r.score}/100</span>` : ''}
      </div>
    </div>

    <div class="grid grid-2" style="align-items:start">
      <div class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('src.whatHeOffers'))}</h2>
          ${d.store.description ? `<p class="small">${esc(d.store.description)}</p>` : ''}
          ${d.catalogue.length
            ? `<div class="table-wrap" style="border:0"><table>
                <thead><tr><th>${esc(t('src.col.category'))}</th><th>${esc(t('src.col.products'))}</th><th>${esc(
                  t('src.col.capacity'),
                )}</th><th>${esc(t('src.col.from'))}</th></tr></thead>
                <tbody>
                  ${d.catalogue
                    .map(
                      (c) => `<tr>
                        <td>${esc(c.name)}</td>
                        <td>${c.products}</td>
                        <td>${esc(formatNumber(c.capacity))}</td>
                        <td>${c.minPrice ? money(c.minPrice, c.currency) : '—'}</td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table></div>`
            : `<p class="muted small">${esc(t('src.noActiveProduct'))}</p>`}
          <a class="btn btn-secondary btn-sm mt-6" href="/touma/boutiques/${esc(d.store.slug)}" data-link>${esc(
            t('src.viewStorefront'),
          )}</a>
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('src.whatHeDid'))}</h2>
          <dl class="spec-list">
            <div><dt>${esc(t('src.shippedOrders'))}</dt><dd>${d.shippedOrders}</dd></div>
            <div><dt>${esc(t('src.servedCountries'))}</dt><dd>${
              d.servedCountries.length ? esc(d.servedCountries.join(', ')) : esc(t('src.noneYet'))
            }</dd></div>
            <div><dt>${esc(t('src.quotesSent'))}</dt><dd>${esc(
              d.quotesAccepted
                ? t('src.quotesAccepted', { sent: d.quotesSent, accepted: d.quotesAccepted })
                : String(d.quotesSent),
            )}</dd></div>
            <div><dt>${esc(t('src.medianLead'))}</dt><dd>${esc(
              d.medianLeadTimeDays !== null ? t('src.days', { count: d.medianLeadTimeDays }) : t('src.noQuoteYet'),
            )}</dd></div>
            <div><dt>${esc(t('src.totalCapacity'))}</dt><dd>${esc(formatNumber(d.totalCapacity))}</dd></div>
          </dl>
          <p class="xs muted" style="margin:var(--space-3) 0 0">${esc(t('src.historyNote'))}</p>
        </section>
      </div>

      <aside class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('src.reputation'))}</h2>
          ${r.published
            ? `<dl class="spec-list">
                ${r.metrics.onTimeRate !== null ? `<div><dt>${esc(t('src.onTime'))}</dt><dd>${Math.round(r.metrics.onTimeRate * 100)} %</dd></div>` : ''}
                ${r.metrics.disputeRate !== null ? `<div><dt>${esc(t('src.disputes'))}</dt><dd>${Math.round(r.metrics.disputeRate * 100)} %</dd></div>` : ''}
                ${r.metrics.responseRate !== null ? `<div><dt>${esc(t('src.responses'))}</dt><dd>${Math.round(r.metrics.responseRate * 100)} %</dd></div>` : ''}
                <div><dt>${esc(t('src.deliveredOrders'))}</dt><dd>${r.ordersDelivered}</dd></div>
              </dl>`
            : `<p class="small muted" style="margin:0">${esc(t('src.notEnough', { minimum: r.minimumOrders }))}</p>`}
        </section>

        ${session.user
          ? `<section class="card">
              <h2 style="font-size:var(--text-md)">${esc(t('src.getInTouch'))}</h2>
              <p class="small muted">${esc(t('src.getInTouchHint'))}</p>
              <button class="btn btn-block btn-sm" data-contact-store="${esc(d.store.id)}">${svg('inbox')} ${esc(
                t('src.contactSupplier'),
              )}</button>
            </section>`
          : `<section class="card">
              <h2 style="font-size:var(--text-md)">${esc(t('src.getInTouch'))}</h2>
              <p class="small muted" style="margin:0">
                <a href="/touma/connexion" data-link>${esc(t('src.login'))}</a> ${esc(t('src.loginToContact'))}
              </p>
            </section>`}
      </aside>
    </div>`;
}

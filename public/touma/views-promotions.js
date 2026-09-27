/**
 * Promotions : création et suivi des codes de réduction.
 *
 * La même vue sert le vendeur (codes de ses boutiques, financés par lui) et
 * l'administration (campagnes TOUMA). La distinction n'est pas cosmétique :
 * elle décide qui paie la remise, et l'interface le dit explicitement.
 */
import { api, esc, emptyState, formatDate, money, statusPill } from './core.js';
import { breadcrumb, pagination } from './components.js';
import { t } from './i18n.js';

const typeRemise = (code) => t(`promo.type.${code}`);
const financement = (code) => t(`promo.funding.${code}`);

/** L'ordre des types proposés — l'ordre, pas les libellés. */
const TYPES = ['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING'];

/** Formule lisible de la remise accordée. */
function offer(coupon) {
  if (coupon.type === 'FREE_SHIPPING') return t('promo.freeShipping');
  if (coupon.type === 'PERCENTAGE') {
    return coupon.maxDiscountAmount
      ? t('promo.percentOffCapped', { value: coupon.value, cap: money(coupon.maxDiscountAmount, coupon.currency ?? '') })
      : t('promo.percentOff', { value: coupon.value });
  }
  return t('promo.amountOff', { amount: money(coupon.value, coupon.currency ?? '') });
}

function couponRow(coupon) {
  const usage = coupon.usageLimit ? `${coupon.usageCount}/${coupon.usageLimit}` : String(coupon.usageCount);
  return `<tr>
    <td>
      <strong style="font-family:var(--font-mono)">${esc(coupon.code)}</strong>
      ${coupon.description ? `<div class="xs muted">${esc(coupon.description)}</div>` : ''}
      <div class="xs muted">${esc(financement(coupon.funding))}</div>
    </td>
    <td>${esc(offer(coupon))}<div class="xs muted">${esc(typeRemise(coupon.type))}</div></td>
    <td class="small">
      ${coupon.minOrderAmount ? `${esc(t('promo.from', { amount: money(coupon.minOrderAmount, coupon.currency ?? '') }))}<br />` : ''}
      ${coupon.firstOrderOnly ? `${t('promo.firstOrder')}<br />` : ''}
      ${coupon.countryCodes.length ? esc(coupon.countryCodes.join(', ')) : `<span class="muted">${esc(t('promo.allCountries'))}</span>`}
    </td>
    <td class="small">${usage}${
      coupon.usageLimitPerUser
        ? `<div class="xs muted">${esc(t('promo.perBuyer', { count: coupon.usageLimitPerUser }))}</div>`
        : ''
    }</td>
    <td class="small">${coupon.endsAt ? formatDate(coupon.endsAt) : `<span class="muted">${esc(t('promo.noEnd'))}</span>`}</td>
    <td>${statusPill(coupon.status)}</td>
    <td class="row" style="gap:var(--space-2);justify-content:flex-end">
      <a class="btn btn-secondary btn-sm" href="/touma/promotions/${esc(coupon.id)}" data-link>${esc(t('promo.followUp'))}</a>
      ${coupon.status === 'ACTIVE'
        ? `<button class="btn btn-ghost btn-sm" data-pause-coupon="${esc(coupon.id)}">${esc(t('promo.pause'))}</button>`
        : coupon.status === 'PAUSED'
          ? `<button class="btn btn-ghost btn-sm" data-resume-coupon="${esc(coupon.id)}">${esc(t('promo.resume'))}</button>`
          : ''}
    </td>
  </tr>`;
}

/** Formulaire de création, adapté au périmètre (boutique ou plateforme). */
function createForm(stores, scope) {
  return `<form id="coupon-create-form" data-scope="${esc(scope)}">
    <p class="small muted">${esc(t(scope === 'platform' ? 'promo.platformNote' : 'promo.storeNote'))}</p>

    <div class="grid grid-2" style="gap:var(--space-3)">
      <div class="field"><label for="co-code">${esc(t('promo.code'))}</label>
        <input id="co-code" required minlength="3" maxlength="40" placeholder="RENTREE10" style="font-family:var(--font-mono);text-transform:uppercase" />
      </div>
      <div class="field"><label for="co-type">${esc(t('promo.discountType'))}</label>
        <select id="co-type">
          ${TYPES.map((code) => `<option value="${code}">${esc(typeRemise(code))}</option>`).join('')}
        </select>
      </div>
    </div>

    ${scope === 'store'
      ? `<div class="field"><label for="co-store">${esc(t('promo.store'))}</label>
          <select id="co-store" required>${stores.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>
        </div>`
      : ''}

    <div class="grid grid-2" style="gap:var(--space-3)">
      <div class="field" id="co-value-field"><label for="co-value">${esc(t('promo.value'))}</label>
        <input id="co-value" type="text" inputmode="decimal" placeholder="10" />
        <span class="field-hint">${esc(t('promo.valueHint'))}</span>
      </div>
      <div class="field"><label for="co-currency">${esc(t('promo.currency'))}</label>
        <input id="co-currency" maxlength="3" placeholder="XAF" style="text-transform:uppercase" />
      </div>
    </div>

    <div class="grid grid-2" style="gap:var(--space-3)">
      <div class="field"><label for="co-min">${esc(t('promo.minPurchase'))}</label><input id="co-min" type="text" inputmode="decimal" placeholder="50000" /></div>
      <div class="field"><label for="co-max">${esc(t('promo.maxDiscount'))}</label><input id="co-max" type="text" inputmode="decimal" placeholder="5000" /></div>
    </div>

    <div class="grid grid-2" style="gap:var(--space-3)">
      <div class="field"><label for="co-limit">${esc(t('promo.totalUses'))}</label><input id="co-limit" type="number" min="1" placeholder="100" /></div>
      <div class="field"><label for="co-limit-user">${esc(t('promo.usesPerBuyer'))}</label><input id="co-limit-user" type="number" min="1" placeholder="1" /></div>
    </div>

    <div class="grid grid-2" style="gap:var(--space-3)">
      <div class="field"><label for="co-ends">${esc(t('promo.endDate'))}</label><input id="co-ends" type="date" /></div>
      <div class="field"><label for="co-countries">${esc(t('promo.countries'))}</label><input id="co-countries" maxlength="60" placeholder="TD, CM" /></div>
    </div>

    <div class="field"><label for="co-description">${esc(t('promo.description'))}</label><input id="co-description" maxlength="300" placeholder="${esc(
      t('promo.descriptionPlaceholder'),
    )}" /></div>

    <label class="check" style="margin-bottom:var(--space-4)">
      <input id="co-first" type="checkbox" /><span class="small">${esc(t('promo.firstOnly'))}</span>
    </label>

    <button class="btn" type="submit">${esc(t('promo.create'))}</button>
  </form>`;
}

/** Liste et création — le titre est posé par la vue appelante (onglets vendeur ou console admin). */
async function listView({ scope, query, stores, base }) {
  const page = Number(query.get('page') || 1);
  const data = await api(`/coupons?scope=${scope}&page=${page}`);

  const canCreate = scope === 'platform' || stores.length > 0;
  return `
    <p class="small muted">${esc(t('promo.neverNegative'))}</p>

    <section class="card" style="margin-bottom:var(--space-5)">
      <details${data.items.length ? '' : ' open'}>
        <summary class="strong">${esc(t('promo.createSummary'))}</summary>
        <div style="margin-top:var(--space-4)">
          ${canCreate
            ? createForm(stores, scope)
            : `<p class="small muted" style="margin:0">${esc(t('promo.needStore'))}</p>`}
        </div>
      </details>
    </section>

    ${data.items.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>${esc(t('promo.code'))}</th><th>${esc(t('promo.col.discount'))}</th><th>${esc(
            t('promo.col.conditions'),
          )}</th><th>${esc(t('promo.col.usage'))}</th><th>${esc(t('promo.col.end'))}</th><th>${esc(
            t('promo.col.status'),
          )}</th><th></th></tr></thead>
          <tbody>${data.items.map(couponRow).join('')}</tbody>
        </table></div>
        ${pagination(data, (p) => `${base}?page=${p}`)}`
      : emptyState({ title: t('promo.emptyTitle'), body: t('promo.emptyBody'), iconName: 'spark' })}`;
}

/** Espace vendeur : codes de mes boutiques. */
export async function sellerCoupons(_params, query) {
  const [{ tabs }, stores] = await Promise.all([import('./views-seller.js'), api('/stores/mine')]);
  const content = await listView({
    scope: 'store',
    query,
    stores: stores.items,
    base: '/touma/vendeur/promotions',
  });
  return `<h1 style="font-size:var(--text-xl)">${esc(t('promo.sellerTitle'))}</h1>${tabs('/touma/vendeur/promotions')}${content}`;
}

/** Administration : campagnes TOUMA. */
export async function adminCoupons(_params, query) {
  const [{ layout }, content] = await Promise.all([
    import('./views-admin.js'),
    listView({ scope: 'platform', query, stores: [], base: '/touma/admin/promotions' }),
  ]);
  return layout('/touma/admin/promotions', t('promo.adminTitle'), content);
}

/** Détail : ce qu'un code a réellement coûté. */
export async function couponDetail(params) {
  const data = await api(`/coupons/${params.id}/redemptions`);
  const c = data.coupon;

  return `
    ${breadcrumb([
      { label: t('promo.sellerTitle'), href: c.storeId ? '/touma/vendeur/promotions' : '/touma/admin/promotions' },
      { label: c.code },
    ])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px;font-family:var(--font-mono)">${esc(c.code)}</h1>
        <p class="small muted" style="margin:0">${esc(offer(c))} · ${esc(financement(c.funding))}${c.description ? ` · ${esc(c.description)}` : ''}</p>
      </div>
      ${statusPill(c.status)}
    </div>

    <div class="grid grid-2" style="align-items:start">
      <section class="card">
        <h2 style="font-size:var(--text-md)">${esc(t('promo.redemptions'))}</h2>
        ${data.items.length
          ? `<div class="table-wrap" style="border:0"><table>
              <thead><tr><th>${esc(t('promo.col.cart'))}</th><th>${esc(t('promo.col.granted'))}</th><th>${esc(
                t('promo.col.date'),
              )}</th></tr></thead>
              <tbody>
                ${data.items
                  .map(
                    (r) => `<tr>
                      <td class="small">${esc(r.orderGroup.reference)}<div class="xs muted">${esc(
                        t('promo.cartOf', { amount: money(r.orderGroup.total, r.currency) }),
                      )}</div></td>
                      <td><strong>${money(r.amount, r.currency)}</strong></td>
                      <td class="small muted">${formatDate(r.createdAt, true)}</td>
                    </tr>`,
                  )
                  .join('')}
              </tbody>
            </table></div>`
          : `<p class="muted small">${esc(t('promo.neverUsed'))}</p>`}
      </section>

      <aside class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('promo.costTitle'))}</h2>
          <p style="margin:0;font-size:var(--text-xl);font-weight:var(--weight-bold)">${money(data.totalGranted, data.items[0]?.currency ?? c.currency ?? '')}</p>
          <p class="small muted" style="margin:2px 0 0">${esc(
            c.usageLimit
              ? t('promo.usageCountOf', { count: c.usageCount, limit: c.usageLimit })
              : t('promo.usageCount', { count: c.usageCount }),
          )}</p>
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('promo.conditions'))}</h2>
          <dl class="spec-list">
            <div><dt>${esc(t('promo.minPurchase'))}</dt><dd>${c.minOrderAmount ? money(c.minOrderAmount, c.currency ?? '') : '—'}</dd></div>
            <div><dt>${esc(t('promo.maxDiscount'))}</dt><dd>${c.maxDiscountAmount ? money(c.maxDiscountAmount, c.currency ?? '') : '—'}</dd></div>
            <div><dt>${esc(t('promo.usesPerBuyer'))}</dt><dd>${esc(String(c.usageLimitPerUser ?? t('promo.unlimited')))}</dd></div>
            <div><dt>${esc(t('promo.firstOrderLabel'))}</dt><dd>${esc(t(c.firstOrderOnly ? 'promo.yes' : 'promo.no'))}</dd></div>
            <div><dt>${esc(t('promo.countriesLabel'))}</dt><dd>${
              c.countryCodes.length ? esc(c.countryCodes.join(', ')) : esc(t('promo.allCountriesShort'))
            }</dd></div>
            <div><dt>${esc(t('promo.validity'))}</dt><dd>${formatDate(c.startsAt)} → ${
              c.endsAt ? formatDate(c.endsAt) : esc(t('promo.noEnd'))
            }</dd></div>
          </dl>
        </section>
      </aside>
    </div>`;
}

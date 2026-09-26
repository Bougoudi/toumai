/**
 * TOUMA — marketing : centre vendeur, centre d'administration, parrainage.
 *
 * Deux règles tiennent ces écrans :
 *
 * 1. **Aucun chiffre de performance inventé.** Ce qui est affiché est ce qui a
 *    été compté. Ce qui n'est pas mesurable est nommé comme tel, plutôt que
 *    remplacé par une estimation qui orienterait de vraies décisions.
 * 2. **Une promotion écartée dit pourquoi.** Un vendeur qui teste sa règle doit
 *    voir ce qui bloque, pas un écran vide.
 */
import { api, esc, formatDate, money, emptyState } from './core.js';
import { breadcrumb } from './components.js';
import { t } from './i18n.js';

const STATUT_BADGE = {
  ACTIVE: 'badge-verified',
  PAUSED: 'badge-country',
  DRAFT: '',
  SCHEDULED: 'badge-country',
  EXPIRED: 'badge-danger',
  ARCHIVED: 'badge-danger',
};

/** Une promotion, avec ce qu'elle a réellement coûté. */
function promotionCard(p) {
  const budget = p.budget;
  return `<article class="card" style="margin-bottom:var(--space-3)">
    <div class="card-head">
      <h3 style="font-size:var(--text-md);margin:0">${esc(p.name)}</h3>
      <span class="badge ${STATUT_BADGE[p.status] ?? ''}">${esc(t(`promo.status.${p.status}`))}</span>
    </div>
    <p class="small muted">${esc(t(`promo.type.${p.type}`))}
      · <span dir="ltr">${p.type === 'FREE_SHIPPING' ? '' : esc(p.value)}${p.type === 'PERCENTAGE' ? ' %' : ''}</span>
      · ${esc(t(`promo.stacking.${p.stacking}`))}
    </p>
    ${p.description ? `<p class="small">${esc(p.description)}</p>` : ''}

    ${p.rules?.length
      ? `<details style="margin-top:var(--space-2)">
          <summary class="small">${esc(t('promo.conditionCount', { count: p.rules.length }))}</summary>
          <ul class="small" style="margin-top:var(--space-2)">
            ${p.rules.map((r) => `<li>${esc(t(`promo.rule.${r.kind}`))}${r.threshold ? ` — <span dir="ltr">${esc(r.threshold)}</span>` : ''}${r.negated ? ` (${esc(t('promo.negated'))})` : ''}</li>`).join('')}
          </ul>
        </details>`
      : `<p class="xs muted">${esc(t('promo.noCondition'))}</p>`}

    ${budget
      ? `<p class="xs muted" style="margin-top:var(--space-2)">
          ${esc(t('promo.budgetSpent', {
            spent: money(budget.spent, budget.currency),
            total: money(budget.total, budget.currency),
          }))}
        </p>`
      : ''}

    <div class="row" style="gap:var(--space-2);margin-top:var(--space-3)">
      ${p.status === 'DRAFT' || p.status === 'PAUSED'
        ? `<button class="btn btn-sm" data-promotion="${esc(p.id)}" data-status="ACTIVE">${esc(t('promo.activate'))}</button>`
        : ''}
      ${p.status === 'ACTIVE'
        ? `<button class="btn btn-secondary btn-sm" data-promotion="${esc(p.id)}" data-status="PAUSED">${esc(t('promo.pause'))}</button>`
        : ''}
      <a class="btn btn-ghost btn-sm" href="/touma/vendeur/marketing/${esc(p.id)}" data-link>${esc(t('promo.performance'))}</a>
    </div>
  </article>`;
}

/** Centre marketing du vendeur. */
export async function sellerMarketing() {
  const promotions = await api('/seller/marketing/promotions');

  return `
    ${breadcrumb([
      { label: t('nav.home'), href: '/touma/' },
      { label: t('seller.area'), href: '/touma/vendeur' },
      { label: t('promo.title') },
    ])}
    <div class="card-head">
      <h1>${esc(t('promo.myPromotions'))}</h1>
      <a class="btn" href="/touma/vendeur/marketing/nouvelle" data-link>${esc(t('promo.newPromotion'))}</a>
    </div>
    <p class="muted">${esc(t('promo.sellerIntro'))}</p>

    ${promotions.items.length
      ? `<div class="mt-6">${promotions.items.map(promotionCard).join('')}</div>`
      : emptyState({
          title: t('promo.noPromotionTitle'),
          body: t('promo.noPromotionBody'),
          actionLabel: t('promo.newPromotion'),
          actionHref: '/touma/vendeur/marketing/nouvelle',
          iconName: 'tag',
        })}

    <section class="card mt-6">
      <h2 style="font-size:var(--text-md)">${esc(t('promo.fundingTitle'))}</h2>
      <p class="small muted" style="margin-bottom:0">${esc(t('promo.fundingBody'))}</p>
    </section>`;
}

/** Performance d'une promotion — ce qui est compté, et ce qui ne l'est pas. */
export async function promotionPerformance(params) {
  const p = await api(`/seller/marketing/promotions/${encodeURIComponent(params.id)}/performance`);

  const tuile = (cle, valeur) => `<div class="stat-card">
    <div class="stat-label">${esc(t(cle))}</div>
    <div class="stat-value" dir="ltr">${esc(String(valeur))}</div>
  </div>`;

  return `
    ${breadcrumb([
      { label: t('promo.title'), href: '/touma/vendeur/marketing' },
      { label: p.name },
    ])}
    <h1>${esc(p.name)}</h1>
    <span class="badge ${STATUT_BADGE[p.status] ?? ''}">${esc(t(`promo.status.${p.status}`))}</span>

    <div class="grid grid-3 mt-6">
      ${tuile('promo.timesApplied', p.timesApplied)}
      ${tuile('promo.distinctBuyers', p.distinctBuyers)}
      ${tuile('promo.ordersWith', p.ordersWithPromotion)}
    </div>

    <section class="card mt-6">
      <h2 style="font-size:var(--text-md)">${esc(t('promo.promotionCost'))}</h2>
      ${p.discountByCurrency.length
        ? `<div class="stack" style="gap:var(--space-2)">
            ${p.discountByCurrency
              .map((d) => `<div class="row-between small"><span>${esc(d.currency)}</span><strong>${money(d.amount, d.currency)}</strong></div>`)
              .join('')}
          </div>`
        : `<p class="muted small" style="margin-bottom:0">${esc(t('promo.noCostYet'))}</p>`}
      <p class="xs muted" style="margin-top:var(--space-3);margin-bottom:0">${esc(t('promo.currenciesSeparate'))}</p>
    </section>

    ${p.budget
      ? `<section class="card mt-6">
          <h2 style="font-size:var(--text-md)">${esc(t('promo.budget'))}</h2>
          <p style="margin:0">${esc(t('promo.budgetSpent', {
            spent: money(p.budget.spent, p.budget.currency),
            total: money(p.budget.total, p.budget.currency),
          }))}</p>
        </section>`
      : ''}

    <section class="card mt-6">
      <h2 style="font-size:var(--text-md)">${esc(t('promo.notMeasuredTitle'))}</h2>
      <p class="small">${esc(t('promo.notMeasuredBody'))}</p>
      <ul class="small muted" style="margin-bottom:0">
        ${p.notMeasured.map((m) => `<li>${esc(t(`promo.notMeasured.${m}`))}</li>`).join('')}
      </ul>
    </section>`;
}

/** Création d'une promotion. Elle naît en brouillon : publier est un second geste. */
export async function promotionForm() {
  const boutiques = await api('/stores/mine');
  return `
    ${breadcrumb([
      { label: t('promo.title'), href: '/touma/vendeur/marketing' },
      { label: t('promo.newPromotion') },
    ])}
    <div class="container-narrow" style="margin-inline:auto">
      <div class="card">
        <h1 style="font-size:var(--text-xl)">${esc(t('promo.newPromotion'))}</h1>
        <p class="muted small">${esc(t('promo.createIntro'))}</p>
        <form id="promotion-form" novalidate>
          <div class="field">
            <label for="pr-store">${esc(t('promo.store'))}</label>
            <select id="pr-store" required>
              ${(boutiques.items ?? boutiques).map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="pr-name">${esc(t('promo.name'))}</label>
            <input id="pr-name" required minlength="3" maxlength="120" />
          </div>
          <div class="field">
            <label for="pr-type">${esc(t('promo.type'))}</label>
            <select id="pr-type">
              <option value="PERCENTAGE">${esc(t('promo.type.PERCENTAGE'))}</option>
              <option value="FIXED_AMOUNT">${esc(t('promo.type.FIXED_AMOUNT'))}</option>
              <option value="FREE_SHIPPING">${esc(t('promo.type.FREE_SHIPPING'))}</option>
              <option value="FIRST_ORDER">${esc(t('promo.type.FIRST_ORDER'))}</option>
            </select>
          </div>
          <div class="field">
            <label for="pr-value">${esc(t('promo.value'))}</label>
            <input id="pr-value" inputmode="decimal" value="10" required />
            <span class="field-hint">${esc(t('promo.valueHintPromotion'))}</span>
          </div>
          <div class="field">
            <label for="pr-min">${esc(t('promo.minOrder'))}</label>
            <input id="pr-min" inputmode="decimal" placeholder="25000" />
            <span class="field-hint">${esc(t('promo.minOrderHint'))}</span>
          </div>
          <div class="field">
            <label for="pr-stacking">${esc(t('promo.stacking'))}</label>
            <select id="pr-stacking">
              <option value="NON_STACKABLE">${esc(t('promo.stacking.NON_STACKABLE'))}</option>
              <option value="STACKABLE">${esc(t('promo.stacking.STACKABLE'))}</option>
              <option value="EXCLUSIVE">${esc(t('promo.stacking.EXCLUSIVE'))}</option>
            </select>
            <span class="field-hint">${esc(t('promo.stackingHint'))}</span>
          </div>
          <div class="field">
            <label for="pr-budget">${esc(t('promo.budgetOptional'))}</label>
            <input id="pr-budget" inputmode="decimal" placeholder="100000" />
            <span class="field-hint">${esc(t('promo.budgetHint'))}</span>
          </div>
          <button class="btn btn-block btn-lg" type="submit">${esc(t('promo.createDraft'))}</button>
        </form>
        <p class="xs muted mt-6" style="margin-bottom:0">${esc(t('promo.draftNotice'))}</p>
      </div>
    </div>`;
}

/** Mon parrainage. Des décomptes, jamais les filleuls. */
export async function referrals() {
  const data = await api('/referrals');
  if (!data.enabled) {
    return `
      ${breadcrumb([{ label: t('account.title'), href: '/touma/compte' }, { label: t('referral.title') }])}
      <h1>${esc(t('referral.title'))}</h1>
      ${emptyState({ title: t('referral.offTitle'), body: t('referral.offBody'), iconName: 'users' })}`;
  }

  const tuile = (cle, valeur) => `<div class="stat-card">
    <div class="stat-label">${esc(t(cle))}</div>
    <div class="stat-value" dir="ltr">${valeur}</div>
  </div>`;

  return `
    ${breadcrumb([{ label: t('account.title'), href: '/touma/compte' }, { label: t('referral.title') }])}
    <h1>${esc(t('referral.title'))}</h1>
    <p class="muted">${esc(t('referral.intro'))}</p>

    <section class="card mt-6">
      <h2 style="font-size:var(--text-md)">${esc(t('referral.myCode'))}</h2>
      ${data.code
        ? `<p style="font-size:var(--text-2xl);font-weight:var(--weight-bold);letter-spacing:0.15em" dir="ltr">${esc(data.code)}</p>
           <p class="xs muted" style="margin-bottom:0">${esc(t('referral.codeHint'))}</p>`
        : `<button class="btn" data-referral-code>${esc(t('referral.getCode'))}</button>`}
    </section>

    <div class="grid grid-3 mt-6">
      ${tuile('referral.invited', data.invited)}
      ${tuile('referral.qualified', data.qualified)}
      ${tuile('referral.rewarded', data.rewarded)}
    </div>

    <section class="card mt-6">
      <h2 style="font-size:var(--text-md)">${esc(t('referral.rulesTitle'))}</h2>
      <p class="small">${esc(t('referral.rulesBody'))}</p>
      <p class="xs muted" style="margin-bottom:0">${esc(t('referral.privacyNotice'))}</p>
    </section>`;
}

/** Centre marketing de l'administration. */
export async function adminMarketing() {
  const [apercu, campagnes, segments] = await Promise.all([
    api('/admin/marketing/overview'),
    api('/admin/marketing/campaigns?limit=10'),
    api('/admin/marketing/segments'),
  ]);

  const tuile = (cle, valeur) => `<div class="stat-card">
    <div class="stat-label">${esc(t(cle))}</div>
    <div class="stat-value" dir="ltr">${valeur}</div>
  </div>`;

  return `
    ${breadcrumb([{ label: t('admin.title'), href: '/touma/admin' }, { label: t('promo.title') }])}
    <h1>${esc(t('promo.marketingCenter'))}</h1>

    <div class="grid grid-3 mt-6">
      ${tuile('promo.total', apercu.promotions)}
      ${tuile('promo.active', apercu.activePromotions)}
      ${tuile('promo.activeCampaigns', apercu.activeCampaigns)}
      ${tuile('promo.activeCoupons', apercu.activeCoupons)}
    </div>

    <section class="card mt-6">
      <h2 style="font-size:var(--text-md)">${esc(t('promo.discountVolume'))}</h2>
      ${apercu.discountByCurrency.length
        ? `<div class="stack" style="gap:var(--space-2)">
            ${apercu.discountByCurrency
              .map(
                (d) => `<div class="row-between small">
                  <span>${esc(d.currency)} — ${esc(t('promo.applications', { count: d.applications }))}</span>
                  <strong>${money(d.amount, d.currency)}</strong>
                </div>`,
              )
              .join('')}
          </div>`
        : `<p class="muted small" style="margin-bottom:0">${esc(t('promo.noDiscountYet'))}</p>`}
      <p class="xs muted" style="margin-top:var(--space-3);margin-bottom:0">${esc(t('promo.currenciesSeparate'))}</p>
    </section>

    <section class="card mt-6">
      <h2 style="font-size:var(--text-md)">${esc(t('promo.campaigns'))}</h2>
      ${campagnes.items.length
        ? `<div class="stack" style="gap:var(--space-2)">
            ${campagnes.items
              .map(
                (c) => `<div class="row-between small">
                  <span><strong>${esc(c.name)}</strong><br />
                    <span class="xs muted">${formatDate(c.startsAt)} → ${formatDate(c.endsAt)}</span></span>
                  <span class="badge">${esc(t(`promo.campaignStatus.${c.status}`))}</span>
                </div>`,
              )
              .join('')}
          </div>`
        : `<p class="muted small" style="margin-bottom:0">${esc(t('promo.noCampaign'))}</p>`}
    </section>

    <section class="card mt-6">
      <h2 style="font-size:var(--text-md)">${esc(t('promo.segments'))}</h2>
      <p class="xs muted">${esc(t('promo.segmentsIntro'))}</p>
      ${segments.items.length
        ? `<div class="stack" style="gap:var(--space-2)">
            ${segments.items
              .map((s) => `<div class="row-between small"><span>${esc(s.name)}</span><strong dir="ltr">${s.members}</strong></div>`)
              .join('')}
          </div>`
        : `<p class="muted small" style="margin-bottom:0">${esc(t('promo.noSegment'))}</p>`}
    </section>

    <section class="card mt-6">
      <h2 style="font-size:var(--text-md)">${esc(t('promo.notMeasuredTitle'))}</h2>
      <p class="small">${esc(t('promo.notMeasuredBody'))}</p>
      <ul class="small muted" style="margin-bottom:0">
        ${(apercu.notMeasured ?? []).map((m) => `<li>${esc(t(`promo.notMeasured.${m}`))}</li>`).join('')}
      </ul>
    </section>`;
}

/**
 * TOUMA — confiance : centre vendeur, centre acheteur, centre d'administration.
 *
 * Une règle tient tous ces écrans : **jamais un score sans sa ventilation**.
 * « 87/100 » tout seul ne dit rien à celui qui le lit et rien à celui qu'il
 * décrit. Chaque écran rend donc les composantes, avec le décompte qui les a
 * produites, et dit ce qu'il faudrait pour que le score existe quand il
 * n'existe pas encore.
 */
import { api, esc, formatDate, label, emptyState, session, svg } from './core.js';
import { breadcrumb } from './components.js';
import { t } from './i18n.js';

/** Couleur d'un palier. Les paliers sont des repères, jamais des garanties. */
const LEVEL_COLOR = {
  EXCELLENT: 'var(--success)',
  GOOD: 'var(--success)',
  MODERATE: 'var(--warning)',
  LOW: 'var(--danger)',
  INSUFFICIENT_DATA: 'var(--muted)',
};

/**
 * Pastille de score.
 *
 * Quand le score vaut `null`, elle n'affiche pas zéro : elle affiche un tiret
 * et le seuil qui manque. Un vendeur nouveau n'est pas un mauvais vendeur.
 */
function scorePill(trust) {
  const couleur = LEVEL_COLOR[trust.level] ?? 'var(--muted)';
  return `<div class="card" style="text-align:center">
    <div style="font-size:var(--text-3xl);font-weight:var(--weight-bold);color:${couleur}" dir="ltr">
      ${trust.score === null ? '—' : `${trust.score}<span class="muted" style="font-size:var(--text-md)">/100</span>`}
    </div>
    <div class="badge" style="margin-top:var(--space-2)">${esc(t(`trust.level.${trust.level}`))}</div>
    <p class="xs muted" style="margin:var(--space-3) 0 0">
      ${trust.score === null
        ? esc(t('trust.notEnoughData', { minimum: trust.minimumSample, current: trust.sampleSize }))
        : esc(t('trust.basedOn', { count: trust.sampleSize }))}
    </p>
  </div>`;
}

/** Une composante du score, avec ce qui l'a produite. */
function componentRow(c) {
  const positif = c.direction === 'POSITIVE';
  const mesure = c.value !== null;
  const signe = c.points > 0 ? '+' : '';
  return `<div class="row-between" style="padding:var(--space-2) 0;border-bottom:1px solid var(--border)">
    <span class="small">
      ${mesure ? (positif ? '✓' : '⚠') : '·'} ${esc(t(`trust.factor.${c.code}`))}
      ${mesure ? '' : `<span class="xs muted"> — ${esc(t('trust.notMeasured'))}</span>`}
    </span>
    <strong class="small" dir="ltr" style="color:${c.points < 0 ? 'var(--danger)' : 'var(--text)'}">
      ${mesure ? `${signe}${c.points}` : '—'}
    </strong>
  </div>`;
}

function breakdown(trust) {
  return `<section class="card">
    <h2 style="font-size:var(--text-md)">${esc(t('trust.breakdown'))}</h2>
    <p class="xs muted">${esc(t('trust.breakdownIntro'))}</p>
    <div style="margin-top:var(--space-3)">
      ${(trust.components ?? []).map(componentRow).join('')}
    </div>
  </section>`;
}

function badgeList(badges) {
  if (!badges?.length) {
    return `<p class="muted small">${esc(t('trust.noBadge'))}</p>`;
  }
  return `<div class="row" style="flex-wrap:wrap;gap:var(--space-2)">
    ${badges
      .map(
        (b) => `<span class="badge badge-verified" title="${esc(t('trust.awardedOn', { date: formatDate(b.awardedAt) }))}">
          ${esc(t(`trust.badge.${b.code}`))}
        </span>`,
      )
      .join('')}
  </div>`;
}

/** Espace confiance du vendeur. */
export async function sellerTrust() {
  const me = await api('/trust/me');

  return `
    ${breadcrumb([
      { label: t('nav.home'), href: '/touma/' },
      { label: t('seller.area'), href: '/touma/vendeur' },
      { label: t('trust.title') },
    ])}
    <h1>${esc(t('trust.sellerTitle'))}</h1>
    <p class="muted">${esc(t('trust.sellerIntro'))}</p>

    ${me.seller.length === 0
      ? emptyState({
          title: t('trust.noStoreTitle'),
          body: t('trust.noStoreBody'),
          actionLabel: t('seller.noStoreAction'),
          actionHref: '/touma/vendeur/boutique',
          iconName: 'store',
        })
      : me.seller
          .map(
            (s) => `<section style="margin-top:var(--space-6)">
              <div class="card-head">
                <h2 style="font-size:var(--text-lg)">${esc(s.store.name)}</h2>
                <span class="badge ${s.verification.status === 'APPROVED' ? 'badge-verified' : ''}">
                  ${esc(label(s.verification.status))}
                </span>
              </div>
              <div class="grid grid-2 mt-6">
                <div class="stack">
                  ${scorePill(s.trust)}
                  <section class="card">
                    <h2 style="font-size:var(--text-md)">${esc(t('trust.badges'))}</h2>
                    ${badgeList(s.badges)}
                  </section>
                  <section class="card">
                    <h2 style="font-size:var(--text-md)">${esc(t('trust.verification'))}</h2>
                    <dl class="spec-list">
                      <div><dt>${esc(t('trust.status'))}</dt><dd>${esc(label(s.verification.status))}</dd></div>
                      <div><dt>${esc(t('trust.level'))}</dt><dd>${esc(t(`trust.vlevel.${s.verification.level}`))}</dd></div>
                    </dl>
                    <a class="btn btn-secondary btn-block btn-sm mt-6" href="/touma/vendeur/verification" data-link>
                      ${esc(t('trust.improveVerification'))}
                    </a>
                  </section>
                </div>
                ${breakdown(s.trust)}
              </div>
              <p class="xs muted" style="margin-top:var(--space-3)">
                <a href="/touma/confiance/historique/SELLER/${esc(s.store.id)}" data-link>${esc(t('trust.seeHistory'))}</a>
              </p>
            </section>`,
          )
          .join('')}

    <section class="card mt-6">
      <h2 style="font-size:var(--text-md)">${esc(t('trust.rulesTitle'))}</h2>
      <p class="small muted" style="margin-bottom:0">${esc(t('trust.rulesBody'))}</p>
    </section>

    ${standingCard(me.standing)}
    ${appealsCard(me.appeals)}`;
}

/** État du compte. Affiché même quand tout va bien : l'absence de sanction est une information. */
function standingCard(standing) {
  if (!standing || standing.status === 'ACTIVE') {
    return `<section class="card mt-6">
      <h2 style="font-size:var(--text-md)">${esc(t('trust.standing'))}</h2>
      <p class="small" style="margin-bottom:0;color:var(--success)">${esc(t('trust.standingActive'))}</p>
    </section>`;
  }
  return `<section class="card mt-6" style="border-color:var(--danger)">
    <h2 style="font-size:var(--text-md)">${esc(t('trust.standing'))}</h2>
    <p><strong>${esc(t(`trust.standing.${standing.status}`))}</strong></p>
    ${standing.publicReason ? `<p class="small">${esc(standing.publicReason)}</p>` : ''}
    ${standing.expiresAt
      ? `<p class="xs muted">${esc(t('trust.standingUntil', { date: formatDate(standing.expiresAt) }))}</p>`
      : ''}
    <p class="xs muted">${esc(t('trust.standingEffects'))}</p>
    <ul class="small">
      ${(standing.effects ?? []).map((e) => `<li>${esc(t(`trust.effect.${e}`))}</li>`).join('')}
    </ul>
    <a class="btn btn-secondary btn-block btn-sm" href="/touma/confiance/recours" data-link>${esc(t('trust.appealThis'))}</a>
  </section>`;
}

function appealsCard(appeals) {
  return `<section class="card mt-6">
    <div class="card-head">
      <h2 style="font-size:var(--text-md)">${esc(t('trust.appeals'))}</h2>
      <a class="btn btn-ghost btn-sm" href="/touma/confiance/recours" data-link>${esc(t('trust.newAppeal'))}</a>
    </div>
    ${appeals?.length
      ? `<div class="stack" style="gap:var(--space-2)">
          ${appeals
            .map(
              (a) => `<div class="row-between small" style="border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-3)">
                <span>
                  <strong>${esc(t(`trust.subject.${a.subjectType}`))}</strong><br />
                  <span class="xs muted">${formatDate(a.createdAt, true)}</span>
                  ${a.resolution ? `<br /><span class="xs">${esc(a.resolution)}</span>` : ''}
                </span>
                <span class="badge">${esc(t(`trust.appeal.${a.status}`))}</span>
              </div>`,
            )
            .join('')}
        </div>`
      : `<p class="muted small" style="margin-bottom:0">${esc(t('trust.noAppeal'))}</p>`}
  </section>`;
}

/** Espace confiance de l'acheteur. Volontairement sobre. */
export async function buyerTrust() {
  const me = await api('/trust/me');
  return `
    ${breadcrumb([
      { label: t('nav.home'), href: '/touma/' },
      { label: t('account.title'), href: '/touma/compte' },
      { label: t('trust.title') },
    ])}
    <h1>${esc(t('trust.buyerTitle'))}</h1>
    <p class="muted">${esc(t('trust.buyerIntro'))}</p>

    <div class="grid grid-2 mt-6">
      <div class="stack">
        ${scorePill(me.buyer)}
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('trust.badges'))}</h2>
          ${badgeList(me.buyer.badges)}
        </section>
      </div>
      ${breakdown(me.buyer)}
    </div>

    ${standingCard(me.standing)}
    ${appealsCard(me.appeals)}`;
}

/** Historique daté d'un score. */
export async function trustHistory(params) {
  const data = await api(`/trust/history/${encodeURIComponent(params.entityType)}/${encodeURIComponent(params.entityId)}`);
  return `
    ${breadcrumb([{ label: t('nav.home'), href: '/touma/' }, { label: t('trust.history') }])}
    <h1>${esc(t('trust.history'))}</h1>
    <p class="muted">${esc(t('trust.historyIntro'))}</p>
    ${data.items.length
      ? `<div class="table-wrap mt-6"><table class="table">
          <thead><tr>
            <th>${esc(t('trust.date'))}</th>
            <th>${esc(t('trust.score'))}</th>
            <th>${esc(t('trust.change'))}</th>
            <th>${esc(t('trust.reason'))}</th>
          </tr></thead>
          <tbody>
            ${data.items
              .map(
                (i) => `<tr>
                  <td>${formatDate(i.createdAt, true)}</td>
                  <td dir="ltr">${i.score === null ? '—' : i.score}</td>
                  <td dir="ltr" style="color:${(i.delta ?? 0) < 0 ? 'var(--danger)' : 'var(--success)'}">
                    ${i.delta === null ? '—' : `${i.delta > 0 ? '+' : ''}${i.delta}`}
                  </td>
                  <td>${esc(t(`trust.event.${i.reason}`))}</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table></div>`
      : emptyState({ title: t('trust.noHistoryTitle'), body: t('trust.noHistoryBody'), iconName: 'chart' })}`;
}

/** Dépôt d'un recours. */
export async function appealForm() {
  return `
    ${breadcrumb([{ label: t('nav.home'), href: '/touma/' }, { label: t('trust.newAppeal') }])}
    <div class="container-narrow" style="margin-inline:auto">
      <div class="card">
        <h1 style="font-size:var(--text-xl)">${esc(t('trust.newAppeal'))}</h1>
        <p class="muted small">${esc(t('trust.appealIntro'))}</p>
        <form id="appeal-form" novalidate>
          <div class="field">
            <label for="ap-subject">${esc(t('trust.appealSubject'))}</label>
            <select id="ap-subject">
              <option value="STANDING">${esc(t('trust.subject.STANDING'))}</option>
              <option value="VERIFICATION">${esc(t('trust.subject.VERIFICATION'))}</option>
              <option value="REVIEW">${esc(t('trust.subject.REVIEW'))}</option>
              <option value="TRUST_SCORE">${esc(t('trust.subject.TRUST_SCORE'))}</option>
            </select>
          </div>
          <div class="field">
            <label for="ap-message">${esc(t('trust.appealMessage'))}</label>
            <textarea id="ap-message" rows="6" required minlength="20" maxlength="4000"></textarea>
            <span class="field-hint">${esc(t('trust.appealHint'))}</span>
          </div>
          <button class="btn btn-block btn-lg" type="submit">${esc(t('action.send'))}</button>
        </form>
      </div>
    </div>`;
}

/** Centre de confiance de l'administration. */
export async function adminTrust() {
  const [overview, avis, recours] = await Promise.all([
    api('/admin/trust/overview'),
    api('/admin/trust/reviews?status=FLAGGED&limit=10'),
    api('/admin/trust/appeals?limit=10'),
  ]);

  const tuile = (cle, valeur) => `<div class="stat-card">
    <div class="stat-label">${esc(t(cle))}</div>
    <div class="stat-value" dir="ltr">${valeur}</div>
  </div>`;

  return `
    ${breadcrumb([{ label: t('admin.title'), href: '/touma/admin' }, { label: t('trust.title') }])}
    <h1>${esc(t('trust.adminTitle'))}</h1>

    <div class="grid grid-3 mt-6">
      ${tuile('trust.verifiedSellers', overview.verifiedSellers)}
      ${tuile('trust.pendingVerifications', overview.pendingVerifications)}
      ${tuile('trust.highRiskUsers', overview.highRiskUsers)}
      ${tuile('trust.flaggedReviews', overview.flaggedReviews)}
      ${tuile('trust.activeSanctions', overview.activeSanctions)}
      ${tuile('trust.openAppeals', overview.openAppeals)}
    </div>

    <section class="card mt-6">
      <h2 style="font-size:var(--text-md)">${esc(t('trust.scoreDistribution'))}</h2>
      ${overview.sellerScoreDistribution.length
        ? `<div class="stack" style="gap:var(--space-2)">
            ${overview.sellerScoreDistribution
              .map(
                (d) => `<div class="row-between small">
                  <span>${esc(t(`trust.level.${d.level}`))}</span>
                  <strong dir="ltr">${d.count}</strong>
                </div>`,
              )
              .join('')}
          </div>`
        : `<p class="muted small" style="margin-bottom:0">${esc(t('trust.noScoreYet'))}</p>`}
    </section>

    <section class="card mt-6">
      <h2 style="font-size:var(--text-md)">${esc(t('trust.flaggedReviewsQueue'))}</h2>
      <p class="xs muted">${esc(t('trust.flaggedReviewsIntro'))}</p>
      ${avis.items.length
        ? `<div class="stack" style="gap:var(--space-3);margin-top:var(--space-3)">
            ${avis.items
              .map(
                (r) => `<div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-3)">
                  <div class="row-between">
                    <strong class="small">${esc(r.product?.title ?? '')}</strong>
                    <span class="badge badge-danger" dir="ltr">${r.riskScore?.score ?? 0}</span>
                  </div>
                  <p class="small">${esc(r.comment ?? '')}</p>
                  <p class="xs muted">
                    ${(r.riskScore?.signals ?? []).map((s) => esc(t(`trust.signal.${s.code}`))).join(' · ')}
                  </p>
                  <div class="row" style="gap:var(--space-2)">
                    <button class="btn btn-secondary btn-sm" data-moderate-review="${esc(r.id)}" data-decision="PUBLISHED">
                      ${esc(t('trust.keep'))}
                    </button>
                    <button class="btn btn-danger btn-sm" data-moderate-review="${esc(r.id)}" data-decision="HIDDEN">
                      ${esc(t('trust.hide'))}
                    </button>
                  </div>
                </div>`,
              )
              .join('')}
          </div>`
        : `<p class="muted small" style="margin-bottom:0">${esc(t('trust.noFlaggedReview'))}</p>`}
    </section>

    <section class="card mt-6">
      <h2 style="font-size:var(--text-md)">${esc(t('trust.appealsQueue'))}</h2>
      ${recours.items.length
        ? `<div class="stack" style="gap:var(--space-3);margin-top:var(--space-3)">
            ${recours.items
              .map(
                (a) => `<div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-3)">
                  <div class="row-between">
                    <strong class="small">${esc(t(`trust.subject.${a.subjectType}`))}</strong>
                    <span class="xs muted">${formatDate(a.createdAt, true)}</span>
                  </div>
                  <p class="small">${esc(a.message)}</p>
                  <div class="row" style="gap:var(--space-2)">
                    <button class="btn btn-secondary btn-sm" data-decide-appeal="${esc(a.id)}" data-decision="APPROVED">
                      ${esc(t('trust.appealAccept'))}
                    </button>
                    <button class="btn btn-ghost btn-sm" data-decide-appeal="${esc(a.id)}" data-decision="REJECTED">
                      ${esc(t('trust.appealReject'))}
                    </button>
                  </div>
                </div>`,
              )
              .join('')}
          </div>`
        : `<p class="muted small" style="margin-bottom:0">${esc(t('trust.noOpenAppeal'))}</p>`}
    </section>`;
}

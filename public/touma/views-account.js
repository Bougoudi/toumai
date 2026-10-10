/**
 * TOUMA — compte : connexion, inscription, profil, adresses, notifications.
 */
import { api, esc, formatDate, label, money, session, emptyState, svg } from './core.js';
import { breadcrumb } from './components.js';
import { t } from './i18n.js';

export async function login(_params, query) {
  return `
    <div class="container-narrow" style="margin-inline:auto">
      <div class="card">
        <h1 style="font-size:var(--text-xl)">${esc(t('auth.loginTitle'))}</h1>
        <p class="muted small">${esc(t('auth.loginIntro'))}</p>
        <form id="login-form" novalidate>
          <div class="field">
            <label for="l-email">${esc(t('auth.email'))}</label>
            <input id="l-email" type="email" required autocomplete="email" inputmode="email" />
          </div>
          <div class="field">
            <label for="l-password">${esc(t('auth.password'))}</label>
            <input id="l-password" type="password" required autocomplete="current-password" />
          </div>
          <input type="hidden" id="l-next" value="${esc(query.get('suite') || '/touma/')}" />
          <button class="btn btn-block btn-lg" type="submit">${esc(t('auth.loginTitle'))}</button>
        </form>
        <p class="small mt-6" style="margin-bottom:0">
          ${esc(t('auth.noAccount'))} <a href="/touma/inscription" data-link>${esc(t('auth.createAccount'))}</a>
        </p>
      </div>
    </div>`;
}

export async function register() {
  const countries = await api('/countries');
  return `
    <div class="container-narrow" style="margin-inline:auto">
      <div class="card">
        <h1 style="font-size:var(--text-xl)">${esc(t('auth.registerTitle'))}</h1>
        <p class="muted small">${esc(t('auth.registerIntro'))}</p>
        <form id="register-form" novalidate>
          <div class="field"><label for="r-name">${esc(t('auth.fullName'))}</label><input id="r-name" required autocomplete="name" /></div>
          <div class="field"><label for="r-email">${esc(t('auth.email'))}</label><input id="r-email" type="email" required autocomplete="email" inputmode="email" /></div>
          <div class="field">
            <label for="r-phone">${esc(t('auth.phoneOptional'))}</label>
            <input id="r-phone" inputmode="tel" placeholder="+235…" autocomplete="tel" />
          </div>
          <div class="field">
            <label for="r-country">${esc(t('auth.country'))}</label>
            <select id="r-country">${countries.items.map((c) => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</select>
          </div>
          <fieldset class="field">
            <legend class="label">${esc(t('auth.iWantTo'))}</legend>
            <div class="row" style="gap:var(--space-2)">
              <label class="check" data-selected="true" style="flex:1"><input type="radio" name="role" value="BUYER" checked /><span><strong>${esc(
                t('auth.buy'),
              )}</strong><br /><span class="small muted">${esc(t('auth.buyHint'))}</span></span></label>
              <label class="check" style="flex:1"><input type="radio" name="role" value="SELLER" /><span><strong>${esc(
                t('auth.sell'),
              )}</strong><br /><span class="small muted">${esc(t('auth.sellHint'))}</span></span></label>
            </div>
          </fieldset>
          <div class="field">
            <label for="r-password">${esc(t('auth.password'))}</label>
            <input id="r-password" type="password" required minlength="10" autocomplete="new-password" />
            <span class="field-hint">${esc(t('auth.passwordHint'))}</span>
          </div>
          <button class="btn btn-block btn-lg" type="submit">${esc(t('auth.createMine'))}</button>
        </form>
        <p class="small mt-6" style="margin-bottom:0">${esc(t('auth.alreadyMember'))} <a href="/touma/connexion" data-link>${esc(
          t('auth.loginTitle'),
        )}</a></p>
      </div>
    </div>`;
}

export async function account() {
  const [me, notifications, loyalty] = await Promise.all([
    api('/auth/me'),
    api('/notifications'),
    // La fidélité peut être désactivée : son absence ne casse pas la page.
    api('/loyalty').catch(() => null),
  ]);
  return `
    ${breadcrumb([{ label: t('nav.home'), href: '/touma/' }, { label: t('account.title') }])}
    <h1>${esc(t('account.title'))}</h1>

    <div class="grid grid-2 mt-6">
      <div class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('account.profile'))}</h2>
          <dl class="spec-list">
            <div><dt>${esc(t('account.name'))}</dt><dd>${esc(me.name)}</dd></div>
            <div><dt>${esc(t('account.emailLabel'))}</dt><dd>${esc(me.email)}</dd></div>
            <div><dt>${esc(t('account.phone'))}</dt><dd>${esc(me.phone ?? '—')}</dd></div>
            <div><dt>${esc(t('account.countryLabel'))}</dt><dd>${esc(me.countryCode ?? '—')}</dd></div>
            <div><dt>${esc(t('account.role'))}</dt><dd>${esc(label(me.role))}</dd></div>
          </dl>
          ${me.role === 'BUYER'
            ? `<a class="btn btn-secondary btn-block mt-6" href="/touma/vendeur/boutique" data-link>${esc(t('account.openStore'))}</a>`
            : `<a class="btn btn-secondary btn-block mt-6" href="/touma/vendeur" data-link>${esc(t('account.sellerArea'))}</a>`}
          <button class="btn btn-ghost btn-block btn-sm mt-6" data-logout-all>${esc(t('account.logoutAll'))}</button>
        </section>

        ${loyalty?.enabled
          ? `<section class="card">
              <div class="card-head">
                <h2 style="font-size:var(--text-md)">${esc(t('loyalty.title'))}</h2>
                <span class="badge badge-verified">${esc(loyalty.tier)}</span>
              </div>
              <p style="margin:0;font-size:var(--text-xl);font-weight:var(--weight-bold)">${esc(
                t('loyalty.points', { count: loyalty.balance }),
              )}</p>
              <p class="small muted" style="margin:2px 0 0">${esc(
                t('loyalty.worth', { amount: money(loyalty.balanceValue, loyalty.currency) }),
              )}</p>
              ${loyalty.nextTier
                ? `<p class="small" style="margin:var(--space-3) 0 0">${esc(
                    t('loyalty.toNextTier', { remaining: loyalty.nextTier.remaining, tier: loyalty.nextTier.name }),
                  )}</p>`
                : `<p class="small" style="margin:var(--space-3) 0 0">${esc(t('loyalty.topTier'))}</p>`}
              ${loyalty.events.length
                ? `<details style="margin-top:var(--space-4)">
                    <summary class="small">${esc(t('loyalty.history'))}</summary>
                    <div class="stack" style="gap:var(--space-2);margin-top:var(--space-3)">
                      ${loyalty.events
                        .slice(0, 12)
                        .map(
                          (e) => `<div class="row-between small">
                            <span>${esc(e.reason || e.type)}${e.orderNumber ? ` <span class="muted">${esc(e.orderNumber)}</span>` : ''}</span>
                            <strong style="color:${e.points >= 0 ? 'var(--success)' : 'var(--danger)'}">${e.points >= 0 ? '+' : ''}${e.points}</strong>
                          </div>`,
                        )
                        .join('')}
                    </div>
                  </details>`
                : `<p class="xs muted" style="margin:var(--space-3) 0 0">${esc(t('loyalty.empty'))}</p>`}
            </section>`
          : ''}

        <section class="card">
          <h2 style="font-size:var(--text-md)">${esc(t('account.afterSales'))}</h2>
          <div class="stack" style="gap:var(--space-2)">
            <a class="btn btn-secondary btn-block btn-sm" href="/touma/commandes" data-link>${esc(t('account.myOrders'))}</a>
            <a class="btn btn-secondary btn-block btn-sm" href="/touma/retours" data-link>${esc(t('account.myReturns'))}</a>
            <a class="btn btn-secondary btn-block btn-sm" href="/touma/documents" data-link>${esc(t('account.myDocuments'))}</a>
            <a class="btn btn-secondary btn-block btn-sm" href="/touma/messages" data-link>${esc(t('account.myMessages'))}</a>
            <a class="btn btn-secondary btn-block btn-sm" href="/touma/aide" data-link>${esc(t('account.support'))}</a>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2 style="font-size:var(--text-md)">${esc(t('account.addresses', { count: me.addresses.length }))}</h2></div>
          ${me.addresses.length
            ? `<div class="stack">
                ${me.addresses
                  .map(
                    (a) => `<div class="row-between" style="border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-3)">
                      <span class="small">
                        <strong>${esc(a.fullName)}</strong>${a.isDefault ? ` <span class="badge badge-verified">${esc(t('account.defaultAddress'))}</span>` : ''}<br />
                        ${esc(a.line1)}, ${esc(a.city)} — ${esc(a.countryCode)}<br />
                        <span class="muted">${esc(a.phone)}</span>
                      </span>
                      <button class="btn btn-ghost btn-sm" data-delete-address="${esc(a.id)}">${esc(t('account.deleteAddress'))}</button>
                    </div>`,
                  )
                  .join('')}
              </div>`
            : `<p class="muted small">${esc(t('account.noAddress'))}</p>`}
        </section>
      </div>

      <section class="card">
        <div class="card-head">
          <h2 style="font-size:var(--text-md)">${esc(t('notif.title'))}</h2>
          ${notifications.unread ? `<button class="btn btn-ghost btn-sm" data-read-all>${esc(t('notif.markAllRead'))}</button>` : ''}
        </div>
        ${notifications.items.length
          ? `<div class="stack" style="gap:var(--space-2)">
              ${notifications.items
                .slice(0, 20)
                .map(
                  (n) => `<div class="notif-item" data-unread="${!n.readAt}">
                    <strong>${esc(n.title)}</strong>
                    <p>${esc(n.body)}</p>
                    <span class="xs muted">${formatDate(n.createdAt, true)}</span>
                  </div>`,
                )
                .join('')}
            </div>`
          : `<p class="muted small">${esc(t('notif.empty'))}</p>`}
      </section>
    </div>`;
}

/** Panneau de notifications ouvert depuis l'en-tête. */
export async function notificationsPanel() {
  const data = await api('/notifications');
  if (!data.items.length) {
    return `<div class="modal"><h2>${esc(t('notif.title'))}</h2>${emptyState({
      title: t('notif.nothingNew'),
      body: t('notif.nothingNewBody'),
      iconName: 'inbox',
    })}<div class="row"><button class="btn btn-secondary" data-close-modal>${esc(t('notif.close'))}</button></div></div>`;
  }
  return `<div class="modal">
    <div class="card-head">
      <h2>${esc(t('notif.title'))} ${data.unread ? `<span class="badge badge-country">${esc(t('notif.unreadCount', { count: data.unread }))}</span>` : ''}</h2>
      <button class="icon-btn" data-close-modal aria-label="${esc(t('notif.close'))}">${svg('alert')}</button>
    </div>
    <div class="stack" style="gap:var(--space-2)">
      ${data.items
        .slice(0, 15)
        .map(
          (n) => `<div class="notif-item" data-unread="${!n.readAt}">
            <strong>${esc(n.title)}</strong>
            <p>${esc(n.body)}</p>
            <span class="xs muted">${formatDate(n.createdAt, true)}</span>
          </div>`,
        )
        .join('')}
    </div>
    <div class="row">
      ${data.unread ? `<button class="btn btn-secondary" data-read-all>${esc(t('notif.markAllRead'))}</button>` : ''}
      <a class="btn" href="/touma/compte" data-link data-close-modal>${esc(t('notif.seeAll'))}</a>
    </div>
  </div>`;
}

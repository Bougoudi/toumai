/**
 * TOUMA — compte : connexion, inscription, profil, adresses, notifications.
 */
import { api, esc, formatDate, label, session, emptyState, svg } from './core.js';
import { breadcrumb } from './components.js';

export async function login(_params, query) {
  return `
    <div class="container-narrow" style="margin-inline:auto">
      <div class="card">
        <h1 style="font-size:var(--text-xl)">Se connecter</h1>
        <p class="muted small">Accédez à vos commandes, votre boutique et vos paiements.</p>
        <form id="login-form" novalidate>
          <div class="field">
            <label for="l-email">Adresse e-mail</label>
            <input id="l-email" type="email" required autocomplete="email" inputmode="email" />
          </div>
          <div class="field">
            <label for="l-password">Mot de passe</label>
            <input id="l-password" type="password" required autocomplete="current-password" />
          </div>
          <input type="hidden" id="l-next" value="${esc(query.get('suite') || '/touma/')}" />
          <button class="btn btn-block btn-lg" type="submit">Se connecter</button>
        </form>
        <p class="small mt-6" style="margin-bottom:0">
          Pas encore de compte ? <a href="/touma/inscription" data-link>Créer un compte</a>
        </p>
      </div>
    </div>`;
}

export async function register() {
  const countries = await api('/countries');
  return `
    <div class="container-narrow" style="margin-inline:auto">
      <div class="card">
        <h1 style="font-size:var(--text-xl)">Créer un compte TOUMA</h1>
        <p class="muted small">Un seul compte pour acheter et pour vendre.</p>
        <form id="register-form" novalidate>
          <div class="field"><label for="r-name">Nom complet</label><input id="r-name" required autocomplete="name" /></div>
          <div class="field"><label for="r-email">Adresse e-mail</label><input id="r-email" type="email" required autocomplete="email" inputmode="email" /></div>
          <div class="field">
            <label for="r-phone">Téléphone (facultatif)</label>
            <input id="r-phone" inputmode="tel" placeholder="+235…" autocomplete="tel" />
          </div>
          <div class="field">
            <label for="r-country">Pays</label>
            <select id="r-country">${countries.items.map((c) => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</select>
          </div>
          <fieldset class="field">
            <legend class="label">Je souhaite</legend>
            <div class="row" style="gap:var(--space-2)">
              <label class="check" data-selected="true" style="flex:1"><input type="radio" name="role" value="BUYER" checked /><span><strong>Acheter</strong><br /><span class="small muted">Trouver des fournisseurs</span></span></label>
              <label class="check" style="flex:1"><input type="radio" name="role" value="SELLER" /><span><strong>Vendre</strong><br /><span class="small muted">Ouvrir une boutique</span></span></label>
            </div>
          </fieldset>
          <div class="field">
            <label for="r-password">Mot de passe</label>
            <input id="r-password" type="password" required minlength="10" autocomplete="new-password" />
            <span class="field-hint">10 caractères minimum.</span>
          </div>
          <button class="btn btn-block btn-lg" type="submit">Créer mon compte</button>
        </form>
        <p class="small mt-6" style="margin-bottom:0">Déjà inscrit ? <a href="/touma/connexion" data-link>Se connecter</a></p>
      </div>
    </div>`;
}

export async function account() {
  const [me, notifications] = await Promise.all([api('/auth/me'), api('/notifications')]);
  return `
    ${breadcrumb([{ label: 'Accueil', href: '/touma/' }, { label: 'Mon compte' }])}
    <h1>Mon compte</h1>

    <div class="grid grid-2 mt-6">
      <div class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">Profil</h2>
          <dl class="spec-list">
            <div><dt>Nom</dt><dd>${esc(me.name)}</dd></div>
            <div><dt>E-mail</dt><dd>${esc(me.email)}</dd></div>
            <div><dt>Téléphone</dt><dd>${esc(me.phone ?? '—')}</dd></div>
            <div><dt>Pays</dt><dd>${esc(me.countryCode ?? '—')}</dd></div>
            <div><dt>Rôle</dt><dd>${esc(label(me.role))}</dd></div>
          </dl>
          ${me.role === 'BUYER'
            ? `<a class="btn btn-secondary btn-block mt-6" href="/touma/vendeur/boutique" data-link>Ouvrir une boutique</a>`
            : `<a class="btn btn-secondary btn-block mt-6" href="/touma/vendeur" data-link>Espace vendeur</a>`}
          <button class="btn btn-ghost btn-block btn-sm mt-6" data-logout-all>Déconnecter tous mes appareils</button>
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">Suivi et après-vente</h2>
          <div class="stack" style="gap:var(--space-2)">
            <a class="btn btn-secondary btn-block btn-sm" href="/touma/commandes" data-link>Mes commandes</a>
            <a class="btn btn-secondary btn-block btn-sm" href="/touma/retours" data-link>Mes retours et remboursements</a>
            <a class="btn btn-secondary btn-block btn-sm" href="/touma/messages" data-link>Mes messages</a>
            <a class="btn btn-secondary btn-block btn-sm" href="/touma/aide" data-link>Assistance TOUMA</a>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2 style="font-size:var(--text-md)">Adresses (${me.addresses.length})</h2></div>
          ${me.addresses.length
            ? `<div class="stack">
                ${me.addresses
                  .map(
                    (a) => `<div class="row-between" style="border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-3)">
                      <span class="small">
                        <strong>${esc(a.fullName)}</strong>${a.isDefault ? ' <span class="badge badge-verified">Par défaut</span>' : ''}<br />
                        ${esc(a.line1)}, ${esc(a.city)} — ${esc(a.countryCode)}<br />
                        <span class="muted">${esc(a.phone)}</span>
                      </span>
                      <button class="btn btn-ghost btn-sm" data-delete-address="${esc(a.id)}">Supprimer</button>
                    </div>`,
                  )
                  .join('')}
              </div>`
            : '<p class="muted small">Aucune adresse enregistrée.</p>'}
        </section>
      </div>

      <section class="card">
        <div class="card-head">
          <h2 style="font-size:var(--text-md)">Notifications</h2>
          ${notifications.unread ? `<button class="btn btn-ghost btn-sm" data-read-all>Tout marquer comme lu</button>` : ''}
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
          : `<p class="muted small">Aucune notification pour l’instant.</p>`}
      </section>
    </div>`;
}

/** Panneau de notifications ouvert depuis l'en-tête. */
export async function notificationsPanel() {
  const data = await api('/notifications');
  if (!data.items.length) {
    return `<div class="modal"><h2>Notifications</h2>${emptyState({
      title: 'Rien de neuf',
      body: 'Les mises à jour de vos commandes, paiements et livraisons apparaîtront ici.',
      iconName: 'inbox',
    })}<div class="row"><button class="btn btn-secondary" data-close-modal>Fermer</button></div></div>`;
  }
  return `<div class="modal">
    <div class="card-head">
      <h2>Notifications ${data.unread ? `<span class="badge badge-country">${data.unread} non lue(s)</span>` : ''}</h2>
      <button class="icon-btn" data-close-modal aria-label="Fermer">${svg('alert')}</button>
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
      ${data.unread ? '<button class="btn btn-secondary" data-read-all>Tout marquer comme lu</button>' : ''}
      <a class="btn" href="/touma/compte" data-link data-close-modal>Voir tout</a>
    </div>
  </div>`;
}

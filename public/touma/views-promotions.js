/**
 * Promotions : création et suivi des codes de réduction.
 *
 * La même vue sert le vendeur (codes de ses boutiques, financés par lui) et
 * l'administration (campagnes TOUMA). La distinction n'est pas cosmétique :
 * elle décide qui paie la remise, et l'interface le dit explicitement.
 */
import { api, esc, emptyState, formatDate, money, statusPill } from './core.js';
import { breadcrumb, pagination } from './components.js';

const TYPE_LABEL = {
  PERCENTAGE: 'Pourcentage',
  FIXED_AMOUNT: 'Montant fixe',
  FREE_SHIPPING: 'Livraison offerte',
};

const FUNDING_LABEL = {
  PLATFORM: 'Financé par TOUMA',
  STORE: 'Financé par la boutique',
};

/** Formule lisible de la remise accordée. */
function offer(coupon) {
  if (coupon.type === 'FREE_SHIPPING') return 'Livraison offerte';
  if (coupon.type === 'PERCENTAGE') {
    return `−${coupon.value} %${coupon.maxDiscountAmount ? ` (au plus ${money(coupon.maxDiscountAmount, coupon.currency ?? '')})` : ''}`;
  }
  return `−${money(coupon.value, coupon.currency ?? '')}`;
}

function couponRow(coupon) {
  const usage = coupon.usageLimit ? `${coupon.usageCount}/${coupon.usageLimit}` : String(coupon.usageCount);
  return `<tr>
    <td>
      <strong style="font-family:var(--font-mono)">${esc(coupon.code)}</strong>
      ${coupon.description ? `<div class="xs muted">${esc(coupon.description)}</div>` : ''}
      <div class="xs muted">${esc(FUNDING_LABEL[coupon.funding])}</div>
    </td>
    <td>${esc(offer(coupon))}<div class="xs muted">${esc(TYPE_LABEL[coupon.type])}</div></td>
    <td class="small">
      ${coupon.minOrderAmount ? `dès ${money(coupon.minOrderAmount, coupon.currency ?? '')}<br />` : ''}
      ${coupon.firstOrderOnly ? '1<sup>re</sup> commande<br />' : ''}
      ${coupon.countryCodes.length ? esc(coupon.countryCodes.join(', ')) : '<span class="muted">tous pays</span>'}
    </td>
    <td class="small">${usage}${coupon.usageLimitPerUser ? `<div class="xs muted">${coupon.usageLimitPerUser}/acheteur</div>` : ''}</td>
    <td class="small">${coupon.endsAt ? formatDate(coupon.endsAt) : '<span class="muted">sans fin</span>'}</td>
    <td>${statusPill(coupon.status)}</td>
    <td class="row" style="gap:var(--space-2);justify-content:flex-end">
      <a class="btn btn-secondary btn-sm" href="/touma/promotions/${esc(coupon.id)}" data-link>Suivi</a>
      ${coupon.status === 'ACTIVE'
        ? `<button class="btn btn-ghost btn-sm" data-pause-coupon="${esc(coupon.id)}">Suspendre</button>`
        : coupon.status === 'PAUSED'
          ? `<button class="btn btn-ghost btn-sm" data-resume-coupon="${esc(coupon.id)}">Réactiver</button>`
          : ''}
    </td>
  </tr>`;
}

/** Formulaire de création, adapté au périmètre (boutique ou plateforme). */
function createForm(stores, scope) {
  return `<form id="coupon-create-form" data-scope="${esc(scope)}">
    ${scope === 'platform'
      ? '<p class="small muted">Campagne TOUMA : la remise est prise en charge par la plateforme, la commission du vendeur n’en est pas affectée.</p>'
      : '<p class="small muted">Promotion de votre boutique : elle réduit votre revenu, et la commission TOUMA est calculée sur le montant net.</p>'}

    <div class="grid grid-2" style="gap:var(--space-3)">
      <div class="field"><label for="co-code">Code</label>
        <input id="co-code" required minlength="3" maxlength="40" placeholder="RENTREE10" style="font-family:var(--font-mono);text-transform:uppercase" />
      </div>
      <div class="field"><label for="co-type">Type de remise</label>
        <select id="co-type">
          <option value="PERCENTAGE">Pourcentage</option>
          <option value="FIXED_AMOUNT">Montant fixe</option>
          <option value="FREE_SHIPPING">Livraison offerte</option>
        </select>
      </div>
    </div>

    ${scope === 'store'
      ? `<div class="field"><label for="co-store">Boutique</label>
          <select id="co-store" required>${stores.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>
        </div>`
      : ''}

    <div class="grid grid-2" style="gap:var(--space-3)">
      <div class="field" id="co-value-field"><label for="co-value">Valeur</label>
        <input id="co-value" type="text" inputmode="decimal" placeholder="10" />
        <span class="field-hint">Pourcentage entre 0 et 100, ou montant dans la devise choisie.</span>
      </div>
      <div class="field"><label for="co-currency">Devise (montant fixe)</label>
        <input id="co-currency" maxlength="3" placeholder="XAF" style="text-transform:uppercase" />
      </div>
    </div>

    <div class="grid grid-2" style="gap:var(--space-3)">
      <div class="field"><label for="co-min">Minimum d’achat</label><input id="co-min" type="text" inputmode="decimal" placeholder="50000" /></div>
      <div class="field"><label for="co-max">Remise maximale</label><input id="co-max" type="text" inputmode="decimal" placeholder="5000" /></div>
    </div>

    <div class="grid grid-2" style="gap:var(--space-3)">
      <div class="field"><label for="co-limit">Utilisations au total</label><input id="co-limit" type="number" min="1" placeholder="100" /></div>
      <div class="field"><label for="co-limit-user">Utilisations par acheteur</label><input id="co-limit-user" type="number" min="1" placeholder="1" /></div>
    </div>

    <div class="grid grid-2" style="gap:var(--space-3)">
      <div class="field"><label for="co-ends">Fin de validité</label><input id="co-ends" type="date" /></div>
      <div class="field"><label for="co-countries">Pays de livraison (codes séparés par des virgules)</label><input id="co-countries" maxlength="60" placeholder="TD, CM" /></div>
    </div>

    <div class="field"><label for="co-description">Description visible par l’acheteur</label><input id="co-description" maxlength="300" placeholder="10 % sur votre première commande" /></div>

    <label class="check" style="margin-bottom:var(--space-4)">
      <input id="co-first" type="checkbox" /><span class="small">Réservé à une première commande</span>
    </label>

    <button class="btn" type="submit">Créer le code</button>
  </form>`;
}

/** Liste et création — le titre est posé par la vue appelante (onglets vendeur ou console admin). */
async function listView({ scope, query, stores, base }) {
  const page = Number(query.get('page') || 1);
  const data = await api(`/coupons?scope=${scope}&page=${page}`);

  const canCreate = scope === 'platform' || stores.length > 0;
  return `
    <p class="small muted">Un code ne peut jamais rendre une commande négative, ni dépasser la limite que vous lui fixez.</p>

    <section class="card" style="margin-bottom:var(--space-5)">
      <details${data.items.length ? '' : ' open'}>
        <summary class="strong">Créer un code de réduction</summary>
        <div style="margin-top:var(--space-4)">
          ${canCreate
            ? createForm(stores, scope)
            : '<p class="small muted" style="margin:0">Ouvrez d’abord une boutique pour créer des codes.</p>'}
        </div>
      </details>
    </section>

    ${data.items.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Code</th><th>Remise</th><th>Conditions</th><th>Usage</th><th>Fin</th><th>Statut</th><th></th></tr></thead>
          <tbody>${data.items.map(couponRow).join('')}</tbody>
        </table></div>
        ${pagination(data, (p) => `${base}?page=${p}`)}`
      : emptyState({
          title: 'Aucun code pour l’instant',
          body: 'Créez un code de réduction pour animer vos ventes : pourcentage, montant fixe ou livraison offerte.',
          iconName: 'spark',
        })}`;
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
  return `<h1 style="font-size:var(--text-xl)">Promotions</h1>${tabs('/touma/vendeur/promotions')}${content}`;
}

/** Administration : campagnes TOUMA. */
export async function adminCoupons(_params, query) {
  const [{ layout }, content] = await Promise.all([
    import('./views-admin.js'),
    listView({ scope: 'platform', query, stores: [], base: '/touma/admin/promotions' }),
  ]);
  return layout('/touma/admin/promotions', 'Promotions TOUMA', content);
}

/** Détail : ce qu'un code a réellement coûté. */
export async function couponDetail(params) {
  const data = await api(`/coupons/${params.id}/redemptions`);
  const c = data.coupon;

  return `
    ${breadcrumb([{ label: 'Promotions', href: c.storeId ? '/touma/vendeur/promotions' : '/touma/admin/promotions' }, { label: c.code }])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px;font-family:var(--font-mono)">${esc(c.code)}</h1>
        <p class="small muted" style="margin:0">${esc(offer(c))} · ${esc(FUNDING_LABEL[c.funding])}${c.description ? ` · ${esc(c.description)}` : ''}</p>
      </div>
      ${statusPill(c.status)}
    </div>

    <div class="grid grid-2" style="align-items:start">
      <section class="card">
        <h2 style="font-size:var(--text-md)">Utilisations</h2>
        ${data.items.length
          ? `<div class="table-wrap" style="border:0"><table>
              <thead><tr><th>Panier</th><th>Remise accordée</th><th>Date</th></tr></thead>
              <tbody>
                ${data.items
                  .map(
                    (r) => `<tr>
                      <td class="small">${esc(r.orderGroup.reference)}<div class="xs muted">panier de ${money(r.orderGroup.total, r.currency)}</div></td>
                      <td><strong>${money(r.amount, r.currency)}</strong></td>
                      <td class="small muted">${formatDate(r.createdAt, true)}</td>
                    </tr>`,
                  )
                  .join('')}
              </tbody>
            </table></div>`
          : '<p class="muted small">Ce code n’a pas encore été utilisé.</p>'}
      </section>

      <aside class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">Ce que ce code a coûté</h2>
          <p style="margin:0;font-size:var(--text-xl);font-weight:var(--weight-bold)">${money(data.totalGranted, data.items[0]?.currency ?? c.currency ?? '')}</p>
          <p class="small muted" style="margin:2px 0 0">${c.usageCount} utilisation(s)${c.usageLimit ? ` sur ${c.usageLimit}` : ''}.</p>
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">Conditions</h2>
          <dl class="spec-list">
            <div><dt>Minimum d’achat</dt><dd>${c.minOrderAmount ? money(c.minOrderAmount, c.currency ?? '') : '—'}</dd></div>
            <div><dt>Remise maximale</dt><dd>${c.maxDiscountAmount ? money(c.maxDiscountAmount, c.currency ?? '') : '—'}</dd></div>
            <div><dt>Par acheteur</dt><dd>${c.usageLimitPerUser ?? 'illimité'}</dd></div>
            <div><dt>Première commande</dt><dd>${c.firstOrderOnly ? 'oui' : 'non'}</dd></div>
            <div><dt>Pays</dt><dd>${c.countryCodes.length ? esc(c.countryCodes.join(', ')) : 'tous'}</dd></div>
            <div><dt>Validité</dt><dd>${formatDate(c.startsAt)} → ${c.endsAt ? formatDate(c.endsAt) : 'sans fin'}</dd></div>
          </dl>
        </section>
      </aside>
    </div>`;
}

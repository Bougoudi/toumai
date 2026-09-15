/**
 * TOUMA Business — espace des acheteurs professionnels : profil entreprise,
 * appels d'offres, comparaison des offres et négociation.
 */
import { api, esc, money, formatDate, label, session, statusPill, stars, emptyState, svg, toast } from './core.js';
import { breadcrumb, statCard } from './components.js';

const TABS = [
  ['/touma/business', "Vue d'ensemble"],
  ['/touma/business/appels-offres', "Mes appels d'offres"],
  ['/touma/business/messages', 'Messagerie'],
  ['/touma/business/appels-offres/nouveau', 'Publier une demande'],
  ['/touma/sourcing', 'Sourcing'],
  ['/touma/business/profil', 'Profil entreprise'],
];

function tabs(current) {
  return `<nav class="tabs" aria-label="TOUMA Business">
    ${TABS.map(([href, text]) => `<a href="${href}" data-link${href === current ? ' aria-current="page"' : ''}>${text}</a>`).join('')}
  </nav>`;
}

const RFQ_STATUS = {
  OPEN: 'Ouvert aux offres',
  QUOTED: 'Offres reçues',
  AWARDED: 'Attribué',
  CLOSED: 'Clos',
  EXPIRED: 'Expiré',
  CANCELLED: 'Annulé',
};

const QUOTE_STATUS = {
  SUBMITTED: 'Offre reçue',
  COUNTERED: 'En négociation',
  ACCEPTED: 'Acceptée',
  REJECTED: 'Non retenue',
  EXPIRED: 'Expirée',
  WITHDRAWN: 'Retirée',
};

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
    ${breadcrumb([{ label: 'Accueil', href: '/touma/' }, { label: 'TOUMA Business' }])}
    <div class="row-between">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px">TOUMA Business</h1>
        <p class="muted small" style="margin:0">Achetez en gros : publiez votre besoin, comparez les offres, négociez, commandez.</p>
      </div>
      <a class="btn btn-accent" href="/touma/business/appels-offres/nouveau" data-link>Publier une demande</a>
    </div>
    ${tabs('/touma/business')}

    ${profile
      ? ''
      : `<div class="alert alert-info" style="margin-bottom:var(--space-5)">
          <div>
            <strong>Complétez votre profil entreprise</strong>
            <div class="small">Les fournisseurs répondent plus volontiers à une entreprise identifiée.
              <a href="/touma/business/profil" data-link>Renseigner mon profil</a></div>
          </div>
        </div>`}

    <div class="grid grid-stats">
      ${statCard('Appels d’offres en cours', awaiting.length)}
      ${statCard('Offres reçues', quotesReceived)}
      ${statCard('Entreprise', profile ? profile.legalName : 'Non renseignée', profile?.sector ?? '')}
    </div>

    <section class="section mt-8">
      <div class="section-head">
        <h2>Mes dernières demandes</h2>
        <a class="small" href="/touma/business/appels-offres" data-link>Tout voir</a>
      </div>
      ${mine.items.length ? rfqList(mine.items) : emptyState({
        title: 'Aucune demande publiée',
        body: 'Décrivez ce que vous cherchez — produit, quantité, pays de livraison — et laissez les fournisseurs vous répondre.',
        actionLabel: 'Publier une demande',
        actionHref: '/touma/business/appels-offres/nouveau',
        iconName: 'inbox',
      })}
    </section>

    ${session.isSeller && open.items.length
      ? `<section class="section">
          <div class="section-head"><h2>Demandes auxquelles vous pouvez répondre</h2></div>
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
                <span class="badge badge-country">Livraison ${esc(r.countryCode)}${r.city ? ` · ${esc(r.city)}` : ''}</span>
                ${r.sourceCountry ? `<span class="badge badge-cross">Origine ${esc(r.sourceCountry)}</span>` : ''}
                <span>${r.items.length} ligne(s) · ${r.quoteCount} offre(s)</span>
              </div>
            </div>
            <div class="row" style="gap:var(--space-3)">
              <span class="status status-${esc(r.status)}">${esc(RFQ_STATUS[r.status] ?? r.status)}</span>
              <a class="btn btn-secondary btn-sm" href="/touma/business/appels-offres/${esc(r.id)}" data-link>Ouvrir</a>
            </div>
          </div>
          <p class="small muted mt-6" style="margin-bottom:0">
            ${r.items.map((i) => `${i.quantity} ${esc(i.unit)} — ${esc(i.name)}`).join(' · ')}
            ${r.deadline ? ` · réponses jusqu'au ${formatDate(r.deadline)}` : ''}
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
    mine: {
      title: 'Aucune demande publiée',
      body: 'Publiez votre première demande d’achat.',
      actionLabel: 'Publier une demande',
    },
    open: {
      title: 'Aucune demande ouverte',
      body: 'Revenez plus tard : les demandes des acheteurs apparaîtront ici.',
    },
    invited: {
      title: 'Aucune sollicitation reçue',
      body: 'Quand un acheteur vous repère dans le sourcing et vous invite à répondre, sa demande apparaît ici.',
    },
  }[scope];

  return `
    <h1 style="font-size:var(--text-xl)">Appels d'offres</h1>
    ${tabs('/touma/business/appels-offres')}
    <div class="chip-row" style="margin-bottom:var(--space-5)">
      <a class="chip" href="/touma/business/appels-offres" data-link aria-current="${scope === 'mine'}">Mes demandes</a>
      <a class="chip" href="/touma/business/appels-offres?scope=open" data-link aria-current="${scope === 'open'}">Demandes ouvertes</a>
      ${session.isSeller
        ? `<a class="chip" href="/touma/business/appels-offres?scope=invited" data-link aria-current="${scope === 'invited'}">Sollicitations reçues</a>`
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
    <h1 style="font-size:var(--text-xl)">Publier une demande d'achat</h1>
    ${tabs('/touma/business/appels-offres/nouveau')}
    <p class="muted small">
      Décrivez précisément ce que vous cherchez. Les fournisseurs du corridor vous répondent avec un prix, un délai et une
      durée de validité ; vous comparez, négociez, puis commandez.
    </p>

    <form class="card" id="rfq-form">
      <div class="field">
        <label for="q-title">Intitulé de la demande</label>
        <input id="q-title" required maxlength="200" placeholder="Recherche 500 kg de cacao en fèves" />
      </div>
      <div class="field">
        <label for="q-description">Précisions</label>
        <textarea id="q-description" rows="4" maxlength="4000" placeholder="Qualité attendue, conditionnement, échantillon, conditions de paiement…"></textarea>
      </div>
      <div class="grid grid-2">
        <div class="field">
          <label for="q-country">Pays de livraison</label>
          <select id="q-country">${countries.items.map(option).join('')}</select>
        </div>
        <div class="field"><label for="q-city">Ville de livraison</label><input id="q-city" maxlength="120" /></div>
        <div class="field">
          <label for="q-source">Pays d'origine souhaité (facultatif)</label>
          <select id="q-source"><option value="">Indifférent</option>${countries.items.map((c) => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label for="q-currency">Devise</label>
          <select id="q-currency"><option value="XAF">XAF</option><option value="EUR">EUR</option></select>
        </div>
        <div class="field">
          <label for="q-deadline">Réponses attendues avant le</label>
          <input id="q-deadline" type="date" />
        </div>
      </div>

      <fieldset>
        <legend class="label">Produits recherchés</legend>
        <div id="rfq-items">${rfqItemRow(0, categories.items)}</div>
        <button class="btn btn-secondary btn-sm" type="button" id="add-rfq-item">Ajouter une ligne</button>
      </fieldset>

      <div class="row mt-6">
        <button class="btn btn-accent" type="submit">Publier la demande</button>
        <a class="btn btn-ghost" href="/touma/business/appels-offres" data-link>Annuler</a>
      </div>
    </form>`;
}

export function rfqItemRow(index, categories) {
  return `<div class="card rfq-item" style="box-shadow:none;margin-bottom:var(--space-3)">
    <div class="grid grid-2">
      <div class="field"><label for="i-name-${index}">Produit</label><input id="i-name-${index}" class="i-name" required maxlength="200" placeholder="Cacao en fèves fermentées" /></div>
      <div class="field">
        <label for="i-category-${index}">Catégorie</label>
        <select id="i-category-${index}" class="i-category"><option value="">Non précisée</option>${categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label for="i-qty-${index}">Quantité</label><input id="i-qty-${index}" class="i-qty" type="number" min="1" value="100" required /></div>
      <div class="field"><label for="i-unit-${index}">Unité</label><input id="i-unit-${index}" class="i-unit" value="kg" maxlength="30" /></div>
      <div class="field"><label for="i-target-${index}">Prix unitaire cible (facultatif)</label><input id="i-target-${index}" class="i-target" inputmode="decimal" placeholder="2800" /></div>
    </div>
    <div class="field" style="margin-bottom:0"><label for="i-desc-${index}">Détail</label><input id="i-desc-${index}" class="i-desc" maxlength="1000" placeholder="Qualité export, humidité contrôlée…" /></div>
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
      { label: 'TOUMA Business', href: '/touma/business' },
      { label: "Appels d'offres", href: '/touma/business/appels-offres' },
      { label: data.reference },
    ])}
    <div class="row-between" style="margin-bottom:var(--space-4)">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px">${esc(data.title)}</h1>
        <p class="small muted" style="margin:0">
          ${esc(data.reference)} · publié le ${formatDate(data.createdAt)}
          ${data.deadline ? ` · réponses jusqu'au ${formatDate(data.deadline)}` : ''}
        </p>
      </div>
      <span class="status status-${esc(data.status)}">${esc(RFQ_STATUS[data.status] ?? data.status)}</span>
    </div>

    <div class="grid grid-2">
      <section class="card">
        <h2 style="font-size:var(--text-md)">Besoin exprimé</h2>
        ${data.description ? `<p class="small" style="white-space:pre-line">${esc(data.description)}</p>` : ''}
        <div class="table-wrap" style="border:0">
          <table>
            <thead><tr><th>Produit</th><th>Quantité</th><th>Prix cible</th></tr></thead>
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
          <div><dt>Livraison</dt><dd>${esc(data.countryCode)}${data.city ? ` · ${esc(data.city)}` : ''}</dd></div>
          ${data.sourceCountry ? `<div><dt>Origine souhaitée</dt><dd>${esc(data.sourceCountry)}</dd></div>` : ''}
          <div><dt>Devise</dt><dd>${esc(data.currency)}</dd></div>
          ${data.business ? `<div><dt>Acheteur</dt><dd>${esc(data.business.legalName)}${data.business.sector ? ` — ${esc(data.business.sector)}` : ''}</dd></div>` : ''}
        </dl>
        ${data.isOwner && ['OPEN', 'QUOTED'].includes(data.status)
          ? `<button class="btn btn-secondary btn-sm mt-6" data-close-rfq="${esc(data.id)}">Clore cette demande</button>`
          : ''}
      </section>

      <section>
        ${canQuote && !alreadyQuoted
          ? `<form class="card" id="quote-form" data-rfq="${esc(data.id)}">
              <h2 style="font-size:var(--text-md)">Proposer une offre</h2>
              <div class="field">
                <label for="qf-store">Boutique</label>
                <select id="qf-store">${stores.items.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${esc(s.countryCode)})</option>`).join('')}</select>
              </div>
              <div id="quote-lines">
                ${data.items
                  .map(
                    (i, index) => `<div class="card quote-line" style="box-shadow:none;margin-bottom:var(--space-3)" data-rfq-item="${esc(i.id)}">
                      <strong class="small">${esc(i.name)} — ${i.quantity} ${esc(i.unit)}</strong>
                      <div class="grid grid-2 mt-6">
                        <div class="field" style="margin-bottom:0"><label for="ql-qty-${index}">Quantité proposée</label><input id="ql-qty-${index}" class="ql-qty" type="number" min="1" value="${i.quantity}" /></div>
                        <div class="field" style="margin-bottom:0"><label for="ql-price-${index}">Prix unitaire (${esc(data.currency)})</label><input id="ql-price-${index}" class="ql-price" inputmode="decimal" required placeholder="2750" /></div>
                      </div>
                      <input type="hidden" class="ql-name" value="${esc(i.name)}" />
                      <input type="hidden" class="ql-unit" value="${esc(i.unit)}" />
                    </div>`,
                  )
                  .join('')}
              </div>
              <div class="grid grid-2">
                <div class="field"><label for="qf-shipping">Transport (${esc(data.currency)})</label><input id="qf-shipping" inputmode="decimal" value="0" /></div>
                <div class="field"><label for="qf-lead">Délai (jours)</label><input id="qf-lead" type="number" min="0" value="10" /></div>
                <div class="field"><label for="qf-validity">Offre valable (jours)</label><input id="qf-validity" type="number" min="1" max="120" value="14" /></div>
              </div>
              <div class="field"><label for="qf-message">Message au client</label><textarea id="qf-message" rows="3" maxlength="2000"></textarea></div>
              <button class="btn btn-accent" type="submit">Envoyer mon offre</button>
            </form>`
          : ''}

        <div class="card${canQuote && !alreadyQuoted ? ' mt-6' : ''}">
          <h2 style="font-size:var(--text-md)">
            ${data.isOwner ? `Offres reçues (${data.quotes.length})` : 'Mon offre'}
          </h2>
          ${data.quotes.length
            ? `<div class="stack">${data.quotes.map((q) => quoteCard(q, data, me)).join('')}</div>`
            : `<p class="muted small" style="margin:0">${data.isOwner ? 'Aucune offre reçue pour l’instant. Les fournisseurs du corridor sont notifiés.' : 'Vous n’avez pas encore répondu à cette demande.'}</p>`}
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
          ${q.store.verificationStatus === 'APPROVED' ? '<span class="badge badge-verified">Vérifié</span>' : ''}
          ${stars(q.store.ratingAverage, q.store.ratingCount)}
        </div>
      </div>
      <span class="status status-${esc(q.status)}">${esc(QUOTE_STATUS[q.status] ?? q.status)}</span>
    </div>

    <div class="summary mt-6">
      <div class="summary-line"><span>Marchandise</span><span>${money(q.itemsTotal, q.currency)}</span></div>
      <div class="summary-line"><span>Transport</span><span>${money(q.shippingTotal, q.currency)}</span></div>
      <div class="summary-line summary-total"><span>Total</span><span>${money(q.total, q.currency)}</span></div>
    </div>
    <p class="xs muted">
      Délai annoncé : ${q.leadTimeDays} jour(s) · offre valable jusqu'au ${formatDate(q.validUntil)}
      ${q.expired ? ' · <span class="badge badge-danger">expirée</span>' : ''}
    </p>
    ${q.message ? `<p class="small">« ${esc(q.message)} »</p>` : ''}

    <div class="row" style="gap:var(--space-2);flex-wrap:wrap;margin-top:var(--space-3)">
      <a class="btn btn-secondary btn-sm" href="/touma/negociations/${esc(q.id)}" data-link>${svg('chart')} Ouvrir la négociation</a>
      ${q.conversationId ? `<a class="btn btn-ghost btn-sm" href="/touma/messages/${esc(q.conversationId)}" data-link>${svg('inbox')} Discuter</a>` : ''}
    </div>

    ${q.negotiations.length
      ? `<details style="margin-top:var(--space-3)">
          <summary class="small strong">Négociation (${q.negotiations.length})</summary>
          <div class="stack" style="margin-top:var(--space-3);gap:var(--space-2)">
            ${q.negotiations
              .map(
                (n) => `<div class="notif-item">
                  <strong>${esc(n.author.name)}${n.kind === 'COUNTER_OFFER' ? ' — contre-proposition' : ''}</strong>
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
        ? `<a class="btn btn-secondary btn-sm mt-6" href="/touma/commandes/groupe/${esc(q.orderGroupId)}" data-link>Voir la commande</a>`
        : ''
      : `<form class="mt-6 negotiate-form" data-quote="${esc(q.id)}">
          <div class="field" style="margin-bottom:var(--space-2)">
            <label for="neg-${esc(q.id)}">Message ou contre-proposition</label>
            <textarea id="neg-${esc(q.id)}" class="neg-body" rows="2" maxlength="2000" placeholder="Pouvez-vous descendre à … ?"></textarea>
          </div>
          <div class="row" style="gap:var(--space-2)">
            <input class="neg-total" inputmode="decimal" placeholder="Total proposé (facultatif)" style="max-width:220px" />
            <button class="btn btn-secondary btn-sm" type="submit">Envoyer</button>
          </div>
        </form>
        ${canDecide
          ? `<div class="row mt-6">
              ${addresses.length
                ? `<select class="accept-address" style="max-width:260px" aria-label="Adresse de livraison">
                    ${addresses.map((a) => `<option value="${esc(a.id)}">${esc(a.city)} — ${esc(a.line1)}</option>`).join('')}
                  </select>
                  <button class="btn btn-accent btn-sm" data-accept-quote="${esc(q.id)}">Accepter et commander</button>`
                : '<a class="btn btn-secondary btn-sm" href="/touma/compte" data-link>Ajoutez une adresse pour accepter</a>'}
              <button class="btn btn-ghost btn-sm" data-reject-quote="${esc(q.id)}">Refuser</button>
            </div>`
          : ''}`}
  </article>`;
}

// ── Profil entreprise ──────────────────────────────────────────────────────
export async function profile() {
  const [profileData, countries] = await Promise.all([api('/business/profile'), api('/countries')]);
  const value = (v) => esc(v ?? '');
  return `
    <h1 style="font-size:var(--text-xl)">Profil entreprise</h1>
    ${tabs('/touma/business/profil')}
    <p class="muted small">Ces informations sont visibles des fournisseurs auxquels vous adressez une demande.</p>

    <form class="card" id="business-form">
      <div class="field"><label for="b-legal">Raison sociale</label><input id="b-legal" required maxlength="200" value="${value(profileData?.legalName)}" /></div>
      <div class="grid grid-2">
        <div class="field"><label for="b-reg">Numéro d'enregistrement (RCCM…)</label><input id="b-reg" maxlength="80" value="${value(profileData?.registrationNo)}" /></div>
        <div class="field"><label for="b-tax">Identifiant fiscal</label><input id="b-tax" maxlength="80" value="${value(profileData?.taxId)}" /></div>
        <div class="field"><label for="b-sector">Secteur d'activité</label><input id="b-sector" maxlength="120" value="${value(profileData?.sector)}" placeholder="Distribution agroalimentaire" /></div>
        <div class="field">
          <label for="b-country">Pays</label>
          <select id="b-country">${countries.items.map((c) => `<option value="${esc(c.code)}"${profileData?.countryCode === c.code ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label for="b-city">Ville</label><input id="b-city" maxlength="120" value="${value(profileData?.city)}" /></div>
        <div class="field"><label for="b-phone">Téléphone</label><input id="b-phone" inputmode="tel" maxlength="30" value="${value(profileData?.phone)}" /></div>
        <div class="field"><label for="b-website">Site web</label><input id="b-website" type="url" maxlength="200" value="${value(profileData?.website)}" placeholder="https://…" /></div>
        <div class="field"><label for="b-volume">Volume d'achat annuel (indicatif)</label><input id="b-volume" maxlength="60" value="${value(profileData?.annualVolume)}" placeholder="50–100 M XAF" /></div>
      </div>
      <button class="btn btn-accent" type="submit">Enregistrer</button>
    </form>`;
}

// ── Offres du fournisseur ──────────────────────────────────────────────────
export async function myQuotes() {
  const data = await api('/quotes/mine');
  return `
    <h1 style="font-size:var(--text-xl)">Mes offres</h1>
    <p class="muted small">Réponses envoyées aux appels d'offres des acheteurs professionnels.</p>
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
          title: 'Aucune offre envoyée',
          body: 'Consultez les demandes ouvertes et proposez vos prix.',
          actionLabel: 'Voir les demandes',
          actionHref: '/touma/business/appels-offres?scope=open',
          iconName: 'inbox',
        })}`;
}

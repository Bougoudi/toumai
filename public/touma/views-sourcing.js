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

const LEVEL = {
  EXCELLENT: 'Excellent',
  FIABLE: 'Fiable',
  CORRECT: 'Correct',
  A_SURVEILLER: 'À surveiller',
  NOUVEAU: 'Nouvelle boutique',
};

const SORTS = [
  ['relevance', 'Pertinence'],
  ['capacity', 'Capacité disponible'],
  ['price', 'Prix le plus bas'],
  ['reputation', 'Réputation'],
];

/** Carte d'un fournisseur : ce qu'on sait de lui, et ce qu'on ne sait pas. */
function supplierCard(item, { selectable }) {
  const s = item.store;
  const initial = (s.name || 'T').trim().charAt(0).toUpperCase();

  const facts = [
    ['Capacité en stock', `${item.capacity.toLocaleString('fr-FR')} unité(s)`],
    item.minOrderQty !== null ? ['Quantité minimale', `${item.minOrderQty}`] : null,
    item.bestPrice ? ['À partir de', money(item.bestPrice.amount, item.bestPrice.currency)] : null,
    item.medianLeadTimeDays !== null ? ['Délai annoncé (médiane)', `${item.medianLeadTimeDays} j`] : null,
    ['Références correspondantes', String(item.matchingProducts)],
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
            ${s.verified ? '<span class="badge badge-verified">Vérifié</span>' : ''}
            ${item.reputationScore !== null ? `<span class="badge badge-verified">${esc(LEVEL[item.reputationLevel] ?? item.reputationLevel)} · ${item.reputationScore}/100</span>` : ''}
            ${s.rating.count ? stars(s.rating.average, s.rating.count) : ''}
          </div>
        </div>
      </div>
      ${selectable
        ? `<label class="check" style="border:0;padding:0;margin:0">
            <input type="checkbox" class="supplier-pick" data-store="${esc(s.id)}" />
            <span class="small">Solliciter</span>
          </label>`
        : ''}
    </div>

    <dl class="spec-list mt-6">
      ${facts.map(([labelText, value]) => `<div><dt>${esc(labelText)}</dt><dd>${esc(value)}</dd></div>`).join('')}
    </dl>

    ${item.servesRequestedQuantity !== null
      ? `<p class="small" style="margin:var(--space-3) 0 0;color:${item.servesRequestedQuantity ? 'var(--success)' : 'var(--warning)'}">
          ${item.servesRequestedQuantity
            ? 'Peut servir le volume demandé sur au moins une référence.'
            : 'Stock insuffisant pour le volume demandé — à confirmer avec lui.'}
        </p>`
      : ''}

    ${item.servesDestination !== null
      ? `<p class="xs muted" style="margin:var(--space-2) 0 0">
          ${item.servesDestination
            ? 'A déjà expédié vers ce pays.'
            : 'N’a pas encore expédié vers ce pays — cela ne veut pas dire qu’il ne peut pas.'}
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
    ${breadcrumb([{ label: 'TOUMA Business', href: '/touma/business' }, { label: 'Sourcing' }])}
    <h1 style="font-size:var(--text-xl)">Trouver un fournisseur</h1>
    <p class="small muted">
      Capacité, pays desservis et délais viennent des transactions réelles des boutiques, jamais de déclarations.
    </p>

    <form id="sourcing-filters" class="card" style="margin-bottom:var(--space-5)">
      <div class="grid grid-2" style="gap:var(--space-3)">
        <div class="field" style="margin:0"><label for="so-q">Que cherchez-vous ?</label>
          <input id="so-q" name="q" value="${esc(query.get('q') ?? '')}" placeholder="cacao, sésame, emballage…" />
        </div>
        <div class="field" style="margin:0"><label for="so-category">Catégorie</label>
          <select id="so-category" name="category">
            <option value="">Toutes</option>
            ${categories.items.map((c) => opt(c.slug, c.name, query.get('category'))).join('')}
          </select>
        </div>
      </div>
      <div class="grid grid-2" style="gap:var(--space-3)">
        <div class="field" style="margin:0"><label for="so-country">Pays du fournisseur</label>
          <select id="so-country" name="country">
            <option value="">Tous</option>
            ${countries.items.map((c) => opt(c.code, c.name, query.get('country'))).join('')}
          </select>
        </div>
        <div class="field" style="margin:0"><label for="so-destination">Livrer vers</label>
          <select id="so-destination" name="destination">
            <option value="">Peu importe</option>
            ${countries.items.map((c) => opt(c.code, c.name, query.get('destination'))).join('')}
          </select>
        </div>
      </div>
      <div class="grid grid-2" style="gap:var(--space-3)">
        <div class="field" style="margin:0"><label for="so-quantity">Volume recherché</label>
          <input id="so-quantity" name="minQuantity" type="number" min="1" value="${esc(query.get('minQuantity') ?? '')}" placeholder="2000" />
        </div>
        <div class="field" style="margin:0"><label for="so-sort">Trier par</label>
          <select id="so-sort" name="sort">${SORTS.map(([v, t]) => opt(v, t, query.get('sort'))).join('')}</select>
        </div>
      </div>
      <label class="check" style="margin:var(--space-3) 0">
        <input type="checkbox" name="verifiedOnly" value="true" ${query.get('verifiedOnly') ? 'checked' : ''} />
        <span class="small">Fournisseurs vérifiés uniquement</span>
      </label>
      <button class="btn" type="submit">Rechercher</button>
    </form>

    ${selectable
      ? `<form id="invite-form" class="card" style="margin-bottom:var(--space-5)">
          <div class="row-between" style="gap:var(--space-3);flex-wrap:wrap">
            <div class="field" style="flex:1;min-width:220px;margin:0">
              <label for="so-rfq">Solliciter les fournisseurs cochés pour</label>
              <select id="so-rfq">
                ${rfqs.items.map((r) => `<option value="${esc(r.id)}">${esc(r.reference)} — ${esc(r.title)}</option>`).join('')}
              </select>
            </div>
            <button class="btn btn-accent" type="submit">Envoyer l’invitation</button>
          </div>
          <p class="xs muted" style="margin:var(--space-2) 0 0">
            L’appel d’offres reste ouvert à tous : l’invitation prévient le fournisseur que vous l’attendez.
          </p>
        </form>`
      : session.user
        ? `<p class="small muted">Publiez un appel d’offres pour pouvoir solliciter directement des fournisseurs.
            <a href="/touma/business/appels-offres/nouveau" data-link>Publier une demande</a>.</p>`
        : ''}

    ${data.items.length
      ? `<div class="grid grid-cards">${data.items.map((i) => supplierCard(i, { selectable })).join('')}</div>
         ${pagination(data, hrefFor)}`
      : emptyState({
          title: 'Aucun fournisseur pour cette recherche',
          body: 'Élargissez le volume, le pays ou la catégorie : le catalogue TOUMA s’étoffe boutique après boutique.',
          actionLabel: 'Voir toutes les boutiques',
          actionHref: '/touma/boutiques',
          iconName: 'store',
        })}`;
}

/** Fiche fournisseur : catalogue par catégorie, faits observés, réputation. */
export async function supplier(params) {
  const d = await api(`/sourcing/suppliers/${params.slug}`);
  const r = d.reputation;

  return `
    ${breadcrumb([{ label: 'Sourcing', href: '/touma/sourcing' }, { label: d.store.name }])}
    <div class="row-between" style="margin-bottom:var(--space-5)">
      <div>
        <h1 style="font-size:var(--text-xl);margin-bottom:2px">${esc(d.store.name)}</h1>
        <p class="small muted" style="margin:0">
          ${esc(d.store.countryCode)}${d.store.city ? ` · ${esc(d.store.city)}` : ''} · sur TOUMA depuis ${formatDate(d.store.memberSince)}
        </p>
      </div>
      <div class="row" style="gap:var(--space-2)">
        ${d.store.verified ? '<span class="badge badge-verified">Vérifié</span>' : '<span class="badge">Non vérifié</span>'}
        ${r.published ? `<span class="badge badge-verified">${esc(LEVEL[r.level] ?? r.level)} · ${r.score}/100</span>` : ''}
      </div>
    </div>

    <div class="grid grid-2" style="align-items:start">
      <div class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">Ce qu’il propose</h2>
          ${d.store.description ? `<p class="small">${esc(d.store.description)}</p>` : ''}
          ${d.catalogue.length
            ? `<div class="table-wrap" style="border:0"><table>
                <thead><tr><th>Catégorie</th><th>Références</th><th>Capacité</th><th>À partir de</th></tr></thead>
                <tbody>
                  ${d.catalogue
                    .map(
                      (c) => `<tr>
                        <td>${esc(c.name)}</td>
                        <td>${c.products}</td>
                        <td>${c.capacity.toLocaleString('fr-FR')}</td>
                        <td>${c.minPrice ? money(c.minPrice, c.currency) : '—'}</td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table></div>`
            : '<p class="muted small">Aucun produit actif pour l’instant.</p>'}
          <a class="btn btn-secondary btn-sm mt-6" href="/touma/boutiques/${esc(d.store.slug)}" data-link>Voir la vitrine</a>
        </section>

        <section class="card">
          <h2 style="font-size:var(--text-md)">Ce qu’il a réellement fait</h2>
          <dl class="spec-list">
            <div><dt>Commandes expédiées</dt><dd>${d.shippedOrders}</dd></div>
            <div><dt>Pays desservis</dt><dd>${d.servedCountries.length ? esc(d.servedCountries.join(', ')) : 'aucun pour l’instant'}</dd></div>
            <div><dt>Offres B2B envoyées</dt><dd>${d.quotesSent}${d.quotesAccepted ? ` (dont ${d.quotesAccepted} acceptée(s))` : ''}</dd></div>
            <div><dt>Délai annoncé (médiane)</dt><dd>${d.medianLeadTimeDays !== null ? `${d.medianLeadTimeDays} j` : 'pas encore d’offre'}</dd></div>
            <div><dt>Capacité totale en stock</dt><dd>${d.totalCapacity.toLocaleString('fr-FR')}</dd></div>
          </dl>
          <p class="xs muted" style="margin:var(--space-3) 0 0">
            Ces chiffres décrivent son historique sur TOUMA. Ils ne garantissent pas une transaction.
          </p>
        </section>
      </div>

      <aside class="stack">
        <section class="card">
          <h2 style="font-size:var(--text-md)">Réputation</h2>
          ${r.published
            ? `<dl class="spec-list">
                ${r.metrics.onTimeRate !== null ? `<div><dt>Livraisons à l’heure</dt><dd>${Math.round(r.metrics.onTimeRate * 100)} %</dd></div>` : ''}
                ${r.metrics.disputeRate !== null ? `<div><dt>Litiges</dt><dd>${Math.round(r.metrics.disputeRate * 100)} %</dd></div>` : ''}
                ${r.metrics.responseRate !== null ? `<div><dt>Réponses aux messages</dt><dd>${Math.round(r.metrics.responseRate * 100)} %</dd></div>` : ''}
                <div><dt>Commandes livrées</dt><dd>${r.ordersDelivered}</dd></div>
              </dl>`
            : `<p class="small muted" style="margin:0">
                Pas encore assez de commandes livrées pour publier des indicateurs (${r.minimumOrders} minimum).
              </p>`}
        </section>

        ${session.user
          ? `<section class="card">
              <h2 style="font-size:var(--text-md)">Entrer en contact</h2>
              <p class="small muted">Posez vos questions avant de commander : délais, conditionnement, capacité réelle.</p>
              <button class="btn btn-block btn-sm" data-contact-store="${esc(d.store.id)}">${svg('inbox')} Contacter ce fournisseur</button>
            </section>`
          : `<section class="card">
              <h2 style="font-size:var(--text-md)">Entrer en contact</h2>
              <p class="small muted" style="margin:0">
                <a href="/touma/connexion" data-link>Connectez-vous</a> pour écrire à ce fournisseur ou le solliciter sur un appel d’offres.
              </p>
            </section>`}
      </aside>
    </div>`;
}

/**
 * Le pays, vu de l'intérieur.
 *
 * Deux écrans que la V17 réclamait et que rien ne montrait : la page publique
 * d'une province, et le tableau de bord national.
 *
 * Une seule règle les gouverne, et c'est celle du §80 : **tout est compté sur
 * des faits**. Une province sans boutique affiche zéro, et c'est précisément
 * l'information utile — elle dit où le produit n'existe pas encore. Une page de
 * province vide est celle qu'on serait le plus tenté de garnir de chiffres
 * plausibles ; c'est pour cela qu'elle affiche son vide en toutes lettres.
 *
 * Deux distinctions sont tenues à l'écran parce qu'elles comptent :
 *
 * - **« Aucune zone déclarée » n'est pas « non desservie ».** L'un est un trou
 *   de configuration, l'autre une décision d'exploitation. Les confondre ferait
 *   croire à un exploitant qu'il a tranché quelque chose qu'il n'a pas vu.
 * - **Aucun délai n'est affiché sans zone.** « Estimation indisponible » est une
 *   réponse ; un délai par défaut est une promesse faite à quelqu'un qui va
 *   attendre un colis.
 */
import { api, esc, emptyState, money, svg } from './core.js';
import { breadcrumb, statCard } from './components.js';
import { layout as adminLayout } from './views-admin.js';

const VERIFICATION = {
  VERIFIED: 'Touma Verified',
  PENDING: 'Vérification en cours',
  UNVERIFIED: '',
  REJECTED: '',
  EXPIRED: 'Vérification expirée',
};

const LOCALITY_TYPE = { CITY: 'Ville', TOWN: 'Bourg', VILLAGE: 'Village', HAMLET: 'Hameau', OTHER: 'Lieu' };

// ── Page publique d'une province ───────────────────────────────────────────

export async function province(params) {
  const data = await api(`/geo/provinces/${encodeURIComponent(params.code)}`);
  const p = data.province;
  const titre = p.nameAr ? `${esc(p.name)} <span dir="rtl" lang="ar" class="muted">${esc(p.nameAr)}</span>` : esc(p.name);

  return `${breadcrumb([
      { label: 'Accueil', href: '/touma/' },
      { label: 'Provinces', href: '/touma/provinces' },
      { label: p.name },
    ])}

    <h1 style="font-size:var(--text-xl)">${titre}</h1>
    <p class="small muted">Province du Tchad · code officiel ${esc(p.code)}</p>

    <div class="grid-3" style="margin:var(--space-4) 0">
      ${statCard('Boutiques actives', String(data.stores.total), data.stores.total === 0 ? 'Aucune boutique ici pour l’instant' : '')}
      ${statCard('Départements', String(p.departmentCount))}
      ${statCard('Localités recensées', p.localityCount.toLocaleString('fr-FR'))}
    </div>

    ${deliveryBlock(data.delivery, data.cashOnDelivery)}

    <h2 style="font-size:var(--text-lg);margin-top:var(--space-5)">Boutiques</h2>
    ${
      data.stores.items.length === 0
        ? emptyState({
            title: 'Aucune boutique dans cette province',
            body: 'C’est une information, pas une erreur : personne n’y vend encore sur TOUMA. Les vendeurs des autres provinces livrent peut-être ici — la question est celle de la desserte, ci-dessus.',
            actionLabel: 'Voir toutes les boutiques',
            actionHref: '/touma/boutiques',
            iconName: 'store',
          })
        : `<div class="grid-3">
            ${data.stores.items
              .map(
                (b) => `<a class="card" href="/touma/boutiques/${esc(b.slug)}" data-link style="display:block;color:inherit;text-decoration:none">
                  <strong>${esc(b.name)}</strong>
                  ${VERIFICATION[b.verificationStatus] ? `<div class="xs" style="color:var(--success)">${svg('shield')} ${esc(VERIFICATION[b.verificationStatus])}</div>` : ''}
                  ${
                    b.ratingCount > 0
                      ? `<div class="small muted">${esc(b.ratingAverage)} / 5 · ${b.ratingCount} avis</div>`
                      : `<div class="small muted">Pas encore d’avis</div>`
                  }
                </a>`,
              )
              .join('')}
          </div>
          ${data.stores.hasMore ? `<p class="small muted">${data.stores.total - data.stores.items.length} autres boutiques dans cette province.</p>` : ''}`
    }

    ${
      data.pickupPoints.length > 0
        ? `<h2 style="font-size:var(--text-lg);margin-top:var(--space-5)">Points relais</h2>
           <div class="stack">
             ${data.pickupPoints
               .map(
                 (r) => `<div class="card">
                   <strong>${esc(r.name)}</strong>
                   <div class="small muted">${esc(r.addressLine)} · ${esc(r.city)}</div>
                 </div>`,
               )
               .join('')}
           </div>`
        : ''
    }

    ${
      data.mainLocalities.length > 0
        ? `<h2 style="font-size:var(--text-lg);margin-top:var(--space-5)">Principales localités</h2>
           <div class="row" style="gap:var(--space-2);flex-wrap:wrap">
             ${data.mainLocalities
               .map(
                 (l) => `<span class="chip">${esc(l.name)}${
                   l.nameAr ? ` <span dir="rtl" lang="ar" class="muted">${esc(l.nameAr)}</span>` : ''
                 } <span class="xs muted">${esc(LOCALITY_TYPE[l.type] ?? l.type)}</span></span>`,
               )
               .join('')}
           </div>`
        : ''
    }

    <p class="small muted" style="margin-top:var(--space-5)">
      Découpage administratif issu de <a href="https://www.geonames.org/" rel="noopener">GeoNames</a> (CC BY 4.0).
      Les sous-préfectures ne figurent dans aucune source ouverte : elles sont absentes plutôt qu’inventées.
    </p>`;
}

function deliveryBlock(delivery, cod) {
  if (!delivery.served && delivery.options.length === 0) {
    return `<div class="alert alert-warning">
      <div>
        <strong>Livraison : estimation indisponible</strong>
        <div class="small">
          Aucune zone de livraison n’est déclarée pour cette province. TOUMA n’affiche pas de délai ni de
          tarif tant qu’un transporteur n’en a pas déclaré : un délai par défaut serait une promesse
          invérifiable.
        </div>
      </div>
    </div>`;
  }

  return `<div class="card">
    <h2 style="font-size:var(--text-base);margin-bottom:var(--space-3)">Livraison</h2>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Service</th><th>Délai annoncé</th><th>Prise en charge</th><th>Par kg</th></tr></thead>
        <tbody>
          ${delivery.options
            .map(
              (o) => `<tr>
                <td>${esc(o.serviceName)}${o.status !== 'SERVED' ? ` <span class="xs muted">(non desservie)</span>` : ''}</td>
                <td>${o.estimatedMinDays}–${o.estimatedMaxDays} jours</td>
                <td>${money(o.basePrice, o.currency)}</td>
                <td>${o.pricePerKg ? money(o.pricePerKg, o.currency) : '—'}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
    <p class="small muted" style="margin-top:var(--space-3)">
      Délais <strong>annoncés par le transporteur</strong>, pas calculés par TOUMA.
      Paiement à la livraison : ${cod.open ? 'ouvert dans cette province' : '<strong>fermé</strong> ici'}.
    </p>
  </div>`;
}

/** Index des provinces : la porte d'entrée des pages par province. */
export async function provinces() {
  const data = await api('/geo/provinces?country=TD');

  return `${breadcrumb([{ label: 'Accueil', href: '/touma/' }, { label: 'Provinces' }])}
    <h1 style="font-size:var(--text-xl)">Les 23 provinces du Tchad</h1>
    <p class="small muted">Chaque province a sa page : boutiques présentes, desserte réelle, points relais.</p>

    <div class="grid-3" style="margin-top:var(--space-4)">
      ${data.items
        .map(
          (p) => `<a class="card" href="/touma/provinces/${esc(p.code)}" data-link style="display:block;color:inherit;text-decoration:none">
            <strong>${esc(p.name)}</strong>
            ${p.nameAr ? `<div dir="rtl" lang="ar" class="small muted">${esc(p.nameAr)}</div>` : ''}
            <div class="xs muted">${p.departmentCount} département${p.departmentCount > 1 ? 's' : ''} · ${p.localityCount.toLocaleString('fr-FR')} localités</div>
          </a>`,
        )
        .join('')}
    </div>`;
}

// ── Tableau de bord national ───────────────────────────────────────────────

export async function national() {
  const data = await api('/admin/geo/national?country=TD');

  const actives = data.rows.filter((r) => r.stores > 0).length;
  const desservies = data.rows.filter((r) => r.delivery?.served).length;
  const sansZone = data.rows.filter((r) => r.delivery === null).length;

  const content = `
    <div class="grid-3" style="margin-bottom:var(--space-4)">
      ${statCard('Provinces couvertes', `${data.provinceCount}`)}
      ${statCard('Avec au moins une boutique', `${actives}`, `${data.provinceCount - actives} sans aucune`)}
      ${statCard('Desservies par un transporteur', `${desservies}`, `${sansZone} sans zone déclarée`)}
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Province</th><th>Boutiques</th><th>Acheteurs</th><th>Points relais</th>
            <th>Livraison</th><th>Paiement livraison</th><th>Ventes</th>
          </tr>
        </thead>
        <tbody>
          ${data.rows
            .map(
              (r) => `<tr>
                <td>
                  <a href="/touma/provinces/${esc(r.province.code)}" data-link>${esc(r.province.name)}</a>
                  ${r.province.nameAr ? `<div dir="rtl" lang="ar" class="xs muted">${esc(r.province.nameAr)}</div>` : ''}
                </td>
                <td${r.stores === 0 ? ' class="muted"' : ''}>${r.stores}</td>
                <td${r.buyerAddresses === 0 ? ' class="muted"' : ''}>${r.buyerAddresses}</td>
                <td${r.pickupPoints === 0 ? ' class="muted"' : ''}>${r.pickupPoints}</td>
                <td>${
                  r.delivery === null
                    ? '<span class="muted">aucune zone déclarée</span>'
                    : r.delivery.served
                      ? `<span style="color:var(--success)">desservie</span> <span class="xs muted">(${r.delivery.zones})</span>`
                      : '<span style="color:var(--warning)">non desservie</span>'
                }</td>
                <td>${r.cashOnDeliveryOpen ? 'ouvert' : '<span class="muted">fermé</span>'}</td>
                <td>${
                  r.revenue.length === 0
                    ? '<span class="muted">—</span>'
                    : r.revenue.map((v) => `${money(v.total, v.currency)} <span class="xs muted">(${v.orderCount})</span>`).join('<br>')
                }</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>

    <div class="alert" style="margin-top:var(--space-4)">
      <div>
        <strong>Comment lire ce tableau</strong>
        <div class="small">
          Tous les chiffres sont comptés sur des faits enregistrés. Une province à zéro n’a réellement aucune
          activité — c’est l’information la plus utile de ce tableau. « Aucune zone déclarée » n’est
          <strong>pas</strong> « non desservie » : l’un est un trou de configuration, l’autre une décision.
          Les montants ne sont jamais additionnés entre devises.
          ${
            data.caveats.ordersWithoutProvince > 0
              ? `<br>${data.caveats.ordersWithoutProvince} commande${data.caveats.ordersWithoutProvince > 1 ? 's' : ''}
                 dont l’adresse n’est rattachée à aucune province ${data.caveats.ordersWithoutProvince > 1 ? 'sont comptées' : 'est comptée'}
                 à part, plutôt que réparties au jugé.`
              : ''
          }
        </div>
      </div>
    </div>`;

  return adminLayout('/touma/admin/national', 'Tableau de bord national', content);
}

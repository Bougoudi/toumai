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
import { t, formatNumber } from './i18n.js';

/**
 * Deux états de vérification ne portent aucun libellé — « non vérifiée » et
 * « refusée » ne s'affichent pas sur une vitrine publique : dire d'une boutique
 * qu'elle a été refusée la condamnerait sans procès sur une page que tout le
 * monde peut lire.
 */
const MENTION_VERIFICATION = new Set(['VERIFIED', 'PENDING', 'EXPIRED']);
const mentionVerification = (statut) => (MENTION_VERIFICATION.has(statut) ? t(`geo.verif.${statut}`) : '');
const typeLocalite = (code) => t(`geo.locality.${code}`);

// ── Page publique d'une province ───────────────────────────────────────────

export async function province(params) {
  const data = await api(`/geo/provinces/${encodeURIComponent(params.code)}`);
  const p = data.province;
  const titre = p.nameAr ? `${esc(p.name)} <span dir="rtl" lang="ar" class="muted">${esc(p.nameAr)}</span>` : esc(p.name);

  return `${breadcrumb([
      { label: t('nav.home'), href: '/touma/' },
      { label: t('geo.provincesCrumb'), href: '/touma/provinces' },
      { label: p.name },
    ])}

    <h1 style="font-size:var(--text-xl)">${titre}</h1>
    <p class="small muted">${esc(t('geo.officialCode', { code: p.code }))}</p>

    <div class="grid-3" style="margin:var(--space-4) 0">
      ${statCard(t('geo.activeStores'), String(data.stores.total), data.stores.total === 0 ? t('geo.noStoreHere') : '')}
      ${statCard(t('geo.departments'), String(p.departmentCount))}
      ${statCard(t('geo.localities'), formatNumber(p.localityCount))}
    </div>

    ${deliveryBlock(data.delivery, data.cashOnDelivery)}

    <h2 style="font-size:var(--text-lg);margin-top:var(--space-5)">${esc(t('geo.stores'))}</h2>
    ${
      data.stores.items.length === 0
        ? emptyState({
            title: t('geo.noStoreTitle'),
            body: t('geo.noStoreBody'),
            actionLabel: t('geo.allStores'),
            actionHref: '/touma/boutiques',
            iconName: 'store',
          })
        : `<div class="grid-3">
            ${data.stores.items
              .map(
                (b) => `<a class="card" href="/touma/boutiques/${esc(b.slug)}" data-link style="display:block;color:inherit;text-decoration:none">
                  <strong>${esc(b.name)}</strong>
                  ${
                    mentionVerification(b.verificationStatus)
                      ? `<div class="xs" style="color:var(--success)">${svg('shield')} ${esc(mentionVerification(b.verificationStatus))}</div>`
                      : ''
                  }
                  ${
                    b.ratingCount > 0
                      ? `<div class="small muted">${esc(t('geo.rating', { average: b.ratingAverage, count: b.ratingCount }))}</div>`
                      : `<div class="small muted">${esc(t('geo.noRating'))}</div>`
                  }
                </a>`,
              )
              .join('')}
          </div>
          ${
            data.stores.hasMore
              ? `<p class="small muted">${esc(t('geo.moreStores', { count: data.stores.total - data.stores.items.length }))}</p>`
              : ''
          }`
    }

    ${
      data.pickupPoints.length > 0
        ? `<h2 style="font-size:var(--text-lg);margin-top:var(--space-5)">${esc(t('geo.pickupPoints'))}</h2>
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
        ? `<h2 style="font-size:var(--text-lg);margin-top:var(--space-5)">${esc(t('geo.mainLocalities'))}</h2>
           <div class="row" style="gap:var(--space-2);flex-wrap:wrap">
             ${data.mainLocalities
               .map(
                 (l) => `<span class="chip">${esc(l.name)}${
                   l.nameAr ? ` <span dir="rtl" lang="ar" class="muted">${esc(l.nameAr)}</span>` : ''
                 } <span class="xs muted">${esc(typeLocalite(l.type))}</span></span>`,
               )
               .join('')}
           </div>`
        : ''
    }

    <p class="small muted" style="margin-top:var(--space-5)">${esc(t('geo.sourceBefore'))}<a href="https://www.geonames.org/" rel="noopener">GeoNames</a>${esc(
      t('geo.sourceAfter'),
    )}</p>`;
}

function deliveryBlock(delivery, cod) {
  if (!delivery.served && delivery.options.length === 0) {
    return `<div class="alert alert-warning">
      <div>
        <strong>${esc(t('geo.noEstimate'))}</strong>
        <div class="small">${esc(t('geo.noEstimateBody'))}</div>
      </div>
    </div>`;
  }

  return `<div class="card">
    <h2 style="font-size:var(--text-base);margin-bottom:var(--space-3)">${esc(t('geo.delivery'))}</h2>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>${esc(t('geo.col.service'))}</th><th>${esc(t('geo.col.announcedDelay'))}</th><th>${esc(
          t('geo.col.pickup'),
        )}</th><th>${esc(t('geo.col.perKg'))}</th></tr></thead>
        <tbody>
          ${delivery.options
            .map(
              (o) => `<tr>
                <td>${esc(o.serviceName)}${o.status !== 'SERVED' ? ` <span class="xs muted">${esc(t('geo.notServedInline'))}</span>` : ''}</td>
                <td>${esc(t('geo.dayRange', { min: o.estimatedMinDays, max: o.estimatedMaxDays }))}</td>
                <td>${money(o.basePrice, o.currency)}</td>
                <td>${o.pricePerKg ? money(o.pricePerKg, o.currency) : '—'}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
    <p class="small muted" style="margin-top:var(--space-3)">
      ${esc(t('geo.carrierAnnounced'))} ${esc(t(cod.open ? 'geo.codOpenHere' : 'geo.codClosedHere'))}
    </p>
  </div>`;
}

/** Index des provinces : la porte d'entrée des pages par province. */
export async function provinces() {
  const data = await api('/geo/provinces?country=TD');

  return `${breadcrumb([{ label: t('nav.home'), href: '/touma/' }, { label: t('geo.provincesCrumb') }])}
    <h1 style="font-size:var(--text-xl)">${esc(t('geo.indexTitle'))}</h1>
    <p class="small muted">${esc(t('geo.indexIntro'))}</p>

    <div class="grid-3" style="margin-top:var(--space-4)">
      ${data.items
        .map(
          (p) => `<a class="card" href="/touma/provinces/${esc(p.code)}" data-link style="display:block;color:inherit;text-decoration:none">
            <strong>${esc(p.name)}</strong>
            ${p.nameAr ? `<div dir="rtl" lang="ar" class="small muted">${esc(p.nameAr)}</div>` : ''}
            <div class="xs muted">${esc(
              t('geo.departmentCount', { departments: p.departmentCount, localities: formatNumber(p.localityCount) }),
            )}</div>
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
      ${statCard(t('geo.provincesCovered'), `${data.provinceCount}`)}
      ${statCard(t('geo.withAtLeastOneStore'), `${actives}`, t('geo.withoutAny', { count: data.provinceCount - actives }))}
      ${statCard(t('geo.servedByCarrier'), `${desservies}`, t('geo.withoutZone', { count: sansZone }))}
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>${esc(t('geo.col.province'))}</th><th>${esc(t('geo.col.stores'))}</th><th>${esc(t('geo.col.buyers'))}</th><th>${esc(
              t('geo.col.pickupPoints'),
            )}</th>
            <th>${esc(t('geo.col.delivery'))}</th><th>${esc(t('geo.col.cod'))}</th><th>${esc(t('geo.col.sales'))}</th>
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
                    ? `<span class="muted">${esc(t('geo.noZoneDeclared'))}</span>`
                    : r.delivery.served
                      ? `<span style="color:var(--success)">${esc(t('geo.served'))}</span> <span class="xs muted">(${r.delivery.zones})</span>`
                      : `<span style="color:var(--warning)">${esc(t('geo.notServed'))}</span>`
                }</td>
                <td>${
                  r.cashOnDeliveryOpen ? esc(t('geo.codOpen')) : `<span class="muted">${esc(t('geo.codClosed'))}</span>`
                }</td>
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
        <strong>${esc(t('geo.howToRead'))}</strong>
        <div class="small">
          ${esc(t('geo.howToReadBody'))}
          ${
            data.caveats.ordersWithoutProvince > 0
              ? `<br>${esc(t('geo.ordersWithoutProvince', { count: data.caveats.ordersWithoutProvince }))}`
              : ''
          }
        </div>
      </div>
    </div>`;

  return adminLayout('/touma/admin/national', t('geo.nationalTitle'), content);
}

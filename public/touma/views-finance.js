/**
 * Finance : ce qui est dû, quand, et pourquoi pas encore.
 *
 * Le moteur de règlement existait entièrement — parts par boutique et par
 * paiement, fenêtre de protection, éligibilité, versements, retenues — et
 * **aucun écran ne le montrait**. Un vendeur voyait ses commandes livrées et
 * n'avait aucun moyen de savoir ce qui lui revenait, quand il serait payé, ni
 * pourquoi un versement tardait. C'est la question la plus anxiogène du métier,
 * et c'était la seule sans réponse.
 *
 * Quatre règles viennent du moteur, et une interface qui les contredirait
 * ferait mentir le produit :
 *
 * - **Les devises ne sont jamais additionnées.** Un solde est rendu par devise.
 *   Un total « toutes devises confondues » serait un chiffre inventé, et c'est
 *   pire qu'une absence de chiffre.
 * - **« Dû » n'est pas « possédé ».** Aucun portefeuille : ces écrans disent ce
 *   qui revient à une boutique, pas ce qu'elle détiendrait chez TOUMA. La
 *   distinction sépare une place de marché d'un établissement de paiement, et
 *   elle doit se lire à l'écran comme elle se lit dans le modèle.
 * - **Rien ne part tout seul.** Une part devient réglable ; elle ne se paie pas
 *   seule. Un humain crée le versement, un humain l'exécute, et les deux sont
 *   nommés.
 * - **Un retard a toujours un motif visible.** Trois conditions, dans l'ordre où
 *   elles échouent : livrée, fenêtre écoulée, aucun litige bloquant. Un
 *   versement retenu sans raison est, du point de vue du vendeur, un vol
 *   silencieux.
 */
import { api, esc, emptyState, formatDate, money, label } from './core.js';
import { statCard } from './components.js';
import { layout as adminLayout } from './views-admin.js';
import { tabs as sellerTabs } from './views-seller.js';
import { t } from './i18n.js';

/**
 * Deux familles de statuts que rien n'autorise à confondre : « PENDING » pour
 * une part de règlement veut dire « fenêtre de protection en cours », pour un
 * versement « à exécuter ». Elles ont donc chacune leurs clés.
 */
const etatPart = (code) => t(`fin.alloc.${code}`);
const etatVersement = (code) => t(`fin.payout.${code}`);

const pill = (value, libelle) => `<span class="status status-${esc(value)}">${esc(libelle)}</span>`;

/**
 * Pourquoi cette part n'est pas encore réglable — dans l'ordre où les
 * conditions échouent, parce que c'est celui qui répond à la question posée.
 */
function whyNotYet(a, protectionDays) {
  if (a.status !== 'PENDING') return '';
  if (a.order?.status !== 'DELIVERED') {
    return t('fin.awaitingDelivery');
  }
  if (a.eligibleAt && new Date(a.eligibleAt).getTime() > Date.now()) {
    return t('fin.eligibleOn', { date: formatDate(a.eligibleAt), days: protectionDays });
  }
  // La part est livrée, la fenêtre est écoulée, et elle n'a pourtant pas
  // basculé : il reste un litige bloquant. Le dire plutôt que laisser le
  // vendeur conclure à une panne.
  return t('fin.disputeBlocks');
}

/** Soldes par devise. Aucun total tous devises confondus : il serait faux. */
function balanceBlock(balances) {
  if (!balances.length) {
    return `<p class="muted">${esc(t('fin.noIncome'))}</p>`;
  }
  return balances
    .map(
      (b) => `<div class="card">
        <div class="row-between" style="margin-bottom:var(--space-3)">
          <strong>${esc(b.currency)}</strong>
        </div>
        <div class="grid-3">
          ${statCard(t('fin.protectionWindow'), money(b.pending, b.currency), t('fin.protectionHint'))}
          ${statCard(t('fin.eligible'), money(b.eligible, b.currency), t('fin.eligibleHint'))}
          ${statCard(t('fin.settled'), money(b.settled, b.currency), t('fin.settledHint'))}
        </div>
      </div>`,
    )
    .join('');
}

/**
 * Le rappel qui empêche de lire ces écrans comme un compte en banque.
 * Il est construit au rendu, et non figé au chargement du module : autrement il
 * resterait dans la langue où la page a été ouverte la première fois.
 */
const notAWallet = () => `<p class="small muted">${esc(t('fin.notAWallet'))}</p>`;

// ── Vendeur ────────────────────────────────────────────────────────────────

export async function sellerFinance() {
  const data = await api('/seller/finance');
  const parts = data.allocations ?? [];

  return `<h1 style="font-size:var(--text-xl)">${esc(t('fin.sellerTitle', { store: data.store.name }))}</h1>
    ${sellerTabs('/touma/vendeur/finance')}
    <div class="row-between" style="margin:var(--space-4) 0">
      <p class="small muted" style="margin:0">${esc(t('fin.sellerIntro'))}</p>
      <a class="btn btn-ghost" href="/touma/vendeur/versements" data-link>${esc(t('fin.myPayouts'))}</a>
    </div>

    <div class="stack">
      ${balanceBlock(data.balances ?? [])}
      ${notAWallet()}

      <h2 style="font-size:var(--text-lg)">${esc(t('fin.byOrder'))}</h2>
      ${
        parts.length === 0
          ? emptyState({
              title: t('fin.noAllocTitle'),
              body: t('fin.noAllocBody'),
              actionLabel: t('fin.mySales'),
              actionHref: '/touma/vendeur/commandes',
              iconName: 'box',
            })
          : `<div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>${esc(t('fin.col.order'))}</th><th>${esc(t('fin.col.gross'))}</th><th>${esc(
                      t('fin.col.commission'),
                    )}</th><th>${esc(t('fin.col.refunded'))}</th><th>${esc(t('fin.col.net'))}</th><th>${esc(t('fin.col.state'))}</th>
                  </tr>
                </thead>
                <tbody>
                  ${parts
                    .map(
                      (a) => `<tr>
                        <td>
                          <strong>${esc(a.order?.orderNumber ?? '—')}</strong>
                          ${(() => {
                            const motif = whyNotYet(a, data.protectionDays);
                            return motif ? `<div class="xs muted">${esc(motif)}</div>` : '';
                          })()}
                        </td>
                        <td>${money(a.grossAmount, a.currency)}</td>
                        <td class="muted">− ${money(a.commissionAmount, a.currency)}</td>
                        <td class="muted">${Number(a.refundedAmount) > 0 ? `− ${money(a.refundedAmount, a.currency)}` : '—'}</td>
                        <td><strong>${money(a.netAmount, a.currency)}</strong></td>
                        <td>${pill(a.status, etatPart(a.status))}</td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
      }

      <p class="small muted">${esc(t('fin.commissionNote'))}</p>
    </div>`;
}

export async function sellerPayouts() {
  const data = await api('/seller/finance/payouts');

  return `<h1 style="font-size:var(--text-xl)">${esc(t('fin.payouts'))}</h1>
    ${sellerTabs('/touma/vendeur/finance')}

    ${
      data.items.length === 0
        ? emptyState({
            title: t('fin.noPayoutTitle'),
            body: t('fin.noPayoutBody'),
            actionLabel: t('fin.seeWhatIsDue'),
            actionHref: '/touma/vendeur/finance',
            iconName: 'box',
          })
        : `<div class="stack">
            ${data.items
              .map(
                (p) => `<div class="card">
                  <div class="row-between">
                    <div style="min-width:0">
                      <strong>${esc(p.reference)}</strong>
                      <div class="small muted">${esc(
                        t('fin.payoutMeta', { count: p.orderCount, date: formatDate(p.createdAt) }),
                      )}</div>
                      ${p.paidAt ? `<div class="xs muted">${esc(t('fin.paidOn', { date: formatDate(p.paidAt, true) }))}</div>` : ''}
                      ${
                        p.holdReason
                          ? `<div class="xs" style="color:var(--warning)">${esc(t('fin.heldReason', { reason: p.holdReason }))}</div>`
                          : ''
                      }
                      ${
                        p.failureReason
                          ? `<div class="xs" style="color:var(--danger)">${esc(t('fin.failureReason', { reason: p.failureReason }))}</div>`
                          : ''
                      }
                    </div>
                    <div class="row" style="gap:var(--space-3)">
                      ${pill(p.status, etatVersement(p.status))}
                      <strong>${money(p.amount, p.currency)}</strong>
                    </div>
                  </div>
                </div>`,
              )
              .join('')}
          </div>`
    }

    <p class="small muted" style="margin-top:var(--space-4)">${esc(t('fin.payoutElsewhere'))}</p>`;
}

// ── Administration ─────────────────────────────────────────────────────────

export async function adminFinance() {
  const data = await api('/admin/finance/overview');

  // Chaque table porte sa propre famille de statuts : « PENDING » ne veut pas
  // dire la même chose pour un paiement, une part et un versement. Le libellé
  // passe donc en argument, au lieu d'afficher le code brut comme avant.
  const table = (titre, lignes, avecTotal = true, libelle = label) => `
    <div class="card">
      <h2 style="font-size:var(--text-base);margin-bottom:var(--space-3)">${esc(titre)}</h2>
      ${
        lignes.length === 0
          ? `<p class="muted small">${esc(t('fin.nothingToShow'))}</p>`
          : `<div class="table-wrap"><table class="table">
              <thead><tr><th>${esc(t('fin.col.state'))}</th><th>${esc(t('fin.col.currency'))}</th><th>${esc(
                t('fin.col.count'),
              )}</th>${avecTotal ? `<th>${esc(t('fin.col.total'))}</th>` : ''}</tr></thead>
              <tbody>
                ${lignes
                  .map(
                    (l) => `<tr>
                      <td>${esc(libelle(l.status))}</td>
                      <td>${esc(l.currency)}</td>
                      <td>${l.count}</td>
                      ${avecTotal ? `<td>${money(l.total, l.currency)}</td>` : ''}
                    </tr>`,
                  )
                  .join('')}
              </tbody>
            </table></div>`
      }
    </div>`;

  return adminLayout(
    '/touma/admin/finance',
    t('fin.adminTitle'),
    `<div class="stack">
      <div class="row-between">
        <p class="small muted" style="margin:0">${esc(t('fin.adminIntro'))}</p>
        <a class="btn btn-ghost" href="/touma/admin/versements" data-link>${esc(t('fin.payouts'))}</a>
      </div>
      ${table(t('fin.tablePayments'), data.payments)}
      ${table(t('fin.tableSettlements'), data.settlements, false, etatPart)}
      ${table(t('fin.tablePayouts'), data.payouts, true, etatVersement)}
      ${table(t('fin.tableRefunds'), data.refunds)}
      <p class="small muted">${esc(data.note)}</p>
    </div>`,
  );
}

export async function adminPayouts(_params, query = {}) {
  const filtre = query.etat ?? '';
  const data = await api(`/admin/finance/payouts${filtre ? `?status=${encodeURIComponent(filtre)}` : ''}`);

  const onglet = (valeur, libelle) =>
    `<a class="chip${filtre === valeur ? ' chip-active' : ''}" href="/touma/admin/versements${
      valeur ? `?etat=${valeur}` : ''
    }" data-link>${esc(libelle)}</a>`;

  return adminLayout(
    '/touma/admin/versements',
    t('fin.payouts'),
    `<div class="row" style="gap:var(--space-2);flex-wrap:wrap;margin:var(--space-3) 0">
      ${onglet('', t('fin.filterAll'))}${onglet('PENDING', t('fin.filterPending'))}${onglet('HELD', t('fin.filterHeld'))}${onglet(
        'PAID',
        t('fin.filterPaid'),
      )}${onglet('FAILED', t('fin.filterFailed'))}
    </div>

    <form class="card" id="payout-create-form" style="margin-bottom:var(--space-4)">
      <h2 style="font-size:var(--text-base);margin-bottom:var(--space-3)">${esc(t('fin.createPayout'))}</h2>
      <p class="small muted" style="margin-bottom:var(--space-3)">${esc(t('fin.createPayoutHint'))}</p>
      <div class="row" style="gap:var(--space-3);flex-wrap:wrap">
        <input class="input" name="storeId" placeholder="${esc(t('fin.storeIdPlaceholder'))}" required style="flex:1;min-width:220px" />
        <input class="input" name="currency" placeholder="${esc(t('fin.currencyPlaceholder'))}" maxlength="3" required style="width:120px" />
        <button class="btn btn-primary" type="submit">${esc(t('fin.create'))}</button>
      </div>
    </form>

    ${
      data.items.length === 0
        ? emptyState({ title: t('fin.noPayoutTitle'), body: t('fin.noMatchingPayout'), iconName: 'box' })
        : `<div class="stack">
            ${data.items
              .map(
                (p) => `<div class="card">
                  <div class="row-between">
                    <div style="min-width:0">
                      <strong>${esc(p.reference)}</strong>
                      <div class="small muted">${esc(
                        t('fin.adminPayoutMeta', { store: p.store.name, count: p.orderCount, date: formatDate(p.createdAt) }),
                      )}</div>
                      ${
                        p.holdReason
                          ? `<div class="xs" style="color:var(--warning)">${esc(t('fin.heldReason', { reason: p.holdReason }))}</div>`
                          : ''
                      }
                    </div>
                    <div class="row" style="gap:var(--space-3)">
                      ${pill(p.status, etatVersement(p.status))}
                      <strong>${money(p.amount, p.currency)}</strong>
                    </div>
                  </div>
                  <div class="row" style="gap:var(--space-2);margin-top:var(--space-3);flex-wrap:wrap">
                    ${
                      p.status === 'PENDING'
                        ? `<button class="btn btn-primary btn-sm" data-payout-process="${esc(p.id)}">${esc(t('fin.recordExecution'))}</button>
                           <button class="btn btn-ghost btn-sm" data-payout-hold="${esc(p.id)}">${esc(t('fin.hold'))}</button>
                           <button class="btn btn-ghost btn-sm" data-payout-cancel="${esc(p.id)}">${esc(t('fin.cancelPayout'))}</button>`
                        : ''
                    }
                    ${p.status === 'HELD' ? `<button class="btn btn-primary btn-sm" data-payout-release="${esc(p.id)}">${esc(t('fin.release'))}</button>` : ''}
                  </div>
                </div>`,
              )
              .join('')}
          </div>`
    }

    <p class="small muted" style="margin-top:var(--space-4)">${esc(t('fin.executionNote'))}</p>`,
  );
}

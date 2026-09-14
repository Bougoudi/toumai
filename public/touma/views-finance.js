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
import { api, esc, emptyState, formatDate, money } from './core.js';
import { statCard } from './components.js';
import { layout as adminLayout } from './views-admin.js';
import { tabs as sellerTabs } from './views-seller.js';

const ALLOCATION_STATUS = {
  PENDING: 'Fenêtre de protection',
  ELIGIBLE: 'Réglable',
  SETTLED: 'Rattachée à un versement',
  CANCELLED: 'Annulée',
};

const PAYOUT_STATUS = {
  PENDING: 'À exécuter',
  PROCESSING: 'En cours',
  PAID: 'Versé',
  HELD: 'Retenu',
  FAILED: 'Échec',
  CANCELLED: 'Annulé',
};

const LEDGER_TYPE = {
  SALE: 'Vente',
  COMMISSION: 'Commission TOUMA',
  REFUND: 'Remboursement',
  COMMISSION_REVERSAL: 'Commission rendue',
  PAYOUT: 'Versement',
  ADJUSTMENT: 'Ajustement',
};

const pill = (value, dict) => `<span class="status status-${esc(value)}">${esc(dict[value] ?? value)}</span>`;

/**
 * Pourquoi cette part n'est pas encore réglable — dans l'ordre où les
 * conditions échouent, parce que c'est celui qui répond à la question posée.
 */
function whyNotYet(a, protectionDays) {
  if (a.status !== 'PENDING') return '';
  if (a.order?.status !== 'DELIVERED') {
    return 'En attente de livraison.';
  }
  if (a.eligibleAt && new Date(a.eligibleAt).getTime() > Date.now()) {
    return `Réglable le ${formatDate(a.eligibleAt)} — fenêtre de protection de ${protectionDays} jours après la livraison.`;
  }
  // La part est livrée, la fenêtre est écoulée, et elle n'a pourtant pas
  // basculé : il reste un litige bloquant. Le dire plutôt que laisser le
  // vendeur conclure à une panne.
  return 'Un litige en cours bloque le règlement de cette commande.';
}

/** Soldes par devise. Aucun total tous devises confondus : il serait faux. */
function balanceBlock(balances) {
  if (!balances.length) {
    return `<p class="muted">Aucun encaissement pour l’instant.</p>`;
  }
  return balances
    .map(
      (b) => `<div class="card">
        <div class="row-between" style="margin-bottom:var(--space-3)">
          <strong>${esc(b.currency)}</strong>
        </div>
        <div class="grid-3">
          ${statCard('Fenêtre de protection', money(b.pending, b.currency), 'Encaissé, pas encore réglable')}
          ${statCard('Réglable', money(b.eligible, b.currency), 'Un versement peut être créé')}
          ${statCard('Déjà versé', money(b.settled, b.currency), 'Rattaché à un versement')}
        </div>
      </div>`,
    )
    .join('');
}

/** Le rappel qui empêche de lire ces écrans comme un compte en banque. */
const NOT_A_WALLET = `<p class="small muted">
  Ces montants disent <strong>ce qui vous revient</strong>, pas une somme détenue pour vous chez TOUMA :
  TOUMA n’est pas un établissement de paiement et ne conserve aucun solde. Les devises ne sont jamais
  additionnées entre elles — sans taux officiel, un total mélangé serait un chiffre inventé.
</p>`;

// ── Vendeur ────────────────────────────────────────────────────────────────

export async function sellerFinance() {
  const data = await api('/seller/finance');
  const parts = data.allocations ?? [];

  return `<h1 style="font-size:var(--text-xl)">Finance — ${esc(data.store.name)}</h1>
    ${sellerTabs('/touma/vendeur/finance')}
    <div class="row-between" style="margin:var(--space-4) 0">
      <p class="small muted" style="margin:0">Ce qui vous revient, et quand.</p>
      <a class="btn btn-ghost" href="/touma/vendeur/versements" data-link>Mes versements</a>
    </div>

    <div class="stack">
      ${balanceBlock(data.balances ?? [])}
      ${NOT_A_WALLET}

      <h2 style="font-size:var(--text-lg)">Par commande</h2>
      ${
        parts.length === 0
          ? emptyState({
              title: 'Aucune part de règlement',
              body: 'Dès qu’une commande est payée, la part qui vous revient apparaît ici — avec la date à laquelle elle devient réglable.',
              actionLabel: 'Mes ventes',
              actionHref: '/touma/vendeur/commandes',
              iconName: 'box',
            })
          : `<div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Commande</th><th>Brut</th><th>Commission</th><th>Remboursé</th><th>Net</th><th>État</th>
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
                        <td>${pill(a.status, ALLOCATION_STATUS)}</td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
      }

      <p class="small muted">
        La commission est prélevée sur ce que vous encaissez réellement : une remise que vous financez la
        réduit, une campagne TOUMA non. Un remboursement diminue la part correspondante — ce qui est rendu
        à l’acheteur n’est plus dû.
      </p>
    </div>`;
}

export async function sellerPayouts() {
  const data = await api('/seller/finance/payouts');

  return `<h1 style="font-size:var(--text-xl)">Versements</h1>
    ${sellerTabs('/touma/vendeur/finance')}

    ${
      data.items.length === 0
        ? emptyState({
            title: 'Aucun versement',
            body: 'Un versement est créé par TOUMA lorsque des parts deviennent réglables. Rien ne part automatiquement : une personne le décide et une personne l’exécute.',
            actionLabel: 'Voir ce qui m’est dû',
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
                      <div class="small muted">${p.orderCount} commande${p.orderCount > 1 ? 's' : ''} · créé le ${formatDate(p.createdAt)}</div>
                      ${p.paidAt ? `<div class="xs muted">Versé le ${formatDate(p.paidAt, true)}</div>` : ''}
                      ${
                        p.holdReason
                          ? `<div class="xs" style="color:var(--warning)">Retenu : ${esc(p.holdReason)}</div>`
                          : ''
                      }
                      ${p.failureReason ? `<div class="xs" style="color:var(--danger)">Échec : ${esc(p.failureReason)}</div>` : ''}
                    </div>
                    <div class="row" style="gap:var(--space-3)">
                      ${pill(p.status, PAYOUT_STATUS)}
                      <strong>${money(p.amount, p.currency)}</strong>
                    </div>
                  </div>
                </div>`,
              )
              .join('')}
          </div>`
    }

    <p class="small muted" style="margin-top:var(--space-4)">
      Un versement marqué « versé » consigne un virement réalisé <strong>ailleurs</strong> — par une banque ou
      un opérateur agréé — avec sa référence et le nom de qui l’a décidé. TOUMA ne transfère pas d’argent
      elle-même.
    </p>`;
}

// ── Administration ─────────────────────────────────────────────────────────

export async function adminFinance() {
  const data = await api('/admin/finance/overview');

  const table = (titre, lignes, avecTotal = true) => `
    <div class="card">
      <h2 style="font-size:var(--text-base);margin-bottom:var(--space-3)">${esc(titre)}</h2>
      ${
        lignes.length === 0
          ? `<p class="muted small">Rien à afficher.</p>`
          : `<div class="table-wrap"><table class="table">
              <thead><tr><th>État</th><th>Devise</th><th>Nombre</th>${avecTotal ? '<th>Total</th>' : ''}</tr></thead>
              <tbody>
                ${lignes
                  .map(
                    (l) => `<tr>
                      <td>${esc(l.status)}</td>
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
    'Finance',
    `<div class="stack">
      <div class="row-between">
        <p class="small muted" style="margin:0">Tout est calculé sur des faits : une ligne absente est une ligne qui n’existe pas.</p>
        <a class="btn btn-ghost" href="/touma/admin/versements" data-link>Versements</a>
      </div>
      ${table('Paiements', data.payments)}
      ${table('Parts de règlement', data.settlements, false)}
      ${table('Versements', data.payouts)}
      ${table('Remboursements', data.refunds)}
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
    'Versements',
    `<div class="row" style="gap:var(--space-2);flex-wrap:wrap;margin:var(--space-3) 0">
      ${onglet('', 'Tous')}${onglet('PENDING', 'À exécuter')}${onglet('HELD', 'Retenus')}${onglet('PAID', 'Versés')}${onglet('FAILED', 'Échecs')}
    </div>

    <form class="card" id="payout-create-form" style="margin-bottom:var(--space-4)">
      <h2 style="font-size:var(--text-base);margin-bottom:var(--space-3)">Créer un versement</h2>
      <p class="small muted" style="margin-bottom:var(--space-3)">
        Regroupe les parts <strong>réglables</strong> d’une boutique dans une devise. Une part en fenêtre de
        protection, ou bloquée par un litige, n’y entre pas.
      </p>
      <div class="row" style="gap:var(--space-3);flex-wrap:wrap">
        <input class="input" name="storeId" placeholder="Identifiant de la boutique" required style="flex:1;min-width:220px" />
        <input class="input" name="currency" placeholder="Devise (XAF)" maxlength="3" required style="width:120px" />
        <button class="btn btn-primary" type="submit">Créer</button>
      </div>
    </form>

    ${
      data.items.length === 0
        ? emptyState({ title: 'Aucun versement', body: 'Aucun versement ne correspond à ce filtre.', iconName: 'box' })
        : `<div class="stack">
            ${data.items
              .map(
                (p) => `<div class="card">
                  <div class="row-between">
                    <div style="min-width:0">
                      <strong>${esc(p.reference)}</strong>
                      <div class="small muted">${esc(p.store.name)} · ${p.orderCount} commande${p.orderCount > 1 ? 's' : ''} · ${formatDate(p.createdAt)}</div>
                      ${p.holdReason ? `<div class="xs" style="color:var(--warning)">Retenu : ${esc(p.holdReason)}</div>` : ''}
                    </div>
                    <div class="row" style="gap:var(--space-3)">
                      ${pill(p.status, PAYOUT_STATUS)}
                      <strong>${money(p.amount, p.currency)}</strong>
                    </div>
                  </div>
                  <div class="row" style="gap:var(--space-2);margin-top:var(--space-3);flex-wrap:wrap">
                    ${
                      p.status === 'PENDING'
                        ? `<button class="btn btn-primary btn-sm" data-payout-process="${esc(p.id)}">Consigner l’exécution</button>
                           <button class="btn btn-ghost btn-sm" data-payout-hold="${esc(p.id)}">Retenir</button>
                           <button class="btn btn-ghost btn-sm" data-payout-cancel="${esc(p.id)}">Annuler</button>`
                        : ''
                    }
                    ${p.status === 'HELD' ? `<button class="btn btn-primary btn-sm" data-payout-release="${esc(p.id)}">Lever la retenue</button>` : ''}
                  </div>
                </div>`,
              )
              .join('')}
          </div>`
    }

    <p class="small muted" style="margin-top:var(--space-4)">
      « Consigner l’exécution » n’envoie aucun argent : TOUMA ne transfère pas de fonds. Le virement est
      réalisé par une banque ou un opérateur agréé, et cette action en enregistre la référence et l’auteur.
      Annuler un versement <strong>rend ses parts</strong> — sans quoi l’annulation ferait disparaître ce qui
      est dû.
    </p>`,
  );
}

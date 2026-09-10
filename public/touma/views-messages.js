/**
 * Messagerie : liste des conversations et fil de discussion.
 */
import { api, esc, formatDate, emptyState, svg } from './core.js';
import { breadcrumb } from './components.js';

export async function inbox() {
  const data = await api('/conversations');
  return `
    ${breadcrumb([{ label: 'Accueil', href: '/touma/' }, { label: 'Messages' }])}
    <h1 style="font-size:var(--text-xl)">Messages</h1>
    ${data.items.length
      ? `<div class="stack">
          ${data.items
            .map(
              (c) => `<a class="card" href="/touma/messages/${esc(c.id)}" data-link style="display:block;color:inherit;text-decoration:none">
                <div class="row-between">
                  <div style="min-width:0">
                    <strong>${esc(c.store?.name ?? c.participants.join(', ') ?? 'Conversation')}</strong>
                    ${c.unread ? '<span class="badge badge-cross">Non lu</span>' : ''}
                    <div class="small muted">${esc(c.subject ?? '')}${c.order ? ` · commande ${esc(c.order.orderNumber)}` : ''}</div>
                    ${c.lastMessage ? `<div class="small" style="margin-top:var(--space-1)">${esc(c.lastMessage.body)}</div>` : ''}
                  </div>
                  <span class="xs muted">${formatDate(c.lastMessageAt, true)}</span>
                </div>
              </a>`,
            )
            .join('')}
        </div>`
      : emptyState({
          title: 'Aucune conversation',
          body: 'Contactez un vendeur depuis une fiche produit ou une commande pour démarrer un échange.',
          actionLabel: 'Explorer le catalogue',
          actionHref: '/touma/produits',
          iconName: 'inbox',
        })}`;
}

export async function thread(params) {
  const data = await api(`/conversations/${params.id}`);
  return `
    ${breadcrumb([{ label: 'Messages', href: '/touma/messages' }, { label: data.store?.name ?? 'Conversation' }])}
    <div class="row-between" style="margin-bottom:var(--space-4)">
      <div>
        <h1 style="font-size:var(--text-lg);margin-bottom:2px">${esc(data.store?.name ?? 'Conversation')}</h1>
        <p class="small muted" style="margin:0">${esc(data.subject ?? '')}</p>
      </div>
      ${data.store ? `<a class="btn btn-secondary btn-sm" href="/touma/boutiques/${esc(data.store.slug)}" data-link>Voir la boutique</a>` : ''}
    </div>

    <div class="card">
      <div class="stack" style="gap:var(--space-3)">
        ${data.messages.length
          ? data.messages
              .map(
                (m) => `<div class="notif-item" data-unread="${!m.mine}" style="${m.mine ? 'background:var(--primary-soft);margin-left:var(--space-8)' : 'margin-right:var(--space-8)'}">
                  <strong>${esc(m.mine ? 'Vous' : m.author.name)}</strong>
                  <p style="white-space:pre-line">${esc(m.body)}</p>
                  ${m.attachments.length
                    ? `<div class="row" style="gap:var(--space-2)">${m.attachments
                        .map((a) => `<a class="badge" href="${esc(a.url)}" rel="noopener noreferrer" target="_blank">${svg('inbox')} ${esc(a.name)}</a>`)
                        .join('')}</div>`
                    : ''}
                  <span class="xs muted">${formatDate(m.createdAt, true)}</span>
                </div>`,
              )
              .join('')
          : '<p class="muted small">Aucun message pour l’instant. Écrivez le premier.</p>'}
      </div>

      <form id="message-form" data-conversation="${esc(data.id)}" class="mt-6">
        <div class="field">
          <label for="m-body">Votre message</label>
          <textarea id="m-body" rows="3" maxlength="4000" required placeholder="Bonjour, quel est le délai pour 200 kg ?"></textarea>
        </div>
        <button class="btn" type="submit">Envoyer</button>
      </form>
    </div>`;
}

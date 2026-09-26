/**
 * TOUMA — noyau de l'application web : session, client d'API, utilitaires
 * d'affichage et composants transverses (toasts, modales, états).
 *
 * Aucune dépendance externe, aucun script en ligne : compatible avec la
 * politique de sécurité du contenu (CSP) du serveur.
 */

import { locale, statusLabel, STATUS_FR, t } from './i18n.js';

export const API = '/api/v1';
const STORAGE = 'touma.session';

// ── Session ────────────────────────────────────────────────────────────────
export const session = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE) || 'null');
    } catch {
      return null;
    }
  },
  write(value) {
    localStorage.setItem(STORAGE, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent('touma:session'));
  },
  clear() {
    localStorage.removeItem(STORAGE);
    window.dispatchEvent(new CustomEvent('touma:session'));
  },
  get user() {
    return this.read()?.user ?? null;
  },
  get role() {
    return this.read()?.user?.role ?? null;
  },
  get isSeller() {
    return ['SELLER', 'ADMIN'].includes(this.role);
  },
  get isAdmin() {
    return this.role === 'ADMIN';
  },
};

// ── Client d'API ───────────────────────────────────────────────────────────
let refreshing = null;

/** Renouvelle le jeton d'accès ; les appels concurrents partagent la promesse. */
async function refreshSession(refreshToken) {
  refreshing =
    refreshing ??
    (async () => {
      try {
        const res = await fetch(`${API}/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          session.clear();
          return false;
        }
        const data = await res.json();
        session.write({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  return refreshing;
}

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Appelle l'API ; réessaie une fois après renouvellement du jeton d'accès. */
/**
 * Client d'API. JSON par défaut ; `contentType` permet d'envoyer un corps brut
 * (import CSV) et `accept` de récupérer un fichier texte (export) sans passer
 * par un lien, qui partirait sans en-tête d'authentification.
 */
export async function api(path, { method = 'GET', body, retry = true, contentType, accept, headers: extra } = {}) {
  const current = session.read();
  const headers = { ...(extra ?? {}) };
  const raw = Boolean(contentType);
  if (body !== undefined) headers['content-type'] = contentType ?? 'application/json';
  if (accept) headers.accept = accept;
  if (current?.accessToken) headers.authorization = `Bearer ${current.accessToken}`;

  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(t('core.offline'), 0);
  }

  if (res.status === 401 && retry && current?.refreshToken) {
    if (await refreshSession(current.refreshToken)) return api(path, { method, body, retry: false, contentType, accept, headers: extra });
  }

  const text = await res.text();
  // Une réponse non-JSON (un CSV) est rendue telle quelle une fois le succès acquis.
  if (res.ok && accept && accept !== 'application/json') return text;

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new ApiError(data?.error || `Erreur ${res.status}`, res.status, data?.details);
  return data;
}

// ── Utilitaires d'affichage ────────────────────────────────────────────────
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Devises sans subdivision courante en Afrique centrale et de l'Ouest. */
const ZERO_DECIMAL = new Set(['XAF', 'XOF']);

/**
 * Formate un montant décimal (transmis en chaîne par l'API). Aucune conversion.
 *
 * **Les chiffres restent latins, même en arabe, et c'est délibéré.** Les
 * chiffres arabo-indiens (٠١٢…) sont d'usage au Tchad, mais un prix est la
 * seule chaîne de l'interface où une lecture ambiguë coûte de l'argent : un
 * acheteur qui hésite sur un montant se trompe de commande. Basculer le système
 * de numération pour les prix est une décision d'exploitation, pas un détail de
 * localisation — elle se prend avec des utilisateurs réels, pas ici.
 *
 * Les dates, elles, suivent la langue : s'y tromper ne coûte rien.
 */
export function money(amount, currency) {
  const decimals = ZERO_DECIMAL.has(currency) ? 0 : 2;
  const value = Number(amount ?? 0);
  const formatted = value.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return currency ? `${formatted} ${currency}` : formatted;
}

export function formatDate(value, withTime = false) {
  if (!value) return '—';
  const options = { day: '2-digit', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(options, { hour: '2-digit', minute: '2-digit' });
  // La date suit la langue de l'interface : un arabophone lit « ١٥ مارس » et
  // non « 15 mars ». Le calendrier reste grégorien, qui est celui de
  // l'administration tchadienne.
  return new Date(value).toLocaleDateString(locale() === 'ar' ? 'ar-TD' : 'fr-FR', options);
}

/** Libellés lisibles des statuts (jamais de constante technique à l'écran). */
export const LABELS = STATUS_FR;


/**
 * Libellé d'un statut serveur.
 *
 * Passe par le dictionnaire de langue : les statuts viennent du serveur sous
 * forme de code (`SHIPPED`, `MOBILE_MONEY`), les mêmes partout, donc les
 * traduire à cet endroit les traduit sur **tous** les écrans d'un coup — y
 * compris ceux dont le reste du texte est encore en français.
 *
 * `LABELS` reste exporté : plusieurs vues l'emploient comme table de référence.
 */
export const label = (value) => statusLabel(value) || value || '';

export function statusPill(value) {
  return `<span class="status status-${esc(value)}">${esc(label(value))}</span>`;
}

/** Jeu d'icônes en ligne (aucune requête réseau supplémentaire). */
export const icon = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.6V21h14V9.6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  cart: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/>',
  box: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  store: '<path d="M4 9h16l-1 11H5z"/><path d="M4 9 6 4h12l2 5"/><path d="M9 13h6"/>',
  truck: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/>',
  shield: '<path d="M12 3 20 6v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  card: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.6-3.6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M4.5 5h15L21 13v6H3v-6z"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  back: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  map: '<path d="m9 4 6 2 5-2v14l-5 2-6-2-5 2V6z"/><path d="M9 4v14M15 6v14"/>',
  // `svg('send')` était employé par l'écran de l'assistant sans que l'icône
  // existe : le bouton d'envoi rendait un `<svg>` vide.
  send: '<path d="M4 12 20 4l-3.5 16-4.5-6z"/><path d="m12 14-8-2"/>',
};

export const svg = (name, cls = '') =>
  `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon[name] ?? ''}</svg>`;

// ── Notifications éphémères ────────────────────────────────────────────────
const MAX_TOASTS = 3;

export function toast(message, kind = 'info') {
  const stack = document.getElementById('toasts');
  if (!stack) return;
  // Jamais d'empilement infini : les plus anciens cèdent la place.
  while (stack.children.length >= MAX_TOASTS) stack.firstElementChild.remove();

  const node = document.createElement('div');
  node.className = `toast toast-${kind}`;
  node.innerHTML = `<span>${esc(message)}</span><button type="button" aria-label="${esc(t('core.close'))}">✕</button>`;
  node.querySelector('button').addEventListener('click', () => node.remove());
  stack.appendChild(node);
  setTimeout(() => node.remove(), kind === 'error' ? 6500 : 4000);
}

// ── Fenêtre modale / confirmation ──────────────────────────────────────────
/** Affiche une confirmation et renvoie `true` si l'utilisateur valide. */
/**
 * Modale de choix : une question, une liste de réponses, un motif libre
 * facultatif. Sert notamment au signalement d'un message.
 */
export function chooseDialog({ title, body, options, withNote = false, confirmLabel = t('action.send') }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const previous = document.activeElement;
    root.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal">
          <h2 id="modal-title">${esc(title)}</h2>
          ${body ? `<p class="muted">${esc(body)}</p>` : ''}
          <div class="field">
            <label for="choose-value">${esc(t('core.reason'))}</label>
            <select id="choose-value">
              ${options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}
            </select>
          </div>
          ${withNote ? `<div class="field"><label for="choose-note">${esc(t('core.noteOptional'))}</label><textarea id="choose-note" rows="2" maxlength="1000"></textarea></div>` : ''}
          <div class="row">
            <button class="btn btn-secondary" data-action="cancel">${esc(t('action.cancel'))}</button>
            <button class="btn" data-action="confirm">${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`;

    const close = (value) => {
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') close(null);
    };
    root.querySelector('[data-action="cancel"]').addEventListener('click', () => close(null));
    root.querySelector('[data-action="confirm"]').addEventListener('click', () =>
      close({
        value: root.querySelector('#choose-value').value,
        note: root.querySelector('#choose-note')?.value.trim() ?? '',
      }),
    );
    root.querySelector('.modal-backdrop').addEventListener('click', (event) => {
      if (event.target.classList.contains('modal-backdrop')) close(null);
    });
    document.addEventListener('keydown', onKey);
    root.querySelector('#choose-value').focus();
  });
}

export function confirmDialog({ title, body, confirmLabel = t('action.confirm'), cancelLabel = t('action.cancel'), danger = false }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const previous = document.activeElement;
    root.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal">
          <h2 id="modal-title">${esc(title)}</h2>
          <p class="muted">${esc(body)}</p>
          <div class="row">
            <button class="btn btn-secondary" data-action="cancel">${esc(cancelLabel)}</button>
            <button class="btn ${danger ? 'btn-danger' : ''}" data-action="confirm">${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`;

    const close = (value) => {
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') close(false);
    };
    root.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
    root.querySelector('[data-action="confirm"]').addEventListener('click', () => close(true));
    root.querySelector('.modal-backdrop').addEventListener('click', (event) => {
      if (event.target.classList.contains('modal-backdrop')) close(false);
    });
    document.addEventListener('keydown', onKey);
    root.querySelector('[data-action="confirm"]').focus();
  });
}

// ── États réutilisables ────────────────────────────────────────────────────
export function loadingState(kind = 'list') {
  if (kind === 'products') {
    return `<div class="grid grid-products">${'<div class="skeleton skeleton-card"></div>'.repeat(8)}</div>`;
  }
  return `<div class="stack" aria-busy="true" aria-live="polite">
    <div class="skeleton skeleton-text" style="width:40%;height:22px"></div>
    <div class="skeleton skeleton-card" style="height:160px"></div>
    <div class="skeleton skeleton-card" style="height:120px"></div>
    <span class="sr-only">${esc(t('core.loadingSr'))}</span>
  </div>`;
}

export function emptyState({ title, body, actionLabel, actionHref, iconName = 'box' }) {
  return `<div class="state">
    <div class="state-icon">${svg(iconName)}</div>
    <h2>${esc(title)}</h2>
    <p>${esc(body)}</p>
    ${actionLabel ? `<div class="row"><a class="btn" href="${esc(actionHref)}" data-link>${esc(actionLabel)}</a></div>` : ''}
  </div>`;
}

export function errorState(error, retryHref = '/touma/') {
  const offline = error?.status === 0;
  return `<div class="state">
    <div class="state-icon">${svg('alert')}</div>
    <h2>${esc(t(offline ? 'core.connectionLost' : 'error.generic'))}</h2>
    <p>${esc(error?.message ?? t('core.unknownError'))}</p>
    <div class="row">
      <button class="btn" data-action="reload">${esc(t('action.retry'))}</button>
      <a class="btn btn-secondary" href="${esc(retryHref)}" data-link>${esc(t('sh.backHome'))}</a>
    </div>
  </div>`;
}

/** Étoiles de notation, accessibles aux lecteurs d'écran. */
export function stars(rating, count) {
  const value = Number(rating ?? 0);
  if (!count) return `<span class="stars xs muted">${esc(t('core.noReview'))}</span>`;
  const full = Math.round(value);
  return `<span class="stars" aria-label="${esc(t('core.ratingAria', { value: value.toFixed(1), count }))}">
    ${'★'.repeat(full)}<span>${'★'.repeat(5 - full)}</span>
    <span class="count">${value.toFixed(1)} (${count})</span>
  </span>`;
}

/** Image de produit : visuel du vendeur, sinon repli graphique (jamais de texte brut). */
export function productImage(url, alt, cls = '') {
  const src = url || '/touma/img/placeholder.svg';
  return `<img class="${cls}" src="${esc(src)}" alt="${esc(alt || t('core.productImageAlt'))}" loading="lazy" decoding="async" />`;
}

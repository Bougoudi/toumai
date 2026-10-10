import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { emailEnabled, sendEmail } from '../../utils/email.js';
import { categoryOf, registerNotificationChannel, type NotificationChannel, type NotificationInput, type NotificationType } from './notifications.js';

/**
 * Canal e-mail des notifications TOUMA.
 *
 * Le métier ne sait rien de ce fichier : il publie un événement, ce canal le
 * met en forme. C'est le premier canal réel de la plateforme — jusqu'ici, une
 * notification ne sortait jamais de l'application.
 *
 * Quatre règles, et elles ne sont pas décoratives :
 *
 *  1. **Rien n'est envoyé sans consentement.** `notify()` ne demande le canal
 *     e-mail que si l'utilisateur l'a activé pour cette catégorie. Le défaut est
 *     « non » : recevoir des e-mails est un choix, pas un réglage à découvrir.
 *  2. **Le contenu de l'e-mail est celui de la notification, pas davantage.**
 *     Pas de reprise du message d'origine, pas de pièce jointe, aucun jeton dans
 *     l'URL. Une boîte e-mail est relue par d'autres yeux que ceux du
 *     destinataire, et un lien porteur de secret y vit éternellement.
 *  3. **Tout ce qui vient d'un humain est échappé.** Le titre et le corps d'une
 *     notification peuvent contenir le nom d'une boutique ou d'un produit, donc
 *     du texte écrit par quelqu'un d'autre.
 *  4. **Un échec d'envoi n'annule jamais l'action métier.** Une commande passée
 *     reste passée si le service d'e-mail est en panne.
 */

/** Où mène la notification, dans l'application. */
const PATH_BY_CATEGORY: Record<string, string> = {
  MESSAGES: '/touma/messages',
  NEGOTIATION: '/touma/negociations',
  RFQ: '/touma/business/appels-offres',
  ORDERS: '/touma/commandes',
  MARKETING: '/touma/',
};

/** Échappement HTML — le même principe que côté navigateur. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Lien vers la page concernée. Renvoie `null` si `PUBLIC_URL` n'est pas
 * configuré : mieux vaut un e-mail sans bouton qu'un bouton vers
 * `http://localhost:3000`, qui ne mène nulle part depuis un téléphone.
 */
export function deepLink(type: NotificationType, data?: Record<string, unknown>, publicUrl = env.publicUrl): string | null {
  const base = publicUrl?.replace(/\/+$/, '');
  if (!base || /^https?:\/\/(localhost|127\.0\.0\.1)/.test(base)) return null;

  const category = categoryOf(type);
  const path = PATH_BY_CATEGORY[category] ?? '/touma/';

  // Un identifiant de conversation ou de négociation précise la destination.
  const id = typeof data?.conversationId === 'string' ? data.conversationId : typeof data?.quoteId === 'string' ? data.quoteId : null;
  // On ne colle que des identifiants : ni jeton, ni signature, ni paramètre
  // repris tel quel d'une entrée utilisateur.
  if (id && /^[A-Za-z0-9_-]{1,64}$/.test(id)) return `${base}${path}/${id}`;
  return `${base}${path}`;
}

/**
 * Met en forme l'e-mail. Fonction pure : c'est elle qu'on teste, plutôt que de
 * vérifier après coup ce qui est parti chez le prestataire.
 *
 * Mise en page volontairement rudimentaire — tableau, styles en ligne, aucune
 * image distante. Les clients de messagerie suppriment les feuilles de style,
 * bloquent les images et redimensionnent tout : ce qui survit partout, c'est un
 * texte lisible et un lien visible.
 */
export function renderNotificationEmail(input: NotificationInput, publicUrl = env.publicUrl): { subject: string; html: string } {
  const link = deepLink(input.type, input.data, publicUrl);
  const preferences = link ? `${publicUrl.replace(/\/+$/, '')}/touma/messages/reglages` : null;

  const bouton = link
    ? `<p style="margin:24px 0"><a href="${esc(link)}" style="background:#0b5d5e;color:#faf8f2;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">Ouvrir dans TOUMA</a></p>`
    : '';

  const pied = preferences
    ? `<p style="margin:24px 0 0;font-size:13px;color:#5d6a6a">Vous recevez cet e-mail parce que vous l'avez demandé pour cette catégorie. <a href="${esc(preferences)}" style="color:#0b5d5e">Changer mes préférences</a>.</p>`
    : `<p style="margin:24px 0 0;font-size:13px;color:#5d6a6a">Vous recevez cet e-mail parce que vous l'avez demandé pour cette catégorie. Vous pouvez le désactiver dans vos préférences de notification.</p>`;

  const html = `<!doctype html>
<html lang="fr"><body style="margin:0;padding:24px;background:#faf8f2;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#172121">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3dccd;border-radius:12px">
    <tr><td style="padding:24px">
      <p style="margin:0 0 4px;font-weight:700;letter-spacing:0.08em;color:#0b5d5e">TOUMA</p>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${esc(input.title)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.6">${esc(input.body)}</p>
      ${bouton}
      ${pied}
    </td></tr>
  </table>
</body></html>`;

  return { subject: `TOUMA — ${input.title}`, html };
}

export const emailNotificationChannel: NotificationChannel = {
  code: 'EMAIL',

  /** Sans clé d'envoi configurée, le canal se déclare absent plutôt qu'en panne. */
  supports() {
    return emailEnabled();
  },

  async deliver(input: NotificationInput): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } });
    // Pas d'adresse : rien à envoyer. Ce n'est pas une erreur à journaliser
    // avec l'identifiant, qui n'apprendrait rien à personne.
    if (!user?.email) return;

    const { subject, html } = renderNotificationEmail(input);
    await sendEmail(user.email, subject, html);
  },
};

/**
 * Branche le canal au démarrage, si et seulement si l'envoi est configuré.
 * Appelé par `createApp()`, comme le stockage des pièces jointes.
 */
export function initNotificationChannels(): void {
  if (emailEnabled()) registerNotificationChannel(emailNotificationChannel);
}

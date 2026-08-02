import { env } from '../config/env.js';
import { logger } from './logger.js';

/** L'envoi d'e-mails est-il configuré (clé Resend présente) ? */
export function emailEnabled(): boolean {
  return env.email.enabled;
}

/**
 * Envoie un e-mail via l'API HTTP de Resend (compatible avec le proxy sortant
 * HTTPS — pas de port SMTP, souvent bloqué en hébergement). Lève une erreur si
 * l'envoi n'est pas configuré ou si Resend refuse la requête.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!env.email.resendApiKey) {
    throw new Error('Envoi d’e-mail non configuré (définissez RESEND_API_KEY).');
  }
  const res = await fetch(env.email.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.email.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.email.from, to: [to], subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.error('Envoi d’e-mail échoué', { status: res.status, body: body.slice(0, 200) });
    throw new Error(`Envoi d’e-mail échoué (${res.status}).`);
  }
  logger.info('E-mail envoyé', { to, subject });
}

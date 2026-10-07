import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { emailEnabled, sendEmail } from '../../utils/email.js';
import { logger } from '../../utils/logger.js';
import { getSettings } from '../settings/settings.service.js';

/**
 * Liste e-mail de la boutique : inscription (pop-up / pied de page) contre un code
 * de bienvenue personnel, utilisable une seule fois à la commande.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I

function newCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `BIENVENUE-${s}`;
}

/** Jeton de désinscription (HMAC de l'e-mail) : pas besoin de stocker de secret par inscrit. */
export function unsubscribeToken(email: string): string {
  return createHmac('sha256', env.auth.jwtSecret).update(`unsub:${email.toLowerCase()}`).digest('base64url').slice(0, 32);
}

export function unsubscribeUrl(email: string): string {
  const base = env.publicUrl.replace(/\/+$/, '');
  return `${base}/boutique/desinscription?e=${encodeURIComponent(email)}&t=${unsubscribeToken(email)}`;
}

export const newsletterService = {
  /** Inscrit (ou retrouve) un e-mail et renvoie son code de bienvenue. */
  async subscribe(rawEmail: string, source: 'popup' | 'footer'): Promise<{ code: string; pct: number; reused: boolean; used: boolean }> {
    const email = rawEmail.trim().toLowerCase();
    const pct = getSettings().newsletterPct;
    const existing = await prisma.subscriber.findUnique({ where: { email } });
    if (existing) {
      if (existing.unsubscribedAt) {
        await prisma.subscriber.update({ where: { id: existing.id }, data: { unsubscribedAt: null, consentAt: new Date() } });
      }
      return { code: existing.code, pct, reused: true, used: !!existing.codeUsedAt };
    }
    let sub = null;
    for (let i = 0; i < 5 && !sub; i++) {
      try {
        sub = await prisma.subscriber.create({ data: { email, code: newCode(), source } });
      } catch (err) {
        // Conflit d'unicité (code déjà tiré, ou inscription simultanée) : on réessaie.
        const again = await prisma.subscriber.findUnique({ where: { email } });
        if (again) return { code: again.code, pct, reused: true, used: !!again.codeUsedAt };
        if (i === 4) throw err;
      }
    }
    logger.info('Nouvelle inscription newsletter', { source });
    if (emailEnabled()) {
      const shop = getSettings();
      sendEmail(
        email,
        `Votre code de bienvenue : -${pct} %`,
        `<p>Bienvenue chez ${shop.shopName} !</p><p>Voici votre code personnel : <strong style="font-size:18px;letter-spacing:2px">${sub!.code}</strong> (-${pct} % sur votre première commande).</p><p>Saisissez-le dans le champ « Code promo » au moment de commander.</p><p style="color:#888;font-size:12px">Vous recevez cet e-mail car vous vous êtes inscrit(e) sur notre boutique. <a href="${unsubscribeUrl(email)}">Se désinscrire</a></p>`,
      ).catch((err) => logger.warn('E-mail de bienvenue non envoyé', { err: err instanceof Error ? err.message : String(err) }));
    }
    return { code: sub!.code, pct, reused: false, used: false };
  },

  /** Code valide et pas encore utilisé → pourcentage de remise ; sinon null. */
  async validCode(raw: string | undefined): Promise<{ id: string; code: string; pct: number } | null> {
    const code = (raw ?? '').trim().toUpperCase();
    if (!code) return null;
    const sub = await prisma.subscriber.findUnique({ where: { code } });
    if (!sub || sub.codeUsedAt) return null;
    return { id: sub.id, code: sub.code, pct: getSettings().newsletterPct };
  },

  /** Marque le code comme utilisé (atomique : échoue s'il vient d'être utilisé ailleurs). */
  async consume(id: string, orderId: string): Promise<boolean> {
    const r = await prisma.subscriber.updateMany({ where: { id, codeUsedAt: null }, data: { codeUsedAt: new Date(), orderId } });
    return r.count === 1;
  },

  async unsubscribe(email: string, token: string): Promise<boolean> {
    const expected = Buffer.from(unsubscribeToken(email));
    const got = Buffer.from(token);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return false;
    await prisma.subscriber.updateMany({ where: { email: email.trim().toLowerCase() }, data: { unsubscribedAt: new Date() } });
    return true;
  },

  async list(take = 200) {
    const [items, total, active] = await Promise.all([
      prisma.subscriber.findMany({ orderBy: { createdAt: 'desc' }, take }),
      prisma.subscriber.count(),
      prisma.subscriber.count({ where: { unsubscribedAt: null } }),
    ]);
    return { items, total, active };
  },
};

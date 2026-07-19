import { env } from '../../config/env.js';
import { stripeClient } from '../../config/stripe.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';

/**
 * Stripe Payouts (via Stripe Connect Express).
 *
 * Modèle : le marchand connecte UN compte Stripe Express (son compte bancaire).
 * Un retrait devient alors un transfert réel de la balance de la plateforme vers
 * ce compte, qui reverse automatiquement l'argent sur le compte bancaire.
 *
 * Sans clé Stripe ou sans compte connecté, on retombe gracieusement sur le
 * mode « manuel » (demande enregistrée en attente) — comme les autres connecteurs.
 */

const ACCOUNT_KEY = 'sys.stripeConnectAccountId';

function stripe() {
  if (!env.stripe.enabled) {
    throw new HttpError(501, 'Stripe non configuré : définissez STRIPE_SECRET_KEY.');
  }
  return stripeClient();
}

/** Lit l'identifiant du compte connecté (stocké dans Setting), ou null. */
async function getAccountId(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: ACCOUNT_KEY } });
  if (!row) return null;
  try {
    const v = JSON.parse(row.value);
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

async function setAccountId(id: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: ACCOUNT_KEY },
    create: { key: ACCOUNT_KEY, value: JSON.stringify(id) },
    update: { value: JSON.stringify(id) },
  });
}

export const payoutService = {
  /** Stripe Payouts est-il utilisable (clé présente) ? */
  configured: () => env.stripe.enabled,

  /**
   * État de la connexion Stripe Payouts.
   * `connected` : un compte Express existe. `payoutsEnabled` : Stripe autorise
   * les versements (onboarding terminé, informations bancaires validées).
   */
  async status() {
    if (!env.stripe.enabled) {
      return { configured: false, connected: false, payoutsEnabled: false, detailsSubmitted: false };
    }
    const accountId = await getAccountId();
    if (!accountId) {
      return { configured: true, connected: false, payoutsEnabled: false, detailsSubmitted: false };
    }
    try {
      const acct = await stripe().accounts.retrieve(accountId);
      return {
        configured: true,
        connected: true,
        accountId,
        payoutsEnabled: !!acct.payouts_enabled,
        detailsSubmitted: !!acct.details_submitted,
      };
    } catch (err) {
      logger.warn('Compte Stripe Connect introuvable', { accountId, err: String(err) });
      return { configured: true, connected: false, payoutsEnabled: false, detailsSubmitted: false };
    }
  },

  /**
   * Démarre (ou reprend) l'onboarding Stripe : crée le compte Express au besoin
   * puis renvoie un lien hébergé où le marchand saisit ses informations bancaires.
   */
  async onboardingLink() {
    if (!env.stripe.enabled) {
      throw new HttpError(501, 'Stripe non configuré : définissez STRIPE_SECRET_KEY.');
    }
    let accountId = await getAccountId();
    if (!accountId) {
      const account = await stripe().accounts.create({
        type: 'express',
        capabilities: { transfers: { requested: true } },
        business_profile: { product_description: 'Ventes e-commerce dropshipping (Toumai)' },
        metadata: { app: 'toumai' },
      });
      accountId = account.id;
      await setAccountId(accountId);
      logger.info('Compte Stripe Connect créé', { accountId });
    }
    const link = await stripe().accountLinks.create({
      account: accountId,
      refresh_url: `${env.publicUrl}/?stripe=refresh`,
      return_url: `${env.publicUrl}/?stripe=return`,
      type: 'account_onboarding',
    });
    return { url: link.url, accountId };
  },

  /**
   * Effectue un versement réel : transfert de la balance plateforme vers le
   * compte Stripe connecté. Renvoie l'identifiant et le statut du transfert.
   * Lève une erreur si Stripe/onboarding ne sont pas prêts (l'appelant peut
   * alors retomber sur le mode manuel).
   */
  async payout(amount: number, currency: string): Promise<{ externalId: string; status: string; destination: string }> {
    const st = await this.status();
    if (!st.configured) throw new HttpError(501, 'Stripe non configuré.');
    if (!st.connected || !st.accountId) throw new HttpError(409, 'Aucun compte Stripe Payouts connecté.');
    if (!st.payoutsEnabled) throw new HttpError(409, 'Onboarding Stripe incomplet : versements non encore autorisés.');

    const transfer = await stripe().transfers.create({
      amount: Math.round(amount * 100),
      currency: currency.toLowerCase(),
      destination: st.accountId,
      metadata: { app: 'toumai', kind: 'withdrawal' },
    });
    logger.info('Transfert Stripe créé', { transferId: transfer.id, amount, currency });
    return { externalId: transfer.id, status: 'PAID', destination: `Stripe ${st.accountId.slice(-6)}` };
  },
};

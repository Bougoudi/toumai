import { env } from '../../config/env.js';
import { IYZICO, initializeCheckoutForm, retrieveCheckoutForm } from '../../config/iyzico.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';

/** Sépare « Prénom Nom » en prénom / nom pour l'acheteur iyzico. */
function splitName(full: string): { name: string; surname: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { name: parts[0] || 'Client', surname: parts[0] || 'Client' };
  return { name: parts.slice(0, -1).join(' '), surname: parts[parts.length - 1] };
}

/** Devise de commande → constante iyzico (repli TRY : iyzico est turc). */
function iyziCurrency(code: string): string {
  const c = code.toUpperCase();
  const supported = IYZICO.CURRENCY as Record<string, string>;
  return supported[c] ?? IYZICO.CURRENCY.TRY;
}

export const iyzicoService = {
  enabled: () => env.iyzico.enabled,

  /**
   * Crée une page de paiement carte hébergée iyzico (« Checkout Form ») pour une
   * commande et renvoie l'URL vers laquelle rediriger le client. Après paiement,
   * iyzico redirige le navigateur vers `callbackUrl` (voir handleCallback).
   */
  async createCheckout(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, customer: true },
    });
    if (!order) throw new HttpError(404, 'Commande introuvable');
    if (order.status !== 'PENDING') {
      throw new HttpError(409, `Commande déjà « ${order.status} », paiement inutile.`);
    }
    if (order.items.length === 0) throw new HttpError(400, 'Commande sans article.');

    const { name, surname } = splitName(order.customer.name);
    const city = order.customer.city || 'Istanbul';
    const country = order.customer.country || 'Turkey';
    const address = order.customer.address || 'N/A';
    const currency = iyziCurrency(order.currency);

    // Les lignes du panier doivent totaliser exactement `price`.
    const basketItems = order.items.map((it) => ({
      id: it.id,
      name: it.product?.name ?? 'Produit',
      category1: 'Général',
      itemType: IYZICO.BASKET_ITEM_TYPE.PHYSICAL,
      price: (it.unitSalePrice * it.quantity).toFixed(2),
    }));
    const price = order.items
      .reduce((s, it) => s + it.unitSalePrice * it.quantity, 0)
      .toFixed(2);

    const request = {
      locale: IYZICO.LOCALE.TR,
      conversationId: order.id,
      price,
      paidPrice: price,
      currency,
      basketId: order.orderNumber,
      paymentGroup: IYZICO.PAYMENT_GROUP.PRODUCT,
      callbackUrl: `${env.publicUrl}/api/payments/iyzico/callback`,
      enabledInstallments: [1],
      buyer: {
        id: order.customer.id,
        name,
        surname,
        gsmNumber: order.customer.phone || '+905350000000',
        email: order.customer.email,
        // TC Kimlik : requis par iyzico. En sandbox, une valeur de test suffit ;
        // en production, l'acheteur la saisit / on la collecte au checkout.
        identityNumber: '11111111111',
        registrationAddress: address,
        city,
        country,
        ip: '85.34.78.112',
      },
      shippingAddress: { contactName: order.customer.name, city, country, address },
      billingAddress: { contactName: order.customer.name, city, country, address },
      basketItems,
    };

    const result = await initializeCheckoutForm(request);
    if (result.status !== 'success') {
      logger.warn('Échec initialisation iyzico', { orderId: order.id, err: result.errorMessage });
      throw new HttpError(502, `iyzico: ${result.errorMessage || 'initialisation refusée.'}`);
    }
    logger.info('Page de paiement iyzico créée', { orderId: order.id, token: result.token });
    return { url: result.paymentPageUrl as string, token: result.token as string };
  },

  /**
   * Traite le retour iyzico (POST du navigateur avec `token`). Relit le paiement
   * côté iyzico (source de vérité) et, si SUCCESS, marque la commande PAID —
   * l'expédition s'enclenche au prochain cycle `fulfillOrders`, et le montant
   * remonte dans le portefeuille.
   * Renvoie le numéro de commande + statut pour la redirection navigateur.
   */
  async handleCallback(token: string | undefined): Promise<{ orderNumber?: string; paid: boolean }> {
    if (!token) throw new HttpError(400, 'Jeton iyzico manquant.');
    const result = await retrieveCheckoutForm(token);
    if (result.status !== 'success') {
      logger.warn('Relecture iyzico échouée', { err: result.errorMessage });
      return { paid: false };
    }
    const orderId = result.conversationId as string | undefined;
    const paid = result.paymentStatus === 'SUCCESS';

    let orderNumber: string | undefined;
    if (orderId) {
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { orderNumber: true } });
      orderNumber = order?.orderNumber;
      if (paid) {
        await prisma.order.updateMany({ where: { id: orderId, status: 'PENDING' }, data: { status: 'PAID' } });
        logger.info('Paiement iyzico confirmé, commande marquée PAID', { orderId, paymentId: result.paymentId });
      }
    }
    return { orderNumber, paid };
  },
};

import Iyzipay from 'iyzipay';
import { env } from './env.js';

/**
 * Fabrique le client iyzico partagé (paiement carte — Turquie).
 *
 * En bac à sable (sandbox), `IYZICO_URI` pointe vers `sandbox-api.iyzipay.com`
 * (gratuit, sans document). En production réelle, mettre `api.iyzipay.com` et
 * les vraies clés fournies par iyzico après ouverture du compte marchand.
 */
let client: Iyzipay | null = null;

export function iyzicoClient(): Iyzipay {
  if (!client) {
    client = new Iyzipay({
      apiKey: env.iyzico.apiKey,
      secretKey: env.iyzico.secretKey,
      uri: env.iyzico.uri,
    });
  }
  return client;
}

/** Constantes iyzico réexportées (locale, devise, groupes…). */
export const IYZICO = {
  LOCALE: Iyzipay.LOCALE,
  CURRENCY: Iyzipay.CURRENCY,
  PAYMENT_GROUP: Iyzipay.PAYMENT_GROUP,
  BASKET_ITEM_TYPE: Iyzipay.BASKET_ITEM_TYPE,
};

/**
 * L'API iyzico est en callback ; on la promisifie pour l'utiliser en async/await.
 */
export function initializeCheckoutForm(request: Record<string, unknown>) {
  return new Promise<any>((resolve, reject) => {
    iyzicoClient().checkoutFormInitialize.create(request, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

export function retrieveCheckoutForm(token: string) {
  return new Promise<any>((resolve, reject) => {
    iyzicoClient().checkoutForm.retrieve(
      { locale: IYZICO.LOCALE.TR, token },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      },
    );
  });
}

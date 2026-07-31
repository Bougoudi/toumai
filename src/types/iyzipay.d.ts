/**
 * Déclarations de types minimales pour le SDK officiel `iyzipay` (CommonJS,
 * sans types fournis). On ne type que ce que Toumai utilise : l'initialisation
 * du « Checkout Form » (page de paiement carte hébergée) et sa relecture.
 */
declare module 'iyzipay' {
  interface IyzipayConfig {
    apiKey: string;
    secretKey: string;
    uri: string;
  }

  type IyzipayCallback = (err: Error | null, result: any) => void;

  interface CheckoutFormInitializeResult {
    status: 'success' | 'failure';
    errorMessage?: string;
    errorCode?: string;
    token?: string;
    /** URL de la page de paiement hébergée iyzico (redirection du client). */
    paymentPageUrl?: string;
    checkoutFormContent?: string;
    tokenExpireTime?: number;
    conversationId?: string;
  }

  interface CheckoutFormRetrieveResult {
    status: 'success' | 'failure';
    errorMessage?: string;
    errorCode?: string;
    /** 'SUCCESS' | 'FAILURE' | 'INIT_THREEDS' ... */
    paymentStatus?: string;
    paymentId?: string;
    price?: string;
    paidPrice?: string;
    currency?: string;
    basketId?: string;
    conversationId?: string;
    token?: string;
  }

  class Iyzipay {
    constructor(config: IyzipayConfig);

    checkoutFormInitialize: {
      create(request: Record<string, unknown>, cb: IyzipayCallback): void;
    };
    checkoutForm: {
      retrieve(request: Record<string, unknown>, cb: IyzipayCallback): void;
    };

    static LOCALE: { TR: 'tr'; EN: 'en' };
    static CURRENCY: {
      TRY: 'TRY'; EUR: 'EUR'; USD: 'USD'; IRR: 'IRR';
      GBP: 'GBP'; NOK: 'NOK'; RUB: 'RUB'; CHF: 'CHF';
    };
    static PAYMENT_GROUP: { PRODUCT: 'PRODUCT'; LISTING: 'LISTING'; SUBSCRIPTION: 'SUBSCRIPTION' };
    static BASKET_ITEM_TYPE: { PHYSICAL: 'PHYSICAL'; VIRTUAL: 'VIRTUAL' };
  }

  export = Iyzipay;
}

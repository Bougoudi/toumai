import { Prisma } from '@prisma/client';

/**
 * Utilitaire monétaire de Touma.
 *
 * Règle absolue : **aucun montant financier n'est un `number` flottant**.
 * Tout passe par `Prisma.Decimal` (précision arbitraire), y compris les
 * additions, multiplications et arrondis. Les `Float` JavaScript perdent des
 * centimes (0.1 + 0.2 ≠ 0.3) : inacceptable pour de l'argent.
 */
export type Money = Prisma.Decimal;

/** Nombre de décimales par devise (XAF/XOF n'ont pas de subdivision courante). */
const CURRENCY_DECIMALS: Record<string, number> = {
  XAF: 0,
  XOF: 0,
  NGN: 2,
  EUR: 2,
  USD: 2,
  GHS: 2,
  KES: 2,
  ZAR: 2,
  MAD: 2,
};

/** Décimales d'une devise (2 par défaut). */
export function currencyDecimals(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

/** Construit un Decimal depuis n'importe quelle entrée (string recommandée). */
export function money(value: Prisma.Decimal | string | number): Money {
  return new Prisma.Decimal(value);
}

export const ZERO: Money = new Prisma.Decimal(0);

/** Somme d'une liste de montants. */
export function sum(values: Array<Prisma.Decimal | string | number>): Money {
  return values.reduce<Money>((acc, v) => acc.plus(money(v)), new Prisma.Decimal(0));
}

/** Multiplie un montant par une quantité entière. */
export function multiply(amount: Prisma.Decimal | string | number, quantity: number): Money {
  return money(amount).times(quantity);
}

/**
 * Arrondit un montant selon les décimales de sa devise (arrondi commercial,
 * moitié supérieure). À appliquer au dernier moment, jamais en cours de calcul.
 */
export function roundTo(amount: Prisma.Decimal | string | number, currency: string): Money {
  return money(amount).toDecimalPlaces(currencyDecimals(currency), Prisma.Decimal.ROUND_HALF_UP);
}

/** Applique un taux (ex. commission 0.05) puis arrondit dans la devise. */
export function applyRate(amount: Prisma.Decimal | string | number, rate: number, currency: string): Money {
  return roundTo(money(amount).times(new Prisma.Decimal(rate.toString())), currency);
}

/** Vrai si le montant est strictement positif. */
export function isPositive(amount: Prisma.Decimal | string | number): boolean {
  return money(amount).greaterThan(0);
}

/** Représentation JSON stable : chaîne, jamais un float. */
export function toJSON(amount: Prisma.Decimal | string | number): string {
  return money(amount).toString();
}

/** Formate un montant pour l'affichage (ex. « 25 000 XAF »). */
export function format(amount: Prisma.Decimal | string | number, currency: string, locale = 'fr-FR'): string {
  const decimals = currencyDecimals(currency);
  const n = Number(money(amount).toFixed(decimals));
  return `${n.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${currency}`;
}

/**
 * Touma ne convertit **jamais** une devise « à peu près ». Tant qu'aucun
 * fournisseur de taux officiel n'est raccordé, une opération multi-devises est
 * refusée explicitement plutôt que produite avec un taux inventé.
 */
export function assertSameCurrency(a: string, b: string): void {
  if (a.toUpperCase() !== b.toUpperCase()) {
    throw new Error(
      `Devises incompatibles (${a} / ${b}) : Touma refuse toute conversion approximative. ` +
        'Raccordez un fournisseur de taux de change officiel avant de mélanger les devises.',
    );
  }
}

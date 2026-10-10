import { Prisma } from '@prisma/client';
import type { PromotionStacking } from '@prisma/client';

/**
 * TOUMA GROWTH — que faire quand plusieurs remises se rencontrent.
 *
 * **Le défaut qu'on évite.** Sans règle explicite, deux promotions qui se
 * chevauchent s'appliquent toutes les deux ou aucune, selon l'ordre dans lequel
 * la base les a rendues. Le même panier donne alors deux totaux différents à
 * deux secondes d'intervalle, et personne ne sait lequel est le bon.
 *
 * **La règle retenue**, dans cet ordre :
 *
 * 1. Une promotion `EXCLUSIVE` gagne seule. La meilleure des exclusives
 *    l'emporte, et elle écarte tout le reste — y compris un code saisi.
 * 2. Sinon, **une seule** `NON_STACKABLE` s'applique : la plus prioritaire,
 *    et à priorité égale la plus avantageuse pour l'acheteur.
 * 3. Les `STACKABLE` s'ajoutent à ce qui précède.
 *
 * **Pourquoi « la plus avantageuse » à égalité de priorité.** Le contraire
 * demanderait à l'acheteur de comprendre un ordre interne pour savoir pourquoi
 * il a eu la moins bonne des deux. À priorité égale, le doute profite à
 * l'acheteur — et le vendeur qui ne le veut pas règle la priorité.
 *
 * Les promotions écartées ne disparaissent pas : elles sont rendues avec la
 * raison de leur mise à l'écart, pour que l'interface puisse l'expliquer.
 */

export interface Candidate<T> {
  promotion: T;
  stacking: PromotionStacking;
  priority: number;
  /** Remise que cette promotion accorderait si elle était retenue. */
  amount: Prisma.Decimal;
}

export interface Excluded<T> {
  promotion: T;
  /** Code de message, traduit à l'affichage. */
  reason: string;
}

export interface Selection<T> {
  applied: Array<Candidate<T>>;
  excluded: Array<Excluded<T>>;
  /** `true` si une promotion exclusive interdit d'appliquer un code. */
  blocksCoupon: boolean;
}

/** Trie du plus prioritaire au moins prioritaire, puis du plus avantageux. */
function meilleur<T>(a: Candidate<T>, b: Candidate<T>): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  return b.amount.comparedTo(a.amount);
}

export function select<T>(candidates: Array<Candidate<T>>): Selection<T> {
  if (candidates.length === 0) return { applied: [], excluded: [], blocksCoupon: false };

  const exclusives = candidates.filter((c) => c.stacking === 'EXCLUSIVE').sort(meilleur);
  const nonCumulables = candidates.filter((c) => c.stacking === 'NON_STACKABLE').sort(meilleur);
  const cumulables = candidates.filter((c) => c.stacking === 'STACKABLE').sort(meilleur);

  if (exclusives.length > 0) {
    const gagnante = exclusives[0];
    const ecartees = [
      ...exclusives.slice(1).map((c) => ({ promotion: c.promotion, reason: 'promo.excluded.otherExclusive' })),
      ...nonCumulables.map((c) => ({ promotion: c.promotion, reason: 'promo.excluded.exclusiveApplied' })),
      ...cumulables.map((c) => ({ promotion: c.promotion, reason: 'promo.excluded.exclusiveApplied' })),
    ];
    return { applied: [gagnante], excluded: ecartees, blocksCoupon: true };
  }

  const applied: Array<Candidate<T>> = [];
  const excluded: Array<Excluded<T>> = [];

  if (nonCumulables.length > 0) {
    applied.push(nonCumulables[0]);
    for (const c of nonCumulables.slice(1)) {
      excluded.push({ promotion: c.promotion, reason: 'promo.excluded.betterNonStackable' });
    }
  }
  applied.push(...cumulables);

  return { applied, excluded, blocksCoupon: false };
}

/**
 * Borne la remise totale au sous-total éligible.
 *
 * **Un total ne peut jamais devenir négatif**, et une remise ne peut jamais
 * dépasser ce sur quoi elle porte. Le cumul de deux promotions légitimes
 * suffit à y arriver ; c'est ici qu'on l'arrête, une fois, plutôt que dans
 * chaque appelant.
 */
export function cap(discount: Prisma.Decimal, eligible: Prisma.Decimal): Prisma.Decimal {
  if (discount.lessThan(0)) return new Prisma.Decimal(0);
  return discount.greaterThan(eligible) ? eligible : discount;
}

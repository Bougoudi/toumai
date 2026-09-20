import { Prisma } from '@prisma/client';
import type { PromotionRuleKind } from '@prisma/client';

/**
 * TOUMA GROWTH — moteur de règles.
 *
 * **Pas d'`eval()`, et ce n'est pas une préférence de style.** Une règle
 * commerciale stockée en chaîne puis évaluée, c'est une exécution de code
 * arbitraire déguisée en paramètre : quiconque peut écrire une promotion peut
 * alors écrire du code. Le moteur ne connaît que les douze genres déclarés
 * dans `PromotionRuleKind`, et une règle qu'il ne reconnaît pas **ne passe
 * pas** — elle n'est pas ignorée.
 *
 * C'est la différence qui compte : ignorer une règle inconnue reviendrait à
 * appliquer une promotion en sautant la condition qui la limitait.
 *
 * **Ni base ni réseau ici.** Le contexte est fourni tout fait, ce qui rend les
 * propriétés du moteur vérifiables sans PostgreSQL — et elles le sont.
 */

/** Ce qu'on sait du panier et de l'acheteur au moment d'évaluer. */
export interface RuleContext {
  /** Montant de marchandise éligible, dans la devise du panier. */
  subtotal: Prisma.Decimal;
  quantity: number;
  currency: string;
  productIds: string[];
  categoryIds: string[];
  storeIds: string[];
  countryCode: string;
  /** Province de livraison, quand elle est connue. */
  provinceId: string | null;
  /** Commandes déjà passées par l'acheteur (hors annulées). */
  previousOrders: number;
  /** Segments auxquels l'acheteur appartient. */
  segments: string[];
  /** Stock disponible sur les produits visés, quand la règle en dépend. */
  stock: number | null;
}

export interface Rule {
  kind: PromotionRuleKind;
  threshold: Prisma.Decimal | null;
  values: string[];
  negated: boolean;
}

/** Pourquoi une règle n'est pas remplie. Rendu à l'acheteur, donc lisible. */
export interface RuleFailure {
  kind: PromotionRuleKind;
  /** Code de message, traduit à l'affichage — jamais une phrase en dur. */
  reason: string;
  detail: Record<string, unknown>;
}

const intersecte = (a: string[], b: string[]) => a.some((x) => b.includes(x));

/**
 * Évalue une règle. Rend `null` si elle est remplie, sinon la raison.
 *
 * La négation s'applique **après** : « sauf ces catégories » est la même
 * mesure, lue à l'envers.
 */
function evaluerUne(rule: Rule, ctx: RuleContext): RuleFailure | null {
  const echec = (reason: string, detail: Record<string, unknown> = {}): RuleFailure => ({
    kind: rule.kind,
    reason,
    detail,
  });

  let remplie: boolean;
  let raison = 'promo.fail.generic';
  let detail: Record<string, unknown> = {};

  switch (rule.kind) {
    case 'MIN_ORDER_AMOUNT': {
      const seuil = rule.threshold ?? new Prisma.Decimal(0);
      remplie = ctx.subtotal.greaterThanOrEqualTo(seuil);
      raison = 'promo.fail.minOrderAmount';
      detail = { required: seuil.toString(), current: ctx.subtotal.toString(), currency: ctx.currency };
      break;
    }
    case 'MIN_QUANTITY': {
      const seuil = Number(rule.threshold ?? 0);
      remplie = ctx.quantity >= seuil;
      raison = 'promo.fail.minQuantity';
      detail = { required: seuil, current: ctx.quantity };
      break;
    }
    case 'PRODUCT':
      remplie = rule.values.length === 0 || intersecte(ctx.productIds, rule.values);
      raison = 'promo.fail.product';
      break;
    case 'CATEGORY':
      remplie = rule.values.length === 0 || intersecte(ctx.categoryIds, rule.values);
      raison = 'promo.fail.category';
      break;
    case 'SELLER':
      remplie = rule.values.length === 0 || intersecte(ctx.storeIds, rule.values);
      raison = 'promo.fail.seller';
      break;
    case 'COUNTRY':
      remplie = rule.values.length === 0 || rule.values.includes(ctx.countryCode);
      raison = 'promo.fail.country';
      detail = { country: ctx.countryCode };
      break;
    case 'PROVINCE':
      // Une province inconnue ne remplit pas une règle de province. Deviner
      // reviendrait à accorder une promotion locale à une livraison dont on
      // ignore la destination.
      remplie = rule.values.length === 0 || (ctx.provinceId !== null && rule.values.includes(ctx.provinceId));
      raison = 'promo.fail.province';
      break;
    case 'FIRST_ORDER':
      remplie = ctx.previousOrders === 0;
      raison = 'promo.fail.firstOrder';
      detail = { previousOrders: ctx.previousOrders };
      break;
    case 'NEW_CUSTOMER':
      remplie = ctx.segments.includes('NEW_CUSTOMER');
      raison = 'promo.fail.newCustomer';
      break;
    case 'CUSTOMER_SEGMENT':
      remplie = rule.values.length === 0 || intersecte(ctx.segments, rule.values);
      raison = 'promo.fail.segment';
      break;
    case 'MIN_STOCK': {
      const seuil = Number(rule.threshold ?? 0);
      // Stock inconnu : la règle n'est **pas** remplie. Supposer le stock
      // suffisant ferait tourner une promotion sur un article épuisé.
      remplie = ctx.stock !== null && ctx.stock >= seuil;
      raison = 'promo.fail.minStock';
      detail = { required: seuil, current: ctx.stock };
      break;
    }
    case 'MAX_STOCK': {
      const seuil = Number(rule.threshold ?? 0);
      remplie = ctx.stock !== null && ctx.stock <= seuil;
      raison = 'promo.fail.maxStock';
      detail = { limit: seuil, current: ctx.stock };
      break;
    }
    default: {
      // Genre inconnu : la promotion ne s'applique pas. L'ignorer reviendrait
      // à sauter la condition qui la limitait.
      const jamaisVu: never = rule.kind;
      return echec('promo.fail.unknownRule', { kind: String(jamaisVu) });
    }
  }

  const finale = rule.negated ? !remplie : remplie;
  if (finale) return null;
  return echec(rule.negated ? `${raison}.negated` : raison, detail);
}

/**
 * Évalue toutes les règles d'une promotion.
 *
 * Toutes doivent être remplies — un ET, jamais un OU implicite. Un OU se
 * modélise par deux promotions, ce qui reste lisible ; un OU caché dans un
 * moteur ne l'est pas.
 */
export function evaluate(rules: Rule[], ctx: RuleContext): { applicable: boolean; failures: RuleFailure[] } {
  const failures: RuleFailure[] = [];
  for (const rule of rules) {
    const echec = evaluerUne(rule, ctx);
    if (echec) failures.push(echec);
  }
  return { applicable: failures.length === 0, failures };
}

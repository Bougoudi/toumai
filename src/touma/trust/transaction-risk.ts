import type { TransactionRiskDecision, TransactionRiskLevel } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * TOUMA TRUST — risque d'une transaction.
 *
 * **La règle qui commande tout le fichier.** Un score probabiliste ne bloque
 * jamais une commande à lui seul (§17). Une décision `BLOCK` n'est rendue que
 * par une **règle nommée** portant sur un fait certain — un compte banni, un
 * vendeur dont la boutique est suspendue. Le reste du score module une décision
 * douce : laisser passer, demander une vérification, retenir le versement,
 * faire relire.
 *
 * La distinction n'est pas théorique. Un acheteur de N'Djamena qui commande
 * pour la première fois, de nuit, un article cher, coche trois cases de risque
 * sans rien faire de mal. Le bloquer serait perdre un client honnête ; retarder
 * le versement au vendeur le temps de la livraison protège tout le monde sans
 * accuser personne.
 *
 * **Ce qui n'entre pas dans le calcul.** Ni la nationalité, ni l'origine, ni la
 * province de l'acheteur. Le pays n'intervient que pour ce qu'il détermine
 * réellement — le corridor de livraison et la devise — et jamais comme
 * substitut de confiance personnelle (§38).
 */

export const RISK_FACTOR_WEIGHTS: Record<string, number> = {
  /** Premier achat d'un compte créé il y a moins de 24 h. */
  BRAND_NEW_ACCOUNT: 15,
  /** Montant très au-dessus de l'habitude de l'acheteur. */
  UNUSUAL_AMOUNT: 20,
  /** Score de risque du compte déjà élevé (signaux de fraude). */
  BUYER_RISK_SIGNALS: 25,
  /** Le vendeur n'est pas vérifié et n'a pas d'antériorité. */
  UNVERIFIED_NEW_SELLER: 15,
  /** Paiement à la livraison : l'argent n'est pas encaissé au départ. */
  CASH_ON_DELIVERY: 10,
  /** Livraison hors du pays du vendeur — plus de mains, plus d'aléas. */
  CROSS_BORDER: 10,
  /** Adresse de livraison jamais utilisée par ce compte. */
  NEW_SHIPPING_ADDRESS: 5,
};

const NIVEAUX: Array<{ level: TransactionRiskLevel; min: number }> = [
  { level: 'CRITICAL', min: 75 },
  { level: 'HIGH', min: 50 },
  { level: 'MEDIUM', min: 25 },
  { level: 'LOW', min: 0 },
];

export interface RiskFactor {
  code: string;
  label: string;
  weight: number;
  detail: Record<string, unknown>;
}

export interface RiskAssessment {
  score: number;
  level: TransactionRiskLevel;
  decision: TransactionRiskDecision;
  factors: RiskFactor[];
  /** Règle nommée ayant imposé la décision, quand il y en a une. */
  rule: string | null;
}

function levelFor(score: number): TransactionRiskLevel {
  return NIVEAUX.find((n) => score >= n.min)?.level ?? 'LOW';
}

/**
 * Décision à partir du niveau. `BLOCK` n'y figure pas : seule une règle
 * certaine peut l'imposer, et elle est appliquée avant d'arriver ici.
 */
function decisionFor(level: TransactionRiskLevel): TransactionRiskDecision {
  switch (level) {
    case 'CRITICAL':
      return 'REVIEW';
    case 'HIGH':
      return 'HOLD';
    case 'MEDIUM':
      return 'REQUIRE_VERIFICATION';
    default:
      return 'ALLOW';
  }
}

export interface TransactionContext {
  buyerId: string;
  storeId: string;
  amount: number;
  currency: string;
  /**
   * Moyen de paiement, **quand il est connu**.
   *
   * Il ne l'est pas au passage de commande : TOUMA crée la commande d'abord et
   * le paiement ensuite. Laissé à `undefined`, le facteur « paiement à la
   * livraison » n'est simplement pas mesuré — il n'est pas supposé absent. La
   * distinction compte : supposer qu'il n'y a pas de COD reviendrait à noter
   * une transaction plus sûre qu'elle ne l'est.
   */
  paymentMethod?: string;
  destinationCountry: string;
  shippingAddressId?: string | null;
}

/**
 * Évalue une transaction. Lecture seule : l'appelant décide quoi en faire, et
 * `record()` la consigne une fois la commande créée.
 */
export async function assessTransaction(context: TransactionContext): Promise<RiskAssessment> {
  if (!env.touma.trust.transactionRiskEnabled) {
    return { score: 0, level: 'LOW', decision: 'ALLOW', factors: [], rule: 'DISABLED' };
  }

  const [buyer, standing, store, historique, risk] = await Promise.all([
    prisma.user.findUnique({ where: { id: context.buyerId }, select: { createdAt: true, status: true } }),
    prisma.toumaAccountStanding.findUnique({ where: { userId: context.buyerId }, select: { status: true } }),
    prisma.toumaStore.findUnique({
      where: { id: context.storeId },
      select: { countryCode: true, status: true, verificationStatus: true, reputation: { select: { ordersDelivered: true } } },
    }),
    prisma.toumaOrder.findMany({
      where: { buyerId: context.buyerId, paidAt: { not: null } },
      select: { total: true, shippingAddressId: true },
      take: 50,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.toumaRiskScore.findUnique({ where: { userId: context.buyerId }, select: { score: true } }),
  ]);

  // ── Règles certaines : elles priment, et elles seules peuvent bloquer ─────
  if (standing?.status === 'BANNED') {
    return {
      score: 100,
      level: 'CRITICAL',
      decision: 'BLOCK',
      factors: [{ code: 'ACCOUNT_BANNED', label: 'Compte banni', weight: 100, detail: {} }],
      rule: 'ACCOUNT_BANNED',
    };
  }
  if (buyer?.status === 'SUSPENDED' || standing?.status === 'SUSPENDED') {
    return {
      score: 100,
      level: 'CRITICAL',
      decision: 'BLOCK',
      factors: [{ code: 'ACCOUNT_SUSPENDED', label: 'Compte suspendu', weight: 100, detail: {} }],
      rule: 'ACCOUNT_SUSPENDED',
    };
  }
  if (store && store.status !== 'ACTIVE') {
    return {
      score: 100,
      level: 'CRITICAL',
      decision: 'BLOCK',
      factors: [{ code: 'STORE_INACTIVE', label: 'Boutique fermée', weight: 100, detail: { status: store.status } }],
      rule: 'STORE_INACTIVE',
    };
  }

  // ── Facteurs pondérés : ils modulent, ils n'excluent pas ──────────────────
  const factors: RiskFactor[] = [];
  const add = (code: string, label: string, detail: Record<string, unknown>) =>
    factors.push({ code, label, weight: RISK_FACTOR_WEIGHTS[code] ?? 1, detail });

  if (buyer) {
    const ageHeures = (Date.now() - buyer.createdAt.getTime()) / 3_600_000;
    if (ageHeures < 24 && historique.length === 0) {
      add('BRAND_NEW_ACCOUNT', 'Compte créé il y a moins de 24 h, premier achat', {
        accountAgeHours: Math.round(ageHeures),
      });
    }
  }

  if (historique.length >= 3) {
    const montants = historique.map((o) => Number(o.total));
    const moyenne = montants.reduce((a, b) => a + b, 0) / montants.length;
    if (moyenne > 0 && context.amount > moyenne * 5) {
      add('UNUSUAL_AMOUNT', 'Montant très supérieur aux achats habituels', {
        amount: context.amount,
        averagePastAmount: Math.round(moyenne),
      });
    }
  }

  if (risk && risk.score >= 30) {
    add('BUYER_RISK_SIGNALS', 'Signaux de fraude déjà enregistrés sur ce compte', { riskScore: risk.score });
  }

  if (store) {
    const livrees = store.reputation?.ordersDelivered ?? 0;
    if (store.verificationStatus !== 'APPROVED' && livrees < 5) {
      add('UNVERIFIED_NEW_SELLER', 'Vendeur ni vérifié ni installé', {
        verificationStatus: store.verificationStatus,
        ordersDelivered: livrees,
      });
    }
    if (store.countryCode !== context.destinationCountry) {
      // Le pays sert ici à ce qu'il détermine vraiment : un colis qui franchit
      // une frontière passe par plus de mains. Ce n'est pas un jugement sur
      // l'acheteur.
      add('CROSS_BORDER', 'Livraison transfrontalière', {
        from: store.countryCode,
        to: context.destinationCountry,
      });
    }
  }

  if (context.paymentMethod === 'CASH_ON_DELIVERY') {
    add('CASH_ON_DELIVERY', 'Paiement à la livraison : rien n’est encaissé au départ', {});
  }

  if (context.shippingAddressId && historique.length > 0) {
    const connues = new Set(historique.map((o) => o.shippingAddressId).filter(Boolean));
    if (connues.size > 0 && !connues.has(context.shippingAddressId)) {
      add('NEW_SHIPPING_ADDRESS', 'Adresse de livraison jamais utilisée par ce compte', {});
    }
  }

  const score = Math.min(100, factors.reduce((acc, f) => acc + f.weight, 0));
  const level = levelFor(score);
  return { score, level, decision: decisionFor(level), factors, rule: null };
}

/** Consigne l'évaluation d'une commande créée. Ne fait jamais échouer l'appelant. */
export async function recordTransactionRisk(orderId: string, assessment: RiskAssessment) {
  try {
    await prisma.toumaTransactionRisk.upsert({
      where: { orderId },
      create: {
        orderId,
        score: assessment.score,
        level: assessment.level,
        decision: assessment.decision,
        factors: assessment.factors as unknown as Prisma.InputJsonValue,
      },
      update: {
        score: assessment.score,
        level: assessment.level,
        decision: assessment.decision,
        factors: assessment.factors as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // Une commande ne doit pas échouer parce que sa trace de risque n'a pas pu
    // être écrite. La trace est précieuse ; la commande l'est davantage.
    logger.error('Risque de transaction non consigné', { orderId, err: String(err) });
  }
}

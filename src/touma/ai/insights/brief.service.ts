import { Prisma } from '@prisma/client';
import { prisma } from '../../../db/prisma.js';
import { demandIntelligence } from './demand.service.js';

/**
 * BILANS D'ACTIVITÉ (§52).
 *
 * Trois bilans : quotidien, hebdomadaire, et par vendeur. Tous bâtis sur le
 * même squelette, qui est celui que §52 demande :
 *
 *   observed   — ce qui a été mesuré
 *   changes    — ce qui a varié par rapport à la période précédente
 *   anomalies  — ce qui sort de l'ordinaire, chiffré
 *   questions  — ce qu'il faudrait aller regarder
 *
 * `questions` remplace la rubrique « explications possibles » du cahier des
 * charges, et c'est délibéré : une explication possible écrite par une machine
 * qui ne connaît que la base se lit comme une explication. Une question se lit
 * comme une question. « Les ventes ont baissé de 30 % — vérifier s'il y a eu
 * une rupture de stock » est utile ; « les ventes ont baissé parce qu'il y a
 * eu une rupture » serait faux une fois sur deux.
 *
 * Aucune devise n'est additionnée à une autre (V20).
 */

export interface Bilan {
  scope: 'PLATFORM' | 'SELLER';
  periodDays: number;
  from: Date;
  to: Date;
  observed: Record<string, unknown>;
  changes: string[];
  anomalies: string[];
  questions: string[];
  unavailable: string[];
}

function variation(courant: number, precedent: number): number | null {
  if (precedent === 0) return null;
  return Number((((courant - precedent) / precedent) * 100).toFixed(1));
}

/** Somme par devise. Jamais un total unique. */
function parDevise(lignes: Array<{ total: Prisma.Decimal; currency: string; status: string }>) {
  const carte = new Map<string, { revenue: Prisma.Decimal; orders: number }>();
  for (const l of lignes) {
    if (l.status === 'CANCELLED') continue;
    const e = carte.get(l.currency) ?? { revenue: new Prisma.Decimal(0), orders: 0 };
    e.revenue = e.revenue.plus(l.total);
    e.orders += 1;
    carte.set(l.currency, e);
  }
  return [...carte.entries()].map(([currency, e]) => ({
    currency,
    revenue: e.revenue.toString(),
    orders: e.orders,
    averageOrderValue: e.orders > 0 ? e.revenue.dividedBy(e.orders).toFixed(2) : null,
  }));
}

async function commandes(where: Prisma.ToumaOrderWhereInput, debut: Date, fin: Date) {
  return prisma.toumaOrder.findMany({
    where: { ...where, createdAt: { gte: debut, lt: fin } },
    select: { total: true, currency: true, status: true },
  });
}

export const briefService = {
  /**
   * Bilan de plateforme. `days = 1` donne le bilan quotidien, `7` celui de la
   * semaine — une seule fonction, parce que la seule différence est la fenêtre
   * et qu'en écrire deux les ferait diverger au premier changement.
   */
  async platform(days: number): Promise<Bilan> {
    const fin = new Date();
    const debut = new Date(fin.getTime() - days * 86_400_000);
    const debutPrecedent = new Date(debut.getTime() - days * 86_400_000);

    const [courantes, precedentes, nouveauxComptes, nouvellesBoutiques, litiges, litigesPrecedents, paiementsEchoues, termes] = await Promise.all([
      commandes({}, debut, fin),
      commandes({}, debutPrecedent, debut),
      prisma.user.count({ where: { createdAt: { gte: debut } } }),
      prisma.toumaStore.count({ where: { createdAt: { gte: debut } } }),
      prisma.toumaDispute.count({ where: { createdAt: { gte: debut } } }),
      prisma.toumaDispute.count({ where: { createdAt: { gte: debutPrecedent, lt: debut } } }),
      prisma.toumaPayment.count({ where: { createdAt: { gte: debut }, status: 'FAILED' } }),
      demandIntelligence.topTerms(days, 5),
    ]);

    const annulees = courantes.filter((c) => c.status === 'CANCELLED').length;
    const changes: string[] = [];
    const anomalies: string[] = [];
    const questions: string[] = [];

    const v = variation(courantes.length, precedentes.length);
    if (v === null) {
      changes.push(`${courantes.length} commande(s) sur ${days} jour(s) ; aucune sur la période précédente, donc aucune comparaison possible.`);
    } else {
      changes.push(`Commandes : ${precedentes.length} → ${courantes.length} (${v > 0 ? '+' : ''}${v} %).`);
      if (Math.abs(v) >= 30) {
        anomalies.push(`Le volume de commandes a varié de ${Math.abs(v).toFixed(0)} % d’une période à l’autre.`);
        questions.push('Vérifier s’il y a eu une rupture de stock, une panne de paiement, ou une campagne en cours sur la période.');
      }
    }

    if (courantes.length > 0 && annulees / courantes.length > 0.15) {
      anomalies.push(`${annulees} commande(s) annulée(s) sur ${courantes.length}, soit ${((annulees / courantes.length) * 100).toFixed(0)} %.`);
      questions.push('Regarder qui annule — acheteur, vendeur ou système — et sur quelles boutiques.');
    }

    const vLitiges = variation(litiges, litigesPrecedents);
    if (vLitiges !== null && vLitiges >= 50 && litiges >= 3) {
      anomalies.push(`Les litiges ouverts ont augmenté de ${vLitiges.toFixed(0)} % (${litigesPrecedents} → ${litiges}).`);
      questions.push('Identifier si les litiges se concentrent sur une boutique, un corridor ou un mode de livraison.');
    }

    if (paiementsEchoues > 0) {
      questions.push(`Examiner les ${paiementsEchoues} paiement(s) en échec : par méthode et par prestataire.`);
    }

    const jamaisTrouves = termes.items.filter((t) => t.neverMatched);
    if (jamaisTrouves.length > 0) {
      questions.push(`Des acheteurs ont cherché ${jamaisTrouves.map((t) => `« ${t.term} »`).join(', ')} sans jamais rien trouver.`);
    }

    return {
      scope: 'PLATFORM',
      periodDays: days,
      from: debut,
      to: fin,
      observed: {
        orders: courantes.length,
        cancelled: annulees,
        byCurrency: parDevise(courantes),
        newAccounts: nouveauxComptes,
        newStores: nouvellesBoutiques,
        disputesOpened: litiges,
        failedPayments: paiementsEchoues,
        topSearchTerms: termes.items,
      },
      changes,
      anomalies,
      questions,
      unavailable: [
        'la cause des variations, qui ne se lit pas dans la base',
        'les vues produit et les ajouts au panier, qui ne sont pas journalisés',
      ],
    };
  },

  /** Bilan d'une boutique. L'appelant a déjà vérifié qu'elle lui appartient. */
  async seller(storeId: string, days: number): Promise<Bilan> {
    const fin = new Date();
    const debut = new Date(fin.getTime() - days * 86_400_000);
    const debutPrecedent = new Date(debut.getTime() - days * 86_400_000);

    const [courantes, precedentes, produits, litiges] = await Promise.all([
      commandes({ storeId }, debut, fin),
      commandes({ storeId }, debutPrecedent, debut),
      prisma.toumaProduct.findMany({
        where: { storeId, status: 'ACTIVE' },
        select: { id: true, title: true, inventory: { select: { quantity: true } } },
      }),
      prisma.toumaDispute.count({ where: { order: { storeId }, createdAt: { gte: debut } } }),
    ]);

    const ruptures = produits.filter((p) => p.inventory.reduce((a, i) => a + i.quantity, 0) <= 0);
    const annulees = courantes.filter((c) => c.status === 'CANCELLED').length;

    const changes: string[] = [];
    const anomalies: string[] = [];
    const questions: string[] = [];

    const v = variation(courantes.length, precedentes.length);
    changes.push(
      v === null
        ? `${courantes.length} commande(s) sur ${days} jour(s) ; aucune sur la période précédente.`
        : `Commandes : ${precedentes.length} → ${courantes.length} (${v > 0 ? '+' : ''}${v} %).`,
    );

    if (ruptures.length > 0) {
      anomalies.push(`${ruptures.length} produit(s) actif(s) en rupture : ${ruptures.slice(0, 5).map((p) => p.title).join(', ')}${ruptures.length > 5 ? '…' : ''}`);
      questions.push('Un produit actif en rupture continue d’être affiché : le réapprovisionner ou le retirer de la vente.');
    }
    if (courantes.length > 0 && annulees / courantes.length > 0.15) {
      anomalies.push(`${annulees} annulation(s) sur ${courantes.length} commande(s).`);
    }
    if (litiges > 0) questions.push(`${litiges} litige(s) ouvert(s) sur la période : y répondre dans les délais évite la décision par défaut.`);
    if (v !== null && v <= -30) {
      questions.push('La baisse peut venir d’une rupture, d’un prix, d’un concurrent ou d’une saison : la base ne le dit pas, mais l’historique de prix et le stock se vérifient.');
    }

    return {
      scope: 'SELLER',
      periodDays: days,
      from: debut,
      to: fin,
      observed: {
        orders: courantes.length,
        cancelled: annulees,
        byCurrency: parDevise(courantes),
        activeProducts: produits.length,
        outOfStock: ruptures.length,
        disputesOpened: litiges,
      },
      changes,
      anomalies,
      questions,
      unavailable: ['la cause des variations, qui ne se lit pas dans la base'],
    };
  },
};

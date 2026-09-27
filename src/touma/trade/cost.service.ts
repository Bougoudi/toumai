import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { corridorService } from './corridor.service.js';
import { fxService } from './fx.service.js';
import type { TradeCostConfidence } from '@prisma/client';

/**
 * COÛT RENDU (§21, §22, §65).
 *
 * C'est le fichier où l'invention serait la plus tentante et la plus
 * coûteuse. Un acheteur qui voit « droits de douane : 12 000 XAF » sur un
 * chiffre fabriqué découvre le vrai montant à la livraison, et c'est Touma
 * qu'il tiendra pour responsable.
 *
 * Donc : **chaque ligne porte sa fiabilité**, et les sous-totaux ne se
 * mélangent pas.
 *
 *   CONFIRMED — le montant est connu et engage (prix produit, devis accepté).
 *   ESTIMATED — une source donne une estimation, et elle est nommée.
 *   UNKNOWN   — personne ne sait. La ligne existe, sans montant.
 *
 * Une ligne `UNKNOWN` ne vaut **pas zéro**. Elle rend le total incomplet, et
 * la réponse le dit : `complete: false`. Compter l'inconnu pour zéro
 * produirait un coût rendu qui paraît total et ne l'est pas — le pire des
 * trois états, parce qu'il ne se voit pas.
 *
 * Touma ne calcule aucun droit de douane. Elle n'est pas une société de
 * douane, aucune source tarifaire n'est branchée, et un barème recopié de
 * mémoire serait une réglementation inventée (§69).
 */

export interface LigneCout {
  code: string;
  label: string;
  amount: string | null;
  confidence: TradeCostConfidence;
  /** Qui fournit ce montant. `null` pour ce que Touma calcule elle-même. */
  source: string | null;
}

export interface CoutRendu {
  currency: string;
  lines: LigneCout[];
  confirmedTotal: string;
  estimatedTotal: string;
  /** Total des deux, quand et seulement quand rien n'est inconnu. */
  total: string | null;
  complete: boolean;
  unknownComponents: string[];
  /** Conversion vers la devise de l'acheteur, si une source existe. */
  conversion: Awaited<ReturnType<typeof fxService.convert>> | null;
  disclaimer: string;
}

export interface DemandeCout {
  currency: string;
  /** Prix des marchandises, connu. */
  productAmount: Prisma.Decimal | string;
  /** Tarif de transport, quand un transporteur l'a donné. */
  shippingAmount?: Prisma.Decimal | string | null;
  shippingSource?: string | null;
  sellerCountry: string;
  buyerCountry: string;
  /** Devise dans laquelle l'acheteur veut lire le total. */
  displayCurrency?: string | null;
}

export const costService = {
  async estimate(demande: DemandeCout): Promise<CoutRendu> {
    const devise = demande.currency.toUpperCase();
    const lignes: LigneCout[] = [];
    const inconnus: string[] = [];

    // ── Marchandises : confirmé, c'est le prix affiché ─────────────────────
    const produits = new Prisma.Decimal(demande.productAmount);
    lignes.push({ code: 'GOODS', label: 'Marchandises', amount: produits.toFixed(2), confidence: 'CONFIRMED', source: null });

    // ── Transport : confirmé si un transporteur l'a chiffré, sinon inconnu ──
    if (demande.shippingAmount !== undefined && demande.shippingAmount !== null) {
      lignes.push({
        code: 'SHIPPING',
        label: 'Transport',
        amount: new Prisma.Decimal(demande.shippingAmount).toFixed(2),
        confidence: 'CONFIRMED',
        source: demande.shippingSource ?? 'transporteur',
      });
    } else {
      lignes.push({ code: 'SHIPPING', label: 'Transport', amount: null, confidence: 'UNKNOWN', source: null });
      inconnus.push('le transport, tant qu’aucun transporteur n’a établi de devis');
    }

    // ── Commission de plateforme : connue, c'est la nôtre ───────────────────
    const commission = produits.mul(new Prisma.Decimal(String(env.touma.commissionRate)));
    lignes.push({
      code: 'PLATFORM_FEE',
      label: 'Commission Touma',
      amount: commission.toFixed(2),
      confidence: 'CONFIRMED',
      source: 'Touma',
      // Le taux appliqué dépend de la boutique, de la catégorie et du pays ;
      // celui-ci est le taux de repli, et le calcul définitif a lieu à la
      // commande. D'où `CONFIRMED` sur le principe, pas sur le centime.
    });

    // ── Frais de prestataire de paiement ───────────────────────────────────
    lignes.push({ code: 'PAYMENT_PROVIDER_FEE', label: 'Frais du prestataire de paiement', amount: null, confidence: 'UNKNOWN', source: null });
    inconnus.push('les frais du prestataire de paiement, tant qu’aucun n’est raccordé');

    // ── Douanes et taxes : jamais calculées par Touma ───────────────────────
    //
    // Sauf si une règle explicitement saisie et sourcée en donne une. Aucune
    // n'est livrée avec le produit ; c'est l'exploitant qui les saisit, avec
    // leur source.
    const corridor = await corridorService.find(demande.sellerCountry, demande.buyerCountry);
    const reglesCout = corridor
      ? await prisma.toumaTradeRuleVersion.findMany({
          where: {
            corridorId: corridor.id,
            ruleType: 'COST_ESTIMATE',
            status: 'ACTIVE',
            effectiveFrom: { lte: new Date() },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
          },
          orderBy: { version: 'desc' },
          take: 1,
        })
      : [];

    const bareme = reglesCout[0];
    if (bareme) {
      const corps = bareme.body as { duties?: { rate?: string; label?: string }; taxes?: { rate?: string; label?: string } };
      for (const [code, libelle, regle] of [
        ['ESTIMATED_DUTIES', 'Droits de douane estimés', corps.duties],
        ['ESTIMATED_TAXES', 'Taxes estimées', corps.taxes],
      ] as const) {
        if (regle?.rate) {
          lignes.push({
            code,
            label: regle.label ?? libelle,
            amount: produits.mul(new Prisma.Decimal(regle.rate)).toFixed(2),
            // `ESTIMATED`, jamais `CONFIRMED` : c'est un barème saisi, pas une
            // liquidation douanière. Seule la douane liquide.
            confidence: 'ESTIMATED',
            source: bareme.sourceName,
          });
        } else {
          lignes.push({ code, label: libelle, amount: null, confidence: 'UNKNOWN', source: null });
          inconnus.push(code === 'ESTIMATED_DUTIES' ? 'les droits de douane' : 'les taxes à l’importation');
        }
      }
    } else {
      lignes.push({ code: 'ESTIMATED_DUTIES', label: 'Droits de douane', amount: null, confidence: 'UNKNOWN', source: null });
      lignes.push({ code: 'ESTIMATED_TAXES', label: 'Taxes à l’importation', amount: null, confidence: 'UNKNOWN', source: null });
      inconnus.push('les droits de douane et taxes à l’importation : Touma n’est pas une société de douane et aucun barème sourcé n’est enregistré pour ce corridor');
    }

    // ── Totaux, séparés par fiabilité ──────────────────────────────────────
    const somme = (niveau: TradeCostConfidence) =>
      lignes
        .filter((l) => l.confidence === niveau && l.amount !== null)
        .reduce((acc, l) => acc.plus(new Prisma.Decimal(l.amount!)), new Prisma.Decimal(0));

    const confirme = somme('CONFIRMED');
    const estime = somme('ESTIMATED');
    const complet = lignes.every((l) => l.confidence !== 'UNKNOWN');

    const conversion =
      demande.displayCurrency && demande.displayCurrency.toUpperCase() !== devise && complet
        ? await fxService.convert(confirme.plus(estime), devise, demande.displayCurrency)
        : null;

    return {
      currency: devise,
      lines: lignes,
      confirmedTotal: confirme.toFixed(2),
      estimatedTotal: estime.toFixed(2),
      // Pas de total tant qu'une ligne est inconnue. Un total qui paraît
      // complet sans l'être est plus trompeur qu'une absence de total.
      total: complet ? confirme.plus(estime).toFixed(2) : null,
      complete: complet,
      unknownComponents: inconnus,
      conversion,
      disclaimer: complet
        ? 'Les montants estimés restent des estimations : seule la douane liquide les droits réellement dus.'
        : 'Estimation incomplète. Touma n’est ni une banque ni une société de douane : les composants inconnus ci-dessus ne peuvent pas être chiffrés sans une source réelle.',
    };
  },

  /** Conserve une estimation rattachée à une commande. */
  async persist(tradeOrderId: string, cout: CoutRendu) {
    return prisma.toumaTradeCostEstimate.create({
      data: {
        tradeOrderId,
        currency: cout.currency,
        lines: cout.lines as object,
        confirmedTotal: new Prisma.Decimal(cout.confirmedTotal),
        estimatedTotal: new Prisma.Decimal(cout.estimatedTotal),
        unknownComponents: cout.unknownComponents,
        overallConfidence: cout.complete ? (new Prisma.Decimal(cout.estimatedTotal).isZero() ? 'CONFIRMED' : 'ESTIMATED') : 'UNKNOWN',
        fxSnapshotId: cout.conversion?.rate?.snapshotId || null,
      },
    });
  },
};

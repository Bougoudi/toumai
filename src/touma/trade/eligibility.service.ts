import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { corridorService } from './corridor.service.js';
import type { TradeDocumentKind, TradeEligibilityVerdict } from '@prisma/client';

/**
 * ÉLIGIBILITÉ TRANSFRONTALIÈRE (§8, §9, §18).
 *
 * Confronte une commande envisagée à la configuration réelle, et rend un
 * verdict **motivé**. Chaque critère est nommé, réussi ou non : un refus dont
 * on ne peut pas dire pourquoi est un refus qu'on ne peut pas corriger.
 *
 * Quatre verdicts, et leur ordre de sévérité compte :
 *
 *   NOT_ELIGIBLE      — un critère dur manque. Rien ne le rattrape.
 *   REQUIRES_DOCUMENT — possible, une fois le document fourni.
 *   REQUIRES_REVIEW   — possible, après examen humain.
 *   ELIGIBLE          — tous les critères sont réunis.
 *
 * Le plus sévère l'emporte. Un produit qui exige un document **et** dont le
 * corridor est suspendu n'est pas « en attente de document » : il est refusé.
 *
 * **Aucune liste de produits interdits n'est livrée avec Touma.** Inventer une
 * réglementation serait le faux le plus grave de ce module : un vendeur verrait
 * sa marchandise bloquée au nom d'une règle qui n'existe pas. Seules les règles
 * explicitement saisies, sourcées et versionnées s'appliquent (§9, §19, §20).
 */

export interface Critere {
  code: string;
  ok: boolean;
  detail: string;
}

export interface ResultatEligibilite {
  verdict: TradeEligibilityVerdict;
  crossBorder: boolean;
  corridor: { code: string; status: string; operational: boolean } | null;
  criteria: Critere[];
  requiredDocuments: TradeDocumentKind[];
  reason: string;
  /** Ce que Touma ne sait pas, et ne prétend pas savoir. */
  unknown: string[];
}

export interface DemandeEligibilite {
  buyerCountry: string;
  sellerCountry: string;
  productId?: string | null;
  currency?: string | null;
  paymentMethod?: string | null;
  userId?: string | null;
}

/** Le plus sévère l'emporte. */
const SEVERITE: Record<TradeEligibilityVerdict, number> = {
  ELIGIBLE: 0,
  REQUIRES_REVIEW: 1,
  REQUIRES_DOCUMENT: 2,
  NOT_ELIGIBLE: 3,
};

function pire(a: TradeEligibilityVerdict, b: TradeEligibilityVerdict): TradeEligibilityVerdict {
  return SEVERITE[a] >= SEVERITE[b] ? a : b;
}

export const eligibilityService = {
  /**
   * Vérifie, sans rien écrire.
   *
   * Utilisée à l'affichage d'une fiche produit comme avant un paiement. La
   * version qui consigne est `checkAndRecord`.
   */
  async check(demande: DemandeEligibilite): Promise<ResultatEligibilite> {
    const acheteur = demande.buyerCountry.toUpperCase();
    const vendeur = demande.sellerCountry.toUpperCase();
    const criteres: Critere[] = [];
    const inconnus: string[] = [];
    const documents = new Set<TradeDocumentKind>();
    let verdict: TradeEligibilityVerdict = 'ELIGIBLE';

    // ── Cas national : rien de ce qui suit ne s'applique ────────────────────
    if (acheteur === vendeur) {
      return {
        verdict: 'ELIGIBLE',
        crossBorder: false,
        corridor: null,
        criteria: [{ code: 'DOMESTIC', ok: true, detail: `Vente nationale : acheteur et vendeur sont au ${acheteur}.` }],
        requiredDocuments: [],
        reason: 'Vente nationale — les règles transfrontalières ne s’appliquent pas.',
        unknown: [],
      };
    }

    // ── Coupe-circuit général ───────────────────────────────────────────────
    if (!env.touma.trade.enabled) {
      return {
        verdict: 'NOT_ELIGIBLE',
        crossBorder: true,
        corridor: null,
        criteria: [{ code: 'CROSS_BORDER_DISABLED', ok: false, detail: 'Le commerce transfrontalier n’est pas activé sur cette instance.' }],
        requiredDocuments: [],
        reason: 'Le commerce transfrontalier n’est pas activé.',
        unknown: [],
      };
    }

    // ── Corridor et capacité réelle ─────────────────────────────────────────
    const corridor = await corridorService.find(vendeur, acheteur);
    const capacite = await corridorService.capability(vendeur, acheteur);

    criteres.push({
      code: 'CORRIDOR',
      ok: capacite.operational,
      detail: capacite.operational
        ? `Corridor ${vendeur} → ${acheteur} opérationnel.`
        : capacite.missing.join(' '),
    });
    if (!capacite.operational) verdict = pire(verdict, 'NOT_ELIGIBLE');

    // ── Devise ──────────────────────────────────────────────────────────────
    if (demande.currency) {
      const devise = demande.currency.toUpperCase();
      const admise = capacite.currencies.length === 0 || capacite.currencies.includes(devise);
      criteres.push({
        code: 'CURRENCY',
        ok: admise,
        detail: admise ? `Devise ${devise} admise sur ce corridor.` : `Devise ${devise} non admise : ${capacite.currencies.join(', ') || 'aucune devise déclarée'}.`,
      });
      if (!admise) verdict = pire(verdict, 'NOT_ELIGIBLE');
    } else {
      inconnus.push('la devise de règlement, non précisée');
    }

    // ── Moyen de paiement ───────────────────────────────────────────────────
    if (demande.paymentMethod) {
      const admis = capacite.paymentMethods.includes(demande.paymentMethod);
      criteres.push({
        code: 'PAYMENT_METHOD',
        ok: admis,
        detail: admis
          ? `Moyen de paiement « ${demande.paymentMethod} » disponible des deux côtés.`
          : `Moyen de paiement « ${demande.paymentMethod} » indisponible sur ce corridor : ${capacite.paymentMethods.join(', ') || 'aucun'}.`,
      });
      if (!admis) verdict = pire(verdict, 'NOT_ELIGIBLE');
    } else {
      criteres.push({
        code: 'PAYMENT_AVAILABILITY',
        ok: capacite.paymentMethods.length > 0,
        detail: capacite.paymentMethods.length > 0 ? `${capacite.paymentMethods.length} moyen(s) de paiement disponible(s).` : 'Aucun moyen de paiement disponible sur ce corridor.',
      });
      if (capacite.paymentMethods.length === 0) verdict = pire(verdict, 'NOT_ELIGIBLE');
    }

    // ── Transport ───────────────────────────────────────────────────────────
    criteres.push({
      code: 'SHIPPING_AVAILABILITY',
      ok: capacite.shippingProviders.length > 0,
      detail:
        capacite.shippingProviders.length > 0
          ? `${capacite.shippingProviders.length} transporteur(s) couvrant les deux pays.`
          : 'Aucun transporteur enregistré ne couvre les deux pays.',
    });
    if (capacite.shippingProviders.length === 0) verdict = pire(verdict, 'NOT_ELIGIBLE');
    // Le tarif et le délai ne sont pas connus ici : ils viennent du
    // transporteur, au moment du devis (V17).
    inconnus.push('le tarif et le délai de livraison, qui se demandent au transporteur');

    // ── Documents exigés par le corridor ────────────────────────────────────
    for (const d of corridor?.requiredDocuments ?? []) documents.add(d);
    if (documents.size > 0) {
      criteres.push({ code: 'CORRIDOR_DOCUMENTS', ok: false, detail: `Ce corridor exige : ${[...documents].join(', ')}.` });
      verdict = pire(verdict, 'REQUIRES_DOCUMENT');
    }

    // ── Produit ─────────────────────────────────────────────────────────────
    if (demande.productId) {
      const produit = await prisma.toumaProduct.findUnique({
        where: { id: demande.productId },
        select: {
          id: true,
          title: true,
          status: true,
          categoryId: true,
          countryOfOrigin: true,
          originStatus: true,
          store: { select: { verificationStatus: true, status: true, countryCode: true } },
        },
      });

      if (!produit || produit.status !== 'ACTIVE' || produit.store?.status !== 'ACTIVE') {
        criteres.push({ code: 'PRODUCT', ok: false, detail: 'Produit indisponible.' });
        verdict = pire(verdict, 'NOT_ELIGIBLE');
      } else {
        // Vérification du vendeur. Un vendeur non vérifié n'est pas refusé :
        // il passe en revue. Le refuser d'office fermerait le transfrontalier
        // à tout nouveau vendeur, ce qui n'est pas une règle mais un blocage.
        const verifie = produit.store.verificationStatus === 'APPROVED';
        criteres.push({
          code: 'SELLER_VERIFICATION',
          ok: verifie,
          detail: verifie ? 'Vendeur vérifié par Touma.' : 'Vendeur non vérifié : un examen est requis avant expédition internationale.',
        });
        if (!verifie) verdict = pire(verdict, 'REQUIRES_REVIEW');

        // Origine déclarée. Son absence n'interdit rien ; elle est signalée,
        // parce qu'un document d'origine ne peut pas être établi sans elle.
        if (!produit.countryOfOrigin || produit.originStatus === 'UNKNOWN') {
          inconnus.push('le pays d’origine de la marchandise, non déclaré par le vendeur');
        }

        const regles = await this.productRules(produit.id, produit.categoryId);
        for (const r of regles) {
          if (r.blockedCountries.map((c) => c.toUpperCase()).includes(acheteur)) {
            criteres.push({ code: 'PRODUCT_BLOCKED_COUNTRY', ok: false, detail: `Une règle enregistrée interdit ce produit à destination de ${acheteur}.` });
            verdict = pire(verdict, 'NOT_ELIGIBLE');
          }
          if (r.allowedCountries.length > 0 && !r.allowedCountries.map((c) => c.toUpperCase()).includes(acheteur)) {
            criteres.push({ code: 'PRODUCT_NOT_ALLOWED_COUNTRY', ok: false, detail: `Ce produit n’est autorisé que vers : ${r.allowedCountries.join(', ')}.` });
            verdict = pire(verdict, 'NOT_ELIGIBLE');
          }
          if (r.allowedCorridors.length > 0 && corridor && !r.allowedCorridors.includes(corridor.code)) {
            criteres.push({ code: 'PRODUCT_NOT_ALLOWED_CORRIDOR', ok: false, detail: `Ce produit n’est autorisé que sur : ${r.allowedCorridors.join(', ')}.` });
            verdict = pire(verdict, 'NOT_ELIGIBLE');
          }
          if (r.requiresReview) {
            criteres.push({ code: 'PRODUCT_REQUIRES_REVIEW', ok: false, detail: 'Une règle enregistrée impose un examen pour ce produit.' });
            verdict = pire(verdict, 'REQUIRES_REVIEW');
          }
          for (const d of r.requiredDocuments) documents.add(d);
          if (r.requiredDocuments.length > 0) verdict = pire(verdict, 'REQUIRES_DOCUMENT');
        }
        if (regles.length === 0) {
          criteres.push({ code: 'PRODUCT_RULES', ok: true, detail: 'Aucune restriction enregistrée pour ce produit.' });
        }
      }
    }

    return {
      verdict,
      crossBorder: true,
      corridor: corridor ? { code: corridor.code, status: corridor.status, operational: capacite.operational } : null,
      criteria: criteres,
      requiredDocuments: [...documents],
      reason: motif(verdict, criteres),
      unknown: inconnus,
    };
  },

  /**
   * Règles applicables à un produit : les siennes et celles de sa catégorie.
   *
   * Seules les règles `active` comptent. Une règle retirée ne bloque plus, mais
   * reste en base : une commande refusée hier doit rester explicable demain.
   */
  async productRules(productId: string, categoryId: string | null) {
    return prisma.toumaCrossBorderProductRule.findMany({
      where: {
        active: true,
        OR: [{ productId }, ...(categoryId ? [{ categoryId }] : [])],
      },
    });
  },

  /** Vérifie **et consigne**. Employée avant un paiement ou une expédition. */
  async checkAndRecord(demande: DemandeEligibilite): Promise<ResultatEligibilite & { checkId: string }> {
    const resultat = await this.check(demande);
    const corridor = resultat.corridor ? await prisma.toumaTradeCorridor.findUnique({ where: { code: resultat.corridor.code }, select: { id: true } }) : null;

    const ligne = await prisma.toumaTradeEligibilityCheck.create({
      data: {
        corridorId: corridor?.id ?? null,
        userId: demande.userId ?? null,
        buyerCountry: demande.buyerCountry.toUpperCase(),
        sellerCountry: demande.sellerCountry.toUpperCase(),
        productId: demande.productId ?? null,
        currency: demande.currency?.toUpperCase() ?? null,
        paymentMethod: demande.paymentMethod ?? null,
        verdict: resultat.verdict,
        criteria: resultat.criteria as object,
        requiredDocuments: resultat.requiredDocuments,
        reason: resultat.reason,
      },
      select: { id: true },
    });
    return { ...resultat, checkId: ligne.id };
  },
};

function motif(verdict: TradeEligibilityVerdict, criteres: Critere[]): string {
  const echecs = criteres.filter((c) => !c.ok);
  switch (verdict) {
    case 'ELIGIBLE':
      return 'Tous les critères vérifiables sont réunis.';
    case 'REQUIRES_DOCUMENT':
      return `Un ou plusieurs documents sont exigés : ${echecs.map((c) => c.detail).join(' ')}`;
    case 'REQUIRES_REVIEW':
      return `Un examen humain est requis : ${echecs.map((c) => c.detail).join(' ')}`;
    default:
      return echecs.map((c) => c.detail).join(' ');
  }
}

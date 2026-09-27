import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { notFound } from '../lib/errors.js';
import { costService } from '../trade/cost.service.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * COMPARAISON D'OFFRES (V28 §7).
 *
 * **Ce que ce service refuse de faire, et pourquoi c'est le point central.**
 * Il ne désigne pas de gagnant. Aucun score, aucun classement, aucun
 * « meilleur fournisseur ».
 *
 * Ce n'est pas de la timidité. Trois raisons concrètes :
 *
 * 1. **Les devises ne s'additionnent pas.** Une offre en XAF et une en NGN ne
 *    se comparent qu'avec un taux officiel. Sans source de change configurée,
 *    tout classement reposerait sur un taux inventé — ce que V20 §49 interdit.
 * 2. **Le coût rendu est souvent incomplet.** Les droits de douane sont
 *    `UNKNOWN` tant qu'aucune source ne les donne. Classer sur un total dont
 *    une composante manque, c'est classer sur autre chose que le coût.
 * 3. **L'arbitrage n'est pas technique.** Un acheteur peut préférer payer 8 %
 *    de plus pour un fournisseur vérifié, ou pour dix jours de moins. Ce
 *    compromis lui appartient ; un score le lui retirerait en le cachant
 *    derrière un chiffre.
 *
 * Ce que le service fait à la place : poser les offres côte à côte sur des
 * dimensions comparables, et **dire pour chacune laquelle est la plus basse ou
 * la plus rapide**. Ce sont des faits, pas des recommandations — et ils ne sont
 * énoncés que lorsqu'ils ont un sens.
 */

export type ComparableRaison = 'DEVISES_DIFFERENTES' | 'COUT_INCOMPLET' | 'UNE_SEULE_OFFRE';

export interface OffreComparee {
  quoteId: string;
  reference: string;
  supplier: { storeId: string; name: string; countryCode: string; verificationStatus: string };
  currency: string;
  /** Quantité totale toutes lignes confondues : sans elle, un prix ne dit rien. */
  quantity: number;
  itemsTotal: string;
  shippingTotal: string;
  total: string;
  /** Prix unitaire moyen, calculé — jamais saisi par le fournisseur. */
  unitPrice: string | null;
  leadTimeDays: number;
  validUntil: Date;
  expired: boolean;
  /** Coût rendu estimé, avec la fiabilité de chaque ligne (V24). */
  landedCost: Awaited<ReturnType<typeof costService.estimate>> | null;
  /**
   * Signaux de confiance disponibles.
   *
   * `null` sur l'objet entier : aucun score n'existe. `score: null` à
   * l'intérieur : un score existe mais n'a pas encore de valeur mesurable.
   * Les deux veulent dire « on ne sait pas », jamais « c'est mauvais » — un
   * fournisseur nouveau n'est pas un mauvais fournisseur.
   */
  trust: { score: number | null; level: string; sampleSize: number } | null;
  /** Dimensions sur lesquelles cette offre est la meilleure. Factuel. */
  lowest: string[];
}

export interface Comparaison {
  rfq: { id: string; reference: string; title: string; currency: string; countryCode: string };
  quotes: OffreComparee[];
  /** Devises représentées. Plus d'une interdit tout total comparé. */
  currencies: string[];
  /** Pourquoi aucun classement global n'est produit. Toujours renseigné. */
  noRankingBecause: ComparableRaison[];
  note: string;
}

/** Somme des quantités de toutes les lignes d'une offre. */
function quantiteTotale(items: Array<{ quantity: number }>): number {
  return items.reduce((n, i) => n + i.quantity, 0);
}

/**
 * Compare les offres reçues sur un appel d'offres.
 *
 * **Réservé à l'acheteur.** Un fournisseur qui obtiendrait cette vue lirait les
 * prix de ses concurrents : c'est exactement ce que le cloisonnement des
 * appels d'offres existe pour empêcher. Un appel d'offres d'autrui est
 * « introuvable », jamais « interdit » — 403 confirmerait son existence.
 */
export async function comparer(user: ToumaRequestUser, rfqId: string): Promise<Comparaison> {
  const rfq = await prisma.toumaRfq.findFirst({
    where: { OR: [{ id: rfqId }, { reference: rfqId }] },
    include: {
      quotes: {
        where: { status: { in: ['SUBMITTED', 'COUNTERED', 'ACCEPTED'] } },
        include: {
          items: true,
          store: { select: { id: true, name: true, countryCode: true, verificationStatus: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!rfq) throw notFound('Appel d’offres introuvable.');
  if (rfq.buyerId !== user.id && user.role !== 'ADMIN') throw notFound('Appel d’offres introuvable.');

  const scores = await prisma.toumaTrustScore.findMany({
    where: { entityType: 'SUPPLIER', entityId: { in: rfq.quotes.map((q) => q.sellerId) } },
    select: { entityId: true, score: true, level: true, sampleSize: true },
  });
  const parVendeur = new Map(scores.map((s) => [s.entityId, s]));

  const maintenant = Date.now();
  const offres: OffreComparee[] = [];

  for (const quote of rfq.quotes) {
    const quantite = quantiteTotale(quote.items);
    // Prix unitaire **calculé**, jamais recopié : un fournisseur qui annoncerait
    // son propre prix unitaire pourrait le dissocier de son total.
    const unitaire = quantite > 0 ? new Prisma.Decimal(quote.itemsTotal).dividedBy(quantite).toDecimalPlaces(4).toString() : null;

    let landedCost: OffreComparee['landedCost'] = null;
    try {
      landedCost = await costService.estimate({
        currency: quote.currency,
        productAmount: quote.itemsTotal,
        shippingAmount: quote.shippingTotal,
        shippingSource: 'Offre du fournisseur',
        sellerCountry: quote.store.countryCode,
        buyerCountry: rfq.countryCode,
      });
    } catch {
      // Le coût rendu est un complément : son indisponibilité ne doit pas
      // priver l'acheteur de la comparaison des offres elles-mêmes.
      landedCost = null;
    }

    const trust = parVendeur.get(quote.sellerId);
    offres.push({
      quoteId: quote.id,
      reference: quote.reference,
      supplier: {
        storeId: quote.store.id,
        name: quote.store.name,
        countryCode: quote.store.countryCode,
        verificationStatus: quote.store.verificationStatus,
      },
      currency: quote.currency,
      quantity: quantite,
      itemsTotal: quote.itemsTotal.toString(),
      shippingTotal: quote.shippingTotal.toString(),
      total: quote.total.toString(),
      unitPrice: unitaire,
      leadTimeDays: quote.leadTimeDays,
      validUntil: quote.validUntil,
      expired: quote.validUntil.getTime() < maintenant,
      landedCost,
      trust: trust ? { score: trust.score, level: trust.level, sampleSize: trust.sampleSize } : null,
      lowest: [],
    });
  }

  const devises = [...new Set(offres.map((o) => o.currency))].sort();
  const vivantes = offres.filter((o) => !o.expired);

  /**
   * Marque les extrêmes, dimension par dimension.
   *
   * Un montant ne se compare qu'à devise égale. Le délai, lui, se compare
   * toujours — un jour est un jour partout. Les offres expirées sont exclues :
   * signaler comme « la moins chère » une offre qu'on ne peut plus accepter
   * serait une information qui trompe.
   */
  const marquer = (dimension: string, valeur: (o: OffreComparee) => number | null, comparables: OffreComparee[]) => {
    const chiffrees = comparables.filter((o) => valeur(o) !== null);
    if (chiffrees.length < 2) return;
    const minimum = Math.min(...chiffrees.map((o) => valeur(o) as number));
    for (const o of chiffrees) if (valeur(o) === minimum) o.lowest.push(dimension);
  };

  // Les montants : seulement si toutes les offres vivantes sont dans la même
  // devise. Sinon la comparaison exigerait un taux de change qu'on n'a pas.
  if (devises.length === 1) {
    marquer('total', (o) => Number(o.total), vivantes);
    marquer('unitPrice', (o) => (o.unitPrice === null ? null : Number(o.unitPrice)), vivantes);
    marquer('shipping', (o) => Number(o.shippingTotal), vivantes);
  }
  marquer('leadTime', (o) => o.leadTimeDays, vivantes);

  const raisons: ComparableRaison[] = [];
  if (devises.length > 1) raisons.push('DEVISES_DIFFERENTES');
  if (offres.some((o) => o.landedCost && !o.landedCost.complete)) raisons.push('COUT_INCOMPLET');
  if (offres.length < 2) raisons.push('UNE_SEULE_OFFRE');

  return {
    rfq: { id: rfq.id, reference: rfq.reference, title: rfq.title, currency: rfq.currency, countryCode: rfq.countryCode },
    quotes: offres,
    currencies: devises,
    noRankingBecause: raisons,
    note:
      'Ces offres sont posées côte à côte, pas classées. ' +
      (devises.length > 1
        ? 'Elles sont libellées dans des devises différentes : les additionner ou les classer exigerait un taux de change officiel que TOUMA n’a pas. '
        : '') +
      'Le choix entre un prix plus bas, un délai plus court et un fournisseur vérifié appartient à l’acheteur.',
  };
}

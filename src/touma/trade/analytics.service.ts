import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { corridorService } from './corridor.service.js';

/**
 * ANALYTIQUE DU COMMERCE (§58, §59).
 *
 * « Ne pas confondre corrélation et causalité » (§59). Ce fichier rend donc
 * des **taux mesurés** et jamais d'explication : un corridor dont 40 % des
 * paiements échouent a un problème, et ce problème peut être le prestataire,
 * la connectivité, le pouvoir d'achat ou un bogue. Les chiffres le signalent ;
 * ils ne le diagnostiquent pas.
 *
 * Deux règles héritées s'appliquent ici comme ailleurs : **jamais deux devises
 * additionnées** (V20), et **un échantillon trop petit ne produit pas de
 * taux** — 1 échec sur 2 commandes fait 50 %, et ne veut rien dire.
 */

/** En dessous, aucun taux n'est publié. */
export const ECHANTILLON_MINIMAL = 5;

function taux(numerateur: number, denominateur: number): number | null {
  if (denominateur < ECHANTILLON_MINIMAL) return null;
  return Number(((numerateur / denominateur) * 100).toFixed(1));
}

/** Somme par devise. Jamais un total unique. */
function parDevise(lignes: Array<{ total: Prisma.Decimal; currency: string }>) {
  const carte = new Map<string, { gmv: Prisma.Decimal; orders: number }>();
  for (const l of lignes) {
    const e = carte.get(l.currency) ?? { gmv: new Prisma.Decimal(0), orders: 0 };
    e.gmv = e.gmv.plus(l.total);
    e.orders += 1;
    carte.set(l.currency, e);
  }
  return [...carte.entries()].map(([currency, e]) => ({
    currency,
    gmv: e.gmv.toString(),
    orders: e.orders,
    averageOrderValue: e.orders > 0 ? e.gmv.dividedBy(e.orders).toFixed(2) : null,
  }));
}

export const tradeAnalytics = {
  /** Vue plateforme : volumes, pays, corridors, incidents. */
  async platform(days: number) {
    const depuis = new Date(Date.now() - days * 86_400_000);

    const commandes = await prisma.toumaOrder.findMany({
      where: { crossBorder: true, createdAt: { gte: depuis } },
      select: {
        total: true, currency: true, status: true, buyerCountry: true, sellerCountry: true,
        createdAt: true, deliveredAt: true,
        payments: { select: { status: true } },
      },
    });

    if (commandes.length === 0) {
      return {
        days,
        crossBorderOrders: 0,
        byCurrency: [],
        byCorridor: [],
        note: `Information non disponible : aucune commande transfrontalière sur ${days} jours.`,
      };
    }

    // ── Par corridor ────────────────────────────────────────────────────────
    const parCorridor = new Map<string, {
      orders: number; delivered: number; cancelled: number;
      paymentAttempts: number; paymentFailures: number;
      deliveryDays: number[]; lignes: Array<{ total: Prisma.Decimal; currency: string }>;
    }>();

    for (const c of commandes) {
      if (!c.sellerCountry || !c.buyerCountry) continue;
      const code = `${c.sellerCountry}_${c.buyerCountry}`;
      const e = parCorridor.get(code) ?? { orders: 0, delivered: 0, cancelled: 0, paymentAttempts: 0, paymentFailures: 0, deliveryDays: [], lignes: [] };
      e.orders += 1;
      if (c.status === 'DELIVERED' || c.status === 'COMPLETED') e.delivered += 1;
      if (c.status === 'CANCELLED') e.cancelled += 1;
      e.paymentAttempts += c.payments.length;
      e.paymentFailures += c.payments.filter((p) => p.status === 'FAILED').length;
      if (c.deliveredAt) e.deliveryDays.push((c.deliveredAt.getTime() - c.createdAt.getTime()) / 86_400_000);
      if (c.status !== 'CANCELLED') e.lignes.push({ total: c.total, currency: c.currency });
      parCorridor.set(code, e);
    }

    const corridors = await corridorService.list();
    const capacites = new Map(corridors.map((c) => [c.code, c.capability]));

    return {
      days,
      crossBorderOrders: commandes.length,
      byCurrency: parDevise(commandes.filter((c) => c.status !== 'CANCELLED').map((c) => ({ total: c.total, currency: c.currency }))),
      byCorridor: [...parCorridor.entries()]
        .map(([code, e]) => ({
          corridor: code,
          operational: capacites.get(code)?.operational ?? false,
          orders: e.orders,
          byCurrency: parDevise(e.lignes),
          // Chaque taux est `null` sous le seuil : 1 échec sur 2 commandes
          // fait 50 % et ne veut rien dire.
          deliverySuccessRate: taux(e.delivered, e.orders),
          cancellationRate: taux(e.cancelled, e.orders),
          paymentFailureRate: taux(e.paymentFailures, e.paymentAttempts),
          averageDeliveryDays: e.deliveryDays.length >= ECHANTILLON_MINIMAL
            ? Number((e.deliveryDays.reduce((a, b) => a + b, 0) / e.deliveryDays.length).toFixed(1))
            : null,
          sampleSize: e.orders,
          insufficientSample: e.orders < ECHANTILLON_MINIMAL,
        }))
        .sort((a, b) => b.orders - a.orders),
      note: null,
      disclaimer:
        'Taux mesurés, sans explication. Un taux d’échec de paiement élevé peut venir du prestataire, de la connectivité ou d’un bogue : ces chiffres le signalent, ils ne le diagnostiquent pas.',
    };
  },

  /** Vue vendeur : ses ventes à l'international. */
  async seller(ownerId: string, days: number) {
    const depuis = new Date(Date.now() - days * 86_400_000);
    const commandes = await prisma.toumaOrder.findMany({
      where: { store: { ownerId }, crossBorder: true, createdAt: { gte: depuis } },
      select: { total: true, currency: true, status: true, buyerCountry: true },
    });

    if (commandes.length === 0) {
      return { days, orders: 0, byCurrency: [], byDestination: [], note: `Information non disponible : aucune vente internationale sur ${days} jours.` };
    }

    const parPays = new Map<string, number>();
    for (const c of commandes) {
      if (!c.buyerCountry) continue;
      parPays.set(c.buyerCountry, (parPays.get(c.buyerCountry) ?? 0) + 1);
    }

    return {
      days,
      orders: commandes.length,
      cancelled: commandes.filter((c) => c.status === 'CANCELLED').length,
      byCurrency: parDevise(commandes.filter((c) => c.status !== 'CANCELLED').map((c) => ({ total: c.total, currency: c.currency }))),
      byDestination: [...parPays.entries()].map(([countryCode, orders]) => ({ countryCode, orders })).sort((a, b) => b.orders - a.orders),
      note: null,
    };
  },

  /** Vue professionnelle : achats, fournisseurs, demandes de devis. */
  async business(buyerId: string, days: number) {
    const depuis = new Date(Date.now() - days * 86_400_000);
    const [commandes, rfqs, devis] = await Promise.all([
      prisma.toumaOrder.findMany({
        where: { buyerId, crossBorder: true, createdAt: { gte: depuis } },
        select: { total: true, currency: true, status: true, sellerCountry: true, storeId: true },
      }),
      prisma.toumaRfq.count({ where: { buyerId, createdAt: { gte: depuis } } }),
      prisma.toumaQuote.count({ where: { rfq: { buyerId }, createdAt: { gte: depuis } } }),
    ]);

    const fournisseurs = new Set(commandes.map((c) => c.storeId));
    const parPays = new Map<string, number>();
    for (const c of commandes) {
      if (!c.sellerCountry) continue;
      parPays.set(c.sellerCountry, (parPays.get(c.sellerCountry) ?? 0) + 1);
    }

    return {
      days,
      imports: commandes.length,
      suppliers: fournisseurs.size,
      rfqs,
      quotes: devis,
      // « Dépense » exclut les commandes annulées : compter ce qui n'a pas été
      // payé gonflerait un chiffre que l'acheteur reconnaîtrait faux.
      spendByCurrency: parDevise(commandes.filter((c) => c.status !== 'CANCELLED').map((c) => ({ total: c.total, currency: c.currency }))),
      bySourceCountry: [...parPays.entries()].map(([countryCode, orders]) => ({ countryCode, orders })).sort((a, b) => b.orders - a.orders),
      ...(commandes.length === 0 ? { note: `Information non disponible : aucune importation sur ${days} jours.` } : {}),
    };
  },
};

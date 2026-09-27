import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { badRequest } from '../lib/errors.js';
import type { FxRateSource } from '@prisma/client';

/**
 * TAUX DE CHANGE (§23, §24, §25).
 *
 * Il n'existait **aucune notion de taux de change dans tout le dépôt** avant
 * V24, et c'était la seule position tenable : V20 interdit les taux fictifs et
 * n'additionne jamais deux devises. Ce fichier crée l'abstraction sans rien
 * changer à cette règle.
 *
 * Trois choses qu'un taux doit porter pour être un taux plutôt qu'un chiffre :
 * **une source, un horodatage, une validité**. Les trois sont obligatoires.
 *
 * Aucune source n'est branchée aujourd'hui. `convert()` rend donc
 * `available: false` avec le motif, et l'appelant affiche « Conversion
 * indisponible » plutôt qu'un montant. Un taux inventé au milieu d'une
 * commande transfrontalière se transforme en écart de caisse chez le vendeur.
 */

export interface Taux {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  source: FxRateSource;
  sourceName: string | null;
  rateAt: Date;
  expiresAt: Date | null;
  snapshotId: string;
}

export interface Conversion {
  available: boolean;
  amount: string | null;
  currency: string;
  /** Le taux employé, ou `null`. Affiché avec le montant, jamais séparé. */
  rate: Taux | null;
  reason: string | null;
}

/**
 * Fournisseur de taux.
 *
 * `getRate` rend `null` quand il ne sait pas — jamais un taux par défaut.
 * Un `1.0` de repli ferait passer 100 000 XAF pour 100 000 EUR.
 */
export interface ExchangeRateProvider {
  readonly code: string;
  readonly configured: boolean;
  getRate(base: string, quote: string): Promise<Taux | null>;
}

/**
 * Fournisseur par défaut : aucun.
 *
 * Il ne simule rien et ne se rabat sur rien. Sa seule fonction est de rendre
 * l'absence explicite plutôt que de laisser un `undefined` circuler.
 */
class AucunFournisseur implements ExchangeRateProvider {
  readonly code = 'NONE';
  readonly configured = false;
  async getRate(): Promise<null> {
    return null;
  }
}

/**
 * Taux saisis à la main par un administrateur.
 *
 * Légitime — une banque centrale publie un taux qu'un exploitant recopie — à
 * condition que la saisie porte son nom de source et sa date. C'est pourquoi
 * `record()` les exige.
 */
class FournisseurManuel implements ExchangeRateProvider {
  readonly code = 'MANUAL_ADMIN';
  readonly configured = true;

  async getRate(base: string, quote: string): Promise<Taux | null> {
    const ligne = await prisma.toumaFxRateSnapshot.findFirst({
      where: {
        baseCurrency: base.toUpperCase(),
        quoteCurrency: quote.toUpperCase(),
        source: { in: ['MANUAL_ADMIN', 'CENTRAL_BANK'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { rateAt: 'desc' },
    });
    return ligne ? versTaux(ligne) : null;
  }
}

function versTaux(l: {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: Prisma.Decimal;
  source: FxRateSource;
  sourceName: string | null;
  rateAt: Date;
  expiresAt: Date | null;
}): Taux {
  return {
    baseCurrency: l.baseCurrency,
    quoteCurrency: l.quoteCurrency,
    rate: l.rate.toString(),
    source: l.source,
    sourceName: l.sourceName,
    rateAt: l.rateAt,
    expiresAt: l.expiresAt,
    snapshotId: l.id,
  };
}

function fournisseur(): ExchangeRateProvider {
  if (!env.touma.trade.fxEnabled) return new AucunFournisseur();
  switch (env.touma.trade.fxProvider.toLowerCase()) {
    case 'manual':
      return new FournisseurManuel();
    default:
      // `EXTERNAL_PROVIDER` et `CENTRAL_BANK` sont nommés au cahier des charges
      // et pas écrits : brancher une API de change demande un contrat, pas du
      // code. Les enregistrer vides ferait croire qu'il suffit d'une clé.
      return new AucunFournisseur();
  }
}

export const fxService = {
  /** Qui fournit les taux, et si une conversion est possible du tout. */
  status() {
    const f = fournisseur();
    return {
      provider: f.code,
      configured: f.configured,
      enabled: env.touma.trade.fxEnabled,
      message: f.configured
        ? null
        : 'Aucune source de taux de change n’est configurée. Les montants restent affichés dans leur devise d’origine, sans conversion.',
    };
  },

  async getRate(base: string, quote: string): Promise<Taux | null> {
    const b = base.toUpperCase();
    const q = quote.toUpperCase();
    // Une devise vers elle-même n'a pas besoin d'une source : le taux est 1
    // par définition, et non par convention.
    if (b === q) {
      return { baseCurrency: b, quoteCurrency: q, rate: '1', source: 'NONE', sourceName: 'identité', rateAt: new Date(), expiresAt: null, snapshotId: '' };
    }
    return fournisseur().getRate(b, q);
  },

  /**
   * Convertit, ou explique pourquoi elle ne peut pas.
   *
   * Ne rend jamais un montant sans le taux qui l'a produit : les afficher
   * séparément permettrait de montrer une conversion dont on ne peut plus dire
   * d'où elle vient (§25).
   */
  async convert(montant: Prisma.Decimal | string, base: string, quote: string): Promise<Conversion> {
    const b = base.toUpperCase();
    const q = quote.toUpperCase();
    if (b === q) {
      return { available: true, amount: new Prisma.Decimal(montant).toString(), currency: q, rate: null, reason: null };
    }
    const taux = await this.getRate(b, q);
    if (!taux) {
      return {
        available: false,
        amount: null,
        currency: q,
        rate: null,
        reason: `Conversion indisponible : aucun taux ${b} → ${q} provenant d’une source connue.`,
      };
    }
    const converti = new Prisma.Decimal(montant).mul(new Prisma.Decimal(taux.rate));
    return { available: true, amount: converti.toFixed(4), currency: q, rate: taux, reason: null };
  },

  /**
   * Enregistre un taux.
   *
   * `sourceName` est obligatoire, et c'est délibéré : un taux sans source est
   * un chiffre que personne ne peut contester. `source: NONE` est refusé — il
   * signifie « pas de source », ce qui ne s'enregistre pas.
   */
  async record(input: {
    baseCurrency: string;
    quoteCurrency: string;
    rate: string;
    source: FxRateSource;
    sourceName: string;
    sourceUrl?: string | null;
    rateAt?: Date;
    createdById?: string | null;
  }) {
    const b = input.baseCurrency.toUpperCase();
    const q = input.quoteCurrency.toUpperCase();
    if (b === q) throw badRequest('Un taux relie deux devises différentes.');
    if (input.source === 'NONE') throw badRequest('« NONE » signifie l’absence de source : un taux ne s’enregistre pas sans source.');
    if (!input.sourceName.trim()) throw badRequest('La source du taux est obligatoire.');

    const taux = new Prisma.Decimal(input.rate);
    if (taux.lessThanOrEqualTo(0)) throw badRequest('Un taux est strictement positif.');

    const rateAt = input.rateAt ?? new Date();
    return prisma.toumaFxRateSnapshot.create({
      data: {
        baseCurrency: b,
        quoteCurrency: q,
        rate: taux,
        source: input.source,
        sourceName: input.sourceName.trim(),
        sourceUrl: input.sourceUrl ?? null,
        rateAt,
        // Un taux périme. Sans expiration, celui de l'an dernier servirait
        // encore aujourd'hui et personne ne s'en apercevrait.
        expiresAt: new Date(rateAt.getTime() + env.touma.trade.fxTtlMinutes * 60_000),
        createdById: input.createdById ?? null,
      },
    });
  },

  /** Historique d'un couple de devises. */
  async history(base: string, quote: string, limit = 30) {
    const lignes = await prisma.toumaFxRateSnapshot.findMany({
      where: { baseCurrency: base.toUpperCase(), quoteCurrency: quote.toUpperCase() },
      orderBy: { rateAt: 'desc' },
      take: limit,
    });
    return lignes.map(versTaux);
  },
};

import type { MarketConnector, NormalizedOpportunity } from './base.market.connector.js';

/**
 * Connecteur d'analyse de marché de démonstration : génère des opportunités
 * produits synthétiques avec des signaux réalistes (demande, concurrence,
 * tendance). Remplacez-le par une vraie source (API de tendances, marketplace).
 */
const NICHES: Array<{ niche: string; category: string; region: string; items: string[] }> = [
  { niche: 'maison & cuisine', category: 'maison', region: 'EU', items: ['Distributeur de savon automatique', 'Planche à découper pliable', 'Organiseur de tiroir modulable', 'Bouilloire à température réglable'] },
  { niche: 'sport & bien-être', category: 'sport', region: 'EU', items: ['Bandes de résistance set', 'Bouteille isotherme 1L', 'Tapis de yoga antidérapant', 'Masseur de nuque électrique'] },
  { niche: 'accessoires tech', category: 'electronique', region: 'Asia', items: ['Support téléphone magnétique', 'Hub USB-C 6-en-1', 'Écouteurs sans fil sport', 'Chargeur sans fil 3-en-1'] },
  { niche: 'animalerie', category: 'animalerie', region: 'EU', items: ['Fontaine à eau pour chat', 'Brosse anti-poils réutilisable', 'Jouet distributeur de croquettes'] },
  { niche: 'beauté', category: 'beaute', region: 'EU', items: ['Rouleau de massage facial', 'Lisseur à cheveux portable', 'Miroir LED grossissant'] },
];

function rnd(min: number, max: number): number {
  return Number((min + Math.random() * (max - min)).toFixed(0));
}

export class MockMarketConnector implements MarketConnector {
  readonly name = 'mock-market';

  async discover(params?: { category?: string; region?: string; limit?: number }): Promise<NormalizedOpportunity[]> {
    const out: NormalizedOpportunity[] = [];

    for (const group of NICHES) {
      if (params?.category && group.category !== params.category) continue;
      if (params?.region && group.region !== params.region) continue;

      for (const title of group.items) {
        const demandScore = rnd(40, 100);
        const competitionScore = rnd(10, 90);
        const trendScore = rnd(30, 100);
        const cost = Number((3 + Math.random() * 25).toFixed(2));
        const sale = Number((cost * (2 + Math.random())).toFixed(2));

        out.push({
          externalId: `mock-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          title,
          category: group.category,
          keywords: title.toLowerCase().split(' ').slice(0, 4).join(','),
          niche: group.niche,
          region: group.region,
          demandScore,
          competitionScore,
          trendScore,
          estimatedCostPrice: cost,
          estimatedSalePrice: sale,
          rawMetrics: {
            monthlySearches: rnd(2000, 90000),
            adCompetition: Number((competitionScore / 100).toFixed(2)),
            estimatedMonthlySales: rnd(50, 3000),
          },
        });
      }
    }

    const limit = params?.limit ?? out.length;
    return out.slice(0, limit);
  }
}

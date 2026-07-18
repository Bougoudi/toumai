/**
 * Connecteur de veille concurrentielle : scanne une boutique et remonte
 * ses produits qui se vendent bien (ventes récentes).
 *
 * L'implémentation `mock` génère des données plausibles. Pour du réel :
 *  - eBay : Browse API / Marketplace Insights API (nécessite un app token),
 *  - Etsy/Amazon : API publiques ou scraping conforme aux CGU.
 * Gardez la même signature et branchez l'appel HTTP dans `scanShop`.
 */
export interface CompetitorScanItem {
  externalId: string;
  title: string;
  category: string;
  price: number;
  currency: string;
  soldCount: number;
  imageUrl?: string;
  url?: string;
}

export interface CompetitorConnector {
  readonly platform: string;
  scanShop(shopName: string, shopUrl?: string): Promise<CompetitorScanItem[]>;
}

const CATALOG = [
  { cat: 'maison', items: ['Organiseur de tiroir', 'Distributeur de savon auto', 'Range-ustensiles mural', 'Boîtes de conservation (lot)'] },
  { cat: 'sport', items: ['Bandes de résistance', 'Gourde isotherme 1L', 'Corde à sauter lestée', 'Tapis de yoga'] },
  { cat: 'electronique', items: ['Support téléphone voiture', 'Hub USB-C 6-en-1', 'Écouteurs sport', 'Lampe LED bureau'] },
  { cat: 'beaute', items: ['Rouleau de jade', 'Miroir LED', 'Brosse lissante', 'Set pinceaux maquillage'] },
  { cat: 'animalerie', items: ['Fontaine à eau chat', 'Brosse anti-poils', 'Tapis de léchage'] },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export class MockCompetitorConnector implements CompetitorConnector {
  readonly platform: string;
  constructor(platform = 'ebay') {
    this.platform = platform;
  }

  async scanShop(shopName: string, _shopUrl?: string): Promise<CompetitorScanItem[]> {
    const seed = hash(shopName);
    // Pseudo-aléatoire déterministe dans [0, 1[ (positif, stable par boutique).
    const unit = (i: number) => {
      const x = Math.sin(seed * 0.0001 + i * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    const out: CompetitorScanItem[] = [];
    let i = 0;
    for (const group of CATALOG) {
      for (const title of group.items) {
        i += 1;
        // Chaque scan varie un peu (ventes récentes).
        const soldCount = 30 + Math.floor(unit(i) * 470) + Math.floor(Math.random() * 50);
        const price = Number((6 + unit(i * 7) * 44).toFixed(2));
        out.push({
          externalId: `${this.platform}-${seed}-${i}`,
          title: `${title}`,
          category: group.cat,
          price,
          currency: 'EUR',
          soldCount,
          imageUrl: `https://picsum.photos/seed/${seed}-${i}/300/300`,
          url: `https://www.${this.platform}.com/itm/${seed}${i}`,
        });
      }
    }
    // Trie par ventes décroissantes et garde les meilleurs.
    return out.sort((a, b) => b.soldCount - a.soldCount).slice(0, 14);
  }
}

const connectors: Record<string, CompetitorConnector> = {
  ebay: new MockCompetitorConnector('ebay'),
  etsy: new MockCompetitorConnector('etsy'),
  amazon: new MockCompetitorConnector('amazon'),
};

export function getCompetitorConnector(platform: string): CompetitorConnector {
  return connectors[platform] ?? connectors.ebay;
}

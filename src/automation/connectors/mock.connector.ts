import type { NormalizedSupplier, SupplierConnector } from './base.connector.js';

/**
 * Connecteur de démonstration : génère des fournisseurs synthétiques.
 * Remplacez-le par un connecteur réel (appel HTTP vers une API/annuaire).
 * Il montre le contrat attendu et permet de tester l'automatisation de bout en bout.
 */
const CATALOG: Omit<NormalizedSupplier, 'externalId'>[] = [
  {
    name: 'Sahel Agro Supplies',
    country: 'Tchad',
    region: 'Africa',
    website: 'https://sahel-agro.example',
    email: 'contact@sahel-agro.example',
    rating: 4.6,
    verified: true,
    certifications: 'ISO9001,HACCP',
    leadTimeDays: 14,
    minOrderValue: 500,
    currency: 'EUR',
    offers: [
      { title: 'Graines de sésame bio', category: 'agroalimentaire', keywords: 'sesame,graines,bio', unitPrice: 1.2, moq: 1000, leadTimeDays: 14 },
      { title: 'Gomme arabique brute', category: 'agroalimentaire', keywords: 'gomme,arabique', unitPrice: 3.5, moq: 500, leadTimeDays: 21 },
    ],
  },
  {
    name: 'Atlas Textile Group',
    country: 'Maroc',
    region: 'Africa',
    website: 'https://atlas-textile.example',
    rating: 4.2,
    verified: true,
    certifications: 'OEKO-TEX,ISO9001',
    leadTimeDays: 25,
    minOrderValue: 1200,
    offers: [
      { title: 'T-shirts coton 180g', category: 'textile', keywords: 'tshirt,coton,vetement', unitPrice: 2.8, moq: 300, leadTimeDays: 25 },
    ],
  },
  {
    name: 'Shenzhen ElectroParts',
    country: 'Chine',
    region: 'Asia',
    website: 'https://electroparts.example',
    rating: 3.9,
    verified: false,
    certifications: 'CE,RoHS',
    leadTimeDays: 40,
    minOrderValue: 800,
    offers: [
      { title: 'Chargeurs USB-C 20W', category: 'electronique', keywords: 'chargeur,usb,electronique', unitPrice: 1.9, moq: 2000, leadTimeDays: 40 },
      { title: 'Câbles HDMI 2m', category: 'electronique', keywords: 'cable,hdmi', unitPrice: 0.8, moq: 5000, leadTimeDays: 35 },
    ],
  },
  {
    name: 'Lyon Packaging Solutions',
    country: 'France',
    region: 'EU',
    website: 'https://lyon-pack.example',
    email: 'sales@lyon-pack.example',
    rating: 4.8,
    verified: true,
    certifications: 'ISO9001,FSC',
    leadTimeDays: 7,
    minOrderValue: 300,
    offers: [
      { title: 'Cartons ondulés recyclés', category: 'emballage', keywords: 'carton,emballage,recycle', unitPrice: 0.45, moq: 1000, leadTimeDays: 7 },
    ],
  },
];

export class MockConnector implements SupplierConnector {
  readonly name = 'mock';

  async fetchSuppliers(params?: { category?: string; region?: string }): Promise<NormalizedSupplier[]> {
    // Simule une variabilité de disponibilité/prix comme le ferait une vraie source.
    const jitter = () => 1 + (Math.random() - 0.5) * 0.1; // ±5 %

    return CATALOG.filter((s) => {
      if (params?.region && s.region?.toLowerCase() !== params.region.toLowerCase()) return false;
      if (params?.category && !s.offers.some((o) => o.category === params.category)) return false;
      return true;
    }).map((s, i) => ({
      ...s,
      externalId: `mock-${i}-${s.name.toLowerCase().replace(/\s+/g, '-')}`,
      offers: s.offers.map((o) => ({
        ...o,
        externalId: `mock-${i}-${o.title.toLowerCase().replace(/\s+/g, '-')}`,
        unitPrice: o.unitPrice ? Number((o.unitPrice * jitter()).toFixed(2)) : undefined,
        inStock: Math.random() > 0.1,
      })),
    }));
  }
}

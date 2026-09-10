/**
 * Jeu de données de développement pour la place de marché TOUMA.
 *
 * Corridor pilote : Tchad (TD) ↔ Cameroun (CM). Les autres pays sont présents
 * mais inactifs : ouvrir un marché consiste à basculer `active`, jamais à
 * modifier le code.
 *
 * ⚠️ Comptes de démonstration : mots de passe volontairement explicites, à
 * n'utiliser qu'en développement. Aucun secret réel n'est présent ici.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../src/db/prisma.js';
import { hashPassword } from '../src/utils/auth.js';
import { slugify } from '../src/touma/lib/slug.js';

const DEV_PASSWORD = 'touma-dev-1234';

const COUNTRIES = [
  { code: 'TD', name: 'Tchad', currency: 'XAF', dialCode: '+235', active: true },
  { code: 'CM', name: 'Cameroun', currency: 'XAF', dialCode: '+237', active: true },
  // Marchés suivants : présents dans le référentiel, désactivés tant que le
  // corridor pilote n'est pas validé.
  { code: 'NG', name: 'Nigeria', currency: 'NGN', dialCode: '+234', active: false },
  { code: 'CI', name: "Côte d'Ivoire", currency: 'XOF', dialCode: '+225', active: false },
  { code: 'SN', name: 'Sénégal', currency: 'XOF', dialCode: '+221', active: false },
  { code: 'GH', name: 'Ghana', currency: 'GHS', dialCode: '+233', active: false },
  { code: 'KE', name: 'Kenya', currency: 'KES', dialCode: '+254', active: false },
];

const CATEGORIES = [
  { name: 'Matières premières & agroalimentaire', segment: 'B2B' },
  { name: 'Emballage & conditionnement', segment: 'B2B' },
  { name: 'Équipement & outillage', segment: 'B2B' },
  { name: 'Mode & textile', segment: 'BOTH' },
  { name: 'Beauté & soins', segment: 'B2C' },
  { name: 'Maison & décoration', segment: 'B2C' },
  { name: 'Accessoires & téléphonie', segment: 'B2C' },
  { name: 'Produits du quotidien', segment: 'B2C' },
];

interface SeedProduct {
  title: string;
  description: string;
  price: string;
  category: string;
  quantity: number;
  minOrderQty?: number;
  weightGrams?: number;
  keywords: string;
  brand?: string;
  /** Visuel de démonstration servi par l'application (public/touma/img). */
  image: string;
  variants?: Array<{ name: string; priceDelta: string; quantity: number }>;
}

const TD_PRODUCTS: SeedProduct[] = [
  {
    title: 'Sésame blanc du Tchad — sac de 25 kg',
    image: '/touma/img/sesame.svg',
    description:
      "Sésame blanc trié, calibre export, récolte de la saison en cours. Conditionné en sacs de 25 kg. Certificat phytosanitaire fourni sur demande. Vendu au sac, tarif dégressif à partir de 20 sacs.",
    price: '38000',
    category: 'Matières premières & agroalimentaire',
    quantity: 240,
    minOrderQty: 5,
    weightGrams: 25000,
    keywords: 'sesame graines export agro tchad gros',
  },
  {
    title: 'Gomme arabique brute — carton de 10 kg',
    image: '/touma/img/gomme.svg',
    description:
      "Gomme arabique (Acacia senegal) récoltée dans le Sahel tchadien, triée à la main. Carton de 10 kg. Idéale pour l'agroalimentaire et la cosmétique.",
    price: '52000',
    category: 'Matières premières & agroalimentaire',
    quantity: 90,
    minOrderQty: 2,
    weightGrams: 10000,
    keywords: 'gomme arabique acacia sahel export',
  },
  {
    title: 'Boubou brodé homme — coton teint à la main',
    image: '/touma/img/boubou.svg',
    description:
      "Boubou traditionnel en coton épais, broderie réalisée à la main sur le col et les manches. Coupe ample. Lavage à la main recommandé.",
    price: '27500',
    category: 'Mode & textile',
    quantity: 60,
    keywords: 'boubou broderie coton mode homme tchad',
    variants: [
      { name: 'Taille M', priceDelta: '0', quantity: 20 },
      { name: 'Taille L', priceDelta: '1500', quantity: 25 },
      { name: 'Taille XL', priceDelta: '3000', quantity: 15 },
    ],
  },
  {
    title: 'Beurre de karité brut — seau de 5 kg',
    image: '/touma/img/karite.svg',
    description:
      "Beurre de karité non raffiné, pressé à froid, sans additif. Seau alimentaire de 5 kg refermable. Convient à la revente en cosmétique artisanale.",
    price: '19500',
    category: 'Beauté & soins',
    quantity: 150,
    minOrderQty: 2,
    weightGrams: 5200,
    keywords: 'karite beurre cosmetique brut naturel',
  },
];

const CM_PRODUCTS: SeedProduct[] = [
  {
    title: 'Cacao en fèves fermentées — sac de 50 kg',
    image: '/touma/img/cacao.svg',
    description:
      "Fèves de cacao fermentées et séchées, région du Centre. Sac de jute de 50 kg. Taux d'humidité contrôlé, échantillon disponible avant commande.",
    price: '145000',
    category: 'Matières premières & agroalimentaire',
    quantity: 40,
    minOrderQty: 1,
    weightGrams: 50000,
    keywords: 'cacao feves fermentation export cameroun',
  },
  {
    title: 'Cartons ondulés double cannelure — lot de 100',
    image: '/touma/img/cartons.svg',
    description:
      "Cartons d'expédition double cannelure 40×30×30 cm, livrés à plat. Lot de 100 unités. Résistance testée pour le transport routier transfrontalier.",
    price: '68000',
    category: 'Emballage & conditionnement',
    quantity: 75,
    minOrderQty: 1,
    weightGrams: 32000,
    keywords: 'carton emballage expedition logistique lot',
  },
  {
    title: 'Pagne wax 6 yards — impression Douala',
    image: '/touma/img/pagne.svg',
    description:
      "Pagne wax 100 % coton, 6 yards, impression réalisée à Douala. Couleurs stables au lavage. Vendu à la pièce, remise à partir de 10 pièces.",
    price: '16500',
    category: 'Mode & textile',
    quantity: 300,
    keywords: 'pagne wax tissu coton mode douala',
    variants: [
      { name: 'Motif bleu', priceDelta: '0', quantity: 120 },
      { name: 'Motif ocre', priceDelta: '0', quantity: 100 },
      { name: 'Motif vert', priceDelta: '500', quantity: 80 },
    ],
  },
  {
    title: 'Chargeur solaire portatif 20 000 mAh',
    image: '/touma/img/solaire.svg',
    description:
      "Batterie externe avec panneau solaire intégré, 20 000 mAh, double port USB, lampe LED. Adaptée aux zones à électricité intermittente. Garantie 12 mois.",
    price: '24000',
    category: 'Accessoires & téléphonie',
    quantity: 120,
    keywords: 'solaire chargeur batterie telephone energie',
    brand: 'Sahel Power',
  },
  {
    title: 'Savon noir africain — carton de 48 pains',
    image: '/touma/img/savon.svg',
    description:
      "Savon noir traditionnel à base de cendres de cabosses et d'huile de palmiste. Carton de 48 pains de 150 g. Étiquetage personnalisable pour les revendeurs.",
    price: '32000',
    category: 'Beauté & soins',
    quantity: 85,
    minOrderQty: 1,
    weightGrams: 7500,
    keywords: 'savon noir beaute soin revente carton',
  },
];

async function upsertUser(input: { email: string; name: string; role: 'BUYER' | 'SELLER' | 'ADMIN'; countryCode: string; phone: string }) {
  const passwordHash = await hashPassword(DEV_PASSWORD);
  return prisma.user.upsert({
    where: { email: input.email },
    update: { toumaRole: input.role, countryCode: input.countryCode },
    create: {
      email: input.email,
      name: input.name,
      passwordHash,
      role: input.role === 'ADMIN' ? 'admin' : 'user',
      toumaRole: input.role,
      countryCode: input.countryCode,
      phone: input.phone,
    },
  });
}

async function seedProducts(storeId: string, countryCode: string, currency: string, products: SeedProduct[], categories: Map<string, string>) {
  for (const p of products) {
    const slug = slugify(p.title);
    const existing = await prisma.toumaProduct.findUnique({ where: { slug } });
    if (existing) continue;

    const product = await prisma.toumaProduct.create({
      data: {
        storeId,
        categoryId: categories.get(p.category) ?? null,
        title: p.title,
        slug,
        description: p.description,
        brand: p.brand ?? null,
        price: new Prisma.Decimal(p.price),
        currency,
        countryCode,
        minOrderQty: p.minOrderQty ?? 1,
        weightGrams: p.weightGrams ?? 800,
        keywords: p.keywords,
        status: 'ACTIVE',
        publishedAt: new Date(),
        images: { create: [{ url: p.image, alt: p.title, position: 0 }] },
      },
    });

    if (p.variants?.length) {
      for (const [i, v] of p.variants.entries()) {
        const variant = await prisma.toumaProductVariant.create({
          data: { productId: product.id, name: v.name, priceDelta: new Prisma.Decimal(v.priceDelta), position: i },
        });
        await prisma.toumaInventory.create({ data: { productId: product.id, variantId: variant.id, quantity: v.quantity } });
      }
    } else {
      await prisma.toumaInventory.create({ data: { productId: product.id, variantId: null, quantity: p.quantity } });
    }
  }
}

async function main() {
  console.log('→ [Touma] Référentiel des pays (corridor pilote TD ↔ CM)…');
  for (const c of COUNTRIES) {
    await prisma.country.upsert({
      where: { code: c.code },
      update: { name: c.name, currency: c.currency, dialCode: c.dialCode, active: c.active },
      create: { ...c, buyingEnabled: c.active, sellingEnabled: c.active },
    });
  }

  console.log('→ [Touma] Catégories du catalogue…');
  const categories = new Map<string, string>();
  for (const [i, c] of CATEGORIES.entries()) {
    const category = await prisma.toumaCategory.upsert({
      where: { slug: slugify(c.name) },
      update: { name: c.name, segment: c.segment, position: i },
      create: { name: c.name, slug: slugify(c.name), segment: c.segment, position: i },
    });
    categories.set(c.name, category.id);
  }

  console.log('→ [Touma] Transporteur de démonstration…');
  await prisma.toumaShippingProvider.upsert({
    where: { code: 'mock' },
    update: { name: 'Touma Mock Carrier', active: true },
    create: { code: 'mock', name: 'Touma Mock Carrier', countries: 'TD,CM', active: true },
  });

  console.log('→ [Touma] Comptes de démonstration…');
  const admin = await upsertUser({ email: 'admin@touma.dev', name: 'Administration Touma', role: 'ADMIN', countryCode: 'TD', phone: '+23590000001' });
  const sellerTd = await upsertUser({ email: 'vendeur.td@touma.dev', name: 'Aïcha Mahamat', role: 'SELLER', countryCode: 'TD', phone: '+23590000002' });
  const sellerCm = await upsertUser({ email: 'vendeur.cm@touma.dev', name: 'Blaise Ngoumou', role: 'SELLER', countryCode: 'CM', phone: '+23790000003' });
  const buyer = await upsertUser({ email: 'acheteur@touma.dev', name: 'Fatimé Oumar', role: 'BUYER', countryCode: 'TD', phone: '+23590000004' });

  console.log('→ [Touma] Boutiques…');
  const storeTd = await prisma.toumaStore.upsert({
    where: { slug: 'sahel-negoce' },
    update: {},
    create: {
      ownerId: sellerTd.id,
      name: 'Sahel Négoce',
      slug: 'sahel-negoce',
      description: "Grossiste tchadien en produits agricoles et textiles. Expédition vers toute l'Afrique centrale.",
      countryCode: 'TD',
      city: "N'Djamena",
      phone: '+23590000002',
      status: 'ACTIVE',
      verificationStatus: 'APPROVED',
    },
  });
  const storeCm = await prisma.toumaStore.upsert({
    where: { slug: 'douala-trade-house' },
    update: {},
    create: {
      ownerId: sellerCm.id,
      name: 'Douala Trade House',
      slug: 'douala-trade-house',
      description: 'Import-export basé à Douala : agroalimentaire, emballage, textile et accessoires.',
      countryCode: 'CM',
      city: 'Douala',
      phone: '+23790000003',
      status: 'ACTIVE',
      verificationStatus: 'PENDING',
    },
  });

  console.log('→ [Touma] Catalogue de démonstration…');
  await seedProducts(storeTd.id, 'TD', 'XAF', TD_PRODUCTS, categories);
  await seedProducts(storeCm.id, 'CM', 'XAF', CM_PRODUCTS, categories);

  console.log('→ [Touma] Dossier Touma Verified en attente (pour tester la file d’administration)…');
  const pending = await prisma.toumaSellerVerification.findFirst({ where: { storeId: storeCm.id } });
  if (!pending) {
    await prisma.toumaSellerVerification.create({
      data: {
        storeId: storeCm.id,
        businessType: 'COMPANY',
        legalName: 'Douala Trade House SARL',
        registrationNo: 'RC/DLA/2019/B/1234',
        contactPhone: '+23790000003',
        contactEmail: 'vendeur.cm@touma.dev',
        documents: [{ kind: 'registre_commerce', url: 'private://demo/rc.pdf', uploadedAt: new Date().toISOString() }] as object,
      },
    });
  }

  console.log('→ [Touma] Points relais du corridor…');
  const PICKUP_POINTS = [
    { code: 'TD-NDJ-01', name: 'Relais Marché de Dembé', countryCode: 'TD', city: "N'Djamena", district: 'Dembé', landmark: 'Face à la grande mosquée', addressLine: 'Avenue Mobutu, Dembé', openingHours: 'Lun–Sam 8h–18h' },
    { code: 'TD-NDJ-02', name: 'Relais Moursal', countryCode: 'TD', city: "N'Djamena", district: 'Moursal', landmark: 'À côté de la pharmacie du rond-point', addressLine: 'Rue 3040, Moursal', openingHours: 'Lun–Ven 9h–17h' },
    { code: 'CM-DLA-01', name: 'Relais Akwa', countryCode: 'CM', city: 'Douala', district: 'Akwa', landmark: 'Immeuble face à la station-service', addressLine: 'Boulevard de la Liberté, Akwa', openingHours: 'Lun–Sam 8h–19h' },
    { code: 'CM-YDE-01', name: 'Relais Mvog-Mbi', countryCode: 'CM', city: 'Yaoundé', district: 'Mvog-Mbi', landmark: 'Près du carrefour Mvog-Mbi', addressLine: 'Avenue Kennedy, Mvog-Mbi', openingHours: 'Lun–Sam 8h–18h' },
  ];
  for (const point of PICKUP_POINTS) {
    await prisma.toumaPickupPoint.upsert({ where: { code: point.code }, update: point, create: point });
  }

  console.log('→ [Touma] Adresse de livraison de l’acheteur…');
  const address = await prisma.toumaAddress.findFirst({ where: { userId: buyer.id } });
  if (!address) {
    await prisma.toumaAddress.create({
      data: {
        userId: buyer.id,
        fullName: 'Fatimé Oumar',
        phone: '+23590000004',
        line1: 'Avenue Charles de Gaulle, quartier Klemat',
        city: "N'Djamena",
        countryCode: 'TD',
        isDefault: true,
      },
    });
  }

  console.log('→ [Touma] TOUMA Business : profil entreprise et appel d’offres de démonstration…');
  const business = await prisma.toumaBusinessProfile.upsert({
    where: { userId: buyer.id },
    update: {},
    create: {
      userId: buyer.id,
      legalName: 'Sahel Distribution SARL',
      registrationNo: 'RCCM/TD/NDJ/2021/B/0421',
      sector: 'Distribution agroalimentaire',
      countryCode: 'TD',
      city: "N'Djamena",
      phone: '+23590000004',
      annualVolume: '50–100 M XAF',
    },
  });

  const existingRfq = await prisma.toumaRfq.findFirst({ where: { buyerId: buyer.id } });
  if (!existingRfq) {
    await prisma.toumaRfq.create({
      data: {
        reference: 'RFQ-DEMO-0001',
        buyerId: buyer.id,
        businessProfileId: business.id,
        title: 'Recherche 500 kg de cacao en fèves — livraison N’Djamena',
        description:
          "Nous recherchons du cacao en fèves fermentées, qualité export, pour une première commande de 500 kg livrée à N'Djamena. Échantillon souhaité avant commande. Paiement à la commande via Touma Pay.",
        countryCode: 'TD',
        city: "N'Djamena",
        sourceCountry: 'CM',
        currency: 'XAF',
        deadline: new Date(Date.now() + 14 * 24 * 3600 * 1000),
        items: {
          create: [
            { name: 'Cacao en fèves fermentées', description: 'Qualité export, humidité contrôlée', quantity: 500, unit: 'kg', targetUnitPrice: '2800' },
          ],
        },
      },
    });
  }

  const [countries, cats, products] = await Promise.all([
    prisma.country.count(),
    prisma.toumaCategory.count(),
    prisma.toumaProduct.count(),
  ]);

  console.log('\n✅ Place de marché Touma prête.');
  console.log(`   Pays : ${countries} · Catégories : ${cats} · Produits : ${products}`);
  console.log('\n   Comptes de développement (mot de passe commun) :');
  console.log(`   • Administration : ${admin.email}`);
  console.log(`   • Vendeur Tchad  : ${sellerTd.email}`);
  console.log(`   • Vendeur Camer. : ${sellerCm.email}`);
  console.log(`   • Acheteur       : ${buyer.email}`);
  console.log(`   • Mot de passe   : ${DEV_PASSWORD}  (développement uniquement)\n`);
}

main()
  .catch((err) => {
    console.error('Échec du peuplement Touma :', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

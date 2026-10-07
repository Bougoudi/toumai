import { prisma } from '../db/prisma.js';
import { getSettings, settingsService } from '../modules/settings/settings.service.js';
import { computeMargin } from '../utils/pricing.js';
import { logger } from '../utils/logger.js';

/**
 * Produits de départ ajoutés à la boutique au démarrage, UNE seule fois chacun
 * (un drapeau en base empêche de les recréer si le vendeur les supprime).
 *
 * Le SKU suit la convention de l'import CJ (« CJ-<SKU CJ> ») : réimporter le
 * produit depuis CJ (Paramètres → Importer, avec le SKU) complète les photos et
 * le prix d'achat sans écraser les textes ci-dessous.
 */
interface StarterProduct {
  flag: string;
  sku: string;
  name: string;
  category: string;
  keywords: string;
  currency: string;
  /** Prix d'achat estimé (CJ affiche 9,62 $ hors livraison). */
  costPrice: number;
  salePrice: number;
  images: string;
  sizes: string;
  colors: string;
  highlights: string;
  steps: string;
  description: string;
  featureIfNone: boolean;
}

const STARTERS: StarterProduct[] = [
  {
    flag: 'starter.sweatPortageTeddy',
    sku: 'CJ-CJWY281211301AZ',
    name: 'Sweat de portage teddy maman & bébé – veste kangourou zippée',
    category: 'Mode maternité & portage',
    keywords: 'sweat de portage,veste de portage,sweat kangourou bébé,pull de portage,veste kangourou maman,sweat teddy,manteau de portage hiver',
    currency: 'EUR',
    costPrice: 8.9,
    salePrice: 34.9,
    // Photos CJ retouchées (flammes et icônes retirées, fond blanc pour la photo réelle).
    images: [
      '/boutique-img/sweat-portage-teddy-beige.jpg',
      '/boutique-img/sweat-portage-teddy-rose.jpg',
      '/boutique-img/sweat-portage-teddy-gris.jpg',
      '/boutique-img/sweat-portage-teddy-photo-reelle.jpg',
      '/boutique-img/sweat-portage-teddy-guide-tailles.jpg',
    ].join(','),
    sizes: 'S,M,L,XL,XXL',
    colors: 'Beige,Rose,Gris',
    highlights: [
      'Bébé au chaud contre vous | Un panneau zippé et une petite capuche à oreilles se referment sur bébé : vous partagez votre chaleur, sans manteau supplémentaire ni couverture qui glisse.',
      'Teddy épais et doux | Une imitation laine d’agneau bouclée et épaissie, douce contre la peau et chaude pour les promenades d’automne et d’hiver.',
      'À porter par-dessus le porte-bébé | Installez bébé dans son porte-bébé ventral, puis refermez le sweat par-dessus : vous restez couverts tous les deux.',
      '2 en 1 : avec ou sans bébé | Refermez simplement le zip central : il redevient une veste à capuche classique pour tous les jours.',
    ].join('\n'),
    steps: [
      'Installez bébé dans son porte-bébé ventral',
      'Enfilez le sweat et ouvrez le panneau bébé',
      'Remontez le zip en gardant le visage de bébé dégagé',
      'Sortez au chaud, bébé à portée de bisou',
    ].join('\n'),
    description: [
      'Le sweat de portage teddy qui garde maman et bébé au chaud, ensemble.',
      'Veste à capuche zippée en matière teddy (sherpa bouclée) épaisse, avec un panneau bébé amovible par zip et une petite capuche à oreilles pour la tête de bébé. Sans bébé, refermez le zip central : c’est une veste à capuche classique, avec deux poches.',
      'Pour qui : mamans (et papas) qui portent leur bébé en porte-bébé ventral et veulent sortir l’automne et l’hiver sans superposer couvertures et manteaux.',
      'Matière : imitation laine d’agneau (teddy) épaissie. Coupe ample. Coloris : beige, rose, gris.',
      'Guide des tailles (vêtement à plat, ±2 cm) — S : poitrine 110, épaules 52, manches 63, longueur 60 · M : 114 / 54 / 64,5 / 61 · L : 118 / 56 / 66 / 62 · XL : 122 / 58 / 67,5 / 63 · XXL : 126 / 60 / 69 / 64.',
      'Ces tailles taillent 1 à 2 tailles plus petit que les tailles européennes : entre deux tailles, ou pour porter bébé dedans, prenez la taille au-dessus.',
      'Sécurité de portage : ce sweat ne remplace pas un porte-bébé. Utilisez toujours un porte-bébé adapté au poids de votre enfant, gardez son visage visible et dégagé, le menton décollé de la poitrine, et son nez et sa bouche jamais couverts par le tissu ou la capuche. Bébé doit rester à portée de bisou.',
      'Entretien : lavage délicat à 30 °C, ne pas sécher en machine pour garder la douceur du teddy.',
    ].join('\n'),
    featureIfNone: true,
  },
];

export async function ensureStarterCatalog(): Promise<void> {
  for (const s of STARTERS) {
    try {
      const done = await prisma.setting.findUnique({ where: { key: s.flag } });
      if (done) continue;
      const existing = await prisma.product.findUnique({ where: { sku: s.sku } });
      const product =
        existing ??
        (await prisma.product.create({
          data: {
            sku: s.sku,
            name: s.name,
            description: s.description,
            category: s.category,
            keywords: s.keywords,
            currency: s.currency,
            costPrice: s.costPrice,
            salePrice: s.salePrice,
            margin: computeMargin(s.salePrice, s.costPrice),
            images: s.images,
            sizes: s.sizes,
            colors: s.colors,
            highlights: s.highlights,
            steps: s.steps,
            source: 'cj',
            status: 'ACTIVE',
          },
        }));
      await prisma.setting.create({ data: { key: s.flag, value: JSON.stringify(product.id) } });
      if (s.featureIfNone && !getSettings().shopFeaturedProductId) {
        await settingsService.update({ shopFeaturedProductId: product.id });
      }
      logger.info('Produit de départ ajouté à la boutique', { sku: s.sku, productId: product.id });
    } catch (err) {
      logger.warn('Produit de départ non ajouté', { sku: s.sku, err: err instanceof Error ? err.message : String(err) });
    }
  }
}

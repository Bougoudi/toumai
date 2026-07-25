import { prisma } from '../../db/prisma.js';
import { orderService } from '../../modules/orders/order.service.js';
import { logger } from '../../utils/logger.js';

const FIRST_NAMES = ['Aïcha', 'Moussa', 'Fatou', 'Jean', 'Léa', 'Karim', 'Sofia', 'Yacine', 'Marie', 'Tom'];
const CITIES = [
  { city: 'Paris', country: 'France', zip: '75001' },
  { city: 'Lyon', country: 'France', zip: '69001' },
  { city: 'N’Djamena', country: 'Tchad', zip: '' },
  { city: 'Bruxelles', country: 'Belgique', zip: '1000' },
  { city: 'Dakar', country: 'Sénégal', zip: '' },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Simulateur de demande : génère des commandes clients payées à partir des
 * produits actifs. Permet au pilote automatique de faire tourner le pilier 3
 * (achat & expédition) sans boutique réelle branchée.
 *
 * En production, ces commandes proviennent de la vraie boutique
 * (webhook Shopify/WooCommerce/Stripe) au lieu de ce simulateur.
 */
export async function simulateDemandJob(orders = 3) {
  const activeProducts = await prisma.product.findMany({
    where: { status: 'ACTIVE', salePrice: { gt: 0 } },
    select: { id: true },
    take: 200,
  });
  if (activeProducts.length === 0) {
    logger.info('Simulateur de demande : aucun produit actif à vendre');
    return 0;
  }

  let created = 0;
  for (let i = 0; i < orders; i += 1) {
    const location = pick(CITIES);
    const name = pick(FIRST_NAMES);
    const itemCount = 1 + Math.floor(Math.random() * 2);
    const chosen = new Set<string>();
    while (chosen.size < Math.min(itemCount, activeProducts.length)) {
      chosen.add(pick(activeProducts).id);
    }

    await orderService.create({
      customer: {
        name,
        email: `${name.toLowerCase().replace(/[^a-z]/g, '')}.${Date.now()}@example.com`,
        city: location.city,
        country: location.country,
        zip: location.zip || undefined,
      },
      items: [...chosen].map((productId) => ({
        productId,
        quantity: 1 + Math.floor(Math.random() * 3),
      })),
      markPaid: true,
    });
    created += 1;
  }

  logger.info('Simulateur de demande', { commandes: created });
  return created;
}

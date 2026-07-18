import { prisma } from '../src/db/prisma.js';
import { refreshSuppliersJob } from '../src/automation/jobs/refreshSuppliers.job.js';
import { marketScanJob } from '../src/automation/jobs/marketScan.job.js';
import { generationService } from '../src/modules/products/generation.service.js';
import { orderService } from '../src/modules/orders/order.service.js';
import { fulfillmentService } from '../src/modules/orders/fulfillment.service.js';

/**
 * Peuple la base en déroulant les 4 piliers :
 *   1. Analyse marché  -> opportunités
 *   2. Génération      -> produits
 *   4. Sourcing        -> fournisseurs
 *   3. Achat & envoi   -> une commande de démonstration honorée automatiquement
 */
async function main() {
  console.log('→ [4] Synchronisation des fournisseurs (connecteur mock)...');
  await refreshSuppliersJob();

  console.log('→ [1] Analyse de marché...');
  await marketScanJob();

  console.log('→ [2] Génération de produits à partir des opportunités...');
  const run = await generationService.generate({ limit: 20, autoPublish: true });
  console.log(`   ${run.generated} produits générés (${run.skipped} ignorés).`);

  // Ajoute quelques produits sourcés en Afrique (pilier 4) pour la démo sésame.
  const agroProducts = [
    { sku: 'AGRO-SESAME-001', name: 'Graines de sésame', category: 'agroalimentaire', keywords: 'sesame,graines,bio', costPrice: 1.2, salePrice: 3.49, region: 'Africa', targetUnitPrice: 1.3, status: 'ACTIVE', source: 'manual' },
  ];
  for (const p of agroProducts) {
    await prisma.product.upsert({ where: { sku: p.sku }, create: p, update: p });
  }

  console.log('→ [3] Commande de démonstration + exécution automatique...');
  const anyProduct =
    (await prisma.product.findUnique({ where: { sku: 'AGRO-SESAME-001' } })) ??
    (await prisma.product.findFirst({ where: { status: 'ACTIVE' } }));
  if (anyProduct) {
    const order = await orderService.create({
      customer: {
        name: 'Client Démo',
        email: 'client.demo@example.com',
        address: '12 rue du Marché',
        city: 'Paris',
        country: 'France',
        zip: '75001',
      },
      items: [{ productId: anyProduct.id, quantity: 2 }],
      markPaid: true,
    });
    const status = await fulfillmentService.fulfillOrder(order);
    console.log(`   Commande ${order.orderNumber} → ${status}`);
  }

  const [opps, products, suppliers, orders] = await Promise.all([
    prisma.marketOpportunity.count(),
    prisma.product.count(),
    prisma.supplier.count(),
    prisma.order.count(),
  ]);
  console.log(
    `✓ Seed terminé : ${opps} opportunités, ${products} produits, ${suppliers} fournisseurs, ${orders} commande(s).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

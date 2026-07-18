import { prisma } from '../src/db/prisma.js';
import { refreshSuppliersJob } from '../src/automation/jobs/refreshSuppliers.job.js';

/**
 * Peuple la base :
 *  1. Synchronise les fournisseurs via le connecteur de démonstration.
 *  2. Crée quelques produits d'exemple.
 */
async function main() {
  console.log('→ Synchronisation des fournisseurs (connecteur mock)...');
  await refreshSuppliersJob();

  console.log('→ Création de produits d’exemple...');
  const products = [
    {
      sku: 'AGRO-SESAME-001',
      name: 'Graines de sésame',
      category: 'agroalimentaire',
      keywords: 'sesame,graines,bio',
      targetUnitPrice: 1.3,
      targetQuantity: 2000,
      region: 'Africa',
      requiredCertifications: 'ISO9001',
    },
    {
      sku: 'ELEC-CHARGER-001',
      name: 'Chargeur USB-C',
      category: 'electronique',
      keywords: 'chargeur,usb,electronique',
      targetUnitPrice: 2.0,
      targetQuantity: 5000,
      region: 'Asia',
      requiredCertifications: 'CE,RoHS',
    },
    {
      sku: 'PACK-CARTON-001',
      name: 'Cartons d’emballage recyclés',
      category: 'emballage',
      keywords: 'carton,emballage,recycle',
      targetUnitPrice: 0.5,
      targetQuantity: 3000,
      region: 'EU',
      requiredCertifications: 'FSC',
    },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { sku: p.sku },
      create: p,
      update: p,
    });
  }

  const supplierCount = await prisma.supplier.count();
  const productCount = await prisma.product.count();
  console.log(`✓ Seed terminé : ${supplierCount} fournisseurs, ${productCount} produits.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

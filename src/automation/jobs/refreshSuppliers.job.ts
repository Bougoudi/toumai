import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';
import type { NormalizedSupplier } from '../connectors/base.connector.js';
import { getSupplierConnectors } from '../connectors/registry.js';


/**
 * Upsert d'un fournisseur normalisé et de ses offres.
 * La déduplication se fait sur (source + name) faute d'un identifiant externe
 * persisté en base ; adaptez si vous ajoutez une colonne `externalId`.
 */
async function upsertSupplier(source: string, s: NormalizedSupplier) {
  const existing = await prisma.supplier.findFirst({
    where: { source, name: s.name },
    select: { id: true },
  });

  const data = {
    name: s.name,
    country: s.country ?? null,
    region: s.region ?? null,
    website: s.website ?? null,
    email: s.email ?? null,
    phone: s.phone ?? null,
    rating: s.rating ?? 0,
    verified: s.verified ?? false,
    certifications: s.certifications ?? '',
    leadTimeDays: s.leadTimeDays ?? null,
    minOrderValue: s.minOrderValue ?? null,
    currency: s.currency ?? 'EUR',
    source,
  };

  const supplierId = existing
    ? (await prisma.supplier.update({ where: { id: existing.id }, data })).id
    : (await prisma.supplier.create({ data })).id;

  // Remplace les offres pour refléter l'état courant de la source.
  await prisma.offer.deleteMany({ where: { supplierId } });
  if (s.offers.length) {
    await prisma.offer.createMany({
      data: s.offers.map((o) => ({
        supplierId,
        title: o.title,
        category: o.category,
        keywords: o.keywords,
        unitPrice: o.unitPrice ?? null,
        currency: o.currency ?? data.currency,
        moq: o.moq ?? null,
        leadTimeDays: o.leadTimeDays ?? null,
        inStock: o.inStock ?? true,
      })),
    });
  }

  return supplierId;
}

/**
 * Job d'automatisation : interroge tous les connecteurs et synchronise
 * la base fournisseurs. Idempotent — peut tourner en boucle sans doublons.
 */
export async function refreshSuppliersJob(params?: { category?: string; region?: string }) {
  let count = 0;
  const connectors = await getSupplierConnectors();
  for (const connector of connectors) {
    const suppliers = await connector.fetchSuppliers(params);
    for (const s of suppliers) {
      await upsertSupplier(connector.name, s);
      count += 1;
    }
    logger.info('Connecteur synchronisé', { connector: connector.name, suppliers: suppliers.length });
  }
  logger.info('Rafraîchissement fournisseurs terminé', { total: count });
  return count;
}

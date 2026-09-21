import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { buildProductFilters, filtresTransfrontaliers, type FilterDimension } from './product.service.js';
import type { ListProductsQuery } from './product.schema.js';

/**
 * FACETTES DE RECHERCHE.
 *
 * Des filtres sans compteur obligent l'acheteur à deviner : il clique, la liste
 * se vide, il recommence. Une facette annonce **combien de résultats** chaque
 * choix donnerait — et se calcule donc en excluant le filtre de sa propre
 * dimension, sinon choisir « Cameroun » mettrait tous les autres pays à zéro et
 * l'acheteur ne pourrait plus changer d'avis sans tout réinitialiser.
 *
 * Tous les compteurs viennent d'agrégats en base : aucun n'est estimé.
 */

/** Tranches de prix « rondes », lisibles par un humain. */
function niceStep(range: number): number {
  if (range <= 0) return 1;
  const rough = range / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  // On arrondit à 1, 2, 5 ou 10 fois la puissance de dix la plus proche.
  for (const factor of [1, 2, 5, 10]) {
    if (rough <= factor * magnitude) return factor * magnitude;
  }
  return 10 * magnitude;
}

export const facetsService = {
  /**
   * Compteurs par catégorie, pays, disponibilité, vérification et tranche de
   * prix, pour la recherche en cours.
   */
  async forQuery(query: ListProductsQuery) {
    /**
     * Les restrictions transfrontalières (`deliverTo`, `corridor`) ne sont pas
     * une dimension de facette : aucun compteur ne les propose, et elles
     * s'appliquent donc à **tous** les compteurs, sans exclusion possible.
     *
     * Les omettre ici donnerait des nombres qui ne correspondent pas à la
     * liste affichée — « Cameroun (42) » suivi de douze résultats. C'est
     * précisément ce que les facettes existent pour éviter.
     */
    const transfrontalier = await filtresTransfrontaliers(query);
    const filtres = (exclude?: FilterDimension) => [...buildProductFilters(query, { exclude }), ...transfrontalier];
    const whereFor = (exclude?: FilterDimension) => ({ AND: filtres(exclude) });

    const [byCategory, byCountry, inStock, outOfStock, verified, priceStats, currencies] = await Promise.all([
      prisma.toumaProduct.groupBy({ by: ['categoryId'], where: whereFor('category'), _count: { _all: true } }),
      prisma.toumaProduct.groupBy({ by: ['countryCode'], where: whereFor('country'), _count: { _all: true } }),
      prisma.toumaProduct.count({
        where: { AND: [...filtres('availability'), { inventory: { some: { quantity: { gt: 0 } } } }] },
      }),
      prisma.toumaProduct.count({
        where: { AND: [...filtres('availability'), { inventory: { every: { quantity: { lte: 0 } } } }] },
      }),
      prisma.toumaProduct.count({
        where: { AND: [...filtres('verified'), { store: { verificationStatus: 'APPROVED' } }] },
      }),
      prisma.toumaProduct.aggregate({ where: whereFor('price'), _min: { price: true }, _max: { price: true }, _count: { _all: true } }),
      prisma.toumaProduct.groupBy({ by: ['currency'], where: whereFor('price'), _count: { _all: true } }),
    ]);

    const [categories, countries] = await Promise.all([
      prisma.toumaCategory.findMany({
        where: { id: { in: byCategory.map((c) => c.categoryId).filter((id): id is string => Boolean(id)) } },
        select: { id: true, name: true, slug: true },
      }),
      prisma.country.findMany({
        where: { code: { in: byCountry.map((c) => c.countryCode).filter((c): c is string => Boolean(c)) } },
        select: { code: true, name: true },
      }),
    ]);
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const countryByCode = new Map(countries.map((c) => [c.code, c]));

    // Tranches de prix : elles n'ont de sens que dans une devise unique.
    // Répartir un panier multi-devises reviendrait à inventer un taux.
    let priceFacet: {
      currency: string | null;
      min: string | null;
      max: string | null;
      buckets: Array<{ from: string; to: string | null; count: number }>;
      /** Renseigné quand les tranches ne peuvent pas être proposées. */
      unavailableReason?: string;
    } = { currency: null, min: null, max: null, buckets: [] };

    if (currencies.length > 1) {
      priceFacet.unavailableReason = 'Plusieurs devises dans ces résultats : affinez par pays pour comparer les prix.';
    } else if (priceStats._count._all > 0 && priceStats._min.price && priceStats._max.price) {
      const min = Number(priceStats._min.price.toString());
      const max = Number(priceStats._max.price.toString());
      const currency = currencies[0]?.currency ?? null;
      priceFacet = { currency, min: String(min), max: String(max), buckets: [] };

      if (max > min) {
        const step = niceStep(max - min);
        const start = Math.floor(min / step) * step;
        const bounds: number[] = [];
        for (let value = start; value < max && bounds.length < 6; value += step) bounds.push(value);

        const counts = await Promise.all(
          bounds.map((from, index) => {
            const to = index === bounds.length - 1 ? null : from + step;
            return prisma.toumaProduct
              .count({
                where: {
                  AND: [
                    ...filtres('price'),
                    { price: { gte: new Prisma.Decimal(from), ...(to === null ? {} : { lt: new Prisma.Decimal(to) }) } },
                  ],
                },
              })
              .then((count) => ({ from: String(from), to: to === null ? null : String(to), count }));
          }),
        );
        // Une tranche vide n'aide personne : on ne propose que ce qui existe.
        priceFacet.buckets = counts.filter((b) => b.count > 0);
      }
    }

    return {
      categories: byCategory
        .filter((c) => c.categoryId && categoryById.has(c.categoryId))
        .map((c) => ({ ...categoryById.get(c.categoryId!)!, count: c._count._all }))
        .sort((a, b) => b.count - a.count),
      countries: byCountry
        .filter((c) => c.countryCode)
        .map((c) => ({
          code: c.countryCode!,
          name: countryByCode.get(c.countryCode!)?.name ?? c.countryCode!,
          count: c._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      availability: { inStock, outOfStock },
      verified,
      price: priceFacet,
    };
  },
};

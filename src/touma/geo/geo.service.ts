import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { notFound } from '../lib/errors.js';

/**
 * Consultation de la géographie administrative.
 *
 * **À quoi cela sert, concrètement.** Le §3 l'énonce sans détour : « ne jamais
 * laisser l'utilisateur saisir librement une province lorsqu'une sélection
 * officielle est possible ». Ces lectures sont ce qui rend la sélection
 * possible — sans elles, l'interface n'a rien à proposer et retombe sur le champ
 * de texte qui a produit « N'Djamena », « Ndjamena » et « N’Djaména ».
 *
 * Tout est public et non authentifié : un acheteur choisit sa province avant
 * d'avoir un compte.
 */

const provinceSelect = {
  id: true,
  code: true,
  name: true,
  nameAr: true,
  countryCode: true,
} as const;

export const geoService = {
  /**
   * Provinces d'un pays. Les provinces désactivées sont exclues : elles restent
   * en base pour que les commandes passées restent lisibles, mais elles ne sont
   * plus proposées à la saisie.
   */
  async provinces(countryCode: string) {
    const items = await prisma.toumaProvince.findMany({
      where: { countryCode: countryCode.toUpperCase(), active: true },
      select: {
        ...provinceSelect,
        _count: { select: { departments: { where: { active: true } }, localities: { where: { active: true } } } },
      },
      orderBy: { name: 'asc' },
    });
    return {
      items: items.map((p) => ({
        ...p,
        departmentCount: p._count.departments,
        localityCount: p._count.localities,
        _count: undefined,
      })),
    };
  },

  /** Départements d'une province. */
  async departments(provinceId: string) {
    const province = await prisma.toumaProvince.findUnique({ where: { id: provinceId }, select: { id: true } });
    if (!province) throw notFound('Province introuvable.');
    const items = await prisma.toumaDepartment.findMany({
      where: { provinceId, active: true },
      select: { id: true, code: true, name: true, nameAr: true },
      orderBy: { name: 'asc' },
    });
    return { items };
  },

  /**
   * Localités d'une province, filtrables au fil de la frappe.
   *
   * Le résultat est **borné** : une province peut compter plus de deux mille
   * lieux habités, et rendre la liste entière à un téléphone sur réseau lent
   * serait lui envoyer plusieurs centaines de kilo-octets pour un menu
   * déroulant. `hasMore` dit honnêtement que la liste est tronquée plutôt que
   * de laisser croire qu'elle est complète.
   */
  async localities(provinceId: string, options: { q?: string; departmentId?: string; limit?: number } = {}) {
    const province = await prisma.toumaProvince.findUnique({ where: { id: provinceId }, select: { id: true } });
    if (!province) throw notFound('Province introuvable.');

    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const where = {
      provinceId,
      active: true,
      ...(options.departmentId ? { departmentId: options.departmentId } : {}),
      ...(options.q ? { name: { contains: options.q, mode: 'insensitive' as const } } : {}),
    };

    const rows = await prisma.toumaLocality.findMany({
      where,
      select: { id: true, name: true, nameAr: true, type: true, departmentId: true },
      // Les villes et chefs-lieux d'abord : c'est là qu'habite la majorité de
      // ceux qui cherchent, et cela évite qu'un hameau homonyme passe devant.
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      take: limit + 1,
    });

    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  },

  /**
   * Fiche d'une province : ce qui existe **réellement** à cet endroit.
   *
   * Tout est compté sur des faits. Une province sans boutique rend zéro — c'est
   * une information, pas un trou à combler. Le §80 interdit d'afficher une
   * statistique fabriquée pour remplir une page, et une page de province vide
   * est précisément celle qu'on serait tenté de garnir.
   *
   * La desserte est dite telle qu'elle est : **« Non desservie »** quand aucune
   * zone ne couvre la province, jamais un délai par défaut.
   */
  async province(idOrCode: string, countryCode = 'TD') {
    const province = await prisma.toumaProvince.findFirst({
      where: {
        active: true,
        OR: [{ id: idOrCode }, { code: idOrCode, countryCode: countryCode.toUpperCase() }],
      },
      select: {
        ...provinceSelect,
        latitude: true,
        longitude: true,
        _count: { select: { departments: { where: { active: true } }, localities: { where: { active: true } } } },
      },
    });
    if (!province) throw notFound('Province introuvable.');

    const [boutiques, pointsRelais, zones, reglesCod, chefsLieux] = await Promise.all([
      prisma.toumaStore.findMany({
        where: { provinceId: province.id, status: 'ACTIVE' },
        // Le badge sort tel qu'il est en base : « vérifié » n'est jamais déduit
        // d'autre chose, conformément au §80.
        select: { id: true, name: true, slug: true, verificationStatus: true, logoUrl: true, ratingAverage: true, ratingCount: true },
        orderBy: { name: 'asc' },
        take: 24,
      }),
      prisma.toumaPickupPoint.findMany({
        where: { provinceId: province.id, active: true },
        select: { id: true, name: true, city: true, addressLine: true },
        orderBy: { name: 'asc' },
        take: 24,
      }),
      prisma.toumaDeliveryZone.findMany({
        where: { provinceId: province.id, active: true },
        select: {
          providerCode: true,
          serviceName: true,
          status: true,
          estimatedMinDays: true,
          estimatedMaxDays: true,
          basePrice: true,
          pricePerKg: true,
          currency: true,
        },
        orderBy: { basePrice: 'asc' },
      }),
      prisma.toumaCodRule.count({ where: { provinceId: province.id, active: true, allowed: true } }),
      prisma.toumaLocality.findMany({
        where: { provinceId: province.id, active: true, type: { in: ['CITY', 'TOWN'] } },
        select: { id: true, name: true, nameAr: true, type: true },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
        take: 12,
      }),
    ]);

    const boutiquesTotal = await prisma.toumaStore.count({ where: { provinceId: province.id, status: 'ACTIVE' } });

    return {
      province: {
        id: province.id,
        code: province.code,
        name: province.name,
        nameAr: province.nameAr,
        countryCode: province.countryCode,
        latitude: province.latitude?.toString() ?? null,
        longitude: province.longitude?.toString() ?? null,
        departmentCount: province._count.departments,
        localityCount: province._count.localities,
      },
      stores: {
        items: boutiques.map((b) => ({ ...b, ratingAverage: b.ratingAverage.toString() })),
        total: boutiquesTotal,
        hasMore: boutiquesTotal > boutiques.length,
      },
      pickupPoints: pointsRelais,
      mainLocalities: chefsLieux,
      delivery: {
        /** Aucune zone : la province n'est pas desservie, et on le dit. */
        served: zones.some((z) => z.status === 'SERVED'),
        options: zones.map((z) => ({
          ...z,
          basePrice: z.basePrice.toString(),
          pricePerKg: z.pricePerKg?.toString() ?? null,
        })),
        note:
          zones.length === 0
            ? 'Aucune zone de livraison déclarée pour cette province : estimation indisponible.'
            : null,
      },
      /** Ouvert seulement si une règle l'ouvre. Fermé par défaut, comme ailleurs. */
      cashOnDelivery: { open: reglesCod > 0 },
    };
  },

  /**
   * Recherche d'une localité dans tout un pays, quand l'utilisateur sait le nom
   * de sa ville mais pas sa province — le cas courant.
   */
  async searchLocalities(countryCode: string, q: string, limit = 20) {
    const terme = q.trim();
    if (terme.length < 2) return { items: [] };
    const rows = await prisma.toumaLocality.findMany({
      where: {
        active: true,
        province: { countryCode: countryCode.toUpperCase(), active: true },
        name: { contains: terme, mode: 'insensitive' },
      },
      select: {
        id: true,
        name: true,
        nameAr: true,
        type: true,
        province: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      take: Math.min(50, Math.max(1, limit)),
    });
    return { items: rows };
  },
};

/**
 * Tableau de bord national.
 *
 * Une lecture du pays province par province : où sont les boutiques, où les
 * commandes partent, où elles arrivent, ce qui est desservi et ce qui ne l'est
 * pas.
 *
 * **Tout est compté sur des faits.** Une province à zéro rend zéro — c'est une
 * information, et c'est même la plus utile : elle dit où le produit n'existe
 * pas encore. Le §80 interdit la statistique fabriquée pour remplir un tableau,
 * et un tableau national vide est exactement celui qu'on serait tenté de
 * garnir.
 *
 * **Les devises ne sont jamais additionnées** : le chiffre d'affaires sort par
 * devise, comme partout ailleurs.
 */
export async function nationalOverview(countryCode = 'TD') {
  const pays = countryCode.toUpperCase();

  const provinces = await prisma.toumaProvince.findMany({
    where: { countryCode: pays, active: true },
    select: { id: true, code: true, name: true, nameAr: true },
    orderBy: { name: 'asc' },
  });
  const parId = new Map(provinces.map((p) => [p.id, p]));

  const [boutiques, pointsRelais, zones, reglesCod, adresses] = await Promise.all([
    prisma.toumaStore.groupBy({ by: ['provinceId'], where: { countryCode: pays, status: 'ACTIVE' }, _count: { _all: true } }),
    prisma.toumaPickupPoint.groupBy({ by: ['provinceId'], where: { countryCode: pays, active: true }, _count: { _all: true } }),
    prisma.toumaDeliveryZone.groupBy({
      by: ['provinceId', 'status'],
      where: { countryCode: pays, active: true, provinceId: { not: null } },
      _count: { _all: true },
    }),
    prisma.toumaCodRule.groupBy({
      by: ['provinceId'],
      where: { countryCode: pays, active: true, allowed: true, provinceId: { not: null } },
      _count: { _all: true },
    }),
    // Où vivent les acheteurs : une adresse rattachée à une province est le
    // seul fait disponible ; on ne déduit rien d'une adresse sans province.
    prisma.toumaAddress.groupBy({ by: ['provinceId'], where: { countryCode: pays, provinceId: { not: null } }, _count: { _all: true } }),
  ]);

  // Commandes reçues par province de livraison, avec leur chiffre d'affaires
  // par devise. Passe par l'adresse de livraison : c'est elle qui dit où la
  // marchandise est allée, pas le pays déclaré par l'acheteur.
  const commandes = await prisma.toumaOrder.findMany({
    where: { buyerCountry: pays, status: { in: ['PAID', 'CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'COMPLETED'] } },
    select: { currency: true, total: true, shippingAddress: { select: { provinceId: true } } },
    take: 20_000,
  });

  const ventes = new Map<string, Map<string, { count: number; total: Prisma.Decimal }>>();
  let sansProvince = 0;
  for (const c of commandes) {
    const pid = c.shippingAddress?.provinceId;
    if (!pid) {
      // Commande dont l'adresse n'est rattachée à aucune province : comptée à
      // part plutôt que répartie au hasard sur une province plausible.
      sansProvince += 1;
      continue;
    }
    const parDevise = ventes.get(pid) ?? new Map();
    const bucket = parDevise.get(c.currency) ?? { count: 0, total: new Prisma.Decimal(0) };
    bucket.count += 1;
    bucket.total = bucket.total.plus(c.total);
    parDevise.set(c.currency, bucket);
    ventes.set(pid, parDevise);
  }

  const compteur = (rows: { provinceId: string | null; _count: { _all: number } }[]) =>
    new Map(rows.filter((r) => r.provinceId).map((r) => [r.provinceId!, r._count._all]));

  const nbBoutiques = compteur(boutiques);
  const nbRelais = compteur(pointsRelais);
  const nbCod = compteur(reglesCod);
  const nbAdresses = compteur(adresses);

  const desserte = new Map<string, { served: number; unserved: number }>();
  for (const z of zones) {
    if (!z.provinceId) continue;
    const e = desserte.get(z.provinceId) ?? { served: 0, unserved: 0 };
    if (z.status === 'SERVED') e.served += z._count._all;
    else e.unserved += z._count._all;
    desserte.set(z.provinceId, e);
  }

  const lignes = provinces.map((p) => {
    const parDevise = ventes.get(p.id);
    const d = desserte.get(p.id);
    return {
      province: { id: p.id, code: p.code, name: p.name, nameAr: p.nameAr },
      stores: nbBoutiques.get(p.id) ?? 0,
      pickupPoints: nbRelais.get(p.id) ?? 0,
      buyerAddresses: nbAdresses.get(p.id) ?? 0,
      cashOnDeliveryOpen: (nbCod.get(p.id) ?? 0) > 0,
      /** `null` = aucune zone déclarée. Différent de « desservie : non ». */
      delivery: d ? { served: d.served > 0, zones: d.served + d.unserved } : null,
      revenue: [...(parDevise?.entries() ?? [])].map(([currency, b]) => ({
        currency,
        orderCount: b.count,
        total: b.total.toString(),
      })),
    };
  });

  return {
    countryCode: pays,
    provinceCount: provinces.length,
    rows: lignes,
    /** Ce que le tableau ne sait pas dire, dit explicitement. */
    caveats: {
      ordersWithoutProvince: sansProvince,
      note:
        'Chiffres calculés sur les faits enregistrés. Une province à zéro n’a réellement aucune activité ; ' +
        'une desserte « null » signifie qu’aucune zone n’est déclarée, ce qui n’est pas la même chose que non desservie. ' +
        'Les montants ne sont jamais additionnés entre devises.',
    },
  };
}

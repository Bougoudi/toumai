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

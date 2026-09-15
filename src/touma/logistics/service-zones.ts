import { prisma } from '../../db/prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * Où une boutique livre — et si l'acheteur peut vraiment être servi.
 *
 * Deux choses différentes se rencontrent ici, et les confondre produirait
 * exactement le genre de promesse fausse que le §80 interdit :
 *
 * - **Le vendeur déclare** où il accepte d'envoyer (`ToumaStoreServiceZone`).
 * - **Le transporteur déclare** où il va (`ToumaDeliveryZone`).
 *
 * Une commande n'est livrable que si **les deux** disent oui. Un vendeur qui
 * sert tout le Tchad ne fait pas arriver un colis à Faya-Largeau si aucun
 * transporteur n'y monte ; un transporteur qui dessert Faya-Largeau ne sert à
 * rien si le vendeur refuse d'y envoyer.
 *
 * **Sans déclaration, un vendeur ne restreint rien.** C'est l'inverse du
 * paiement à la livraison, fermé par défaut, et la différence est réelle :
 * encaisser du liquide est un engagement qu'on prend, refuser de livrer une
 * province est une limitation qu'on choisit. Fermer par défaut couperait du
 * jour au lendemain toutes les boutiques existantes.
 */

export type Verdict = 'SERVED' | 'SELLER_EXCLUDED' | 'NO_CARRIER' | 'UNKNOWN_DESTINATION';

export interface Availability {
  verdict: Verdict;
  /** Ce qu'on dit à l'acheteur. Jamais un délai deviné. */
  message: string;
  /** Vrai seulement quand les deux côtés confirment. */
  deliverable: boolean;
  /** Préparation annoncée par le vendeur, en jours. `null` = non annoncée. */
  handlingDays: number | null;
  /** Fourchette transporteur, quand une zone la déclare. */
  transitDays: { min: number; max: number } | null;
  province: { id: string; name: string } | null;
}

/** Précision croissante : département, province, pays. */
const precision = (z: { departmentId: string | null; provinceId: string | null }) =>
  z.departmentId ? 2 : z.provinceId ? 1 : 0;

/**
 * Le vendeur sert-il cette destination ?
 *
 * La règle la plus précise l'emporte. Une exclusion ferme, ce qui permet de
 * déclarer « tout le Tchad sauf le Tibesti » sans énumérer vingt-deux
 * provinces.
 */
export async function sellerServes(
  storeId: string,
  destination: { countryCode: string; provinceId?: string | null; departmentId?: string | null },
): Promise<{ served: boolean; note: string | null; handlingDays: number | null; declared: boolean }> {
  const zones = await prisma.toumaStoreServiceZone.findMany({
    where: {
      storeId,
      active: true,
      countryCode: destination.countryCode.toUpperCase(),
      OR: [
        { provinceId: null, departmentId: null },
        ...(destination.provinceId ? [{ provinceId: destination.provinceId, departmentId: null }] : []),
        ...(destination.departmentId ? [{ departmentId: destination.departmentId }] : []),
      ],
    },
  });

  // Aucune déclaration pour ce pays : le vendeur n'a rien restreint. Mais s'il
  // a déclaré des zones **ailleurs**, son silence sur ce pays-ci veut dire
  // « je n'y vais pas » — sinon déclarer ses zones ne servirait à rien.
  if (zones.length === 0) {
    const declareAilleurs = await prisma.toumaStoreServiceZone.count({ where: { storeId, active: true } });
    if (declareAilleurs === 0) return { served: true, note: null, handlingDays: null, declared: false };
    return {
      served: false,
      note: 'Cette boutique ne livre pas encore dans ce pays.',
      handlingDays: null,
      declared: true,
    };
  }

  const retenue = zones.slice().sort((a, b) => precision(b) - precision(a))[0];
  return {
    served: retenue.served,
    note: retenue.served ? null : (retenue.note ?? 'Cette boutique ne livre pas à cette destination.'),
    handlingDays: retenue.handlingDays,
    declared: true,
  };
}

/** Un transporteur dessert-il cette destination ? */
async function carrierServes(destination: { countryCode: string; provinceId?: string | null; departmentId?: string | null }) {
  const zones = await prisma.toumaDeliveryZone.findMany({
    where: {
      active: true,
      countryCode: destination.countryCode.toUpperCase(),
      OR: [
        { provinceId: null, departmentId: null, localityId: null },
        ...(destination.provinceId ? [{ provinceId: destination.provinceId }] : []),
        ...(destination.departmentId ? [{ departmentId: destination.departmentId }] : []),
      ],
    },
    select: { status: true, estimatedMinDays: true, estimatedMaxDays: true, provinceId: true, departmentId: true, localityId: true },
  });

  const servantes = zones.filter((z) => z.status === 'SERVED');
  if (servantes.length === 0) return { served: false, transitDays: null };

  // Fourchette la plus favorable annoncée : c'est une donnée d'exploitant, pas
  // un calcul. Aucune moyenne inventée.
  return {
    served: true,
    transitDays: {
      min: Math.min(...servantes.map((z) => z.estimatedMinDays)),
      max: Math.max(...servantes.map((z) => z.estimatedMaxDays)),
    },
  };
}

/**
 * Ce produit peut-il arriver là-bas ?
 *
 * Quatre réponses possibles, et **aucune n'est « probablement »**. Quand le
 * système ne sait pas, il le dit : c'est la troisième règle d'ingénierie de
 * `compliance-boundaries.md`, et elle vaut pour un colis comme pour un franc.
 */
export async function productAvailability(productId: string, provinceId: string): Promise<Availability> {
  const produit = await prisma.toumaProduct.findFirst({
    where: { OR: [{ id: productId }, { slug: productId }] },
    select: { id: true, storeId: true, store: { select: { countryCode: true } } },
  });
  if (!produit) throw notFound('Produit introuvable.');

  const province = await prisma.toumaProvince.findUnique({
    where: { id: provinceId },
    select: { id: true, name: true, countryCode: true, active: true },
  });
  if (!province || !province.active) {
    return {
      verdict: 'UNKNOWN_DESTINATION',
      message: 'Destination inconnue : choisissez une province.',
      deliverable: false,
      handlingDays: null,
      transitDays: null,
      province: null,
    };
  }

  const destination = { countryCode: province.countryCode, provinceId: province.id };
  const [vendeur, transporteur] = await Promise.all([sellerServes(produit.storeId, destination), carrierServes(destination)]);

  const lieu = { id: province.id, name: province.name };

  if (!vendeur.served) {
    return {
      verdict: 'SELLER_EXCLUDED',
      message: vendeur.note ?? `Cette boutique ne livre pas au ${province.name}.`,
      deliverable: false,
      handlingDays: null,
      transitDays: null,
      province: lieu,
    };
  }

  if (!transporteur.served) {
    return {
      verdict: 'NO_CARRIER',
      message: `Aucun transporteur ne dessert le ${province.name} pour l’instant : estimation indisponible.`,
      deliverable: false,
      handlingDays: vendeur.handlingDays,
      transitDays: null,
      province: lieu,
    };
  }

  return {
    verdict: 'SERVED',
    message: `Livrable au ${province.name}.`,
    deliverable: true,
    handlingDays: vendeur.handlingDays,
    transitDays: transporteur.transitDays,
    province: lieu,
  };
}

// ── Déclaration par le vendeur ──────────────────────────────────────────────

export interface ServiceZoneInput {
  countryCode: string;
  provinceId?: string | null;
  departmentId?: string | null;
  served?: boolean;
  handlingDays?: number | null;
  note?: string | null;
}

/** Boutique du demandeur, ou 404 — la convention anti-IDOR du dépôt. */
async function ownStore(user: ToumaRequestUser, storeId: string) {
  const store = await prisma.toumaStore.findUnique({ where: { id: storeId }, select: { id: true, ownerId: true, countryCode: true } });
  if (!store) throw notFound('Boutique introuvable.');
  if (store.ownerId !== user.id && user.role !== 'ADMIN') throw notFound('Boutique introuvable.');
  return store;
}

export const serviceZoneService = {
  /** Zones d'une boutique — lecture publique : un acheteur a le droit de savoir. */
  async list(storeId: string) {
    const zones = await prisma.toumaStoreServiceZone.findMany({
      where: { storeId, active: true },
      select: {
        id: true,
        countryCode: true,
        served: true,
        handlingDays: true,
        note: true,
        province: { select: { id: true, code: true, name: true, nameAr: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ countryCode: 'asc' }],
    });
    return {
      items: zones,
      /** Sans aucune déclaration, la boutique ne restreint rien. */
      unrestricted: zones.length === 0,
    };
  },

  /**
   * Remplace la déclaration d'une boutique.
   *
   * Remplacement complet plutôt qu'ajouts successifs : un vendeur qui retire
   * une province doit pouvoir le faire, et une liste d'exclusions accumulée au
   * fil des ajouts finit par ne plus être lisible par celui qui l'a écrite.
   */
  async replace(user: ToumaRequestUser, storeId: string, zones: ServiceZoneInput[]) {
    const store = await ownStore(user, storeId);
    if (zones.length > 200) throw badRequest('Trop de zones déclarées.');

    // Les identifiants sont vérifiés avant d'écrire : une zone qui pointe vers
    // une province inexistante serait une restriction que personne ne peut
    // satisfaire, donc une boutique invisible sans explication.
    for (const z of zones) {
      if (z.provinceId) {
        const p = await prisma.toumaProvince.findUnique({ where: { id: z.provinceId }, select: { id: true, countryCode: true } });
        if (!p) throw notFound('Province introuvable.');
        if (p.countryCode !== z.countryCode.toUpperCase()) throw badRequest('Cette province n’appartient pas au pays indiqué.');
      }
      if (z.departmentId) {
        const d = await prisma.toumaDepartment.findUnique({ where: { id: z.departmentId }, select: { id: true } });
        if (!d) throw notFound('Département introuvable.');
      }
      if (z.handlingDays != null && (z.handlingDays < 0 || z.handlingDays > 90)) {
        throw badRequest('Le délai de préparation doit être compris entre 0 et 90 jours.');
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.toumaStoreServiceZone.deleteMany({ where: { storeId: store.id } });
      if (zones.length === 0) return;
      await tx.toumaStoreServiceZone.createMany({
        data: zones.map((z) => ({
          storeId: store.id,
          countryCode: z.countryCode.toUpperCase(),
          provinceId: z.provinceId ?? null,
          departmentId: z.departmentId ?? null,
          served: z.served ?? true,
          handlingDays: z.handlingDays ?? null,
          note: z.note ?? null,
        })),
      });
    });

    return this.list(store.id);
  },
};

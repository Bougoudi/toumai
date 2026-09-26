import { Prisma } from '@prisma/client';
import { prisma } from '../../../db/prisma.js';

/**
 * ASSISTANT PANIER (§31).
 *
 * « Comment réduire mon panier de 10 000 XAF ? » — la question mérite une
 * réponse faite de produits qui existent, pas d'un conseil général.
 *
 * Quatre lectures : le découpage par vendeur (qui détermine le nombre de
 * livraisons), les doublons, les produits dont le stock ne suit pas, et les
 * alternatives réellement moins chères dans la même catégorie.
 *
 * **Rien n'est modifié.** L'analyse propose ; l'acheteur retire, remplace ou
 * garde. Un panier qu'un assistant modifie tout seul est un panier dont on ne
 * sait plus ce qu'on y a mis.
 */

export interface AlternativeMoinsChere {
  replaces: { itemId: string; productId: string; title: string; unitPrice: string };
  with: { productId: string; title: string; unitPrice: string; storeName: string | null; verified: boolean; inStock: boolean };
  savingPerUnit: string;
  savingTotal: string;
  currency: string;
  /** Ce que l'alternative ne garantit pas. Nommé, parce que ce n'est pas le même produit. */
  caution: string;
}

export const cartInsights = {
  async analyse(userId: string, options: { targetSaving?: string } = {}) {
    const panier = await prisma.toumaCart.findFirst({
      where: { userId },
      select: {
        id: true,
        items: {
          select: {
            id: true,
            quantity: true,
            productId: true,
            variantId: true,
            product: {
              select: {
                id: true,
                title: true,
                price: true,
                currency: true,
                categoryId: true,
                storeId: true,
                store: { select: { id: true, name: true, countryCode: true, verificationStatus: true } },
                inventory: { select: { quantity: true, variantId: true } },
              },
            },
          },
        },
      },
    });

    const lignes = panier?.items ?? [];
    if (lignes.length === 0) {
      return { empty: true, message: 'Votre panier est vide.', byCurrency: [], sellers: [], duplicates: [], stockIssues: [], alternatives: [], targetSaving: null };
    }

    // ── Totaux par devise. Jamais additionnés entre eux (V20). ──────────────
    const parDevise = new Map<string, Prisma.Decimal>();
    for (const l of lignes) {
      const devise = l.product.currency;
      parDevise.set(devise, (parDevise.get(devise) ?? new Prisma.Decimal(0)).plus(l.product.price.mul(l.quantity)));
    }

    // ── Découpage par vendeur : c'est lui qui fait le nombre de livraisons. ─
    const parVendeur = new Map<string, { nom: string | null; pays: string | null; lignes: number; articles: number }>();
    for (const l of lignes) {
      const id = l.product.storeId;
      const e = parVendeur.get(id) ?? { nom: l.product.store?.name ?? null, pays: l.product.store?.countryCode ?? null, lignes: 0, articles: 0 };
      e.lignes += 1;
      e.articles += l.quantity;
      parVendeur.set(id, e);
    }

    // ── Doublons : le même produit sur deux lignes. ─────────────────────────
    const vus = new Map<string, number>();
    for (const l of lignes) vus.set(l.productId, (vus.get(l.productId) ?? 0) + 1);
    const doublons = [...vus.entries()]
      .filter(([, n]) => n > 1)
      .map(([productId, n]) => ({
        productId,
        title: lignes.find((l) => l.productId === productId)?.product.title ?? null,
        lines: n,
      }));

    // ── Stock insuffisant. Un fait, pas une prédiction. ─────────────────────
    const stock = lignes
      .map((l) => {
        const disponible = l.product.inventory
          .filter((i) => (l.variantId ? i.variantId === l.variantId : true))
          .reduce((a, i) => a + i.quantity, 0);
        return { itemId: l.id, productId: l.productId, title: l.product.title, requested: l.quantity, available: disponible };
      })
      .filter((s) => s.available < s.requested);

    const alternatives = await this.cheaperAlternatives(lignes);

    // ── Objectif d'économie : atteint ou non, avec le chiffre. ──────────────
    let objectif: { requested: string; currency: string; reachable: boolean; bestAchievable: string } | null = null;
    if (options.targetSaving) {
      const cible = new Prisma.Decimal(options.targetSaving);
      // L'objectif se juge dans **une** devise : celle qui domine le panier.
      const devise = [...parDevise.entries()].sort((a, b) => b[1].comparedTo(a[1]))[0][0];
      const cumul = alternatives
        .filter((a) => a.currency === devise)
        .reduce((acc, a) => acc.plus(new Prisma.Decimal(a.savingTotal)), new Prisma.Decimal(0));
      objectif = {
        requested: cible.toString(),
        currency: devise,
        reachable: cumul.greaterThanOrEqualTo(cible),
        bestAchievable: cumul.toString(),
      };
    }

    return {
      empty: false,
      byCurrency: [...parDevise.entries()].map(([currency, total]) => ({ currency, total: total.toString() })),
      sellers: [...parVendeur.entries()].map(([storeId, e]) => ({ storeId, name: e.nom, countryCode: e.pays, lines: e.lignes, units: e.articles })),
      /**
       * Le nombre de vendeurs est dit, pas le coût de livraison : celui-ci
       * vient du transporteur (V17), et l'annoncer ici serait un chiffre
       * inventé.
       */
      shippingNote:
        parVendeur.size > 1
          ? `Votre panier porte sur ${parVendeur.size} vendeurs : il donnera autant d’expéditions distinctes. Le coût de chacune se demande au moment de la commande.`
          : null,
      duplicates: doublons,
      stockIssues: stock,
      alternatives,
      targetSaving: objectif,
      unavailable: ['les frais de livraison, qui dépendent du transporteur et de la destination'],
    };
  },

  /**
   * Alternatives réellement moins chères, dans la même catégorie et la même
   * devise.
   *
   * Ce n'est **pas le même produit**, et la réponse le dit à chaque ligne. Une
   * alternative moins chère dans la même catégorie peut être de qualité, de
   * taille ou de marque différentes : proposer l'échange sans le dire
   * reviendrait à faire croire à une remise là où il y a un autre article.
   */
  async cheaperAlternatives(
    lignes: Array<{ id: string; quantity: number; productId: string; product: { title: string; price: Prisma.Decimal; currency: string; categoryId: string | null } }>,
  ): Promise<AlternativeMoinsChere[]> {
    const sorties: AlternativeMoinsChere[] = [];
    for (const l of lignes) {
      if (!l.product.categoryId) continue;
      const candidat = await prisma.toumaProduct.findFirst({
        where: {
          categoryId: l.product.categoryId,
          currency: l.product.currency,
          status: 'ACTIVE',
          store: { status: 'ACTIVE' },
          id: { not: l.productId },
          price: { lt: l.product.price },
          inventory: { some: { quantity: { gt: 0 } } },
        },
        orderBy: { price: 'desc' },
        select: {
          id: true,
          title: true,
          price: true,
          store: { select: { name: true, verificationStatus: true } },
          inventory: { select: { quantity: true } },
        },
      });
      if (!candidat) continue;
      const ecart = l.product.price.minus(candidat.price);
      sorties.push({
        replaces: { itemId: l.id, productId: l.productId, title: l.product.title, unitPrice: l.product.price.toString() },
        with: {
          productId: candidat.id,
          title: candidat.title,
          unitPrice: candidat.price.toString(),
          storeName: candidat.store?.name ?? null,
          verified: candidat.store?.verificationStatus === 'APPROVED',
          inStock: candidat.inventory.reduce((a, i) => a + i.quantity, 0) > 0,
        },
        savingPerUnit: ecart.toString(),
        savingTotal: ecart.mul(l.quantity).toString(),
        currency: l.product.currency,
        caution: 'Ce n’est pas le même produit : marque, taille, qualité et garantie peuvent différer.',
      });
    }
    // Le plus gros gain d'abord : c'est l'ordre dans lequel la question se pose.
    return sorties.sort((a, b) => new Prisma.Decimal(b.savingTotal).comparedTo(new Prisma.Decimal(a.savingTotal)));
  },
};

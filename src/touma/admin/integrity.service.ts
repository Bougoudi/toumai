import { prisma } from '../../db/prisma.js';

/**
 * CONTRÔLES D'INTÉGRITÉ (V25 §83).
 *
 * Ce que ce service n'est pas : un tableau de bord rassurant. Chaque contrôle
 * cherche une incohérence **précise**, formulée comme un invariant du modèle,
 * et rend les identifiants concernés. « Tout va bien » n'a de valeur que si
 * l'on sait exactement ce qui a été vérifié — d'où le champ `checked`, rendu
 * même quand le compte est à zéro.
 *
 * Tout passe par SQL. Un balayage en mémoire sur les premières lignes
 * trouverait ce qu'il croise et manquerait le reste **en silence** : c'est
 * exactement le défaut qu'un contrôle d'intégrité est censé ne pas avoir. La
 * leçon vient d'une tâche antérieure qui n'inspectait que les 500 premiers
 * produits et déclarait le stock sain.
 *
 * Aucun contrôle ne répare quoi que ce soit. Constater et réparer sont deux
 * gestes, et le second demande une décision humaine (§84).
 */

export type GraviteIntegrite = 'CRITIQUE' | 'ANOMALIE' | 'INFORMATION';

export interface ResultatControle {
  code: string;
  label: string;
  /** Ce que l'invariant affirme, en toutes lettres. */
  invariant: string;
  severity: GraviteIntegrite;
  count: number;
  /** Quelques identifiants, pour commencer l'enquête. Jamais la liste entière. */
  samples: string[];
}

/** Nombre d'exemples rendus par contrôle. */
const ECHANTILLON = 10;

interface Controle {
  code: string;
  label: string;
  invariant: string;
  severity: GraviteIntegrite;
  sql: () => Promise<Array<{ id: string }>>;
}

const CONTROLES: Controle[] = [
  {
    code: 'ORDER_WITHOUT_ITEMS',
    label: 'Commandes sans aucune ligne',
    invariant: 'Toute commande porte au moins une ligne.',
    severity: 'CRITIQUE',
    sql: () => prisma.$queryRaw`
      SELECT o."id" FROM "touma_orders" o
      WHERE NOT EXISTS (SELECT 1 FROM "touma_order_items" i WHERE i."orderId" = o."id")
      LIMIT 100`,
  },
  {
    code: 'ORDER_TOTAL_MISMATCH',
    label: 'Total de commande incohérent',
    invariant: 'total = subtotal + shippingTotal − discountTotal.',
    severity: 'CRITIQUE',
    sql: () => prisma.$queryRaw`
      SELECT "id" FROM "touma_orders"
      WHERE "total" <> ("subtotal" + "shippingTotal" - "discountTotal")
      LIMIT 100`,
  },
  {
    code: 'ORDER_PAID_WITHOUT_PAYMENT',
    label: 'Commandes payées sans paiement réussi',
    invariant: 'Une commande au-delà de PENDING s’appuie sur un paiement SUCCEEDED, sauf paiement à la livraison.',
    severity: 'CRITIQUE',
    sql: () => prisma.$queryRaw`
      SELECT o."id" FROM "touma_orders" o
      WHERE o."status" IN ('PAID', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'COMPLETED')
        AND NOT EXISTS (
          SELECT 1 FROM "touma_payments" p
           WHERE p."orderId" = o."id"
             AND (p."status" = 'SUCCEEDED' OR p."method" = 'CASH_ON_DELIVERY')
        )
      LIMIT 100`,
  },
  {
    code: 'PAYMENT_SUCCEEDED_ORPHAN',
    label: 'Paiements réussis rattachés à aucune commande',
    invariant: 'Un paiement réussi désigne une commande existante.',
    severity: 'CRITIQUE',
    sql: () => prisma.$queryRaw`
      SELECT p."id" FROM "touma_payments" p
      WHERE p."status" = 'SUCCEEDED'
        AND (p."orderId" IS NULL
             OR NOT EXISTS (SELECT 1 FROM "touma_orders" o WHERE o."id" = p."orderId"))
      LIMIT 100`,
  },
  {
    code: 'INVENTORY_NEGATIVE',
    label: 'Stock négatif',
    invariant: 'Une quantité en stock et une quantité réservée ne sont jamais négatives.',
    severity: 'CRITIQUE',
    sql: () => prisma.$queryRaw`
      SELECT "id" FROM "touma_inventory"
      WHERE "quantity" < 0 OR "reserved" < 0
      LIMIT 100`,
  },
  {
    code: 'INVENTORY_OVER_RESERVED',
    label: 'Réservations supérieures au stock',
    invariant: 'On ne réserve pas plus d’unités qu’il n’en existe.',
    severity: 'ANOMALIE',
    sql: () => prisma.$queryRaw`
      SELECT "id" FROM "touma_inventory"
      WHERE "reserved" > "quantity"
      LIMIT 100`,
  },
  {
    code: 'LEDGER_SALE_WITHOUT_COMMISSION',
    label: 'Vente enregistrée sans commission correspondante',
    invariant: 'Une écriture SALE s’accompagne d’une écriture COMMISSION sur la même référence.',
    severity: 'ANOMALIE',
    sql: () => prisma.$queryRaw`
      SELECT s."id" FROM "touma_ledger_entries" s
      WHERE s."type" = 'SALE'
        AND NOT EXISTS (
          SELECT 1 FROM "touma_ledger_entries" c
           WHERE c."referenceType" = s."referenceType"
             AND c."referenceId" = s."referenceId"
             AND c."type" = 'COMMISSION'
        )
      LIMIT 100`,
  },
  {
    code: 'LEDGER_ORPHAN_STORE',
    label: 'Écritures rattachées à aucune boutique',
    invariant: 'Une écriture du grand livre appartient à une boutique existante.',
    severity: 'ANOMALIE',
    sql: () => prisma.$queryRaw`
      SELECT l."id" FROM "touma_ledger_entries" l
      WHERE l."storeId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "touma_stores" s WHERE s."id" = l."storeId")
      LIMIT 100`,
  },
  {
    code: 'SHIPMENT_ORPHAN',
    label: 'Expéditions sans commande',
    invariant: 'Une expédition désigne une commande existante.',
    severity: 'CRITIQUE',
    sql: () => prisma.$queryRaw`
      SELECT s."id" FROM "touma_shipments" s
      WHERE NOT EXISTS (SELECT 1 FROM "touma_orders" o WHERE o."id" = s."orderId")
      LIMIT 100`,
  },
  {
    code: 'DELIVERED_WITHOUT_SHIPMENT',
    label: 'Commandes livrées sans expédition',
    invariant: 'Une commande livrée a laissé une trace d’expédition.',
    severity: 'ANOMALIE',
    sql: () => prisma.$queryRaw`
      SELECT o."id" FROM "touma_orders" o
      WHERE o."status" IN ('DELIVERED', 'COMPLETED')
        AND NOT EXISTS (SELECT 1 FROM "touma_shipments" s WHERE s."orderId" = o."id")
      LIMIT 100`,
  },
];

/**
 * Exécute tous les contrôles.
 *
 * Un contrôle qui échoue n'interrompt pas les autres : une table absente ou
 * une requête fautive ne doit pas faire passer les neuf autres invariants pour
 * vérifiés. L'échec est rendu comme tel, et il compte comme un problème.
 */
export const integrityService = {
  async run(): Promise<{
    status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    checkedAt: string;
    checked: number;
    issues: ResultatControle[];
    failures: Array<{ code: string; error: string }>;
  }> {
    const issues: ResultatControle[] = [];
    const failures: Array<{ code: string; error: string }> = [];

    for (const controle of CONTROLES) {
      try {
        const lignes = await controle.sql();
        if (lignes.length === 0) continue;
        issues.push({
          code: controle.code,
          label: controle.label,
          invariant: controle.invariant,
          severity: controle.severity,
          count: lignes.length,
          samples: lignes.slice(0, ECHANTILLON).map((l) => l.id),
        });
      } catch (err) {
        failures.push({ code: controle.code, error: err instanceof Error ? err.message : String(err) });
      }
    }

    /**
     * « Sain » n'est dit que si tous les contrôles ont réellement tourné.
     *
     * §89 est explicite : interdit d'afficher « System healthy » si les
     * services critiques ne sont pas vérifiés. Un contrôle en échec rend donc
     * l'état `WARNING` au minimum, jamais `HEALTHY`.
     */
    const critique = issues.some((i) => i.severity === 'CRITIQUE');
    const status = critique ? 'CRITICAL' : issues.length > 0 || failures.length > 0 ? 'WARNING' : 'HEALTHY';

    return {
      status,
      checkedAt: new Date().toISOString(),
      /** Ce qui a été vérifié : « rien à signaler » ne vaut que rapporté à ce nombre. */
      checked: CONTROLES.length,
      issues,
      failures,
    };
  },

  /** Le catalogue des invariants, pour que l'écran dise ce qu'il contrôle. */
  catalogue() {
    return CONTROLES.map((c) => ({ code: c.code, label: c.label, invariant: c.invariant, severity: c.severity }));
  },
};

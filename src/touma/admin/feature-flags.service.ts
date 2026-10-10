import { createHash } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';

/**
 * DRAPEAUX DE FONCTIONNALITÉ (V25 §28-29).
 *
 * Ce dépôt a déjà vingt-neuf interrupteurs d'environnement (`TOUMA_*_ENABLED`).
 * Ils ne sont **pas** remplacés, parce qu'ils ne disent pas la même chose :
 * ils disent ce que l'instance *peut* faire. Un paiement sans prestataire
 * raccordé reste éteint, et aucune ligne de base de données ne doit pouvoir le
 * rallumer.
 *
 * Un drapeau décide, parmi ce qui est **possible**, qui le voit. La règle qui
 * en découle est absolue et vérifiée par un test : un drapeau ne rallume
 * jamais ce que l'environnement a éteint. Sans elle, ce module serait un
 * moyen commode d'activer en production une fonctionnalité dont l'instance n'a
 * pas les moyens — c'est-à-dire de promettre à un acheteur ce que personne ne
 * peut tenir.
 */

/** Contexte d'évaluation. Tous les champs sont facultatifs. */
export interface ContexteDrapeau {
  userId?: string | null;
  storeId?: string | null;
  countryCode?: string | null;
  province?: string | null;
}

export interface EvaluationDrapeau {
  key: string;
  enabled: boolean;
  /** Pourquoi, en clair. Un drapeau qu'on ne sait pas expliquer ne se débogue pas. */
  reason: string;
}

/**
 * Interrupteurs d'environnement qui commandent un drapeau.
 *
 * Absent de cette table, un drapeau n'a pas de garde-fou d'environnement et
 * répond seul. Présent, il ne peut pas dépasser l'interrupteur.
 */
const GARDE_FOUS: Record<string, () => boolean> = {
  ai_chat: () => env.touma.ai.enabled && env.touma.ai.chatEnabled,
  loyalty: () => env.touma.loyaltyEnabled,
  flash_sales: () => env.touma.growth.flashSalesEnabled,
  promotions: () => env.touma.growth.promotionsEnabled,
  coupons: () => env.touma.growth.couponsEnabled,
  referrals: () => env.touma.growth.referralsEnabled,
  trade: () => env.touma.trade.enabled,
};

/**
 * Attribution **stable** d'un sujet à une tranche de déploiement (§29).
 *
 * Un tirage au sort à chaque requête ferait clignoter la fonctionnalité : la
 * même personne la verrait, ne la verrait plus, la reverrait — et tout rapport
 * de bogue deviendrait irreproductible. Le hachage du couple (drapeau, sujet)
 * donne toujours le même nombre, donc toujours la même réponse.
 *
 * Le nom du drapeau entre dans le hachage pour que deux déploiements à 10 %
 * ne touchent pas exactement les mêmes personnes : sinon, la même minorité
 * essuierait les plâtres de toutes les nouveautés.
 */
export function tranche(key: string, sujet: string): number {
  const empreinte = createHash('sha256').update(`${key}:${sujet}`).digest();
  return empreinte.readUInt32BE(0) % 100;
}

function cible(liste: string[], valeur: string | null | undefined): boolean {
  if (liste.length === 0) return true; // aucune restriction sur cette dimension
  return Boolean(valeur && liste.includes(valeur));
}

export const featureFlagService = {
  /**
   * Un drapeau s'applique-t-il à ce contexte ?
   *
   * Un drapeau inconnu rend `false` : une fonctionnalité dont personne n'a
   * défini l'ouverture est fermée. L'inverse — ouverte par défaut — ferait
   * qu'une faute de frappe dans une clé activerait tout pour tout le monde.
   */
  async evaluate(key: string, contexte: ContexteDrapeau = {}): Promise<EvaluationDrapeau> {
    const garde = GARDE_FOUS[key];
    if (garde && !garde()) {
      return { key, enabled: false, reason: 'Éteint par la configuration de l’instance : aucun drapeau ne peut le rallumer.' };
    }

    const drapeau = await prisma.toumaFeatureFlag.findUnique({ where: { key } });
    if (!drapeau) return { key, enabled: false, reason: 'Drapeau inconnu : fermé par défaut.' };
    if (!drapeau.enabled) return { key, enabled: false, reason: 'Drapeau éteint.' };

    if (!cible(drapeau.environments, env.nodeEnv)) {
      return { key, enabled: false, reason: `Réservé aux environnements : ${drapeau.environments.join(', ')}.` };
    }
    if (!cible(drapeau.countries, contexte.countryCode ?? null)) {
      return { key, enabled: false, reason: `Réservé aux pays : ${drapeau.countries.join(', ')}.` };
    }
    if (!cible(drapeau.provinces, contexte.province ?? null)) {
      return { key, enabled: false, reason: `Réservé aux provinces : ${drapeau.provinces.join(', ')}.` };
    }
    if (!cible(drapeau.storeIds, contexte.storeId ?? null)) {
      return { key, enabled: false, reason: 'Réservé à certaines boutiques.' };
    }

    /**
     * Une personne **nommément** ciblée passe avant le pourcentage.
     *
     * C'est ce qui permet d'ouvrir une fonctionnalité à l'équipe avant tout le
     * monde sans dépendre du hasard du hachage.
     */
    if (drapeau.userIds.length > 0 && contexte.userId && drapeau.userIds.includes(contexte.userId)) {
      return { key, enabled: true, reason: 'Compte explicitement ciblé.' };
    }
    if (drapeau.userIds.length > 0 && drapeau.rolloutPercent === 0) {
      return { key, enabled: false, reason: 'Réservé à certains comptes.' };
    }

    if (drapeau.rolloutPercent >= 100) return { key, enabled: true, reason: 'Déployé à 100 %.' };
    if (drapeau.rolloutPercent <= 0) return { key, enabled: false, reason: 'Déploiement à 0 %.' };

    /**
     * Sans sujet identifiable, pas de déploiement partiel.
     *
     * Un visiteur anonyme n'a rien de stable à hacher : lui attribuer une
     * tranche au hasard ferait clignoter la fonctionnalité d'une page à
     * l'autre. Il reste donc en dehors tant que le déploiement n'est pas
     * complet.
     */
    const sujet = contexte.userId ?? contexte.storeId ?? null;
    if (!sujet) return { key, enabled: false, reason: 'Déploiement partiel : réservé aux visiteurs identifiables.' };

    const part = tranche(key, sujet);
    return part < drapeau.rolloutPercent
      ? { key, enabled: true, reason: `Dans la tranche déployée (${part} < ${drapeau.rolloutPercent}).` }
      : { key, enabled: false, reason: `Hors de la tranche déployée (${part} ≥ ${drapeau.rolloutPercent}).` };
  },

  /** Raccourci booléen, pour le code métier. */
  async isEnabled(key: string, contexte: ContexteDrapeau = {}): Promise<boolean> {
    return (await this.evaluate(key, contexte)).enabled;
  },

  /**
   * Drapeaux lisibles par le navigateur.
   *
   * Seuls ceux marqués `exposedToClient` : un drapeau dit ce qui se prépare, et
   * tout ce qui se prépare n'a pas à être public. Le motif n'est pas rendu —
   * il décrirait le ciblage à qui n'y a pas droit.
   */
  async forClient(contexte: ContexteDrapeau = {}): Promise<Record<string, boolean>> {
    const drapeaux = await prisma.toumaFeatureFlag.findMany({ where: { exposedToClient: true }, select: { key: true } });
    const resultat: Record<string, boolean> = {};
    for (const d of drapeaux) resultat[d.key] = await this.isEnabled(d.key, contexte);
    return resultat;
  },

  /** Vue d'administration : tout, y compris ce qui n'est pas exposé. */
  async list() {
    const drapeaux = await prisma.toumaFeatureFlag.findMany({ orderBy: { key: 'asc' } });
    return drapeaux.map((d) => ({
      ...d,
      /** L'interrupteur d'environnement qui le commande, s'il y en a un. */
      environmentGate: d.key in GARDE_FOUS ? (GARDE_FOUS[d.key]!() ? 'ouvert' : 'fermé') : 'aucun',
    }));
  },
};

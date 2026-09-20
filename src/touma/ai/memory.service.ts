import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { maskPersonalData } from './privacy.js';

/**
 * MÉMOIRE DE L'ASSISTANT (§35).
 *
 * Bornée par construction, sur trois points :
 *
 * 1. **Clés fermées.** Seules les clés de `CLES_AUTORISEES` peuvent être
 *    écrites. Une mémoire à clés libres finirait par contenir ce qu'un
 *    utilisateur aura mentionné en passant — un numéro, une adresse, une
 *    situation personnelle — parce que rien ne l'en empêcherait.
 * 2. **Expiration obligatoire.** Aucune ligne sans date de fin. Une préférence
 *    de budget oubliée depuis deux ans ne doit pas continuer à filtrer les
 *    recherches de quelqu'un qui ne s'en souvient plus.
 * 3. **Valeurs masquées.** Ce qui ressemble à une donnée personnelle est
 *    masqué avant écriture, même sous une clé autorisée.
 */

export type MemoryKind = 'SESSION' | 'PREFERENCE' | 'TASK';

/**
 * Clés recevables, et ce qu'elles veulent dire.
 *
 * Volontairement courte. Chaque ajout doit se justifier par un service rendu à
 * l'utilisateur, pas par ce qu'il serait pratique de savoir sur lui.
 */
export const CLES_AUTORISEES: Record<string, { kind: MemoryKind; description: string }> = {
  budget_max: { kind: 'PREFERENCE', description: 'Budget maximal habituel, dans la devise indiquée.' },
  devise: { kind: 'PREFERENCE', description: 'Devise préférée pour l’affichage des prix.' },
  province_livraison: { kind: 'PREFERENCE', description: 'Province de livraison habituelle.' },
  categories_suivies: { kind: 'PREFERENCE', description: 'Catégories que l’utilisateur suit.' },
  langue: { kind: 'PREFERENCE', description: 'Langue d’échange : fr ou ar.' },
  recherche_en_cours: { kind: 'SESSION', description: 'Dernière recherche de la session.' },
  produit_consulte: { kind: 'SESSION', description: 'Dernier produit consulté dans la conversation.' },
  boutique_active: { kind: 'SESSION', description: 'Boutique sur laquelle porte la conversation vendeur.' },
  rfq_en_preparation: { kind: 'TASK', description: 'Brouillon de demande de devis en cours.' },
};

function dureeJours(kind: MemoryKind): number {
  const c = env.touma.ai;
  return kind === 'SESSION' ? c.memorySessionDays : kind === 'TASK' ? c.memoryTaskDays : c.memoryPreferenceDays;
}

export const memoryService = {
  /**
   * Écrit une mémoire. Une clé inconnue est **ignorée** plutôt que refusée :
   * l'assistant ne doit pas s'interrompre parce qu'il a voulu retenir quelque
   * chose qu'on lui interdit de retenir.
   */
  async remember(userId: string, key: string, value: string, scopeId?: string | null): Promise<boolean> {
    const definition = CLES_AUTORISEES[key];
    if (!definition) return false;
    const propre = maskPersonalData(value).slice(0, 500);
    if (!propre.trim()) return false;
    await prisma.toumaAiMemory.upsert({
      where: { userId_kind_key: { userId, kind: definition.kind, key } },
      update: { value: propre, scopeId: scopeId ?? null, expiresAt: new Date(Date.now() + dureeJours(definition.kind) * 86_400_000) },
      create: { userId, kind: definition.kind, key, value: propre, scopeId: scopeId ?? null, expiresAt: new Date(Date.now() + dureeJours(definition.kind) * 86_400_000) },
    });
    return true;
  },

  /** Mémoire vivante d'un utilisateur. Les lignes expirées ne sont pas rendues. */
  async recall(userId: string): Promise<Record<string, string>> {
    const lignes = await prisma.toumaAiMemory.findMany({ where: { userId, expiresAt: { gt: new Date() } }, select: { key: true, value: true } });
    return Object.fromEntries(lignes.map((l) => [l.key, l.value]));
  },

  async list(userId: string) {
    return prisma.toumaAiMemory.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, kind: true, key: true, value: true, expiresAt: true, updatedAt: true },
    });
  },

  /** Oubli à la demande. Un utilisateur doit pouvoir retirer ce qu'il a laissé. */
  async forget(userId: string, key?: string): Promise<number> {
    const { count } = await prisma.toumaAiMemory.deleteMany({ where: { userId, ...(key ? { key } : {}) } });
    return count;
  },

  /** Balayage des mémoires expirées. Appelé par l'entretien périodique. */
  async purgeExpired(): Promise<number> {
    const { count } = await prisma.toumaAiMemory.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    return count;
  },
};

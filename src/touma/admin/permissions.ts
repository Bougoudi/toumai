import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../db/prisma.js';
import { forbidden, unauthorized } from '../lib/errors.js';

/**
 * PERMISSIONS D'ADMINISTRATION (V25 §25).
 *
 * Jusqu'ici, « administrateur » était un interrupteur : qui l'était pouvait
 * rembourser un paiement, ajuster le grand livre, activer un corridor,
 * suspendre un vendeur et lire les conversations d'IA. C'est commode à deux
 * personnes et intenable ensuite — le jour où quelqu'un est recruté pour
 * traiter les litiges, on lui donne aussi, sans le vouloir, les paiements.
 *
 * Le découpage suit les frontières du métier, pas celles du code : ce sont
 * des responsabilités confiées à des personnes.
 */

export const PERMISSIONS_ADMIN = [
  'ADMIN_USERS',
  'ADMIN_PAYMENTS',
  'ADMIN_PAYOUTS',
  'ADMIN_TRADE',
  'ADMIN_TRUST',
  'ADMIN_LOGISTICS',
  'ADMIN_AI',
  'ADMIN_MARKETING',
  'ADMIN_SYSTEM',
  // V26 : ouvrir ou fermer un marché n'est pas une tâche d'exploitation
  // ordinaire. C'est une décision commerciale, et elle a sa propre permission.
  'ADMIN_COUNTRIES',
] as const;

export type PermissionAdmin = (typeof PERMISSIONS_ADMIN)[number];

/** Ce que chaque permission autorise, en français, pour l'écran qui les accorde. */
export const LIBELLES_PERMISSION: Record<PermissionAdmin, string> = {
  ADMIN_USERS: 'Comptes : consultation, suspension, rôles',
  ADMIN_PAYMENTS: 'Paiements et remboursements',
  ADMIN_PAYOUTS: 'Versements aux vendeurs et grand livre',
  ADMIN_TRADE: 'Commerce transfrontalier : corridors, règles, documents',
  ADMIN_TRUST: 'Confiance et sécurité : vérifications, litiges, signalements',
  ADMIN_LOGISTICS: 'Transport : transporteurs, zones, points relais',
  ADMIN_AI: 'Assistance IA : prestataires, invites, journaux',
  ADMIN_MARKETING: 'Croissance : promotions, fidélité, campagnes',
  ADMIN_SYSTEM: 'Exploitation : configuration, permissions, intégrité des données',
  ADMIN_COUNTRIES: 'Marchés : configuration pays, contrôle de préparation, ouverture et suspension',
};

export function estPermission(valeur: string): valeur is PermissionAdmin {
  return (PERMISSIONS_ADMIN as readonly string[]).includes(valeur);
}

/** Droits d'administration d'un compte, tels qu'ils s'appliquent réellement. */
export interface DroitsAdmin {
  /** Le compte a-t-il été cadré ? */
  scoped: boolean;
  /** Permissions accordées. Sans objet tant que `scoped` est faux. */
  granted: PermissionAdmin[];
  /** Permissions effectives : tout, ou la liste. */
  effective: PermissionAdmin[];
}

export async function droitsDe(userId: string): Promise<DroitsAdmin> {
  const compte = await prisma.user.findUnique({
    where: { id: userId },
    select: { toumaRole: true, adminPermissions: true, adminScoped: true },
  });
  if (!compte || compte.toumaRole !== 'ADMIN') return { scoped: true, granted: [], effective: [] };

  const granted = compte.adminPermissions.filter(estPermission);
  return {
    scoped: compte.adminScoped,
    granted,
    // Un compte non cadré garde l'accès complet : c'est ce qui permet à ce
    // découpage d'arriver sans couper l'accès des administrateurs existants
    // au moment du déploiement.
    effective: compte.adminScoped ? granted : [...PERMISSIONS_ADMIN],
  };
}

/**
 * Exige une permission précise.
 *
 * À poser **après** `requireAdmin`, qui reste la première barrière : ce
 * middleware affine, il ne remplace pas.
 *
 * Le refus est un 403 et non un 404 : contrairement à une ressource qui
 * appartient à quelqu'un d'autre, l'existence d'une console d'administration
 * n'est pas un secret, et dire « il vous manque ADMIN_PAYMENTS » est
 * exactement ce qu'il faut pour que la bonne personne demande le bon droit.
 */
export function requirePermission(permission: PermissionAdmin) {
  return async function verifier(req: Request, _res: Response, next: NextFunction) {
    try {
      const utilisateur = req.toumaUser;
      if (!utilisateur) throw unauthorized();
      const droits = await droitsDe(utilisateur.id);
      if (!droits.effective.includes(permission)) {
        throw forbidden(`Cette action demande la permission ${permission}.`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

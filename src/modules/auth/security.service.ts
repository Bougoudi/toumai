import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { signStepUp, signToken, verifyPassword } from '../../utils/auth.js';
import { mfaService } from './mfa.service.js';

export const securityService = {
  /** Enregistre une connexion dans le journal (détecte les nouveaux appareils). */
  async recordLogin(input: {
    userId: string;
    method: string;
    success?: boolean;
    ip?: string;
    userAgent?: string;
  }) {
    const priors = await prisma.loginEvent.count({
      where: { userId: input.userId, success: true, ip: input.ip ?? null, userAgent: input.userAgent ?? null },
    });
    return prisma.loginEvent.create({
      data: {
        userId: input.userId,
        method: input.method,
        success: input.success ?? true,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        newDevice: priors === 0,
      },
    });
  },

  /** Historique des connexions (journal de sécurité). */
  history(userId: string, take = 30) {
    return prisma.loginEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take });
  },

  /**
   * « Se déconnecter de partout » : incrémente la version de session (invalide
   * tous les jetons émis) et renvoie un jeton frais pour l'appareil courant.
   */
  async logoutEverywhere(userId: string) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    return { token: signToken(user) };
  },

  /**
   * Ré-authentification « step-up » pour une action sensible.
   * Vérifie le mot de passe ou un code TOTP, puis émet un jeton step-up (2 min).
   */
  async stepUp(userId: string, method: 'password' | 'totp', value: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(404, 'Utilisateur introuvable');
    let ok = false;
    if (method === 'password') ok = await verifyPassword(value, user.passwordHash);
    else ok = user.totpEnabled ? mfaService.verifyTotpCode(user.totpSecret, value) : false;
    if (!ok) throw new HttpError(401, 'Vérification échouée.');
    return { stepUpToken: signStepUp(userId) };
  },

  /** Supprime définitivement le compte (action sensible, protégée par step-up). */
  async deleteAccount(userId: string) {
    await prisma.user.delete({ where: { id: userId } });
  },

  /** Politique 2FA : imposée aux administrateurs, recommandée aux autres. */
  async mfaPolicy(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { _count: { select: { credentials: true } } },
    });
    if (!user) throw new HttpError(404, 'Utilisateur introuvable');
    const enabled = user.totpEnabled || user._count.credentials > 0;
    return { enabled, enforced: user.role === 'admin', recommended: true };
  },
};

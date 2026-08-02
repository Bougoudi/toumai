import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import {
  hashPassword,
  signMfaChallenge,
  signPasswordReset,
  signToken,
  verifyPassword,
  verifyPasswordReset,
} from '../../utils/auth.js';
import { emailEnabled, sendEmail } from '../../utils/email.js';
import { logger } from '../../utils/logger.js';
import type { LoginInput, RegisterInput } from './auth.schema.js';

function publicUser(u: { id: string; name: string; email: string; role: string }) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

export const authService = {
  /** Inscrit un nouvel utilisateur et renvoie un jeton. Le 1er inscrit est admin. */
  async register(input: RegisterInput) {
    const email = input.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new HttpError(409, 'Un compte existe déjà avec cet email');

    const count = await prisma.user.count();
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email,
        passwordHash: await hashPassword(input.password),
        role: count === 0 ? 'admin' : 'user',
      },
    });
    return { token: signToken(user), user: publicUser(user) };
  },

  /**
   * Étape 1 : mot de passe. Si un second facteur est activé, renvoie un défi MFA
   * (aucun accès tant que le 2e facteur n'est pas validé) ; sinon, un jeton complet.
   */
  async login(input: LoginInput) {
    const email = input.email.toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      include: { _count: { select: { credentials: true } } },
    });
    // Message générique pour ne pas révéler l'existence d'un compte.
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new HttpError(401, 'Email ou mot de passe incorrect');
    }
    const methods: string[] = [];
    if (user.totpEnabled) methods.push('totp');
    if (user._count.credentials > 0) methods.push('webauthn');
    if (user.recoveryCodes) methods.push('recovery');

    if (methods.length > 0) {
      return { mfaRequired: true, mfaToken: signMfaChallenge(user.id), methods };
    }
    return { token: signToken(user), user: publicUser(user) };
  },

  /** Étape 2 : émet le jeton complet après validation du second facteur. */
  async issueSession(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(404, 'Utilisateur introuvable');
    return { token: signToken(user), user: publicUser(user) };
  },

  async me(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(404, 'Utilisateur introuvable');
    return publicUser(user);
  },

  /** L'envoi d'e-mails est-il configuré (pour afficher « Mot de passe oublié »). */
  emailEnabled: () => emailEnabled(),

  /**
   * « Mot de passe oublié » : si le compte existe et que l'e-mail est configuré,
   * envoie un lien de réinitialisation (valide 30 min). Renvoie toujours un
   * succès générique — on ne révèle jamais si l'e-mail correspond à un compte.
   */
  async forgotPassword(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && emailEnabled()) {
      const token = signPasswordReset(user.id, user.tokenVersion);
      const link = `${env.publicUrl.replace(/\/$/, '')}/?reset=${encodeURIComponent(token)}`;
      const html = `
        <div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:auto">
          <h2>Réinitialisation de votre mot de passe Toumai</h2>
          <p>Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous
          (lien valable 30 minutes) :</p>
          <p style="text-align:center;margin:28px 0">
            <a href="${link}" style="background:#22d3ee;color:#06212a;padding:12px 22px;border-radius:8px;
            text-decoration:none;font-weight:600">Réinitialiser mon mot de passe</a>
          </p>
          <p style="color:#64748b;font-size:13px">Si vous n'êtes pas à l'origine de cette demande,
          ignorez cet e-mail : votre mot de passe reste inchangé.</p>
        </div>`;
      try {
        await sendEmail(email, 'Réinitialisation de votre mot de passe Toumai', html);
      } catch (err) {
        logger.error('Échec envoi e-mail de réinitialisation', { err: err instanceof Error ? err.message : String(err) });
      }
    }
    return { ok: true };
  },

  /**
   * Applique le nouveau mot de passe à partir d'un jeton de réinitialisation.
   * Le jeton doit correspondre au `tokenVersion` courant (usage unique) ; après
   * succès, on incrémente tokenVersion, ce qui invalide le lien et déconnecte
   * toutes les sessions existantes.
   */
  async resetPassword(token: string, newPassword: string) {
    const parsed = verifyPasswordReset(token);
    if (!parsed) throw new HttpError(400, 'Lien de réinitialisation invalide ou expiré.');
    if (newPassword.length < 10) {
      throw new HttpError(400, 'Le nouveau mot de passe doit faire au moins 10 caractères.');
    }
    const user = await prisma.user.findUnique({ where: { id: parsed.userId } });
    if (!user || user.tokenVersion !== parsed.tv) {
      throw new HttpError(400, 'Lien de réinitialisation déjà utilisé ou expiré.');
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword), tokenVersion: { increment: 1 } },
    });
    logger.info('Mot de passe réinitialisé par e-mail', { userId: user.id });
    return { token: signToken(updated), user: publicUser(updated) };
  },
};

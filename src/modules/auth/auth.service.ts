import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { hashPassword, signToken, verifyPassword } from '../../utils/auth.js';
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

  /** Authentifie un utilisateur et renvoie un jeton. */
  async login(input: LoginInput) {
    const email = input.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    // Message générique pour ne pas révéler l'existence d'un compte.
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new HttpError(401, 'Email ou mot de passe incorrect');
    }
    return { token: signToken(user), user: publicUser(user) };
  },

  async me(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(404, 'Utilisateur introuvable');
    return publicUser(user);
  },
};

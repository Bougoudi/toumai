import { prisma } from '../db/prisma.js';
import { hashPassword } from '../utils/auth.js';
import { logger } from '../utils/logger.js';

/**
 * Crée le premier compte administrateur au démarrage, en production, si la base
 * est vide. Les identifiants proviennent des variables d'environnement
 * `ADMIN_EMAIL` / `ADMIN_PASSWORD` — aucune donnée de démonstration n'est créée.
 *
 * Ne fait rien si :
 *   - des utilisateurs existent déjà (on ne réinitialise jamais un compte) ;
 *   - les variables ne sont pas définies.
 */
export async function ensureFirstAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const count = await prisma.user.count();
  if (count > 0) return;

  if (password.length < 10) {
    logger.error('ADMIN_PASSWORD trop court (≥ 10 caractères requis) : admin non créé');
    return;
  }

  await prisma.user.create({
    data: {
      name: process.env.ADMIN_NAME?.trim() || 'Administrateur',
      email,
      passwordHash: await hashPassword(password),
      role: 'admin',
    },
  });
  logger.info('Compte administrateur initial créé', { email });
}

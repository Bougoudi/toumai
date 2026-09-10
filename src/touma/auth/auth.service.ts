import { randomUUID } from 'node:crypto';
import type { Prisma, User } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { hashPassword, verifyPassword } from '../../utils/auth.js';
import { logger } from '../../utils/logger.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { generateRefreshToken, hashRefreshToken, refreshTokenLooksValid, signAccessToken } from '../lib/tokens.js';

/** Représentation publique d'un utilisateur : aucune donnée sensible. */
export function publicUser(user: Pick<User, 'id' | 'name' | 'email' | 'toumaRole' | 'status' | 'phone' | 'countryCode' | 'locale' | 'createdAt'>) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.toumaRole,
    status: user.status,
    phone: user.phone,
    countryCode: user.countryCode,
    locale: user.locale,
    createdAt: user.createdAt,
  };
}

export interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
}

/** Émet un couple (jeton d'accès, jeton de rafraîchissement) pour une famille donnée. */
async function issueSession(user: User, familyId: string, ctx: SessionContext) {
  const { token, hash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env.touma.refreshTtlSeconds * 1000);
  await prisma.toumaRefreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hash,
      familyId,
      expiresAt,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent?.slice(0, 250) ?? null,
    },
  });
  return {
    accessToken: signAccessToken({
      id: user.id,
      email: user.email,
      toumaRole: user.toumaRole,
      tokenVersion: user.tokenVersion,
    }),
    refreshToken: token,
    expiresIn: env.touma.accessTtlSeconds,
    tokenType: 'Bearer' as const,
  };
}

/** Vérifie que le pays existe et accepte des utilisateurs. */
async function assertCountry(code?: string): Promise<string | null> {
  if (!code) return null;
  const country = await prisma.country.findUnique({ where: { code } });
  if (!country || !country.active) {
    throw badRequest(`Pays « ${code} » non desservi par Touma pour l'instant.`);
  }
  return country.code;
}

export const authService = {
  /**
   * Inscription. Le rôle ADMIN ne peut jamais être obtenu ici (il se donne en
   * base ou via l'espace d'administration).
   */
  async register(input: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    countryCode?: string;
    role: 'BUYER' | 'SELLER';
  }, ctx: SessionContext) {
    const countryCode = await assertCountry(input.countryCode);
    const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing) {
      // Message volontairement générique : ne confirme pas l'existence du compte.
      throw conflict("Impossible de créer ce compte. S'il existe déjà, connectez-vous.");
    }
    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        phone: input.phone ?? null,
        countryCode,
        toumaRole: input.role,
        // Rôle historique du logiciel d'automatisation : inchangé (utilisateur simple).
        role: 'user',
      },
    });
    await audit({ actorId: user.id, action: 'auth.register', entity: 'User', entityId: user.id, ip: ctx.ip });
    const session = await issueSession(user, randomUUID(), ctx);
    return { user: publicUser(user), ...session };
  },

  /**
   * Connexion. Réponse identique que l'e-mail soit inconnu ou le mot de passe
   * faux (protection contre l'énumération des comptes), et vérification du mot
   * de passe toujours exécutée (temps de réponse comparable).
   */
  async login(input: { email: string; password: string }, ctx: SessionContext) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const stored = user?.passwordHash ?? 'x'.repeat(32) + ':' + 'y'.repeat(128);
    const ok = await verifyPassword(input.password, stored);
    if (!user || !ok) {
      if (user) {
        await prisma.loginEvent.create({
          data: { userId: user.id, method: 'password', success: false, ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
        }).catch(() => undefined);
        // Signal de risque : les échecs répétés alimentent le score (Touma Risk).
        await prisma.toumaFraudEvent.create({
          data: { userId: user.id, code: 'LOGIN_FAILED', weight: 2, detail: { ip: ctx.ip ?? null } as object },
        }).catch(() => undefined);
      }
      throw unauthorized('Identifiants invalides.');
    }
    if (user.status !== 'ACTIVE') {
      throw unauthorized('Ce compte est suspendu. Contactez le support Touma.');
    }
    await prisma.loginEvent.create({
      data: { userId: user.id, method: 'password', success: true, ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
    }).catch(() => undefined);
    const session = await issueSession(user, randomUUID(), ctx);
    return { user: publicUser(user), ...session };
  },

  /**
   * Rotation du jeton de rafraîchissement.
   *
   * - le jeton présenté est révoqué et remplacé (usage unique) ;
   * - s'il avait **déjà** été utilisé, c'est le signe d'un vol : toute la
   *   famille de jetons est révoquée et la session tombe.
   */
  async refresh(refreshToken: string, ctx: SessionContext) {
    if (!refreshTokenLooksValid(refreshToken)) throw unauthorized('Jeton de rafraîchissement invalide.');
    const hash = hashRefreshToken(refreshToken);
    const record = await prisma.toumaRefreshToken.findUnique({ where: { tokenHash: hash }, include: { user: true } });
    if (!record) throw unauthorized('Jeton de rafraîchissement invalide.');

    if (record.revokedAt) {
      await prisma.toumaRefreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await audit({
        actorId: record.userId,
        action: 'auth.refresh.reuse_detected',
        entity: 'ToumaRefreshToken',
        entityId: record.id,
        ip: ctx.ip,
      });
      logger.error('Réutilisation d’un jeton de rafraîchissement détectée', { userId: record.userId });
      throw unauthorized('Session compromise : reconnectez-vous.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw unauthorized('Session expirée : reconnectez-vous.');
    }
    if (record.user.status !== 'ACTIVE') throw unauthorized('Ce compte est suspendu.');

    const session = await issueSession(record.user, record.familyId, ctx);
    await prisma.toumaRefreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date(), replacedBy: hashRefreshToken(session.refreshToken) },
    });
    return { user: publicUser(record.user), ...session };
  },

  /** Déconnexion : révoque le jeton présenté, ou toutes les sessions. */
  async logout(userId: string, input: { refreshToken?: string; allDevices?: boolean }, ctx: SessionContext) {
    if (input.allDevices) {
      await prisma.$transaction([
        prisma.toumaRefreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
        // Invalide aussi tous les jetons d'accès déjà émis.
        prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
      ]);
      await audit({ actorId: userId, action: 'auth.logout_all', entity: 'User', entityId: userId, ip: ctx.ip });
      return { revoked: 'all' as const };
    }
    if (input.refreshToken) {
      await prisma.toumaRefreshToken.updateMany({
        where: { tokenHash: hashRefreshToken(input.refreshToken), userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { revoked: 'session' as const };
  },

  /** Profil complet de l'utilisateur courant. */
  async me(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] },
        stores: { select: { id: true, name: true, slug: true, status: true, verificationStatus: true } },
      },
    });
    if (!user) throw unauthorized();
    return {
      ...publicUser(user),
      addresses: user.addresses,
      stores: user.stores,
    };
  },

  /** Met à jour le profil. Le rôle et le statut ne sont jamais modifiables ici. */
  async updateProfile(userId: string, input: { name?: string; phone?: string; countryCode?: string; locale?: string }) {
    if (input.countryCode) await assertCountry(input.countryCode);
    const data: Prisma.UserUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.countryCode !== undefined) data.countryCode = input.countryCode;
    if (input.locale !== undefined) data.locale = input.locale;
    const user = await prisma.user.update({ where: { id: userId }, data });
    return publicUser(user);
  },
};

import { randomUUID } from 'node:crypto';
import type { Prisma, User } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { hashPassword, verifyPassword } from '../../utils/auth.js';
import { logger } from '../../utils/logger.js';
import { audit } from '../lib/audit.js';
import { referralService } from '../growth/referral.service.js';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { generateRefreshToken, hashRefreshToken, refreshTokenLooksValid, signAccessToken } from '../lib/tokens.js';

/**
 * Ce que révoquer produit réellement.
 *
 * Écrit une fois, rendu partout où la question se pose. Laisser croire à une
 * coupure instantanée serait le pire endroit pour être approximatif : on
 * révoque une session précisément quand on pense qu'elle est aux mains de
 * quelqu'un d'autre.
 */
const NOTE_REVOCATION = () =>
  `Révoquer une session empêche immédiatement d’en obtenir de nouveaux jetons. Le jeton d’accès déjà émis reste ` +
  `valable au plus ${Math.round(env.touma.accessTtlSeconds / 60)} minutes. Pour une coupure immédiate partout, utilisez la déconnexion de tous les appareils.`;

/** Représentation publique d'un utilisateur : aucune donnée sensible. */
/**
 * Normalise un numéro avec l'indicatif du pays du compte.
 *
 * Rend `null` quand rien n'est fourni ; lève quand ce qui est fourni n'est pas
 * un numéro. Un numéro facultatif peut être absent — il ne peut pas être
 * n'importe quoi.
 */
async function normalizedPhoneFor(phone: string | undefined, countryCode?: string | null): Promise<string | null> {
  if (!phone) return null;
  const country = countryCode ? await prisma.country.findUnique({ where: { code: countryCode }, select: { dialCode: true } }) : null;
  const dialCode = country?.dialCode.replace(/^\+/, '') || undefined;
  return normalizePhone(phone, dialCode).e164;
}

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
    /** Code de parrainage, facultatif. Un code erroné n'empêche pas l'inscription. */
    referralCode?: string;
  }, ctx: SessionContext) {
    const countryCode = await assertCountry(input.countryCode);
    const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing) {
      // Message volontairement générique : ne confirme pas l'existence du compte.
      throw conflict("Impossible de créer ce compte. S'il existe déjà, connectez-vous.");
    }
    const passwordHash = await hashPassword(input.password);
    // Le numéro est rangé en E.164, avec l'indicatif du pays du compte. Sans
    // cela « 66 12 34 56 » et « +235 66123456 » restent deux numéros différents
    // pour la base : aucun compte reconnaissable par son numéro, aucun SMS
    // fiable, aucune détection de fraude par numéro.
    const phone = await normalizedPhoneFor(input.phone, countryCode);
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        phone,
        countryCode,
        toumaRole: input.role,
        // Rôle historique du logiciel d'automatisation : inchangé (utilisateur simple).
        role: 'user',
      },
    });
    await audit({ actorId: user.id, action: 'auth.register', entity: 'User', entityId: user.id, ip: ctx.ip });
    // Le parrainage ne peut pas faire échouer une inscription : un code
    // erroné, expiré ou frauduleux perd le parrainage, pas le compte.
    await referralService.register(user.id, input.referralCode);
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

  /**
   * Sessions actives d'un compte (V25 §24).
   *
   * Une session est une **famille** de jetons, pas une ligne de la table. Le
   * jeton tourne à chaque rafraîchissement : la ligne vivante d'aujourd'hui
   * n'est pas celle d'il y a dix minutes, et son identifiant non plus. Exposer
   * l'identifiant de ligne donnerait un bouton « révoquer » qui désigne une
   * ligne périmée quelques secondes plus tard. La famille, elle, ne bouge pas
   * tant que l'appareil reste connecté.
   *
   * L'appareil est lu sur la **première** ligne de la famille, pas sur la
   * dernière. La rotation enregistre le contexte de l'appel de
   * rafraîchissement — souvent une requête d'arrière-plan sans en-tête
   * `user-agent` —, si bien que la session perdait son nom dès le premier
   * renouvellement : quelqu'un cherchant « mon téléphone » dans la liste n'y
   * trouvait qu'une ligne anonyme, c'est-à-dire l'inverse de ce que cet écran
   * sert à faire.
   */
  async listSessions(userId: string, refreshTokenCourant?: string) {
    const maintenant = new Date();
    const vivantes = await prisma.toumaRefreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: maintenant } },
      orderBy: { createdAt: 'desc' },
      select: { familyId: true, createdAt: true, expiresAt: true, tokenHash: true },
    });
    if (vivantes.length === 0) return { items: [], note: NOTE_REVOCATION() };

    const familles = [...new Set(vivantes.map((v) => v.familyId))];
    // Les lignes révoquées sont conservées : elles portent l'origine de la
    // session, que la rotation a ensuite cessé de renseigner.
    const origines = await prisma.toumaRefreshToken.findMany({
      where: { userId, familyId: { in: familles } },
      orderBy: { createdAt: 'asc' },
      select: { familyId: true, createdAt: true, userAgent: true, ip: true },
    });
    const origineDe = new Map<string, (typeof origines)[number]>();
    for (const o of origines) if (!origineDe.has(o.familyId)) origineDe.set(o.familyId, o);

    const hashCourant = refreshTokenCourant ? hashRefreshToken(refreshTokenCourant) : null;
    const familleCourante = hashCourant ? vivantes.find((v) => v.tokenHash === hashCourant)?.familyId ?? null : null;

    const derniereDe = new Map<string, (typeof vivantes)[number]>();
    for (const v of vivantes) if (!derniereDe.has(v.familyId)) derniereDe.set(v.familyId, v);

    return {
      items: familles.map((familyId) => {
        const origine = origineDe.get(familyId);
        const derniere = derniereDe.get(familyId)!;
        return {
          /** L'identifiant de **famille** : c'est lui qu'on révoque. */
          id: familyId,
          /** La session depuis laquelle la liste est demandée. */
          current: familyId === familleCourante,
          startedAt: origine?.createdAt ?? derniere.createdAt,
          lastSeenAt: derniere.createdAt,
          expiresAt: derniere.expiresAt,
          /** Relevés à la **connexion**, seul moment où ils décrivent l'appareil. */
          userAgent: origine?.userAgent ?? null,
          ip: origine?.ip ?? null,
        };
      }),
      note: NOTE_REVOCATION(),
    };
  },

  /**
   * Révoque une session entière.
   *
   * Par famille, et pas par ligne : la rotation a laissé une chaîne derrière
   * elle, et ne révoquer que la dernière ligne laisserait un jeton antérieur
   * utilisable. Révoquer la famille ferme la chaîne d'un bloc.
   *
   * Une famille qui n'appartient pas à l'appelant rend « introuvable », pas
   * « interdit » : répondre 403 confirmerait son existence.
   */
  async revokeSession(userId: string, familyId: string, ctx: SessionContext) {
    const { count } = await prisma.toumaRefreshToken.updateMany({
      where: { userId, familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw notFound('Session introuvable.');

    await audit({ actorId: userId, action: 'auth.session_revoked', entity: 'User', entityId: userId, ip: ctx.ip, metadata: { familyId } });
    return {
      revoked: familyId,
      accessTokenValidForSeconds: env.touma.accessTtlSeconds,
      note: NOTE_REVOCATION(),
    };
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
    if (input.phone !== undefined) {
      const utilisateur = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { countryCode: true } });
      data.phone = await normalizedPhoneFor(input.phone, input.countryCode ?? utilisateur.countryCode ?? undefined);
    }
    if (input.countryCode !== undefined) data.countryCode = input.countryCode;
    if (input.locale !== undefined) data.locale = input.locale;
    const user = await prisma.user.update({ where: { id: userId }, data });
    return publicUser(user);
  },
};

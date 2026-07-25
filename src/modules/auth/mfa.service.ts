import { createHash, randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { decrypt, encrypt } from '../../utils/crypto.js';

// ── WebAuthn : identité du site (rpID / origin) ────────────
const rpURL = new URL(env.publicUrl);
const rpID = rpURL.hostname; // ex: localhost
const origin = env.publicUrl.replace(/\/$/, '');
const rpName = 'Toumai';

// Défis WebAuthn en attente (id utilisateur → défi), courte durée.
const challenges = new Map<string, { challenge: string; expires: number }>();
function putChallenge(userId: string, challenge: string) {
  challenges.set(userId, { challenge, expires: Date.now() + 300_000 });
}
function takeChallenge(userId: string): string | null {
  const c = challenges.get(userId);
  challenges.delete(userId);
  if (!c || c.expires < Date.now()) return null;
  return c.challenge;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

async function getUser(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { credentials: true } });
  if (!u) throw new HttpError(404, 'Utilisateur introuvable');
  return u;
}

export const mfaService = {
  /** Récapitulatif des facteurs activés (pour l'UI). */
  async status(userId: string) {
    const u = await getUser(userId);
    let recoveryLeft = 0;
    if (u.recoveryCodes) {
      try {
        recoveryLeft = (JSON.parse(decrypt(u.recoveryCodes)) as string[]).length;
      } catch {
        /* ignore */
      }
    }
    return {
      totpEnabled: u.totpEnabled,
      recoveryCodesRemaining: recoveryLeft,
      securityKeys: u.credentials.map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt })),
    };
  },

  // ── TOTP (application d'authentification) ───────────────
  async totpSetup(userId: string) {
    const u = await getUser(userId);
    const secret = authenticator.generateSecret();
    await prisma.user.update({ where: { id: userId }, data: { totpSecret: encrypt(secret), totpEnabled: false } });
    const otpauth = authenticator.keyuri(u.email, rpName, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    return { otpauth, qrDataUrl, secret };
  },

  /** Active le TOTP après vérification d'un code, puis renvoie les codes de récupération. */
  async totpEnable(userId: string, code: string) {
    const u = await getUser(userId);
    if (!u.totpSecret) throw new HttpError(400, 'Commencez par la configuration TOTP.');
    const secret = decrypt(u.totpSecret);
    if (!authenticator.verify({ token: code, secret })) {
      throw new HttpError(400, 'Code invalide. Vérifiez l’heure de votre téléphone et réessayez.');
    }
    const { plain, stored } = generateRecoveryCodes();
    await prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true, recoveryCodes: encrypt(JSON.stringify(stored)) },
    });
    return { enabled: true, recoveryCodes: plain };
  },

  async totpDisable(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecret: null, recoveryCodes: null },
    });
    return { enabled: false };
  },

  verifyTotpCode(totpSecretEnc: string | null, code: string): boolean {
    if (!totpSecretEnc) return false;
    return authenticator.verify({ token: code, secret: decrypt(totpSecretEnc) });
  },

  // ── Codes de récupération ───────────────────────────────
  async regenerateRecovery(userId: string) {
    const { plain, stored } = generateRecoveryCodes();
    await prisma.user.update({ where: { id: userId }, data: { recoveryCodes: encrypt(JSON.stringify(stored)) } });
    return { recoveryCodes: plain };
  },

  /** Vérifie et consomme un code de récupération (usage unique). */
  async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const u = await getUser(userId);
    if (!u.recoveryCodes) return false;
    let codes: string[];
    try {
      codes = JSON.parse(decrypt(u.recoveryCodes));
    } catch {
      return false;
    }
    const h = sha256(code.trim().toUpperCase());
    const idx = codes.indexOf(h);
    if (idx === -1) return false;
    codes.splice(idx, 1);
    await prisma.user.update({ where: { id: userId }, data: { recoveryCodes: encrypt(JSON.stringify(codes)) } });
    return true;
  },

  // ── WebAuthn (clé de sécurité / passkey) ────────────────
  async webauthnRegisterOptions(userId: string) {
    const u = await getUser(userId);
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: u.email,
      userDisplayName: u.name,
      attestationType: 'none',
      excludeCredentials: u.credentials.map((c) => ({ id: c.credentialId })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    putChallenge(userId, options.challenge);
    return options;
  },

  async webauthnRegisterVerify(userId: string, response: any, name?: string) {
    const challenge = takeChallenge(userId);
    if (!challenge) throw new HttpError(400, 'Défi expiré, recommencez.');
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new HttpError(400, 'Enregistrement de la clé échoué.');
    }
    const { credential } = verification.registrationInfo;
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: b64url(credential.publicKey),
        counter: credential.counter,
        transports: (credential.transports ?? []).join(','),
        name: name?.trim() || 'Clé de sécurité',
      },
    });
    return { registered: true };
  },

  async removeSecurityKey(userId: string, id: string) {
    const cred = await prisma.webAuthnCredential.findFirst({ where: { id, userId } });
    if (!cred) throw new HttpError(404, 'Clé introuvable');
    await prisma.webAuthnCredential.delete({ where: { id } });
  },

  /** Options d'authentification WebAuthn (étape 2 de connexion). */
  async webauthnAuthOptions(userId: string) {
    const u = await getUser(userId);
    if (u.credentials.length === 0) throw new HttpError(400, 'Aucune clé de sécurité enregistrée.');
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: u.credentials.map((c) => ({ id: c.credentialId })),
      userVerification: 'preferred',
    });
    putChallenge(userId, options.challenge);
    return options;
  },

  async webauthnAuthVerify(userId: string, response: any): Promise<boolean> {
    const challenge = takeChallenge(userId);
    if (!challenge) return false;
    const cred = await prisma.webAuthnCredential.findUnique({ where: { credentialId: response.id } });
    if (!cred || cred.userId !== userId) return false;
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: cred.credentialId, publicKey: fromB64url(cred.publicKey), counter: cred.counter },
    });
    if (verification.verified) {
      await prisma.webAuthnCredential.update({
        where: { id: cred.id },
        data: { counter: verification.authenticationInfo.newCounter },
      });
    }
    return verification.verified;
  },
};

/** Génère 10 codes de récupération lisibles + leurs hachages à stocker. */
function generateRecoveryCodes(count = 10): { plain: string[]; stored: string[] } {
  const plain: string[] = [];
  const stored: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = `${randomBytes(3).toString('hex')}-${randomBytes(3).toString('hex')}`.toUpperCase();
    plain.push(code);
    stored.push(sha256(code));
  }
  return { plain, stored };
}

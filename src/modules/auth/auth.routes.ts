import { Router } from 'express';
import { requireAuth, requireStepUp } from '../../middleware/requireAuth.js';
import { authLimiter } from '../../middleware/security.js';
import { asyncHandler } from '../../middleware/validate.js';
import { authController } from './auth.controller.js';
import { mfaController } from './mfa.controller.js';
import { securityController } from './security.controller.js';

export const authRouter = Router();
// Limite stricte (anti-force brute) sur les points de vérification d'identifiants.
authRouter.post('/register', authLimiter, asyncHandler(authController.register));
authRouter.post('/login', authLimiter, asyncHandler(authController.login));
authRouter.get('/me', requireAuth, asyncHandler(authController.me));

// ── MFA : enrôlement (session complète requise) ──────────
authRouter.get('/mfa/status', requireAuth, asyncHandler(mfaController.status));
authRouter.post('/mfa/totp/setup', requireAuth, asyncHandler(mfaController.totpSetup));
authRouter.post('/mfa/totp/enable', requireAuth, asyncHandler(mfaController.totpEnable));
// Désactiver le TOTP = action sensible → ré-authentification (step-up).
authRouter.post('/mfa/totp/disable', requireAuth, requireStepUp, asyncHandler(mfaController.totpDisable));
authRouter.post('/mfa/recovery/regenerate', requireAuth, requireStepUp, asyncHandler(mfaController.regenerateRecovery));
authRouter.post('/mfa/webauthn/register/options', requireAuth, asyncHandler(mfaController.webauthnRegisterOptions));
authRouter.post('/mfa/webauthn/register/verify', requireAuth, asyncHandler(mfaController.webauthnRegisterVerify));
// Retirer une clé de sécurité = action sensible → step-up.
authRouter.delete('/mfa/webauthn/:id', requireAuth, requireStepUp, asyncHandler(mfaController.removeKey));

// ── MFA : étape 2 de connexion (jeton de défi, public, débit strict) ───
authRouter.post('/mfa/verify', authLimiter, asyncHandler(mfaController.verify));
authRouter.post('/mfa/webauthn/auth/options', asyncHandler(mfaController.webauthnAuthOptions));
authRouter.post('/mfa/webauthn/auth/verify', authLimiter, asyncHandler(mfaController.webauthnAuthVerify));

// ── Sécurité du compte ───────────────────────────────────
authRouter.get('/security/policy', requireAuth, asyncHandler(securityController.policy));
authRouter.get('/security/history', requireAuth, asyncHandler(securityController.history));
authRouter.post('/security/step-up', requireAuth, authLimiter, asyncHandler(securityController.stepUp));
authRouter.post('/security/logout-all', requireAuth, asyncHandler(securityController.logoutAll));
// Suppression du compte = action sensible → step-up.
authRouter.post('/security/delete-account', requireAuth, requireStepUp, asyncHandler(securityController.deleteAccount));

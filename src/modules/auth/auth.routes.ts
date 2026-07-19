import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { asyncHandler } from '../../middleware/validate.js';
import { authController } from './auth.controller.js';
import { mfaController } from './mfa.controller.js';

export const authRouter = Router();
authRouter.post('/register', asyncHandler(authController.register));
authRouter.post('/login', asyncHandler(authController.login));
authRouter.get('/me', requireAuth, asyncHandler(authController.me));

// ── MFA : enrôlement (session complète requise) ──────────
authRouter.get('/mfa/status', requireAuth, asyncHandler(mfaController.status));
authRouter.post('/mfa/totp/setup', requireAuth, asyncHandler(mfaController.totpSetup));
authRouter.post('/mfa/totp/enable', requireAuth, asyncHandler(mfaController.totpEnable));
authRouter.post('/mfa/totp/disable', requireAuth, asyncHandler(mfaController.totpDisable));
authRouter.post('/mfa/recovery/regenerate', requireAuth, asyncHandler(mfaController.regenerateRecovery));
authRouter.post('/mfa/webauthn/register/options', requireAuth, asyncHandler(mfaController.webauthnRegisterOptions));
authRouter.post('/mfa/webauthn/register/verify', requireAuth, asyncHandler(mfaController.webauthnRegisterVerify));
authRouter.delete('/mfa/webauthn/:id', requireAuth, asyncHandler(mfaController.removeKey));

// ── MFA : étape 2 de connexion (jeton de défi, public) ───
authRouter.post('/mfa/verify', asyncHandler(mfaController.verify));
authRouter.post('/mfa/webauthn/auth/options', asyncHandler(mfaController.webauthnAuthOptions));
authRouter.post('/mfa/webauthn/auth/verify', asyncHandler(mfaController.webauthnAuthVerify));

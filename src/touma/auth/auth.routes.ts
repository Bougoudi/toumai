import { Router } from 'express';
import { authLimiter } from '../../middleware/security.js';
import { asyncHandler } from '../../middleware/validate.js';
import { authenticate } from '../middleware/toumaAuth.js';
import { authController } from './auth.controller.js';

export const toumaAuthRouter = Router();

// Points d'entrée publics : limite stricte anti-force brute.
toumaAuthRouter.post('/register', authLimiter, asyncHandler(authController.register));
toumaAuthRouter.post('/login', authLimiter, asyncHandler(authController.login));
toumaAuthRouter.post('/refresh', authLimiter, asyncHandler(authController.refresh));

// Session requise.
toumaAuthRouter.post('/logout', authenticate, asyncHandler(authController.logout));
toumaAuthRouter.get('/me', authenticate, asyncHandler(authController.me));
toumaAuthRouter.patch('/me', authenticate, asyncHandler(authController.updateMe));

// Carnet d'adresses de l'utilisateur courant.
/**
 * Sessions actives et révocation (V25 §24).
 *
 * Montées sous `/auth/me/...` et non `/users/me/...` : c'est là que vivent
 * déjà `/me` et `/me/addresses`. Ouvrir un second préfixe pour deux routes
 * couperait la surface d'authentification en deux sans rien apporter.
 */
toumaAuthRouter.get('/me/sessions', authenticate, asyncHandler(authController.listSessions));
toumaAuthRouter.post('/me/sessions/:id/revoke', authenticate, asyncHandler(authController.revokeSession));

/**
 * Données personnelles (V25 §66-68).
 *
 * L'export est limité en débit : c'est une lecture large de tout ce qu'un
 * compte détient, et elle n'a aucune raison d'être appelée en rafale.
 */
toumaAuthRouter.post('/me/export', authenticate, authLimiter, asyncHandler(authController.exportData));
toumaAuthRouter.get('/me/delete-request', authenticate, asyncHandler(authController.deletionStatus));
toumaAuthRouter.post('/me/delete-request', authenticate, authLimiter, asyncHandler(authController.requestDeletion));
toumaAuthRouter.post('/me/delete-request/cancel', authenticate, asyncHandler(authController.cancelDeletion));

toumaAuthRouter.get('/me/addresses', authenticate, asyncHandler(authController.listAddresses));
toumaAuthRouter.post('/me/addresses', authenticate, asyncHandler(authController.createAddress));
toumaAuthRouter.delete('/me/addresses/:id', authenticate, asyncHandler(authController.deleteAddress));

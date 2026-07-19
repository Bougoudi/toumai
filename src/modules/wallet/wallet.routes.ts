import { Router } from 'express';
import { requireStepUp } from '../../middleware/requireAuth.js';
import { asyncHandler } from '../../middleware/validate.js';
import { walletController } from './wallet.controller.js';

export const walletRouter = Router();
walletRouter.get('/', asyncHandler(walletController.overview));
// Le retrait d'argent est une action sensible → ré-authentification requise.
walletRouter.post('/withdraw', requireStepUp, asyncHandler(walletController.withdraw));
walletRouter.post('/:id/cancel', asyncHandler(walletController.cancel));

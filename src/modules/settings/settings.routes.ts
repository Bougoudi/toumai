import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { settingsController } from './settings.controller.js';

export const settingsRouter = Router();
settingsRouter.get('/', settingsController.get);
settingsRouter.patch('/', asyncHandler(settingsController.update));
settingsRouter.post('/reset', asyncHandler(settingsController.reset));
// Purge des données de démonstration (action destructive, confirmée côté UI).
settingsRouter.post('/purge', asyncHandler(settingsController.purge));

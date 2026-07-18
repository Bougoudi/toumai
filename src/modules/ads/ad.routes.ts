import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { adController } from './ad.controller.js';

export const adRouter = Router();
adRouter.get('/', asyncHandler(adController.list));
adRouter.post('/generate', asyncHandler(adController.generate));
adRouter.patch('/:id/status', asyncHandler(adController.setStatus));
adRouter.delete('/:id', asyncHandler(adController.remove));

import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { competitorController } from './competitor.controller.js';

export const competitorRouter = Router();
competitorRouter.get('/', asyncHandler(competitorController.list));
competitorRouter.post('/', asyncHandler(competitorController.add));
competitorRouter.get('/winning', asyncHandler(competitorController.winning));
competitorRouter.delete('/:id', asyncHandler(competitorController.remove));
competitorRouter.patch('/:id/follow', asyncHandler(competitorController.follow));
competitorRouter.post('/:id/scan', asyncHandler(competitorController.scan));
competitorRouter.post('/products/:productId/favorite', asyncHandler(competitorController.favorite));

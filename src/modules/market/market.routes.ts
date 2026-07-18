import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { marketController } from './market.controller.js';

export const marketRouter = Router();

marketRouter.post('/scan', asyncHandler(marketController.scan));
marketRouter.get('/opportunities', asyncHandler(marketController.list));
marketRouter.get('/opportunities/:id', asyncHandler(marketController.get));
marketRouter.patch('/opportunities/:id', asyncHandler(marketController.update));

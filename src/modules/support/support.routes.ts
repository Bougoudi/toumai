import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { supportController } from './support.controller.js';

export const supportRouter = Router();
supportRouter.get('/ai-status', asyncHandler(supportController.status));
supportRouter.get('/thread/:orderId', asyncHandler(supportController.thread));
supportRouter.delete('/thread/:orderId', asyncHandler(supportController.clearThread));
supportRouter.post('/chat', asyncHandler(supportController.chat));

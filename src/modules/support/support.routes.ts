import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { supportController } from './support.controller.js';

export const supportRouter = Router();
supportRouter.get('/ai-status', asyncHandler(supportController.status));
supportRouter.post('/chat', asyncHandler(supportController.chat));

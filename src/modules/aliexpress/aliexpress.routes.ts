import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { aliexpressController } from './aliexpress.controller.js';

export const aliexpressRouter = Router();
aliexpressRouter.get('/oauth/start', asyncHandler(aliexpressController.start));
aliexpressRouter.get('/status', asyncHandler(aliexpressController.status));

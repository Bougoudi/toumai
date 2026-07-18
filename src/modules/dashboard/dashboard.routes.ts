import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { dashboardController } from './dashboard.controller.js';

export const dashboardRouter = Router();
dashboardRouter.get('/', asyncHandler(dashboardController.overview));

export const autopilotRouter = Router();
autopilotRouter.post('/run', asyncHandler(dashboardController.runCycle));

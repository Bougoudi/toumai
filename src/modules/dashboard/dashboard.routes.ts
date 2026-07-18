import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { dashboardController } from './dashboard.controller.js';

export const dashboardRouter = Router();
dashboardRouter.get('/', asyncHandler(dashboardController.overview));

export const autopilotRouter = Router();
autopilotRouter.get('/', dashboardController.status);
autopilotRouter.post('/run', asyncHandler(dashboardController.runCycle));
autopilotRouter.post('/start', dashboardController.start);
autopilotRouter.post('/stop', dashboardController.stop);

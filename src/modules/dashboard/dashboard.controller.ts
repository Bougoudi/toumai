import type { Request, Response } from 'express';
import {
  getAutopilotState,
  runFullCycle,
  startAutopilotBackground,
  stopAutopilotBackground,
} from '../../automation/autopilot.js';
import { dashboardService } from './dashboard.service.js';

export const dashboardController = {
  /** GET /api/dashboard — vue d'ensemble de l'activité. */
  async overview(_req: Request, res: Response) {
    res.json(await dashboardService.overview());
  },

  /** GET /api/autopilot — état du pilote automatique. */
  status(_req: Request, res: Response) {
    res.json(getAutopilotState());
  },

  /** POST /api/autopilot/run — déclenche un cycle complet à la demande. */
  async runCycle(_req: Request, res: Response) {
    const report = await runFullCycle();
    res.json({ message: 'Cycle du pilote automatique exécuté', report });
  },

  /** POST /api/autopilot/start — démarre le pilote en arrière-plan. */
  start(_req: Request, res: Response) {
    res.json(startAutopilotBackground());
  },

  /** POST /api/autopilot/stop — arrête le pilote en arrière-plan. */
  stop(_req: Request, res: Response) {
    res.json(stopAutopilotBackground());
  },
};

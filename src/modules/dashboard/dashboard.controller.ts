import type { Request, Response } from 'express';
import { runFullCycle } from '../../automation/autopilot.js';
import { dashboardService } from './dashboard.service.js';

export const dashboardController = {
  /** GET /api/dashboard — vue d'ensemble de l'activité. */
  async overview(_req: Request, res: Response) {
    res.json(await dashboardService.overview());
  },

  /** POST /api/autopilot/run — déclenche un cycle complet à la demande. */
  async runCycle(_req: Request, res: Response) {
    const report = await runFullCycle();
    res.json({ message: 'Cycle du pilote automatique exécuté', report });
  },
};

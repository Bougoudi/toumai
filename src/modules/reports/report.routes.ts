import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { reportService } from './report.service.js';

export const reportRouter = Router();

reportRouter.get(
  '/pnl',
  asyncHandler(async (_req, res) => {
    res.json(await reportService.pnl());
  }),
);

reportRouter.get(
  '/pnl.csv',
  asyncHandler(async (_req, res) => {
    const csv = await reportService.csv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="toumai-pnl.csv"');
    res.send(csv);
  }),
);

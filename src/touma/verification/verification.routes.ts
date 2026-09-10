import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { authenticate, currentUser, requireRole } from '../middleware/toumaAuth.js';
import { verificationService } from './verification.service.js';

export const verificationRouter = Router();

const submitSchema = z.object({
  storeId: z.string().cuid(),
  businessType: z.enum(['INDIVIDUAL', 'COMPANY']),
  legalName: z.string().trim().min(2).max(200),
  registrationNo: z.string().trim().max(80).optional(),
  taxId: z.string().trim().max(80).optional(),
  contactPhone: z.string().trim().min(6).max(30),
  contactEmail: z.string().trim().toLowerCase().email(),
  documents: z
    .array(z.object({ kind: z.string().trim().min(2).max(60), url: z.string().trim().url().max(500) }))
    .min(1, 'Au moins un document est requis.')
    .max(10),
});

verificationRouter.use(authenticate);

verificationRouter.post(
  '/submit',
  requireRole('SELLER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = parseBody(submitSchema, req);
    res.status(201).json(await verificationService.submit(currentUser(req), input));
  }),
);

verificationRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const storeId = typeof req.query.storeId === 'string' ? req.query.storeId : undefined;
    res.json({ items: await verificationService.status(currentUser(req), storeId) });
  }),
);

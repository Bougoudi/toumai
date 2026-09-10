import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { auditRequest } from '../lib/audit.js';
import { authenticate, currentUser, requireRole } from '../middleware/toumaAuth.js';
import { storeService } from './store.service.js';

export const storeRouter = Router();

const url = z.string().trim().url().max(500);

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  countryCode: z.string().trim().toUpperCase().length(2),
  city: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  logoUrl: url.optional(),
  bannerUrl: url.optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  city: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  logoUrl: url.optional(),
  bannerUrl: url.optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED']).optional(),
});

/** Boutiques du vendeur connecté — déclaré avant `/:id` pour ne pas être capturé. */
storeRouter.get(
  '/mine',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ items: await storeService.mine(currentUser(req).id) });
  }),
);

storeRouter.get('/', asyncHandler(async (req, res) => res.json(await storeService.list(req.query as never))));

storeRouter.get('/:id', asyncHandler(async (req, res) => res.json(await storeService.get(req.params.id))));

storeRouter.post(
  '/',
  authenticate,
  requireRole('BUYER', 'SELLER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = parseBody(createSchema, req);
    const store = await storeService.create(currentUser(req), input);
    await auditRequest(req, 'store.create', 'ToumaStore', store.id, { name: store.name });
    res.status(201).json(store);
  }),
);

storeRouter.patch(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = parseBody(updateSchema, req);
    const store = await storeService.update(req.params.id, currentUser(req), { ...input });
    await auditRequest(req, 'store.update', 'ToumaStore', store.id, { fields: Object.keys(input) });
    res.json(store);
  }),
);

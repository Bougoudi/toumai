import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { auditRequest } from '../lib/audit.js';
import { authenticate, currentUser, requireRole } from '../middleware/toumaAuth.js';
import { storeService } from './store.service.js';
import { serviceZoneService } from '../logistics/service-zones.js';

export const storeRouter = Router();

const url = z.string().trim().url().max(500);

/**
 * Zones de service déclarées par un vendeur.
 *
 * Une liste vide est valide et signifie **« je ne restreins rien »** : c'est la
 * façon de revenir en arrière après avoir déclaré des zones.
 */
const serviceZonesSchema = z.object({
  zones: z
    .array(
      z.object({
        countryCode: z.string().trim().length(2),
        provinceId: z.string().cuid().optional(),
        departmentId: z.string().cuid().optional(),
        served: z.boolean().optional(),
        handlingDays: z.number().int().min(0).max(90).optional(),
        note: z.string().trim().max(300).optional(),
      }),
    )
    .max(200),
});

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

/**
 * Zones de service : où cette boutique livre.
 *
 * Lecture **publique**. Un acheteur a le droit de savoir avant de remplir son
 * panier, et pas au moment du paiement — découvrir à la dernière étape qu'une
 * boutique ne livre pas chez soi est la pire façon de l'apprendre.
 */
storeRouter.get(
  '/:id/zones-service',
  asyncHandler(async (req, res) => res.json(await serviceZoneService.list(req.params.id))),
);

/**
 * Déclaration par le vendeur. Remplacement complet, jamais des ajouts
 * successifs : retirer une province doit être aussi simple que l'ajouter.
 */
storeRouter.put(
  '/:id/zones-service',
  authenticate,
  requireRole('SELLER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = parseBody(serviceZonesSchema, req);
    const result = await serviceZoneService.replace(currentUser(req), req.params.id, input.zones);
    await auditRequest(req, 'store.serviceZones.replace', 'ToumaStore', req.params.id, { count: input.zones.length });
    res.json(result);
  }),
);

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

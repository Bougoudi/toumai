import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { auditRequest } from '../lib/audit.js';
import { authenticate, currentUser, requireRole } from '../middleware/toumaAuth.js';
import { logisticsService } from './logistics.service.js';

export const shippingRouter = Router();

const point = z.object({
  countryCode: z.string().trim().toUpperCase().length(2),
  city: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
});

const quoteSchema = z.object({
  origin: point,
  destination: point,
  weightGrams: z.number().int().min(1).max(2_000_000),
  lengthCm: z.number().int().min(1).max(500).optional(),
  widthCm: z.number().int().min(1).max(500).optional(),
  heightCm: z.number().int().min(1).max(500).optional(),
  currency: z.string().trim().toUpperCase().length(3),
  orderId: z.string().cuid().optional(),
});

const createSchema = z.object({ orderId: z.string().cuid(), quoteId: z.string().cuid().optional() });

const statusSchema = z.object({
  status: z.enum(['PENDING', 'LABEL_CREATED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED', 'CANCELLED']),
  label: z.string().trim().max(200).optional(),
  location: z.string().trim().max(120).optional(),
});

shippingRouter.get('/providers', asyncHandler(async (_req, res) => res.json({ items: logisticsService.listProviders() })));

/** Devis de transport : accessible à tout utilisateur connecté (avant achat). */
shippingRouter.post(
  '/quote',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = parseBody(quoteSchema, req);
    const quotes = await logisticsService.quote(
      {
        origin: input.origin,
        destination: input.destination,
        parcel: { weightGrams: input.weightGrams, lengthCm: input.lengthCm, widthCm: input.widthCm, heightCm: input.heightCm },
        currency: input.currency,
      },
      input.orderId,
    );
    res.json({ items: quotes });
  }),
);

shippingRouter.post(
  '/create',
  authenticate,
  requireRole('SELLER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = parseBody(createSchema, req);
    const shipment = await logisticsService.createShipment(currentUser(req), input);
    await auditRequest(req, 'shipment.create', 'ToumaShipment', shipment.id, { orderId: input.orderId });
    res.status(201).json(shipment);
  }),
);

shippingRouter.get('/:id', authenticate, asyncHandler(async (req, res) => res.json(await logisticsService.get(currentUser(req), req.params.id))));

shippingRouter.get(
  '/:id/tracking',
  authenticate,
  asyncHandler(async (req, res) => res.json(await logisticsService.tracking(currentUser(req), req.params.id))),
);

shippingRouter.patch(
  '/:id/status',
  authenticate,
  requireRole('SELLER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = parseBody(statusSchema, req);
    const shipment = await logisticsService.updateStatus(currentUser(req), req.params.id, input.status, input.label, input.location);
    await auditRequest(req, 'shipment.status', 'ToumaShipment', shipment.id, { status: input.status });
    res.json(shipment);
  }),
);

shippingRouter.post(
  '/:id/cancel',
  authenticate,
  requireRole('SELLER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const shipment = await logisticsService.cancel(currentUser(req), req.params.id);
    await auditRequest(req, 'shipment.cancel', 'ToumaShipment', shipment.id);
    res.json(shipment);
  }),
);

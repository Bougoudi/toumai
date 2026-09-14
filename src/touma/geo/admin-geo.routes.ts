import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { auditRequest } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { authenticate, requireAdmin } from '../middleware/toumaAuth.js';

/**
 * Administration de la géographie et des zones de livraison (§54).
 *
 * Deux principes tenus ici :
 *
 * **On désactive, on ne supprime pas.** Des commandes, des adresses et des
 * boutiques référencent ces objets. Supprimer une province rendrait illisible
 * l'histoire de quelqu'un qui y a acheté l'an dernier ; la désactiver la retire
 * de la saisie sans toucher au passé.
 *
 * **Aucun tarif n'est calculé par le code.** Une zone est une déclaration
 * d'exploitant — « ce transporteur dessert cette province, à ce prix, en tant de
 * jours ». Le système ne devine ni prix ni délai, et quand rien n'est déclaré,
 * il répond qu'il ne sait pas.
 */
export const adminGeoRouter = Router();

adminGeoRouter.use(authenticate, requireAdmin);

// ── Activation / désactivation ──────────────────────────────────────────────

const activeSchema = z.object({ active: z.boolean() });

adminGeoRouter.patch(
  '/provinces/:id',
  asyncHandler(async (req, res) => {
    const input = parseBody(activeSchema, req);
    const province = await prisma.toumaProvince.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
    if (!province) throw notFound('Province introuvable.');

    const updated = await prisma.toumaProvince.update({
      where: { id: req.params.id },
      data: { active: input.active },
      select: { id: true, code: true, name: true, active: true },
    });
    await auditRequest(req, 'geo.province.updated', 'ToumaProvince', province.id, { active: input.active });
    res.json(updated);
  }),
);

adminGeoRouter.patch(
  '/localities/:id',
  asyncHandler(async (req, res) => {
    const input = parseBody(activeSchema, req);
    const locality = await prisma.toumaLocality.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!locality) throw notFound('Localité introuvable.');

    const updated = await prisma.toumaLocality.update({
      where: { id: req.params.id },
      data: { active: input.active },
      select: { id: true, name: true, active: true },
    });
    await auditRequest(req, 'geo.locality.updated', 'ToumaLocality', locality.id, { active: input.active });
    res.json(updated);
  }),
);

// ── Zones de livraison ──────────────────────────────────────────────────────

const zoneSchema = z.object({
  providerCode: z.string().trim().min(1).max(40),
  countryCode: z.string().trim().length(2),
  provinceId: z.string().cuid().optional(),
  departmentId: z.string().cuid().optional(),
  localityId: z.string().cuid().optional(),
  status: z.enum(['SERVED', 'ON_REQUEST', 'UNSERVED']).default('SERVED'),
  estimatedMinDays: z.number().int().min(0).max(365),
  estimatedMaxDays: z.number().int().min(0).max(365),
  /** Montants en chaîne décimale : jamais un nombre JavaScript. */
  basePrice: z.string().regex(/^\d+(\.\d{1,4})?$/),
  pricePerKg: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  currency: z.string().trim().length(3),
  serviceName: z.string().trim().min(1).max(80).default('Standard'),
  note: z.string().trim().max(500).optional(),
  active: z.boolean().default(true),
});

adminGeoRouter.get(
  '/delivery-zones',
  asyncHandler(async (req, res) => {
    const country = typeof req.query.country === 'string' ? req.query.country.toUpperCase() : undefined;
    const items = await prisma.toumaDeliveryZone.findMany({
      where: { ...(country ? { countryCode: country } : {}) },
      orderBy: [{ countryCode: 'asc' }, { providerCode: 'asc' }],
      include: {
        province: { select: { id: true, code: true, name: true } },
        department: { select: { id: true, name: true } },
        locality: { select: { id: true, name: true } },
      },
    });
    res.json({
      items: items.map((z) => ({ ...z, basePrice: z.basePrice.toString(), pricePerKg: z.pricePerKg?.toString() ?? null })),
    });
  }),
);

adminGeoRouter.post(
  '/delivery-zones',
  asyncHandler(async (req, res) => {
    const input = parseBody(zoneSchema, req);
    if (input.estimatedMaxDays < input.estimatedMinDays) {
      throw badRequest('Le délai maximal ne peut pas être inférieur au délai minimal.');
    }

    const zone = await prisma.toumaDeliveryZone.create({
      data: {
        providerCode: input.providerCode,
        countryCode: input.countryCode.toUpperCase(),
        provinceId: input.provinceId ?? null,
        departmentId: input.departmentId ?? null,
        localityId: input.localityId ?? null,
        status: input.status,
        estimatedMinDays: input.estimatedMinDays,
        estimatedMaxDays: input.estimatedMaxDays,
        basePrice: new Prisma.Decimal(input.basePrice),
        pricePerKg: input.pricePerKg ? new Prisma.Decimal(input.pricePerKg) : null,
        currency: input.currency.toUpperCase(),
        serviceName: input.serviceName,
        note: input.note ?? null,
        active: input.active,
      },
    });
    await auditRequest(req, 'geo.zone.created', 'ToumaDeliveryZone', zone.id, {
      provider: zone.providerCode,
      country: zone.countryCode,
    });
    res.status(201).json({ ...zone, basePrice: zone.basePrice.toString(), pricePerKg: zone.pricePerKg?.toString() ?? null });
  }),
);

adminGeoRouter.patch(
  '/delivery-zones/:id',
  asyncHandler(async (req, res) => {
    const input = parseBody(zoneSchema.partial(), req);
    const zone = await prisma.toumaDeliveryZone.findUnique({ where: { id: req.params.id } });
    if (!zone) throw notFound('Zone introuvable.');

    const min = input.estimatedMinDays ?? zone.estimatedMinDays;
    const max = input.estimatedMaxDays ?? zone.estimatedMaxDays;
    if (max < min) throw badRequest('Le délai maximal ne peut pas être inférieur au délai minimal.');

    const updated = await prisma.toumaDeliveryZone.update({
      where: { id: zone.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.estimatedMinDays !== undefined ? { estimatedMinDays: input.estimatedMinDays } : {}),
        ...(input.estimatedMaxDays !== undefined ? { estimatedMaxDays: input.estimatedMaxDays } : {}),
        ...(input.basePrice ? { basePrice: new Prisma.Decimal(input.basePrice) } : {}),
        ...(input.pricePerKg ? { pricePerKg: new Prisma.Decimal(input.pricePerKg) } : {}),
        ...(input.serviceName ? { serviceName: input.serviceName } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    await auditRequest(req, 'geo.zone.updated', 'ToumaDeliveryZone', zone.id, {});
    res.json({ ...updated, basePrice: updated.basePrice.toString(), pricePerKg: updated.pricePerKg?.toString() ?? null });
  }),
);

adminGeoRouter.delete(
  '/delivery-zones/:id',
  asyncHandler(async (req, res) => {
    const zone = await prisma.toumaDeliveryZone.findUnique({ where: { id: req.params.id } });
    if (!zone) throw notFound('Zone introuvable.');

    // Une zone qui a servi à calculer un tarif ne se supprime pas : le devis
    // figé dans une commande cesserait d'être explicable. On la désactive.
    if (zone.active) {
      throw conflict('Désactivez la zone (active: false) plutôt que de la supprimer : des commandes s’appuient sur ses tarifs.');
    }
    await prisma.toumaDeliveryZone.delete({ where: { id: zone.id } });
    await auditRequest(req, 'geo.zone.deleted', 'ToumaDeliveryZone', zone.id, {});
    res.status(204).end();
  }),
);

// ── Points relais ───────────────────────────────────────────────────────────

const pickupSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(120),
  countryCode: z.string().trim().length(2),
  provinceId: z.string().cuid().optional(),
  departmentId: z.string().cuid().optional(),
  localityId: z.string().cuid().optional(),
  city: z.string().trim().min(1).max(120),
  district: z.string().trim().max(120).optional(),
  landmark: z.string().trim().max(200).optional(),
  addressLine: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(30).optional(),
  openingHours: z.string().trim().max(120).optional(),
  active: z.boolean().default(true),
});

adminGeoRouter.post(
  '/pickup-points',
  asyncHandler(async (req, res) => {
    const input = parseBody(pickupSchema, req);
    const existant = await prisma.toumaPickupPoint.findUnique({ where: { code: input.code } });
    if (existant) throw conflict('Un point relais porte déjà ce code.');

    const point = await prisma.toumaPickupPoint.create({
      data: { ...input, countryCode: input.countryCode.toUpperCase() },
    });
    await auditRequest(req, 'geo.pickup.created', 'ToumaPickupPoint', point.id, { code: point.code });
    res.status(201).json(point);
  }),
);

adminGeoRouter.patch(
  '/pickup-points/:id',
  asyncHandler(async (req, res) => {
    const input = parseBody(pickupSchema.partial(), req);
    const point = await prisma.toumaPickupPoint.findUnique({ where: { id: req.params.id } });
    if (!point) throw notFound('Point relais introuvable.');

    const updated = await prisma.toumaPickupPoint.update({
      where: { id: point.id },
      data: { ...input, ...(input.countryCode ? { countryCode: input.countryCode.toUpperCase() } : {}) },
    });
    await auditRequest(req, 'geo.pickup.updated', 'ToumaPickupPoint', point.id, {});
    res.json(updated);
  }),
);

import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { asyncHandler } from '../../middleware/validate.js';

/**
 * Points relais : là où la livraison à domicile est peu fiable, le retrait en
 * point relais est souvent le mode le plus sûr. La liste est publique
 * (l'acheteur doit pouvoir choisir avant de créer un compte).
 */
export const pickupPointRouter = Router();

pickupPointRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const country = typeof req.query.country === 'string' ? req.query.country.toUpperCase() : undefined;
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const items = await prisma.toumaPickupPoint.findMany({
      where: {
        active: true,
        ...(country ? { countryCode: country } : {}),
        ...(city ? { city: { contains: city, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ countryCode: 'asc' }, { city: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        countryCode: true,
        city: true,
        district: true,
        landmark: true,
        addressLine: true,
        phone: true,
        openingHours: true,
      },
    });
    res.json({ items });
  }),
);

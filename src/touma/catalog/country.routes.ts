import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { asyncHandler } from '../../middleware/validate.js';

/**
 * Pays desservis. Le corridor pilote (Tchad ↔ Cameroun) n'est qu'un jeu de
 * données : ouvrir un marché = insérer une ligne, sans toucher au code.
 */
export const countryRouter = Router();

countryRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const all = req.query.all === 'true';
    const items = await prisma.country.findMany({
      where: all ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
    res.json({ items });
  }),
);

countryRouter.get(
  '/:code',
  asyncHandler(async (req, res) => {
    const country = await prisma.country.findUnique({ where: { code: req.params.code.toUpperCase() } });
    if (!country) return res.status(404).json({ error: 'Pays introuvable.' });
    res.json(country);
  }),
);

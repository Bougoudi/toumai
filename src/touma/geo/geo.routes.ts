import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { geoService } from './geo.service.js';

/**
 * Géographie administrative, en lecture publique.
 *
 * Non authentifié à dessein : un acheteur choisit sa province avant d'avoir un
 * compte, et un moteur de recherche doit pouvoir lire les pages de province.
 * Rien ici n'est personnel — ce sont des noms de lieux.
 */
export const geoRouter = Router();

const str = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined);

geoRouter.get(
  '/provinces',
  asyncHandler(async (req, res) => {
    res.json(await geoService.provinces(str(req.query.country) ?? 'TD'));
  }),
);

geoRouter.get(
  '/provinces/:id/departments',
  asyncHandler(async (req, res) => res.json(await geoService.departments(req.params.id))),
);

geoRouter.get(
  '/provinces/:id/localities',
  asyncHandler(async (req, res) =>
    res.json(
      await geoService.localities(req.params.id, {
        q: str(req.query.q),
        departmentId: str(req.query.department),
        limit: Number(req.query.limit) || undefined,
      }),
    ),
  ),
);

geoRouter.get(
  '/localities',
  asyncHandler(async (req, res) =>
    res.json(await geoService.searchLocalities(str(req.query.country) ?? 'TD', str(req.query.q) ?? '', Number(req.query.limit) || undefined)),
  ),
);

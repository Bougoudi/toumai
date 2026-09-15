import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { authenticate, requireAdmin } from '../middleware/toumaAuth.js';
import { auditRequest } from '../lib/audit.js';
import { slugify } from '../lib/slug.js';
import { notFound } from '../lib/errors.js';

export const categoryRouter = Router();

const categorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  parentId: z.string().cuid().optional(),
  segment: z.enum(['B2B', 'B2C', 'BOTH']).default('BOTH'),
  position: z.number().int().min(0).default(0),
});

/** Arborescence publique des catégories (avec le nombre de produits actifs). */
categoryRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const items = await prisma.toumaCategory.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: { where: { status: 'ACTIVE' } } } } },
    });
    res.json({
      items: items.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        parentId: c.parentId,
        segment: c.segment,
        productCount: c._count.products,
      })),
    });
  }),
);

categoryRouter.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const category = await prisma.toumaCategory.findUnique({
      where: { slug: req.params.slug },
      include: { children: { where: { active: true }, orderBy: { position: 'asc' } } },
    });
    if (!category) throw notFound('Catégorie introuvable.');
    res.json(category);
  }),
);

/** Création réservée à l'administration. */
categoryRouter.post(
  '/',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = parseBody(categorySchema, req);
    const category = await prisma.toumaCategory.create({ data: { ...input, slug: slugify(input.name) } });
    await auditRequest(req, 'category.create', 'ToumaCategory', category.id, { name: category.name });
    res.status(201).json(category);
  }),
);

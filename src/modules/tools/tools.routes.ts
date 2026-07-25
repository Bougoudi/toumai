import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '../../middleware/validate.js';
import { generateTitles } from '../../utils/titles.js';

const titlesSchema = z.object({
  name: z.string().min(1, 'Nom du produit requis'),
  keywords: z.string().optional(),
  category: z.string().optional(),
});

export const toolsRouter = Router();

/** POST /api/tools/titles — génère des titres optimisés pour annonce. */
toolsRouter.post('/titles', (req, res) => {
  const input = parseBody(titlesSchema, req);
  res.json({ titles: generateTitles(input) });
});

import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { asyncHandler } from '../../middleware/validate.js';
import { notFound } from '../lib/errors.js';
import { authenticate, currentUser } from '../middleware/toumaAuth.js';

export const notificationRouter = Router();

notificationRouter.use(authenticate);

notificationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const [items, unread] = await Promise.all([
      prisma.toumaNotification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.toumaNotification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    res.json({ items, unread });
  }),
);

notificationRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const updated = await prisma.toumaNotification.updateMany({ where: { id: req.params.id, userId: user.id }, data: { readAt: new Date() } });
    if (updated.count === 0) throw notFound('Notification introuvable.');
    res.json({ read: true });
  }),
);

notificationRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const result = await prisma.toumaNotification.updateMany({ where: { userId: currentUser(req).id, readAt: null }, data: { readAt: new Date() } });
    res.json({ read: result.count });
  }),
);

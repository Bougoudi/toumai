import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { authenticate, currentUser } from '../middleware/toumaAuth.js';
import { messagingService } from './messaging.service.js';

export const conversationRouter = Router();

const openSchema = z.object({
  storeId: z.string().cuid(),
  orderId: z.string().cuid().optional(),
  subject: z.string().trim().max(200).optional(),
});

const messageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  attachments: z
    .array(
      z.object({
        url: z.string().trim().url().max(500),
        name: z.string().trim().min(1).max(200),
        mimeType: z.string().trim().max(100),
        sizeBytes: z.number().int().min(0).max(50 * 1024 * 1024),
      }),
    )
    .max(5)
    .default([]),
});

conversationRouter.use(authenticate);

conversationRouter.get('/', asyncHandler(async (req, res) => res.json({ items: await messagingService.list(currentUser(req)) })));

conversationRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => res.json({ count: await messagingService.unreadCount(currentUser(req).id) })),
);

conversationRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parseBody(openSchema, req);
    const result = await messagingService.openWithStore(currentUser(req), input);
    res.status(result.created ? 201 : 200).json(result);
  }),
);

conversationRouter.get('/:id', asyncHandler(async (req, res) => res.json(await messagingService.get(currentUser(req), req.params.id))));

conversationRouter.post(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const input = parseBody(messageSchema, req);
    res.status(201).json(await messagingService.sendMessage(currentUser(req), req.params.id, input.body, input.attachments));
  }),
);

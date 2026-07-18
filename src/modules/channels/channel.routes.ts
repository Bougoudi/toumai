import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { channelController } from './channel.controller.js';

export const channelRouter = Router();

channelRouter.get('/types', channelController.types);
channelRouter.get('/', asyncHandler(channelController.list));
channelRouter.post('/', asyncHandler(channelController.connect));
channelRouter.get('/:id', asyncHandler(channelController.get));
channelRouter.patch('/:id', asyncHandler(channelController.update));
channelRouter.delete('/:id', asyncHandler(channelController.remove));
channelRouter.post('/:id/test', asyncHandler(channelController.test));
channelRouter.post('/:id/sync', asyncHandler(channelController.sync));
channelRouter.post('/:id/publish/:productId', asyncHandler(channelController.publish));

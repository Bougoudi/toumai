import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { searchController } from './search.controller.js';

export const searchRouter = Router();

searchRouter.post('/', asyncHandler(searchController.search));
searchRouter.get('/', asyncHandler(searchController.list));
searchRouter.get('/:id', asyncHandler(searchController.get));

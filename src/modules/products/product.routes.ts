import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { productController } from './product.controller.js';

export const productRouter = Router();

productRouter.get('/', asyncHandler(productController.list));
productRouter.post('/', asyncHandler(productController.create));
productRouter.get('/:id', asyncHandler(productController.get));
productRouter.patch('/:id', asyncHandler(productController.update));
productRouter.delete('/:id', asyncHandler(productController.remove));

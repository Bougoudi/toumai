import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { productController } from './product.controller.js';

export const productRouter = Router();

// Génération en masse (pilier 2)
productRouter.post('/generate', asyncHandler(productController.generate));
productRouter.get('/generation-runs', asyncHandler(productController.listRuns));
productRouter.get('/generation-runs/:id', asyncHandler(productController.getRun));

// CRUD produits
productRouter.get('/', asyncHandler(productController.list));
productRouter.post('/', asyncHandler(productController.create));
productRouter.get('/:id', asyncHandler(productController.get));
productRouter.patch('/:id', asyncHandler(productController.update));
productRouter.delete('/:id', asyncHandler(productController.remove));

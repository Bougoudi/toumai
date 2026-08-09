import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { supplierController } from './supplier.controller.js';

export const supplierRouter = Router();

supplierRouter.get('/', asyncHandler(supplierController.list));
supplierRouter.post('/refresh', asyncHandler(supplierController.refresh));
supplierRouter.post('/', asyncHandler(supplierController.create));
supplierRouter.get('/:id', asyncHandler(supplierController.get));
supplierRouter.patch('/:id', asyncHandler(supplierController.update));
supplierRouter.delete('/:id', asyncHandler(supplierController.remove));
supplierRouter.post('/:id/offers', asyncHandler(supplierController.addOffer));

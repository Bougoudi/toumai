import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { orderController } from './order.controller.js';

export const orderRouter = Router();

// Clients
orderRouter.post('/customers', asyncHandler(orderController.createCustomer));
orderRouter.get('/customers', asyncHandler(orderController.listCustomers));

// Commandes
orderRouter.post('/', asyncHandler(orderController.create));
orderRouter.get('/', asyncHandler(orderController.list));
orderRouter.get('/:id', asyncHandler(orderController.get));
orderRouter.post('/:id/cancel', asyncHandler(orderController.cancel));
orderRouter.post('/:id/fulfill', asyncHandler(orderController.fulfill));

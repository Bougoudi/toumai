import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { orderController } from './order.controller.js';

export const orderRouter = Router();

// Clients
orderRouter.post('/customers', asyncHandler(orderController.createCustomer));
orderRouter.get('/customers', asyncHandler(orderController.listCustomers));
orderRouter.delete('/customers/:id', asyncHandler(orderController.removeCustomer));

// Commandes
orderRouter.post('/', asyncHandler(orderController.create));
orderRouter.get('/', asyncHandler(orderController.list));
orderRouter.get('/:id', asyncHandler(orderController.get));
orderRouter.post('/:id/cancel', asyncHandler(orderController.cancel));
orderRouter.post('/:id/fulfill', asyncHandler(orderController.fulfill));
// Adresse de livraison : modifiable tant que la commande n'est pas expédiée.
orderRouter.patch('/:id/shipping', asyncHandler(orderController.updateShipping));
orderRouter.post('/:id/hold', asyncHandler(orderController.hold));
orderRouter.post('/:id/confirm', asyncHandler(orderController.confirm));

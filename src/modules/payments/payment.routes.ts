import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { paymentController } from './payment.controller.js';

export const paymentRouter = Router();
paymentRouter.get('/status', paymentController.status);
paymentRouter.post('/checkout/:orderId', asyncHandler(paymentController.checkout));

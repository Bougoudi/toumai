import type { Request, Response } from 'express';
import { parseBody } from '../../middleware/validate.js';
import { loginSchema, registerSchema } from './auth.schema.js';
import { authService } from './auth.service.js';

export const authController = {
  async register(req: Request, res: Response) {
    const input = parseBody(registerSchema, req);
    const result = await authService.register(input);
    res.status(201).json(result);
  },

  async login(req: Request, res: Response) {
    const input = parseBody(loginSchema, req);
    const result = await authService.login(input);
    res.json(result);
  },

  async me(req: Request, res: Response) {
    res.json(await authService.me(req.user!.sub));
  },
};

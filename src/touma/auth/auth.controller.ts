import type { Request, Response } from 'express';
import { prisma } from '../../db/prisma.js';
import { parseBody } from '../../middleware/validate.js';
import { badRequest, notFound } from '../lib/errors.js';
import { currentUser } from '../middleware/toumaAuth.js';
import { authService } from './auth.service.js';
import { addressSchema, loginSchema, logoutSchema, refreshSchema, registerSchema, updateProfileSchema } from './auth.schema.js';

function ctx(req: Request) {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

export const authController = {
  async register(req: Request, res: Response) {
    const input = parseBody(registerSchema, req);
    const result = await authService.register(input, ctx(req));
    res.status(201).json(result);
  },

  async login(req: Request, res: Response) {
    const input = parseBody(loginSchema, req);
    res.json(await authService.login(input, ctx(req)));
  },

  async refresh(req: Request, res: Response) {
    const { refreshToken } = parseBody(refreshSchema, req);
    res.json(await authService.refresh(refreshToken, ctx(req)));
  },

  async logout(req: Request, res: Response) {
    const input = parseBody(logoutSchema, req);
    res.json(await authService.logout(currentUser(req).id, input, ctx(req)));
  },

  async me(req: Request, res: Response) {
    res.json(await authService.me(currentUser(req).id));
  },

  async updateMe(req: Request, res: Response) {
    const input = parseBody(updateProfileSchema, req);
    res.json(await authService.updateProfile(currentUser(req).id, input));
  },

  // ── Carnet d'adresses ────────────────────────────────────────────────────
  async listAddresses(req: Request, res: Response) {
    const items = await prisma.toumaAddress.findMany({
      where: { userId: currentUser(req).id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({ items });
  },

  async createAddress(req: Request, res: Response) {
    const user = currentUser(req);
    const input = parseBody(addressSchema, req);
    const country = await prisma.country.findUnique({ where: { code: input.countryCode } });
    if (!country || !country.active) throw badRequest(`Pays « ${input.countryCode} » non desservi.`);
    const address = await prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.toumaAddress.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
      }
      const count = await tx.toumaAddress.count({ where: { userId: user.id } });
      return tx.toumaAddress.create({ data: { ...input, userId: user.id, isDefault: input.isDefault || count === 0 } });
    });
    res.status(201).json(address);
  },

  async deleteAddress(req: Request, res: Response) {
    const user = currentUser(req);
    // Le filtre par userId protège contre l'IDOR : on ne supprime jamais l'adresse d'autrui.
    const deleted = await prisma.toumaAddress.deleteMany({ where: { id: req.params.id, userId: user.id } });
    if (deleted.count === 0) throw notFound('Adresse introuvable.');
    res.json({ deleted: true });
  },
};

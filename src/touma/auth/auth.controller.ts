import type { Request, Response } from 'express';
import { prisma } from '../../db/prisma.js';
import { parseBody } from '../../middleware/validate.js';
import { badRequest, notFound } from '../lib/errors.js';
import { normalizePhone, tryNormalizePhone } from '../lib/phone.js';
import { currentUser } from '../middleware/toumaAuth.js';
import { authService } from './auth.service.js';
import { addressSchema, deletionRequestSchema, loginSchema, logoutSchema, refreshSchema, registerSchema, updateProfileSchema } from './auth.schema.js';
import { privacyService } from './privacy.service.js';

function ctx(req: Request) {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

/**
 * Vérifie le rattachement géographique d'une adresse.
 *
 * Chaque niveau fourni doit exister **et** être cohérent avec celui du dessus :
 * une localité du Ouaddaï déclarée dans une adresse de N'Djamena est une erreur,
 * pas une préférence. Un identifiant inconnu est refusé plutôt que stocké tel
 * quel — sinon on n'aurait fait que déguiser du texte libre en clé étrangère.
 */
async function resolveAddressGeography(
  input: { provinceId?: string; departmentId?: string; subPrefectureId?: string; localityId?: string },
  countryCode: string,
) {
  const geo: { provinceId: string | null; departmentId: string | null; subPrefectureId: string | null; localityId: string | null } = {
    provinceId: null,
    departmentId: null,
    subPrefectureId: null,
    localityId: null,
  };

  if (input.provinceId) {
    const province = await prisma.toumaProvince.findUnique({ where: { id: input.provinceId }, select: { id: true, countryCode: true, active: true } });
    if (!province || province.countryCode !== countryCode) throw badRequest('Province inconnue pour ce pays.');
    if (!province.active) throw badRequest('Cette province n’est pas desservie pour l’instant.');
    geo.provinceId = province.id;
  }

  if (input.departmentId) {
    const department = await prisma.toumaDepartment.findUnique({ where: { id: input.departmentId }, select: { id: true, provinceId: true } });
    if (!department) throw badRequest('Département inconnu.');
    if (geo.provinceId && department.provinceId !== geo.provinceId) throw badRequest('Ce département n’appartient pas à la province indiquée.');
    geo.departmentId = department.id;
    geo.provinceId = geo.provinceId ?? department.provinceId;
  }

  if (input.localityId) {
    const locality = await prisma.toumaLocality.findUnique({
      where: { id: input.localityId },
      select: { id: true, provinceId: true, departmentId: true, active: true },
    });
    if (!locality) throw badRequest('Localité inconnue.');
    if (!locality.active) throw badRequest('Cette localité n’est pas desservie pour l’instant.');
    if (geo.provinceId && locality.provinceId !== geo.provinceId) throw badRequest('Cette localité n’appartient pas à la province indiquée.');
    geo.localityId = locality.id;
    // La localité renseigne la province quand l'appelant ne l'a pas donnée :
    // beaucoup de gens connaissent leur ville, pas leur découpage administratif.
    geo.provinceId = geo.provinceId ?? locality.provinceId;
    geo.departmentId = geo.departmentId ?? locality.departmentId;
  }

  if (input.subPrefectureId) {
    const sp = await prisma.toumaSubPrefecture.findUnique({ where: { id: input.subPrefectureId }, select: { id: true, departmentId: true } });
    if (!sp) throw badRequest('Sous-préfecture inconnue.');
    if (geo.departmentId && sp.departmentId !== geo.departmentId) throw badRequest('Cette sous-préfecture n’appartient pas au département indiqué.');
    geo.subPrefectureId = sp.id;
  }

  return geo;
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

  /**
   * Sessions actives.
   *
   * Le jeton de rafraîchissement peut être joint pour que la session courante
   * soit signalée comme telle — utile pour ne pas se déconnecter soi-même par
   * mégarde. Il reste facultatif : la liste est lisible sans lui.
   */
  async listSessions(req: Request, res: Response) {
    const courant = typeof req.query.refreshToken === 'string' ? req.query.refreshToken : undefined;
    res.json(await authService.listSessions(currentUser(req).id, courant));
  },

  /** Export des données personnelles (V25 §67). */
  async exportData(req: Request, res: Response) {
    res.json(await privacyService.export(currentUser(req).id));
  },

  /** Demande de suppression de compte (V25 §68). */
  async requestDeletion(req: Request, res: Response) {
    const input = parseBody(deletionRequestSchema, req);
    res.status(202).json(await privacyService.requestDeletion(currentUser(req).id, input, ctx(req)));
  },

  async cancelDeletion(req: Request, res: Response) {
    res.json(await privacyService.cancelDeletion(currentUser(req).id));
  },

  async deletionStatus(req: Request, res: Response) {
    const demande = await privacyService.pendingDeletion(currentUser(req).id);
    res.json(demande ?? { pending: false });
  },

  async revokeSession(req: Request, res: Response) {
    res.json(await authService.revokeSession(currentUser(req).id, req.params.id, ctx(req)));
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

    // Géographie : vérifiée, jamais recopiée telle quelle. Accepter un
    // identifiant de province sans le contrôler reviendrait à remplacer un champ
    // de texte libre par un champ de texte libre déguisé en clé étrangère.
    const geo = await resolveAddressGeography(input, country.code);

    // Téléphones en E.164, avec l'indicatif du pays de l'adresse. Sans cela,
    // « 66 12 34 56 » et « +235 66123456 » restent deux numéros différents pour
    // la base, et le livreur ne joint personne.
    const dialCode = country.dialCode.replace(/^\+/, '') || undefined;
    const phone = normalizePhone(input.phone, dialCode).e164;
    const alternativePhone = tryNormalizePhone(input.alternativePhone, dialCode);

    const address = await prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.toumaAddress.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
      }
      const count = await tx.toumaAddress.count({ where: { userId: user.id } });
      return tx.toumaAddress.create({
        data: { ...input, ...geo, phone, alternativePhone, userId: user.id, isDefault: input.isDefault || count === 0 },
      });
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

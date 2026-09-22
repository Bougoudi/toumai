import { Router } from 'express';
import { z } from 'zod';
import type { CountryStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { notFound } from '../lib/errors.js';
import { requirePermission } from '../admin/permissions.js';
import { authenticate, currentUser, requireAdmin } from '../middleware/toumaAuth.js';
import { changerStatut, historiqueStatuts, marches, preparation } from './country.service.js';

/**
 * API DES MARCHÉS (V26 §75).
 *
 * **La lecture est publique**, et ce n'est pas un détail : quelqu'un au
 * Cameroun doit pouvoir apprendre que TOUMA n'y livre pas encore sans créer de
 * compte pour le découvrir au moment de payer. Ce que l'API publique expose est
 * donc l'état du marché et rien d'autre — jamais la configuration des
 * prestataires, jamais le détail des contrôles internes.
 *
 * L'écriture est fermée derrière `ADMIN_COUNTRIES` : ouvrir un marché est une
 * décision commerciale, pas une tâche d'exploitation.
 */

// ── Public : /api/v1/countries, /api/v1/markets ──────────────────────────────

export const countriesRouter = Router();

/**
 * Marchés.
 *
 * Par défaut, **seuls ceux où l'on peut réellement acheter ou vendre**. Ce
 * point n'est pas cosmétique : cette liste remplit le menu déroulant de
 * l'inscription. L'ancienne version rendait tout pays dont la colonne `active`
 * valait vrai — quelqu'un pouvait donc choisir un marché où rien n'est
 * configuré, et ne le découvrir qu'au paiement.
 *
 * `?all=true` rend le référentiel complet : l'administration en a besoin, et
 * une fiche d'adresse aussi — connaître l'indicatif du Nigeria n'engage pas à
 * y vendre.
 */
countriesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const tous = req.query.all === 'true';
    const items = await marches();
    res.json({
      items: tous ? items : items.filter((m) => m.buyingEnabled || m.sellingEnabled),
      note: 'Un marché n’accepte de transactions que s’il est en PILOT, ACTIVE ou LIMITED. Le statut déclaré ne suffit pas.',
    });
  }),
);

countriesRouter.get(
  '/:code',
  asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();
    const pays = await prisma.country.findUnique({
      where: { code },
      include: { divisionLevels: { where: { used: true }, orderBy: { level: 'asc' } }, tradeConfig: true },
    });
    if (!pays) throw notFound(`Pays « ${code} » inconnu.`);

    res.json({
      code: pays.code,
      name: pays.name,
      nativeName: pays.nativeName,
      currency: pays.currency,
      dialCode: pays.dialCode,
      timezone: pays.timezone,
      status: pays.status,
      buyingEnabled: pays.buyingEnabled,
      sellingEnabled: pays.sellingEnabled,
      languages: pays.tradeConfig?.languages ?? [],
      /** Comment ce pays nomme ses niveaux administratifs (§7). */
      divisionLevels: pays.divisionLevels.map((n) => ({ level: n.level, name: n.name, namePlural: n.namePlural, nameAr: n.nameAr })),
    });
  }),
);

/**
 * Préparation d'un marché, en lecture publique.
 *
 * Seul le verdict et les domaines sortent : dire « expédition : bloqué » est
 * une information loyale pour un vendeur qui se demande s'il peut ouvrir une
 * boutique. Dire *quel* prestataire manque et comment il est configuré ne le
 * regarde pas.
 */
countriesRouter.get(
  '/:code/readiness',
  asyncHandler(async (req, res) => {
    const p = await preparation(req.params.code);
    res.json({
      countryCode: p.countryCode,
      status: p.statutActuel,
      verdict: p.verdict,
      blocked: p.controles.filter((c) => c.etat === 'BLOCKED').map((c) => c.domaine),
      notMeasured: p.nonMesures,
      checkedAt: p.verifieLe,
    });
  }),
);

export const marketsRouter = Router();

marketsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const items = await marches();
    res.json({ items: items.filter((m) => m.buyingEnabled || m.sellingEnabled) });
  }),
);

marketsRouter.get(
  '/:country',
  asyncHandler(async (req, res) => {
    const code = req.params.country.toUpperCase();
    const item = (await marches()).find((m) => m.code === code);
    if (!item) throw notFound(`Marché « ${code} » inconnu.`);
    res.json(item);
  }),
);

// ── Administration : /api/v1/admin/countries ─────────────────────────────────

export const adminCountriesRouter = Router();
adminCountriesRouter.use(authenticate, requireAdmin);

const STATUTS = ['PLANNED', 'CONFIGURING', 'TESTING', 'PILOT', 'ACTIVE', 'LIMITED', 'SUSPENDED', 'DEPRECATED'] as const;

const corpsStatut = z.object({
  status: z.enum(STATUTS),
  /** Un changement non motivé est un changement qu'on ne saura pas relire. */
  reason: z.string().trim().min(10).max(1000),
});

const corpsConfiguration = z.object({
  nativeName: z.string().trim().min(1).max(120).optional(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  dialCode: z.string().trim().regex(/^\+\d{1,4}$/).optional(),
  timezone: z.string().trim().min(3).max(64).optional(),
  buyingEnabled: z.boolean().optional(),
  sellingEnabled: z.boolean().optional(),
});

adminCountriesRouter.get(
  '/',
  requirePermission('ADMIN_COUNTRIES'),
  asyncHandler(async (_req, res) => {
    const pays = await prisma.country.findMany({ orderBy: { code: 'asc' }, include: { tradeConfig: true } });
    res.json({
      items: pays.map((p) => ({
        code: p.code,
        name: p.name,
        status: p.status,
        currency: p.currency,
        timezone: p.timezone,
        buyingEnabled: p.buyingEnabled,
        sellingEnabled: p.sellingEnabled,
        tradeEnabled: p.tradeConfig?.tradeEnabled ?? false,
      })),
    });
  }),
);

adminCountriesRouter.get(
  '/:code',
  requirePermission('ADMIN_COUNTRIES'),
  asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();
    const pays = await prisma.country.findUnique({
      where: { code },
      include: { divisionLevels: { orderBy: { level: 'asc' } }, tradeConfig: true },
    });
    if (!pays) throw notFound(`Pays « ${code} » inconnu.`);
    res.json({ country: pays, history: await historiqueStatuts(code) });
  }),
);

adminCountriesRouter.patch(
  '/:code',
  requirePermission('ADMIN_COUNTRIES'),
  asyncHandler(async (req, res) => {
    const code = req.params.code.toUpperCase();
    const entree = parseBody(corpsConfiguration, req);
    const existant = await prisma.country.findUnique({ where: { code } });
    if (!existant) throw notFound(`Pays « ${code} » inconnu.`);
    res.json(await prisma.country.update({ where: { code }, data: entree }));
  }),
);

/** Contrôle complet, réservé à l'administration : il nomme les prestataires. */
adminCountriesRouter.post(
  '/:code/readiness',
  requirePermission('ADMIN_COUNTRIES'),
  asyncHandler(async (req, res) => res.json(await preparation(req.params.code))),
);

adminCountriesRouter.post(
  '/:code/status',
  requirePermission('ADMIN_COUNTRIES'),
  asyncHandler(async (req, res) => {
    const entree = parseBody(corpsStatut, req);
    const resultat = await changerStatut({
      countryCode: req.params.code,
      vers: entree.status as CountryStatus,
      reason: entree.reason,
      changedById: currentUser(req)?.id ?? null,
    });
    res.json({ country: resultat.country, readiness: resultat.readiness });
  }),
);

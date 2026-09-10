import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseBody, parseQuery } from '../../middleware/validate.js';
import { authenticate, currentUser, optionalAuth, requireRole } from '../middleware/toumaAuth.js';
import { b2bService } from './b2b.service.js';
import { businessProfileSchema, createQuoteSchema, createRfqSchema, listRfqsSchema, negotiationSchema } from './b2b.schema.js';

/**
 * TOUMA Business : profil entreprise, appels d'offres, offres fournisseurs et
 * négociation. Les appels d'offres ouverts sont consultables sans compte (un
 * fournisseur doit pouvoir mesurer l'intérêt avant de s'inscrire) ; toute
 * action nécessite une authentification.
 */
export const businessRouter = Router();
export const rfqRouter = Router();
export const quoteRouter = Router();

// ── Profil entreprise ────────────────────────────────────────────────────────
businessRouter.get(
  '/profile',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await b2bService.getProfile(currentUser(req).id));
  }),
);

businessRouter.put(
  '/profile',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = parseBody(businessProfileSchema, req);
    res.json(await b2bService.saveProfile(currentUser(req), input));
  }),
);

// ── Appels d'offres ──────────────────────────────────────────────────────────
rfqRouter.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const query = parseQuery(listRfqsSchema, req);
    if (query.scope === 'mine' && !req.toumaUser) return res.status(401).json({ error: 'Authentification requise.' });
    res.json(await b2bService.listRfqs(req.toumaUser, query));
  }),
);

rfqRouter.post(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = parseBody(createRfqSchema, req);
    res.status(201).json(await b2bService.createRfq(currentUser(req), input));
  }),
);

rfqRouter.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    res.json(await b2bService.getRfq(req.toumaUser, req.params.id));
  }),
);

rfqRouter.post(
  '/:id/close',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await b2bService.closeRfq(currentUser(req), req.params.id));
  }),
);

/** Un fournisseur répond à un appel d'offres. */
rfqRouter.post(
  '/:id/quotes',
  authenticate,
  requireRole('SELLER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = parseBody(createQuoteSchema, req);
    res.status(201).json(await b2bService.createQuote(currentUser(req), req.params.id, input));
  }),
);

// ── Offres ───────────────────────────────────────────────────────────────────
quoteRouter.use(authenticate);

/** Offres émises par le vendeur connecté. */
quoteRouter.get(
  '/mine',
  asyncHandler(async (req, res) => {
    res.json({ items: await b2bService.listMyQuotes(currentUser(req)) });
  }),
);

quoteRouter.post(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const input = parseBody(negotiationSchema, req);
    res.status(201).json(await b2bService.negotiate(currentUser(req), req.params.id, input));
  }),
);

quoteRouter.post(
  '/:id/accept',
  asyncHandler(async (req, res) => {
    const { addressId } = parseBody(z.object({ addressId: z.string().cuid() }), req);
    res.json(await b2bService.acceptQuote(currentUser(req), req.params.id, addressId));
  }),
);

quoteRouter.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(z.object({ reason: z.string().trim().max(500).optional() }), req);
    res.json(await b2bService.rejectQuote(currentUser(req), req.params.id, reason));
  }),
);

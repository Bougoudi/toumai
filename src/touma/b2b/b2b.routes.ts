import { Router } from 'express';
import { comparer } from './comparison.service.js';
import { z } from 'zod';
import { asyncHandler, parseBody, parseQuery } from '../../middleware/validate.js';
import { authenticate, currentUser, optionalAuth, requireRole } from '../middleware/toumaAuth.js';
import { b2bService } from './b2b.service.js';
import { negotiationService } from './negotiation.js';
import { applyProposalSchema, counterOfferSchema, rejectSchema } from '../messaging/messaging.schema.js';
import { businessProfileSchema, createQuoteSchema, createRfqSchema, inviteSuppliersSchema, listRfqsSchema, negotiationSchema } from './b2b.schema.js';

/**
 * TOUMA Business : profil entreprise, appels d'offres, offres fournisseurs et
 * négociation. Les appels d'offres ouverts sont consultables sans compte (un
 * fournisseur doit pouvoir mesurer l'intérêt avant de s'inscrire) ; toute
 * action nécessite une authentification.
 */
export const businessRouter = Router();
export const rfqRouter = Router();
export const quoteRouter = Router();
/**
 * Négociations. `:id` est l'offre : dans TOUMA, une négociation *est*
 * l'histoire d'une offre, et lui inventer un identifiant séparé n'aurait
 * désigné rien de réel.
 */
export const negotiationRouter = Router();

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
    if (['mine', 'invited'].includes(query.scope) && !req.toumaUser) {
      return res.status(401).json({ error: 'Authentification requise.' });
    }
    res.json(await b2bService.listRfqs(req.toumaUser, query));
  }),
);

/**
 * Comparaison des offres reçues (V28 §7).
 *
 * Réservée à l'acheteur : un fournisseur qui obtiendrait cette vue lirait les
 * prix de ses concurrents. Aucun classement n'en sort — voir le service.
 */
rfqRouter.get(
  '/:id/comparison',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await comparer(currentUser(req), req.params.id));
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

/** L'acheteur sollicite des fournisseurs repérés dans le sourcing. */
rfqRouter.post(
  '/:id/invitations',
  authenticate,
  asyncHandler(async (req, res) => {
    const input = parseBody(inviteSuppliersSchema, req);
    res.status(201).json(await b2bService.inviteSuppliers(currentUser(req), req.params.id, input));
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

// ── Négociation ──────────────────────────────────────────────────────────────
negotiationRouter.use(authenticate);

/** Chronologie, offre courante, droits de l'utilisateur. */
negotiationRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await negotiationService.get(currentUser(req), req.params.id));
  }),
);

/**
 * Contre-proposition structurée. Le client envoie lignes, frais et délai ; le
 * serveur calcule les totaux — jamais l'inverse.
 */
negotiationRouter.post(
  '/:id/counter',
  asyncHandler(async (req, res) => {
    const input = parseBody(counterOfferSchema, req);
    res.status(201).json(await negotiationService.counter(currentUser(req), req.params.id, input));
  }),
);

/** Même opération, nom attendu côté vendeur : proposer une offre révisée. */
negotiationRouter.post(
  '/:id/offers',
  asyncHandler(async (req, res) => {
    const input = parseBody(counterOfferSchema, req);
    res.status(201).json(await negotiationService.counter(currentUser(req), req.params.id, input));
  }),
);

/**
 * Acceptation. L'acheteur transforme l'offre en commande (il fournit son
 * adresse) ; le fournisseur entérine la contre-proposition de l'acheteur.
 */
negotiationRouter.post(
  '/:id/accept',
  asyncHandler(async (req, res) => {
    const input = parseBody(
      z.object({ addressId: z.string().cuid().optional(), negotiationId: z.string().cuid().optional() }),
      req,
    );
    if (input.addressId) {
      res.json(await b2bService.acceptQuote(currentUser(req), req.params.id, input.addressId));
      return;
    }
    res.json(await negotiationService.applyProposal(currentUser(req), req.params.id, input.negotiationId));
  }),
);

/** Le fournisseur entérine explicitement une contre-proposition. */
negotiationRouter.post(
  '/:id/apply',
  asyncHandler(async (req, res) => {
    const input = parseBody(applyProposalSchema, req);
    res.json(await negotiationService.applyProposal(currentUser(req), req.params.id, input.negotiationId));
  }),
);

negotiationRouter.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const input = parseBody(rejectSchema, req);
    res.json(await negotiationService.reject(currentUser(req), req.params.id, input.reason));
  }),
);

/** Retrait de son offre par le fournisseur, tant qu'elle n'est pas acceptée. */
negotiationRouter.post(
  '/:id/withdraw',
  asyncHandler(async (req, res) => {
    const input = parseBody(rejectSchema, req);
    res.json(await negotiationService.withdraw(currentUser(req), req.params.id, input.reason));
  }),
);

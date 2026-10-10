import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { asyncHandler } from '../../middleware/validate.js';
import { auditRequest } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import { authenticate, currentUser } from '../middleware/toumaAuth.js';
import { verifyPickupCode } from './pickup-code.js';

/**
 * Points relais : là où la livraison à domicile est peu fiable, le retrait en
 * point relais est souvent le mode le plus sûr. La liste est publique
 * (l'acheteur doit pouvoir choisir avant de créer un compte).
 */
export const pickupPointRouter = Router();

pickupPointRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const country = typeof req.query.country === 'string' ? req.query.country.toUpperCase() : undefined;
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const province = typeof req.query.province === 'string' ? req.query.province : undefined;
    const items = await prisma.toumaPickupPoint.findMany({
      where: {
        active: true,
        ...(country ? { countryCode: country } : {}),
        ...(city ? { city: { contains: city, mode: 'insensitive' } } : {}),
        // Par identifiant ou par code officiel : une page publique de province
        // connaît le code, pas l'identifiant interne.
        ...(province ? { province: { OR: [{ id: province }, { code: province }] } } : {}),
      },
      orderBy: [{ countryCode: 'asc' }, { city: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        countryCode: true,
        city: true,
        district: true,
        landmark: true,
        addressLine: true,
        phone: true,
        openingHours: true,
        province: { select: { id: true, code: true, name: true, nameAr: true } },
        locality: { select: { id: true, name: true } },
      },
    });
    res.json({ items });
  }),
);

/**
 * Remise d'un colis au comptoir.
 *
 * **Ce qui manquait.** Le parcours s'arrêtait à l'arrivée du colis : rien ne
 * distinguait le destinataire de quiconque connaissait le numéro de commande —
 * numéro qui figure sur tous les écrans, dans tous les e-mails et sur
 * l'étiquette.
 *
 * Le code est présenté par l'acheteur et vérifié ici. Réservé au vendeur
 * concerné et à l'administration : le tenancier du point relais n'a pas de
 * compte TOUMA aujourd'hui, et lui en inventer un serait ajouter un rôle sans
 * politique.
 */
pickupPointRouter.post(
  '/orders/:orderId/release',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const code = typeof req.body?.code === 'string' ? req.body.code : '';

    const order = await prisma.toumaOrder.findUnique({
      where: { id: req.params.orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        deliveryMethod: true,
        pickupCodeHash: true,
        pickupCollectedAt: true,
        buyerId: true,
        store: { select: { ownerId: true } },
      },
    });
    if (!order) throw notFound('Commande introuvable.');
    if (user.role !== 'ADMIN' && order.store.ownerId !== user.id) throw notFound('Commande introuvable.');
    if (order.deliveryMethod !== 'PICKUP_POINT') throw badRequest('Cette commande n’est pas un retrait en point relais.');
    if (order.pickupCollectedAt) throw conflict('Ce colis a déjà été remis.');

    if (!verifyPickupCode(code, order.id, order.pickupCodeHash)) {
      // Le motif reste volontairement le même qu'il s'agisse d'un code faux ou
      // d'un code absent : détailler aiderait à chercher.
      throw badRequest('Code de retrait invalide.');
    }

    const updated = await prisma.toumaOrder.update({
      where: { id: order.id },
      data: { pickupCollectedAt: new Date(), pickupReleasedById: user.id, status: 'DELIVERED', deliveredAt: new Date() },
      select: { id: true, orderNumber: true, status: true, pickupCollectedAt: true },
    });

    await auditRequest(req, 'pickup.released', 'ToumaOrder', order.id, { orderNumber: order.orderNumber });
    await notify({
      userId: order.buyerId,
      type: 'ORDER_STATUS_CHANGED',
      title: 'Colis retiré',
      body: `Votre commande ${order.orderNumber} a été remise au point relais.`,
      data: { orderId: order.id },
    });

    res.json(updated);
  }),
);

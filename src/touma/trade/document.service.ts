import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';
import type { TradeDocumentKind, TradeDocumentStatus } from '@prisma/client';

/**
 * DOCUMENTS COMMERCIAUX (§12 à §17).
 *
 * La distinction qui structure tout ce fichier : **ce que Touma peut émettre**
 * et **ce qu'elle ne peut que recevoir**.
 *
 * Touma émet la facture commerciale, la proforma et la liste de colisage :
 * elles décrivent une transaction dont elle détient les données. Elle n'émet
 * **jamais** un certificat d'origine ni aucun document d'autorité : celui-là
 * vient d'une chambre de commerce ou d'une administration, et le fabriquer
 * serait un faux au sens propre (§17, §69). Il ne peut être que téléversé,
 * puis vérifié par un humain ou un prestataire.
 *
 * Aucun document n'invente de taxe ni d'obligation douanière (§14).
 */

/** Ce que Touma peut légitimement émettre à partir de ses propres données. */
export const EMETTABLES: TradeDocumentKind[] = ['COMMERCIAL_INVOICE', 'PROFORMA_INVOICE', 'PACKING_LIST', 'PURCHASE_ORDER'];

/** Ce qui vient nécessairement d'un tiers. */
export const TELEVERSABLES_SEULEMENT: TradeDocumentKind[] = ['CERTIFICATE_OF_ORIGIN', 'SHIPPING_DOCUMENT', 'OTHER'];

export function estEmettable(kind: TradeDocumentKind): boolean {
  return EMETTABLES.includes(kind);
}

/** Numéro de document, lisible et unique. `FC-2026-000123`. */
async function numeroSuivant(prefixe: string): Promise<string> {
  const annee = new Date().getUTCFullYear();
  const debut = `${prefixe}-${annee}-`;
  const dernier = await prisma.toumaTradeDocument.findFirst({
    where: { number: { startsWith: debut } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const suivant = dernier?.number ? Number(dernier.number.slice(debut.length)) + 1 : 1;
  return `${debut}${String(suivant).padStart(6, '0')}`;
}

const PREFIXES: Partial<Record<TradeDocumentKind, string>> = {
  COMMERCIAL_INVOICE: 'FC',
  PROFORMA_INVOICE: 'PF',
  PACKING_LIST: 'LC',
  PURCHASE_ORDER: 'BC',
};

export const tradeDocumentService = {
  /**
   * Facture commerciale (§14).
   *
   * Reprend les données réelles de la commande. **Aucune taxe n'est calculée**
   * : Touma ne connaît ni le régime fiscal du vendeur ni les obligations du
   * pays de destination. La facture porte les montants qu'elle connaît et dit
   * ce qu'elle ne porte pas.
   */
  async issueCommercialInvoice(user: ToumaRequestUser, orderId: string) {
    if (!env.touma.trade.documentsEnabled) throw badRequest('Les documents commerciaux ne sont pas activés.');

    const commande = await prisma.toumaOrder.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        buyer: { select: { id: true, name: true } },
        store: { select: { id: true, name: true, ownerId: true, countryCode: true } },
        tradeOrder: { select: { id: true } },
        shipments: { select: { originCountry: true, destinationCountry: true }, take: 1 },
      },
    });
    if (!commande) throw notFound('Commande introuvable.');
    // Acheteur, vendeur ou administrateur. Le contrôle est ici parce que la
    // facture porte des noms et des montants des deux parties.
    const autorise = commande.buyerId === user.id || commande.store.ownerId === user.id || user.role === 'ADMIN';
    if (!autorise) throw notFound('Commande introuvable.');

    const tradeOrder = commande.tradeOrder ?? (await this.ensureTradeOrder(commande.id));

    const existante = await prisma.toumaTradeDocument.findFirst({
      where: { tradeOrderId: tradeOrder.id, kind: 'COMMERCIAL_INVOICE', status: { notIn: ['REJECTED', 'EXPIRED'] } },
    });
    // Une facture commerciale ne se réémet pas : deux numéros pour une même
    // transaction rendraient la comptabilité du vendeur incohérente.
    if (existante) return existante;

    const expedition = commande.shipments[0];
    const payload = {
      seller: { name: commande.store.name, countryCode: commande.store.countryCode },
      buyer: { name: commande.buyer.name, countryCode: commande.buyerCountry ?? null },
      origin: expedition?.originCountry ?? commande.store.countryCode,
      destination: expedition?.destinationCountry ?? commande.buyerCountry ?? null,
      items: commande.items.map((i) => ({
        description: i.titleSnapshot,
        quantity: i.quantity,
        unitPrice: i.unitPrice.toString(),
        lineTotal: i.lineTotal.toString(),
        currency: i.currency,
      })),
      currency: commande.currency,
      subtotal: commande.subtotal.toString(),
      shipping: commande.shippingTotal.toString(),
      total: commande.total.toString(),
      issuedAt: new Date().toISOString(),
      /**
       * Ce que la facture **ne** porte **pas**, écrit dans la facture. Un
       * document commercial muet sur ses propres limites laisse croire qu'il
       * les couvre.
       */
      notIncluded: [
        'droits de douane et taxes à l’importation, qui relèvent de l’administration du pays de destination',
        'taxes de vente éventuelles relevant du régime fiscal du vendeur',
      ],
    };

    return prisma.toumaTradeDocument.create({
      data: {
        tradeOrderId: tradeOrder.id,
        kind: 'COMMERCIAL_INVOICE',
        status: 'ISSUED',
        number: await numeroSuivant(PREFIXES.COMMERCIAL_INVOICE!),
        payload: payload as object,
        issuerName: env.touma.companyName || 'Touma',
        issuedAt: new Date(),
      },
    });
  },

  /**
   * Proforma depuis un devis accepté (§15).
   *
   * Le chaînage RFQ → devis → proforma → commande est ce qui rend l'opération
   * traçable. La proforma reprend le devis **tel qu'il a été accepté** : la
   * régénérer depuis les prix du jour changerait ce sur quoi les parties se
   * sont entendues.
   */
  async issueProforma(user: ToumaRequestUser, quoteId: string) {
    if (!env.touma.trade.documentsEnabled) throw badRequest('Les documents commerciaux ne sont pas activés.');

    const devis = await prisma.toumaQuote.findUnique({
      where: { id: quoteId },
      include: {
        rfq: { select: { id: true, title: true, buyerId: true, countryCode: true } },
        store: { select: { id: true, name: true, ownerId: true, countryCode: true } },
        items: { select: { name: true, quantity: true, unit: true, unitPrice: true, lineTotal: true } },
      },
    });
    if (!devis) throw notFound('Devis introuvable.');
    const autorise = devis.rfq.buyerId === user.id || devis.store.ownerId === user.id || user.role === 'ADMIN';
    if (!autorise) throw notFound('Devis introuvable.');
    if (devis.status !== 'ACCEPTED') throw badRequest('Une proforma ne s’établit que sur un devis accepté.');

    const existante = await prisma.toumaTradeDocument.findFirst({
      where: { quoteId, kind: 'PROFORMA_INVOICE', status: { notIn: ['REJECTED', 'EXPIRED'] } },
    });
    if (existante) return existante;

    return prisma.toumaTradeDocument.create({
      data: {
        quoteId,
        rfqId: devis.rfq.id,
        kind: 'PROFORMA_INVOICE',
        status: 'ISSUED',
        number: await numeroSuivant(PREFIXES.PROFORMA_INVOICE!),
        payload: {
          seller: { name: devis.store.name, countryCode: devis.store.countryCode },
          rfq: { id: devis.rfq.id, title: devis.rfq.title, destinationCountry: devis.rfq.countryCode },
          // La proforma reprend le devis **tel qu'il a été accepté**. La
          // régénérer aux prix du jour changerait ce sur quoi les parties se
          // sont entendues.
          items: devis.items.map((i) => ({
            description: i.name,
            quantity: i.quantity,
            unit: i.unit,
            unitPrice: i.unitPrice.toString(),
            lineTotal: i.lineTotal.toString(),
          })),
          itemsTotal: devis.itemsTotal.toString(),
          shippingTotal: devis.shippingTotal.toString(),
          total: devis.total.toString(),
          currency: devis.currency,
          leadTimeDays: devis.leadTimeDays,
          validUntil: devis.validUntil.toISOString(),
          acceptedAt: (devis.acceptedAt ?? devis.updatedAt).toISOString(),
          notIncluded: ['droits de douane et taxes à l’importation'],
        } as object,
        issuerName: env.touma.companyName || 'Touma',
        issuedAt: new Date(),
      },
    });
  },

  /**
   * Liste de colisage (§16).
   *
   * **Aucune dimension n'est inventée.** Le poids vient des produits, qui le
   * portent ; les dimensions ne sont pas saisies dans Touma et sont donc
   * rendues nulles avec la mention. Une liste de colisage aux dimensions
   * fabriquées fait refuser un chargement à la frontière.
   */
  async issuePackingList(user: ToumaRequestUser, orderId: string) {
    if (!env.touma.trade.documentsEnabled) throw badRequest('Les documents commerciaux ne sont pas activés.');

    const commande = await prisma.toumaOrder.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: { select: { sku: true, weightGrams: true, title: true } } } },
        store: { select: { ownerId: true, name: true, countryCode: true } },
        tradeOrder: { select: { id: true } },
      },
    });
    if (!commande) throw notFound('Commande introuvable.');
    if (commande.buyerId !== user.id && commande.store.ownerId !== user.id && user.role !== 'ADMIN') throw notFound('Commande introuvable.');

    const tradeOrder = commande.tradeOrder ?? (await this.ensureTradeOrder(commande.id));
    const existante = await prisma.toumaTradeDocument.findFirst({
      where: { tradeOrderId: tradeOrder.id, kind: 'PACKING_LIST', status: { notIn: ['REJECTED', 'EXPIRED'] } },
    });
    if (existante) return existante;

    let poidsTotal = 0;
    const lignes = commande.items.map((i) => {
      const poids = (i.product?.weightGrams ?? 0) * i.quantity;
      poidsTotal += poids;
      return {
        sku: i.product?.sku ?? null,
        description: i.titleSnapshot,
        quantity: i.quantity,
        unitWeightGrams: i.product?.weightGrams ?? null,
        lineWeightGrams: poids || null,
        // Les dimensions ne sont pas saisies dans Touma : nulles, et dites.
        dimensionsCm: null,
      };
    });

    return prisma.toumaTradeDocument.create({
      data: {
        tradeOrderId: tradeOrder.id,
        kind: 'PACKING_LIST',
        status: 'ISSUED',
        number: await numeroSuivant(PREFIXES.PACKING_LIST!),
        payload: {
          seller: { name: commande.store.name, countryCode: commande.store.countryCode },
          packages: 1,
          lines: lignes,
          totalWeightGrams: poidsTotal || null,
          missing: [
            ...(poidsTotal === 0 ? ['le poids : aucun produit de cette commande ne porte de poids saisi'] : []),
            'les dimensions des colis, qui ne sont pas saisies dans Touma',
          ],
        } as object,
        issuerName: env.touma.companyName || 'Touma',
        issuedAt: new Date(),
      },
    });
  },

  /**
   * Enregistre un document **téléversé**.
   *
   * C'est la seule voie pour un certificat d'origine ou tout document
   * d'autorité. Il entre en `UPLOADED` — jamais `VERIFIED` : personne ne l'a
   * encore regardé, et le marquer vérifié à l'arrivée viderait la vérification
   * de son sens.
   */
  async registerUpload(
    user: ToumaRequestUser,
    input: {
      tradeOrderId?: string | null;
      quoteId?: string | null;
      kind: TradeDocumentKind;
      storageKey: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      issuerName?: string | null;
      number?: string | null;
      issuedAt?: Date | null;
      expiresAt?: Date | null;
    },
  ) {
    if (!env.touma.trade.documentsEnabled) throw badRequest('Les documents commerciaux ne sont pas activés.');
    if (input.tradeOrderId) await this.assertAccess(user, input.tradeOrderId);

    return prisma.toumaTradeDocument.create({
      data: {
        tradeOrderId: input.tradeOrderId ?? null,
        quoteId: input.quoteId ?? null,
        kind: input.kind,
        status: 'UPLOADED',
        number: input.number ?? null,
        storageKey: input.storageKey,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        issuerName: input.issuerName ?? null,
        issuedAt: input.issuedAt ?? null,
        expiresAt: input.expiresAt ?? null,
        uploadedById: user.id,
      },
    });
  },

  /**
   * Vérifie un document (§55).
   *
   * Réservé à l'administration, et la méthode employée est consignée. Un
   * document « vérifié » sans qu'on sache comment n'apporte rien : c'est la
   * méthode qui fait la valeur de la vérification, pas le drapeau.
   */
  async verify(user: ToumaRequestUser, id: string, input: { method: string; note?: string | null }) {
    if (user.role !== 'ADMIN') throw forbidden('La vérification de document est réservée à l’administration.');
    const document = await prisma.toumaTradeDocument.findUnique({ where: { id } });
    if (!document) throw notFound('Document introuvable.');
    if (document.status === 'VERIFIED') throw badRequest('Ce document est déjà vérifié.');
    if (!input.method.trim()) throw badRequest('La méthode de vérification est obligatoire.');

    return prisma.toumaTradeDocument.update({
      where: { id },
      data: { status: 'VERIFIED', verifiedById: user.id, verifiedAt: new Date(), verificationMethod: input.method.trim(), rejectionReason: null },
    });
  },

  async reject(user: ToumaRequestUser, id: string, reason: string) {
    if (user.role !== 'ADMIN') throw forbidden('Le rejet de document est réservé à l’administration.');
    if (!reason.trim()) throw badRequest('Un rejet doit porter son motif.');
    const document = await prisma.toumaTradeDocument.findUnique({ where: { id } });
    if (!document) throw notFound('Document introuvable.');
    return prisma.toumaTradeDocument.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: reason.trim(), verifiedById: user.id, verifiedAt: new Date() },
    });
  },

  /** Documents d'une commande, pour qui y a droit. */
  async listForTradeOrder(user: ToumaRequestUser, tradeOrderId: string) {
    await this.assertAccess(user, tradeOrderId);
    return prisma.toumaTradeDocument.findMany({
      where: { tradeOrderId },
      orderBy: { createdAt: 'desc' },
      // `storageKey` ne sort jamais : c'est le chemin du fichier privé, et
      // l'exposer contournerait l'URL signée.
      select: {
        id: true,
        kind: true,
        status: true,
        number: true,
        payload: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        issuerName: true,
        issuedAt: true,
        expiresAt: true,
        verifiedAt: true,
        verificationMethod: true,
        rejectionReason: true,
        createdAt: true,
      },
    });
  },

  async get(user: ToumaRequestUser, id: string) {
    const document = await prisma.toumaTradeDocument.findUnique({ where: { id } });
    if (!document) throw notFound('Document introuvable.');
    if (document.tradeOrderId) await this.assertAccess(user, document.tradeOrderId);
    else if (user.role !== 'ADMIN') throw notFound('Document introuvable.');
    const { storageKey, ...visible } = document;
    return visible;
  },

  /** Crée le volet commercial d'une commande s'il n'existe pas encore. */
  async ensureTradeOrder(orderId: string) {
    const existant = await prisma.toumaTradeOrder.findUnique({ where: { orderId } });
    if (existant) return existant;

    const commande = await prisma.toumaOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: { currency: true, buyerCountry: true, sellerCountry: true, store: { select: { countryCode: true } } },
    });
    const origine = commande.sellerCountry ?? commande.store.countryCode;
    const destination = commande.buyerCountry;
    const corridor =
      origine && destination && origine !== destination
        ? await prisma.toumaTradeCorridor.findUnique({
            where: { originCountry_destinationCountry: { originCountry: origine, destinationCountry: destination } },
            select: { id: true },
          })
        : null;

    return prisma.toumaTradeOrder.create({
      data: { orderId, corridorId: corridor?.id ?? null, settlementCurrency: commande.currency },
    });
  },

  /** Acheteur, vendeur ou administrateur. Personne d'autre. */
  async assertAccess(user: ToumaRequestUser, tradeOrderId: string) {
    if (user.role === 'ADMIN') return;
    const lien = await prisma.toumaTradeOrder.findUnique({
      where: { id: tradeOrderId },
      select: { order: { select: { buyerId: true, store: { select: { ownerId: true } } } } },
    });
    // Même réponse pour « n'existe pas » et « pas à vous » : un document
    // commercial ne doit pas se laisser deviner par sondage d'identifiants.
    if (!lien || (lien.order.buyerId !== user.id && lien.order.store.ownerId !== user.id)) {
      throw notFound('Document introuvable.');
    }
  },
};

export type { TradeDocumentStatus };

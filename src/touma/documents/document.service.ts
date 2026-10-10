import { Prisma, type DocumentType } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { audit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { sum } from '../lib/money.js';
import { paginated, type PageParams } from '../lib/pagination.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * DOCUMENTS COMMERCIAUX — facture, avoir, reçu, bon de commande, bon de livraison.
 *
 * Trois principes :
 *
 * 1. **L'émetteur est celui qui vend.** Une facture est émise par la boutique
 *    au nom de l'acheteur ; TOUMA n'émet que le reçu du paiement qu'elle a
 *    encaissé. Confondre les deux ferait de la place de marché le vendeur.
 * 2. **Un document est figé.** Son contenu est copié au moment de l'émission ;
 *    une correction passe par un avoir, jamais par une réécriture.
 * 3. **Rien n'est inventé.** Aucune TVA n'est calculée tant qu'aucun régime
 *    fiscal n'est configuré : le document le dit, plutôt que d'annoncer un
 *    montant de taxe faux. Même chose pour l'identité légale manquante.
 */

const PREFIX: Record<DocumentType, string> = {
  INVOICE: 'FAC',
  CREDIT_NOTE: 'AVO',
  PAYMENT_RECEIPT: 'REC',
  PURCHASE_ORDER: 'BDC',
  DELIVERY_NOTE: 'BDL',
};

const TITLE: Record<DocumentType, string> = {
  INVOICE: 'Facture',
  CREDIT_NOTE: 'Avoir',
  PAYMENT_RECEIPT: 'Reçu de paiement',
  PURCHASE_ORDER: 'Bon de commande',
  DELIVERY_NOTE: 'Bon de livraison',
};

/** Code court et stable identifiant l'émetteur dans un numéro de document. */
function issuerCode(id: string | null): string {
  return id ? id.slice(-4).toUpperCase() : 'TOUMA';
}

/**
 * Numéro suivant d'une série. Le compteur est incrémenté de façon atomique :
 * deux factures émises au même instant ne peuvent pas porter le même numéro.
 */
async function nextNumber(tx: Prisma.TransactionClient, type: DocumentType, issuerId: string | null) {
  const year = new Date().getUTCFullYear();
  const key = `${type}:${year}:${issuerId ?? 'platform'}`;
  const sequence = await tx.toumaDocumentSequence.upsert({
    where: { key },
    create: { key, counter: 1 },
    update: { counter: { increment: 1 } },
  });
  return {
    series: key,
    number: `${PREFIX[type]}-${year}-${issuerCode(issuerId)}-${String(sequence.counter).padStart(5, '0')}`,
  };
}

/** Identité légale d'une boutique, telle qu'elle a été vérifiée. */
async function storeParty(storeId: string) {
  const store = await prisma.toumaStore.findUnique({
    where: { id: storeId },
    include: {
      owner: { select: { name: true, email: true, phone: true } },
      verifications: { where: { status: 'APPROVED' }, orderBy: { reviewedAt: 'desc' }, take: 1 },
    },
  });
  if (!store) throw notFound('Boutique introuvable.');
  const verified = store.verifications[0];
  return {
    name: store.name,
    // La raison sociale n'est reprise que si elle a été vérifiée par TOUMA.
    legalName: verified?.legalName ?? null,
    registrationNo: verified?.registrationNo ?? null,
    taxId: verified?.taxId ?? null,
    verified: Boolean(verified),
    city: store.city,
    countryCode: store.countryCode,
    phone: verified?.contactPhone ?? store.phone,
    email: verified?.contactEmail ?? store.owner.email,
  };
}

/** Identité de l'acheteur : profil entreprise s'il existe, compte sinon. */
async function buyerParty(userId: string, snapshot?: Record<string, unknown> | null) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, phone: true, countryCode: true, businessProfile: true },
  });
  if (!user) throw notFound('Acheteur introuvable.');
  const business = user.businessProfile;
  return {
    name: business?.legalName ?? user.name,
    legalName: business?.legalName ?? null,
    registrationNo: business?.registrationNo ?? null,
    taxId: business?.taxId ?? null,
    email: user.email,
    phone: business?.phone ?? user.phone,
    city: (snapshot?.city as string | undefined) ?? business?.city ?? null,
    countryCode: (snapshot?.countryCode as string | undefined) ?? business?.countryCode ?? user.countryCode,
    address: snapshot ?? null,
  };
}

/** Identité de TOUMA, telle qu'elle est configurée — jamais inventée. */
function platformParty() {
  const configured = Boolean(env.touma.companyLegalName || env.touma.companyName);
  return {
    name: env.touma.companyName || 'TOUMA',
    legalName: env.touma.companyLegalName || null,
    registrationNo: env.touma.companyRegistrationNo || null,
    taxId: env.touma.companyTaxId || null,
    address: env.touma.companyAddress || null,
    countryCode: env.touma.companyCountry || null,
    email: env.touma.companyEmail || null,
    /** Faux tant que l'exploitant n'a pas renseigné son identité légale. */
    configured,
  };
}

/**
 * Mention légale portée sur chaque document. Dire qu'aucune TVA n'est calculée
 * vaut mieux que d'afficher un montant de taxe inventé.
 */
const TAX_NOTICE =
  'Montants tels que transactés sur TOUMA. Aucun régime de TVA n’est configuré pour cet émetteur : aucune taxe n’est calculée ni collectée par ce document.';

interface IssueInput {
  type: DocumentType;
  sourceKey: string;
  issuerKind: 'STORE' | 'PLATFORM' | 'BUYER';
  storeId?: string | null;
  buyerId: string;
  orderId?: string | null;
  orderGroupId?: string | null;
  currency: string;
  totalAmount: Prisma.Decimal;
  payload: Record<string, unknown>;
  relatedDocumentId?: string | null;
}

/**
 * Émet un document. Idempotent par `sourceKey` : rejouer un webhook de paiement
 * ne produit pas une seconde facture.
 */
async function issue(input: IssueInput) {
  const existing = await prisma.toumaDocument.findUnique({ where: { sourceKey: input.sourceKey } });
  if (existing) return existing;

  const issuerId = input.issuerKind === 'STORE' ? (input.storeId ?? null) : null;
  try {
    const document = await prisma.$transaction(async (tx) => {
      const { series, number } = await nextNumber(tx, input.type, issuerId);
      return tx.toumaDocument.create({
        data: {
          type: input.type,
          number,
          series,
          issuerKind: input.issuerKind,
          storeId: input.storeId ?? null,
          buyerId: input.buyerId,
          orderId: input.orderId ?? null,
          orderGroupId: input.orderGroupId ?? null,
          currency: input.currency,
          totalAmount: input.totalAmount,
          payload: { ...input.payload, title: TITLE[input.type], taxNotice: TAX_NOTICE } as object,
          sourceKey: input.sourceKey,
          relatedDocumentId: input.relatedDocumentId ?? null,
        },
      });
    });
    await audit({
      actorId: null,
      action: 'document.issue',
      entity: 'ToumaDocument',
      entityId: document.id,
      metadata: { type: input.type, number: document.number, orderId: input.orderId ?? null },
    });
    return document;
  } catch (err) {
    // P2002 : un autre appel concurrent vient d'émettre le même document.
    if ((err as { code?: string }).code === 'P2002') {
      return prisma.toumaDocument.findUnique({ where: { sourceKey: input.sourceKey } });
    }
    logger.error('Document non émis', { type: input.type, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function serialize(document: Awaited<ReturnType<typeof prisma.toumaDocument.findFirstOrThrow>>) {
  return {
    id: document.id,
    type: document.type,
    title: TITLE[document.type],
    number: document.number,
    issuerKind: document.issuerKind,
    storeId: document.storeId,
    orderId: document.orderId,
    orderGroupId: document.orderGroupId,
    currency: document.currency,
    totalAmount: document.totalAmount.toString(),
    taxAmount: document.taxAmount.toString(),
    payload: document.payload,
    issuedAt: document.issuedAt,
  };
}

export const documentService = {
  TITLE,

  /** Facture d'une sous-commande payée : émise par la boutique. */
  async issueInvoiceForOrder(orderId: string) {
    const order = await prisma.toumaOrder.findUnique({
      where: { id: orderId },
      include: { items: true, store: { select: { id: true } } },
    });
    if (!order) return null;

    const [seller, buyer] = await Promise.all([
      storeParty(order.storeId),
      buyerParty(order.buyerId, order.shippingSnapshot as Record<string, unknown>),
    ]);

    return issue({
      type: 'INVOICE',
      sourceKey: `INVOICE:${order.id}`,
      issuerKind: 'STORE',
      storeId: order.storeId,
      buyerId: order.buyerId,
      orderId: order.id,
      orderGroupId: order.groupId,
      currency: order.currency,
      totalAmount: order.total,
      payload: {
        reference: order.orderNumber,
        issuer: seller,
        recipient: buyer,
        lines: order.items.map((i) => ({
          label: i.titleSnapshot,
          variant: i.variantSnapshot,
          quantity: i.quantity,
          unitPrice: i.unitPrice.toString(),
          lineTotal: i.lineTotal.toString(),
        })),
        totals: {
          subtotal: order.subtotal.toString(),
          shipping: order.shippingTotal.toString(),
          discount: order.discountTotal.toString(),
          total: order.total.toString(),
        },
        placedAt: order.placedAt,
        paidAt: order.paidAt,
        crossBorder: order.crossBorder,
      },
    });
  },

  /** Reçu du paiement encaissé par TOUMA pour le compte des vendeurs. */
  async issueReceiptForPayment(paymentId: string) {
    const payment = await prisma.toumaPayment.findUnique({
      where: { id: paymentId },
      include: {
        order: { select: { id: true, orderNumber: true, buyerId: true, shippingSnapshot: true } },
        orderGroup: { select: { id: true, reference: true, buyerId: true, shippingSnapshot: true, orders: { select: { orderNumber: true, total: true, currency: true, store: { select: { name: true } } } } } },
      },
    });
    if (!payment || payment.status !== 'SUCCEEDED') return null;

    const buyerId = payment.orderGroup?.buyerId ?? payment.order?.buyerId;
    if (!buyerId) return null;
    const snapshot = (payment.orderGroup?.shippingSnapshot ?? payment.order?.shippingSnapshot) as Record<string, unknown> | null;
    const buyer = await buyerParty(buyerId, snapshot);

    return issue({
      type: 'PAYMENT_RECEIPT',
      sourceKey: `PAYMENT_RECEIPT:${payment.id}`,
      issuerKind: 'PLATFORM',
      buyerId,
      orderId: payment.orderId,
      orderGroupId: payment.orderGroupId,
      currency: payment.currency,
      totalAmount: payment.amount,
      payload: {
        reference: payment.orderGroup?.reference ?? payment.order?.orderNumber ?? payment.id,
        issuer: platformParty(),
        recipient: buyer,
        method: payment.method,
        provider: payment.provider,
        // Référence du prestataire, jamais de donnée bancaire.
        providerRef: payment.providerRef,
        paidAt: payment.succeededAt,
        lines: (payment.orderGroup?.orders ?? []).map((o) => ({
          label: `Commande ${o.orderNumber} — ${o.store.name}`,
          quantity: 1,
          unitPrice: o.total.toString(),
          lineTotal: o.total.toString(),
        })),
        totals: { total: payment.amount.toString() },
      },
    });
  },

  /** Avoir émis par la boutique après un remboursement effectif. */
  async issueCreditNoteForRefund(refundId: string) {
    const refund = await prisma.toumaRefund.findUnique({
      where: { id: refundId },
      include: { order: { select: { id: true, orderNumber: true, storeId: true, buyerId: true, groupId: true, shippingSnapshot: true } } },
    });
    if (!refund || refund.status !== 'COMPLETED') return null;

    const invoice = await prisma.toumaDocument.findUnique({ where: { sourceKey: `INVOICE:${refund.orderId}` } });
    const [seller, buyer] = await Promise.all([
      storeParty(refund.order.storeId),
      buyerParty(refund.order.buyerId, refund.order.shippingSnapshot as Record<string, unknown>),
    ]);

    return issue({
      type: 'CREDIT_NOTE',
      sourceKey: `CREDIT_NOTE:${refund.id}`,
      issuerKind: 'STORE',
      storeId: refund.order.storeId,
      buyerId: refund.order.buyerId,
      orderId: refund.orderId,
      orderGroupId: refund.order.groupId,
      currency: refund.currency,
      totalAmount: refund.amount,
      relatedDocumentId: invoice?.id ?? null,
      payload: {
        reference: refund.reference,
        issuer: seller,
        recipient: buyer,
        // Un avoir renvoie toujours à la facture qu'il corrige.
        correctsInvoice: invoice?.number ?? null,
        orderNumber: refund.order.orderNumber,
        reason: refund.reason,
        lines: [
          {
            label: `Remboursement sur la commande ${refund.order.orderNumber}`,
            quantity: 1,
            unitPrice: refund.amount.toString(),
            lineTotal: refund.amount.toString(),
          },
        ],
        totals: { total: refund.amount.toString() },
        refundedAt: refund.processedAt,
      },
    });
  },

  /** Bon de livraison émis à la création de l'expédition. */
  async issueDeliveryNote(shipmentId: string) {
    const shipment = await prisma.toumaShipment.findUnique({
      where: { id: shipmentId },
      include: { order: { include: { items: true } } },
    });
    if (!shipment) return null;

    const [seller, buyer] = await Promise.all([
      storeParty(shipment.order.storeId),
      buyerParty(shipment.order.buyerId, shipment.order.shippingSnapshot as Record<string, unknown>),
    ]);

    return issue({
      type: 'DELIVERY_NOTE',
      sourceKey: `DELIVERY_NOTE:${shipment.id}`,
      issuerKind: 'STORE',
      storeId: shipment.order.storeId,
      buyerId: shipment.order.buyerId,
      orderId: shipment.orderId,
      orderGroupId: shipment.order.groupId,
      currency: shipment.order.currency,
      // Un bon de livraison ne porte pas de montant à payer.
      totalAmount: new Prisma.Decimal(0),
      payload: {
        reference: shipment.trackingNumber,
        issuer: seller,
        recipient: buyer,
        orderNumber: shipment.order.orderNumber,
        carrier: shipment.providerCode,
        etaMinDays: shipment.etaMinDays,
        etaMaxDays: shipment.etaMaxDays,
        // Un bon de livraison liste les quantités, pas les prix.
        lines: shipment.order.items.map((i) => ({
          label: i.titleSnapshot,
          variant: i.variantSnapshot,
          quantity: i.quantity,
        })),
        shippedTo: shipment.order.shippingSnapshot,
      },
    });
  },

  /** Bon de commande émis par l'acheteur quand il accepte une offre B2B. */
  async issuePurchaseOrderForQuote(quoteId: string) {
    const quote = await prisma.toumaQuote.findUnique({
      where: { id: quoteId },
      include: {
        items: true,
        store: { select: { id: true } },
        rfq: { select: { reference: true, buyerId: true, title: true } },
        orderGroup: { select: { id: true, reference: true, orders: { select: { id: true, orderNumber: true } } } },
      },
    });
    if (!quote || quote.status !== 'ACCEPTED') return null;

    const [seller, buyer] = await Promise.all([storeParty(quote.storeId), buyerParty(quote.rfq.buyerId, null)]);

    return issue({
      type: 'PURCHASE_ORDER',
      sourceKey: `PURCHASE_ORDER:${quote.id}`,
      // Le bon de commande émane de l'acheteur : c'est lui qui commande.
      issuerKind: 'BUYER',
      storeId: quote.storeId,
      buyerId: quote.rfq.buyerId,
      orderId: quote.orderGroup?.orders[0]?.id ?? null,
      orderGroupId: quote.orderGroupId,
      currency: quote.currency,
      totalAmount: quote.total,
      payload: {
        reference: quote.reference,
        issuer: buyer,
        recipient: seller,
        rfqReference: quote.rfq.reference,
        subject: quote.rfq.title,
        leadTimeDays: quote.leadTimeDays,
        lines: quote.items.map((i) => ({
          label: i.name,
          quantity: i.quantity,
          unit: i.unit,
          unitPrice: i.unitPrice.toString(),
          lineTotal: i.lineTotal.toString(),
        })),
        totals: {
          subtotal: quote.itemsTotal.toString(),
          shipping: quote.shippingTotal.toString(),
          total: quote.total.toString(),
        },
        acceptedAt: quote.acceptedAt,
      },
    });
  },

  /** Documents accessibles à l'utilisateur : les siens, ou ceux de ses boutiques. */
  async list(user: ToumaRequestUser, query: { scope: 'buyer' | 'seller'; type?: DocumentType; page: number; limit: number }) {
    const page: PageParams = { page: query.page, limit: query.limit, skip: (query.page - 1) * query.limit };
    const where: Prisma.ToumaDocumentWhereInput =
      query.scope === 'seller'
        ? { store: user.role === 'ADMIN' ? { isNot: null } : { ownerId: user.id }, ...(query.type ? { type: query.type } : {}) }
        : { buyerId: user.id, ...(query.type ? { type: query.type } : {}) };

    const [rows, total] = await Promise.all([
      prisma.toumaDocument.findMany({
        where,
        include: { store: { select: { name: true } } },
        orderBy: { issuedAt: 'desc' },
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaDocument.count({ where }),
    ]);

    return paginated(
      rows.map((d) => ({
        id: d.id,
        type: d.type,
        title: TITLE[d.type],
        number: d.number,
        storeName: d.store?.name ?? null,
        orderId: d.orderId,
        currency: d.currency,
        totalAmount: d.totalAmount.toString(),
        issuedAt: d.issuedAt,
      })),
      total,
      page,
    );
  },

  /** Détail d'un document. Anti-IDOR : un document d'autrui est « introuvable ». */
  async get(user: ToumaRequestUser, id: string) {
    const document = await prisma.toumaDocument.findFirst({
      where: { OR: [{ id }, { number: id }] },
      include: { store: { select: { ownerId: true } } },
    });
    if (!document) throw notFound('Document introuvable.');
    const allowed = document.buyerId === user.id || document.store?.ownerId === user.id || user.role === 'ADMIN';
    if (!allowed) throw notFound('Document introuvable.');
    return serialize(document);
  },

  /** Documents rattachés à une commande, pour les afficher sur sa page. */
  async forOrder(user: ToumaRequestUser, orderId: string) {
    const order = await prisma.toumaOrder.findUnique({
      where: { id: orderId },
      select: { id: true, groupId: true, buyerId: true, store: { select: { ownerId: true } } },
    });
    if (!order) throw notFound('Commande introuvable.');
    const allowed = order.buyerId === user.id || order.store.ownerId === user.id || user.role === 'ADMIN';
    if (!allowed) throw notFound('Commande introuvable.');

    // Le reçu de paiement est rattaché au **panier** (payé en une fois), pas à
    // une sous-commande : sans cela il n'apparaîtrait sur aucune commande.
    const rows = await prisma.toumaDocument.findMany({
      where: {
        OR: [
          { orderId: order.id },
          ...(order.groupId ? [{ orderGroupId: order.groupId, orderId: null }] : []),
        ],
      },
      orderBy: { issuedAt: 'asc' },
    });
    return {
      items: rows.map((d) => ({
        id: d.id,
        type: d.type,
        title: TITLE[d.type],
        number: d.number,
        totalAmount: d.totalAmount.toString(),
        currency: d.currency,
        issuedAt: d.issuedAt,
      })),
    };
  },

  /** Total facturé par une boutique sur une période — utile au vendeur. */
  async sellerTotals(user: ToumaRequestUser, storeId: string) {
    const store = await prisma.toumaStore.findUnique({ where: { id: storeId }, select: { ownerId: true } });
    if (!store) throw notFound('Boutique introuvable.');
    if (store.ownerId !== user.id && user.role !== 'ADMIN') throw notFound('Boutique introuvable.');

    const [invoices, creditNotes] = await Promise.all([
      prisma.toumaDocument.findMany({ where: { storeId, type: 'INVOICE' }, select: { totalAmount: true, currency: true } }),
      prisma.toumaDocument.findMany({ where: { storeId, type: 'CREDIT_NOTE' }, select: { totalAmount: true, currency: true } }),
    ]);
    const byCurrency = (rows: typeof invoices) => {
      const out: Record<string, string> = {};
      for (const currency of new Set(rows.map((r) => r.currency))) {
        out[currency] = sum(rows.filter((r) => r.currency === currency).map((r) => r.totalAmount)).toString();
      }
      return out;
    };
    return {
      invoiceCount: invoices.length,
      creditNoteCount: creditNotes.length,
      invoiced: byCurrency(invoices),
      credited: byCurrency(creditNotes),
    };
  },
};

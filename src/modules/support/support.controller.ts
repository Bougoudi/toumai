import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody } from '../../middleware/validate.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { getSettings } from '../settings/settings.service.js';
import { aiService, type ChatMessage } from './ai.service.js';

const chatSchema = z.object({
  customerId: z.string().optional(),
  message: z.string().min(1).max(4000),
});

/** Contexte du client + sa commande la plus récente (si un client est ciblé). */
async function customerContext(customerId: string): Promise<string> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return '';
  const order = await prisma.order.findFirst({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    include: { items: { include: { product: true } }, purchaseOrders: true },
  });
  const lines = [`Client : ${customer.name}`, customer.country ? `Pays : ${customer.country}` : ''];
  if (order) {
    const track = order.purchaseOrders.find((p) => p.trackingNumber);
    const products = order.items.map((it) => `${it.product?.name ?? it.productId} ×${it.quantity}`).join(', ');
    lines.push(
      `Dernière commande : ${order.orderNumber}`,
      `Statut : ${order.status}`,
      `Total : ${order.total} ${order.currency}`,
      `Produits : ${products || '—'}`,
      track ? `Suivi : ${track.trackingNumber}${track.carrier ? ' (' + track.carrier + ')' : ''}` : `Suivi : aucun pour l'instant`,
    );
  }
  return lines.filter(Boolean).join('\n');
}

function buildSystemPrompt(ctx: string): string {
  const currency = getSettings().currency;
  return [
    "Tu es l'assistant service client d'une boutique e-commerce (dropshipping) appelée Toumai.",
    'Ton rôle : discuter et aider à résoudre les problèmes des clients, en rédigeant des réponses claires et prêtes à envoyer.',
    'Règles :',
    '- Réponds TOUJOURS dans la langue du dernier message.',
    '- Sois chaleureux, professionnel, orienté solution, concis.',
    '- Adapte la solution à la situation (remboursement si non expédié, patience/renvoi si en transit, photo si produit endommagé, etc.).',
    "- N'invente jamais de numéro de suivi, de date ou de fait : appuie-toi uniquement sur ce que l'on te donne.",
    `- Devise de la boutique : ${currency}.`,
    ctx ? `\nContexte :\n${ctx}` : '',
  ].join('\n');
}

/** Filtre Prisma pour une conversation (client ciblé, ou générale si nul). */
function threadWhere(customerId?: string) {
  return { customerId: customerId && customerId !== 'general' ? customerId : null };
}

export const supportController = {
  /** GET /api/support/ai-status — l'assistant IA est-il configuré ? */
  async status(_req: Request, res: Response) {
    res.json(await aiService.status());
  },

  /** GET /api/support/thread(/:customerId) — historique sauvegardé. */
  async thread(req: Request, res: Response) {
    const messages = await prisma.supportMessage.findMany({
      where: threadWhere(req.params.customerId),
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, createdAt: true },
    });
    res.json({ messages });
  },

  /** DELETE /api/support/thread(/:customerId) — efface la conversation. */
  async clearThread(req: Request, res: Response) {
    await prisma.supportMessage.deleteMany({ where: threadWhere(req.params.customerId) });
    res.json({ ok: true });
  },

  /**
   * POST /api/support/chat — enregistre le message, interroge l'assistant IA
   * (avec le contexte du client si fourni), enregistre et renvoie la réponse.
   */
  async chat(req: Request, res: Response) {
    const input = parseBody(chatSchema, req);
    const targeted = input.customerId && input.customerId !== 'general' ? input.customerId : undefined;
    if (targeted) {
      const customer = await prisma.customer.findUnique({ where: { id: targeted }, select: { id: true } });
      if (!customer) throw new HttpError(404, 'Client introuvable');
    }
    const where = threadWhere(input.customerId);

    await prisma.supportMessage.create({ data: { customerId: where.customerId, role: 'user', content: input.message } });

    const history = await prisma.supportMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });
    const messages: ChatMessage[] = history.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const ctx = targeted ? await customerContext(targeted) : '';
    const reply = await aiService.chat(buildSystemPrompt(ctx), messages);

    await prisma.supportMessage.create({ data: { customerId: where.customerId, role: 'assistant', content: reply } });
    res.json({ reply });
  },
};

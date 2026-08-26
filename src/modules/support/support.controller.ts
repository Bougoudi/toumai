import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody } from '../../middleware/validate.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { getSettings } from '../settings/settings.service.js';
import { aiService, type ChatMessage } from './ai.service.js';

const chatSchema = z.object({
  customerId: z.string().min(1),
  message: z.string().min(1).max(4000),
});

/** Contexte du client + sa commande la plus récente (pour ancrer l'IA). */
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
  } else {
    lines.push("Aucune commande enregistrée pour ce client pour l'instant.");
  }
  return lines.filter(Boolean).join('\n');
}

function buildSystemPrompt(ctx: string): string {
  const currency = getSettings().currency;
  return [
    "Tu es un agent du service client d'une boutique e-commerce (dropshipping) appelée Toumai.",
    'Ton rôle : discuter avec le client (ou aider le vendeur) et résoudre les problèmes, en rédigeant des réponses claires prêtes à envoyer.',
    'Règles :',
    '- Réponds TOUJOURS dans la langue du dernier message.',
    '- Sois chaleureux, professionnel, orienté solution, concis.',
    '- Adapte la solution au statut réel de la commande (remboursement si non expédiée, patience/renvoi si en transit, photo si produit endommagé, etc.).',
    "- N'invente jamais de numéro de suivi, de date ou de fait : appuie-toi uniquement sur le contexte fourni.",
    `- Devise de la boutique : ${currency}.`,
    ctx ? `\nContexte :\n${ctx}` : '',
  ].join('\n');
}

export const supportController = {
  /** GET /api/support/ai-status — l'assistant IA est-il configuré ? */
  async status(_req: Request, res: Response) {
    res.json(await aiService.status());
  },

  /** GET /api/support/thread/:customerId — historique sauvegardé. */
  async thread(req: Request, res: Response) {
    const messages = await prisma.supportMessage.findMany({
      where: { customerId: req.params.customerId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, createdAt: true },
    });
    res.json({ messages });
  },

  /** DELETE /api/support/thread/:customerId — efface la conversation. */
  async clearThread(req: Request, res: Response) {
    await prisma.supportMessage.deleteMany({ where: { customerId: req.params.customerId } });
    res.json({ ok: true });
  },

  /**
   * POST /api/support/chat — enregistre le message, interroge l'agent IA dans le
   * contexte réel du client, enregistre sa réponse, renvoie celle-ci.
   */
  async chat(req: Request, res: Response) {
    const input = parseBody(chatSchema, req);
    const customer = await prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
    if (!customer) throw new HttpError(404, 'Client introuvable');

    await prisma.supportMessage.create({ data: { customerId: input.customerId, role: 'user', content: input.message } });

    const history = await prisma.supportMessage.findMany({
      where: { customerId: input.customerId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });
    const messages: ChatMessage[] = history.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const ctx = await customerContext(input.customerId);
    const reply = await aiService.chat(buildSystemPrompt(ctx), messages);

    await prisma.supportMessage.create({ data: { customerId: input.customerId, role: 'assistant', content: reply } });
    res.json({ reply });
  },
};

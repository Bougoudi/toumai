import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody } from '../../middleware/validate.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { getSettings } from '../settings/settings.service.js';
import { aiService, type ChatMessage } from './ai.service.js';

const chatSchema = z.object({
  orderId: z.string().min(1),
  message: z.string().min(1).max(4000),
});

/** Construit le contexte de la commande (pour ancrer les réponses de l'IA). */
async function orderContext(orderId: string): Promise<string> {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      items: { include: { product: true } },
      purchaseOrders: { include: { supplier: true } },
    },
  });
  if (!o) return '';
  const track = o.purchaseOrders.find((p) => p.trackingNumber);
  const products = o.items.map((it) => `${it.product?.name ?? it.productId} ×${it.quantity}`).join(', ');
  const lines = [
    `Numéro de commande : ${o.orderNumber}`,
    `Client : ${o.customer?.name ?? '—'}`,
    `Statut : ${o.status}`,
    `Total : ${o.total} ${o.currency}`,
    `Produits : ${products || '—'}`,
    track ? `Suivi : ${track.trackingNumber}${track.carrier ? ' (' + track.carrier + ')' : ''}` : `Suivi : aucun pour l'instant`,
    o.customer?.country ? `Pays de livraison : ${o.customer.country}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function buildSystemPrompt(ctx: string): string {
  const currency = getSettings().currency;
  return [
    "Tu es un agent du service client d'une boutique e-commerce (dropshipping) appelée Toumai.",
    "Ton rôle : aider le vendeur à résoudre les problèmes de SES clients et rédiger des réponses prêtes à envoyer AU client.",
    'Règles :',
    '- Réponds TOUJOURS dans la langue du dernier message (celle du client/vendeur).',
    '- Sois chaleureux, professionnel, orienté solution, concis.',
    '- Propose une solution concrète adaptée au statut réel de la commande (remboursement si non expédiée, renvoi/patience si en transit, photo si produit endommagé, etc.).',
    "- N'invente jamais de numéro de suivi, de date ou de fait : appuie-toi uniquement sur le contexte fourni.",
    '- Quand tu proposes un message à envoyer au client, rédige-le directement, prêt à copier.',
    `- Devise de la boutique : ${currency}.`,
    ctx ? `\nContexte de la commande concernée :\n${ctx}` : '',
  ].join('\n');
}

export const supportController = {
  /** GET /api/support/ai-status — l'assistant IA est-il configuré ? */
  async status(_req: Request, res: Response) {
    res.json(await aiService.status());
  },

  /** GET /api/support/thread/:orderId — historique sauvegardé de la conversation. */
  async thread(req: Request, res: Response) {
    const messages = await prisma.supportMessage.findMany({
      where: { orderId: req.params.orderId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, createdAt: true },
    });
    res.json({ messages });
  },

  /** DELETE /api/support/thread/:orderId — efface la conversation (nouveau départ). */
  async clearThread(req: Request, res: Response) {
    await prisma.supportMessage.deleteMany({ where: { orderId: req.params.orderId } });
    res.json({ ok: true });
  },

  /**
   * POST /api/support/chat — enregistre le message, interroge l'agent IA dans le
   * contexte réel de la commande, enregistre sa réponse, renvoie le fil complet.
   */
  async chat(req: Request, res: Response) {
    const input = parseBody(chatSchema, req);
    const order = await prisma.order.findUnique({ where: { id: input.orderId }, select: { id: true } });
    if (!order) throw new HttpError(404, 'Commande introuvable');

    // Enregistre le message entrant (persisté).
    await prisma.supportMessage.create({ data: { orderId: input.orderId, role: 'user', content: input.message } });

    // Reconstruit l'historique complet depuis la base (conversation réelle).
    const history = await prisma.supportMessage.findMany({
      where: { orderId: input.orderId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });
    const messages: ChatMessage[] = history.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const ctx = await orderContext(input.orderId);
    const reply = await aiService.chat(buildSystemPrompt(ctx), messages);

    // Enregistre la réponse de l'agent (persistée).
    await prisma.supportMessage.create({ data: { orderId: input.orderId, role: 'assistant', content: reply } });

    res.json({ reply });
  },
};

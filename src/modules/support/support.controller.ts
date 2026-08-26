import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody } from '../../middleware/validate.js';
import { prisma } from '../../db/prisma.js';
import { getSettings } from '../settings/settings.service.js';
import { aiService, type ChatMessage } from './ai.service.js';

const chatSchema = z.object({
  orderId: z.string().optional(),
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(30),
});

/** Construit le contexte de la commande (pour ancrer les réponses de l'IA). */
async function orderContext(orderId?: string): Promise<string> {
  if (!orderId) return '';
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

export const supportController = {
  /** GET /api/support/ai-status — l'assistant IA est-il configuré ? */
  async status(_req: Request, res: Response) {
    res.json(await aiService.status());
  },

  /** POST /api/support/chat — l'agent IA répond dans le contexte d'une commande. */
  async chat(req: Request, res: Response) {
    const input = parseBody(chatSchema, req);
    const ctx = await orderContext(input.orderId);
    const currency = getSettings().currency;
    const system = [
      "Tu es un agent du service client d'une boutique e-commerce (dropshipping) appelée Toumai.",
      "Ton rôle : aider le vendeur à résoudre les problèmes de SES clients et rédiger des réponses prêtes à envoyer AU client.",
      "Règles :",
      "- Réponds TOUJOURS dans la langue du dernier message (celle du client/vendeur).",
      "- Sois chaleureux, professionnel, orienté solution, concis.",
      "- Propose une solution concrète adaptée au statut réel de la commande (remboursement si non expédiée, renvoi/patience si en transit, photo si produit endommagé, etc.).",
      "- N'invente jamais de numéro de suivi, de date ou de fait : appuie-toi uniquement sur le contexte fourni.",
      "- Quand tu proposes un message à envoyer au client, rédige-le directement, prêt à copier.",
      `- Devise de la boutique : ${currency}.`,
      ctx ? `\nContexte de la commande concernée :\n${ctx}` : "\nAucune commande spécifique sélectionnée : aide de manière générale.",
    ].join('\n');

    const reply = await aiService.chat(system, input.messages as ChatMessage[]);
    res.json({ reply });
  },
};

import { z } from 'zod';
import { urlWeb } from '../lib/url.js';

/** Assistance Touma — schémas d'entrée. */

export const ticketCategories = ['ORDER', 'PAYMENT', 'DELIVERY', 'RETURN', 'ACCOUNT', 'STORE', 'VERIFICATION', 'OTHER'] as const;
export const ticketStatuses = ['OPEN', 'IN_PROGRESS', 'PENDING_USER', 'RESOLVED', 'CLOSED'] as const;
export const ticketPriorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

export const attachmentSchema = z.object({
  url: urlWeb(2000),
  name: z.string().trim().max(200).default('pièce jointe'),
  mimeType: z.string().trim().max(100).default('application/pdf'),
  sizeBytes: z.number().int().min(0).max(5 * 1024 * 1024).default(0),
});

export const createTicketSchema = z.object({
  subject: z.string().trim().min(5, 'Résumez votre demande en quelques mots.').max(200),
  category: z.enum(ticketCategories).default('OTHER'),
  message: z.string().trim().min(10, 'Décrivez votre problème.').max(5000),
  orderId: z.string().cuid().optional(),
  storeId: z.string().cuid().optional(),
  attachments: z.array(attachmentSchema).max(5).default([]),
});

export const listTicketsSchema = z.object({
  /** `mine` = mes tickets ; `all` = file d'assistance (administration). */
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z.enum(ticketStatuses).optional(),
  category: z.enum(ticketCategories).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const replySchema = z.object({
  body: z.string().trim().min(1).max(5000),
  /** Note interne : visible de la seule administration. */
  internal: z.boolean().default(false),
  attachments: z.array(attachmentSchema).max(5).default([]),
});

export const updateTicketSchema = z.object({
  status: z.enum(ticketStatuses).optional(),
  priority: z.enum(ticketPriorities).optional(),
  /** Affectation à un membre de l'équipe (identifiant utilisateur). */
  assignedToId: z.string().cuid().nullable().optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type ListTicketsQuery = z.infer<typeof listTicketsSchema>;
export type ReplyInput = z.infer<typeof replySchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

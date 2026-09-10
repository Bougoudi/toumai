import { z } from 'zod';

/** Mot de passe : longueur minimale sérieuse, pas de règle absurde. */
const password = z.string().min(10, 'Le mot de passe doit contenir au moins 10 caractères.').max(200);

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s-]{6,20}$/, 'Numéro de téléphone invalide.')
  .transform((v) => v.replace(/[\s-]/g, ''));

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password,
  phone: phone.optional(),
  /** ISO-3166-1 alpha-2 : le pays doit exister et être actif (table Country). */
  countryCode: z.string().trim().toUpperCase().length(2).optional(),
  /** Un compte peut naître acheteur ou vendeur ; ADMIN ne s'obtient jamais ainsi. */
  role: z.enum(['BUYER', 'SELLER']).default('BUYER'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(10).optional(),
  /** `true` = révoque toutes les sessions de l'utilisateur. */
  allDevices: z.boolean().optional(),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: phone.optional(),
  countryCode: z.string().trim().toUpperCase().length(2).optional(),
  locale: z.string().trim().min(2).max(10).optional(),
});

export const addressSchema = z.object({
  kind: z.enum(['SHIPPING', 'BILLING', 'PICKUP']).default('SHIPPING'),
  fullName: z.string().trim().min(2).max(120),
  phone,
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2).max(120),
  region: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  countryCode: z.string().trim().toUpperCase().length(2),
  isDefault: z.boolean().default(false),

  /**
   * Réalité des adresses d'Afrique centrale : beaucoup de lieux n'ont ni rue
   * nommée ni code postal. Le quartier et le point de repère sont souvent ce
   * qui permet réellement au livreur de trouver le destinataire.
   */
  district: z.string().trim().max(120).optional(),
  landmark: z.string().trim().max(200).optional(),
  instructions: z.string().trim().max(500).optional(),
  /** Coordonnées facultatives, jamais exposées publiquement. */
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AddressInput = z.infer<typeof addressSchema>;

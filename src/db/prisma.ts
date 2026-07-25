import { PrismaClient } from '@prisma/client';

/**
 * Instance Prisma partagée (singleton).
 * En développement, on la stocke sur `globalThis` pour éviter de multiplier
 * les connexions lors du hot-reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

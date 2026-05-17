import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

/**
 * Single PrismaClient instance per process. In dev with hot reload, this avoids
 * exhausting the connection pool. In production the global is set once at boot.
 */
export const prisma: PrismaClient =
  global.__prisma__ ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? ['warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma__ = prisma;
}

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

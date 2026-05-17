import type { FastifyInstance } from 'fastify';
import { ledgerTotalsByCurrency } from '@afristable/ledger';

export async function registerHealth(app: FastifyInstance) {
  app.get('/', async () => ({ status: 'ok' }));

  app.get('/ready', async () => {
    await app.container.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  });

  // Lightweight ledger sanity check. Not for high-frequency probing.
  app.get('/ledger', async () => {
    const totals = await ledgerTotalsByCurrency(app.container.prisma);
    const broken = totals.filter((t) => t.net !== '0');
    return { ok: broken.length === 0, broken, totals };
  });
}

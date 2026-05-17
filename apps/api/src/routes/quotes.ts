import type { FastifyInstance } from 'fastify';
import { CreateQuoteSchema } from '@afristable/shared';
import { requireUser } from '../middleware/auth.js';

export async function registerQuotes(app: FastifyInstance) {
  const { quotes } = app.container;

  app.post('/', { preHandler: requireUser }, async (req) => {
    const body = CreateQuoteSchema.parse(req.body);
    const quote = await quotes.create(req.auth!.userId, body);
    return quote;
  });
}

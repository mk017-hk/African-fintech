import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateTransferSchema,
  CreatePaymentRequestSchema,
  NotFound,
  ValidationError,
} from '@afristable/shared';
import { requireUser, deviceFingerprint } from '../middleware/auth.js';
import { consumeIdempotencyKey, storeIdempotentResponse } from '../middleware/idempotency.js';

export async function registerTransfers(app: FastifyInstance) {
  const { transfers, prisma } = app.container;

  app.post('/', { preHandler: requireUser }, async (req, reply) => {
    const idem = await consumeIdempotencyKey(req, reply);
    if (idem.alreadyAnswered) return;

    const body = CreateTransferSchema.parse(req.body);

    // Resolve destination → receiverId for internal P2P.
    if (body.destination.kind === 'phone') {
      const target = await prisma.user.findUnique({ where: { phoneE164: body.destination.phoneE164 } });
      if (!target) throw NotFound('No account for that phone number');
      const tx = await transfers.sendInternal({
        senderId: req.auth!.userId,
        receiverId: target.id,
        quoteId: body.quoteId,
        idempotencyKey: idem.key,
        note: body.note,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? undefined,
        deviceFingerprint: deviceFingerprint(req),
      });
      const resp = { transactionId: tx.id, status: tx.status };
      await storeIdempotentResponse(idem.key, 201, resp);
      return reply.code(201).send(resp);
    }
    if (body.destination.kind === 'user') {
      const tx = await transfers.sendInternal({
        senderId: req.auth!.userId,
        receiverId: body.destination.userId,
        quoteId: body.quoteId,
        idempotencyKey: idem.key,
        note: body.note,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? undefined,
        deviceFingerprint: deviceFingerprint(req),
      });
      const resp = { transactionId: tx.id, status: tx.status };
      await storeIdempotentResponse(idem.key, 201, resp);
      return reply.code(201).send(resp);
    }
    throw ValidationError('Use /v1/withdrawals for off-platform destinations');
  });

  app.post('/requests', { preHandler: requireUser }, async (req, reply) => {
    const body = CreatePaymentRequestSchema.parse(req.body);
    // Payment requests are unsigned but server-tracked; the payer later
    // creates a quote + transfer against the requested amount/currency.
    const expiresAt = new Date(Date.now() + body.expiresInSeconds * 1000);
    const t = await prisma.transaction.create({
      data: {
        type: 'PAYMENT_REQUEST',
        status: 'PENDING',
        receiverId: req.auth!.userId,
        amount: body.amount,
        currency: body.currency.toUpperCase(),
        metadata: { note: body.note, expiresAt: expiresAt.toISOString() },
      },
    });
    return reply.code(201).send({
      requestId: t.id,
      payUrl: `${app.container.env.WEB_PUBLIC_URL}/pay/${t.id}`,
      expiresAt,
    });
  });

  app.get('/:id', { preHandler: requireUser }, async (req) => {
    const { id } = req.params as { id: string };
    const tx = await prisma.transaction.findFirst({
      where: {
        id,
        OR: [{ senderId: req.auth!.userId }, { receiverId: req.auth!.userId }],
      },
    });
    if (!tx) throw NotFound('Transaction not found');
    return tx;
  });

  app.get('/', { preHandler: requireUser }, async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
    const txs = await prisma.transaction.findMany({
      where: {
        OR: [{ senderId: req.auth!.userId }, { receiverId: req.auth!.userId }],
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return { transactions: txs };
  });
}

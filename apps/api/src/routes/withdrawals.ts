import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PhoneE164Schema } from '@afristable/shared';
import { requireUser, deviceFingerprint } from '../middleware/auth.js';
import { consumeIdempotencyKey, storeIdempotentResponse } from '../middleware/idempotency.js';

const OnchainSchema = z.object({
  quoteId: z.string().min(1),
  network: z.enum(['ETHEREUM', 'POLYGON', 'BASE', 'SOLANA', 'STELLAR']),
  toAddress: z.string().min(8).max(128),
  memo: z.string().max(64).optional(),
});

const MobileMoneySchema = z.object({
  quoteId: z.string().min(1),
  provider: z.enum(['MPESA', 'MTN', 'ORANGE', 'AIRTEL']),
  msisdnE164: PhoneE164Schema,
});

const BankSchema = z.object({
  quoteId: z.string().min(1),
  partner: z.enum(['flutterwave', 'paystack', 'generic']),
  bankCode: z.string().min(2).max(16),
  accountNumber: z.string().min(4).max(34),
  accountName: z.string().min(1).max(140),
});

export async function registerWithdrawals(app: FastifyInstance) {
  const { withdrawals, chains } = app.container;

  app.post('/onchain', { preHandler: requireUser }, async (req, reply) => {
    const idem = await consumeIdempotencyKey(req, reply);
    if (idem.alreadyAnswered) return;
    const body = OnchainSchema.parse(req.body);

    // Reject invalid address shape early before quote/funds checks.
    const provider = chains.get(body.network);
    if (!provider.isValidAddress(body.toAddress)) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid address for network' } });
    }

    const tx = await withdrawals.withdrawOnchain({
      userId: req.auth!.userId,
      quoteId: body.quoteId,
      idempotencyKey: idem.key,
      network: body.network,
      toAddress: body.toAddress,
      memo: body.memo,
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? undefined,
      deviceFingerprint: deviceFingerprint(req),
    });
    const resp = { transactionId: tx.id, status: tx.status };
    await storeIdempotentResponse(idem.key, 201, resp);
    return reply.code(201).send(resp);
  });

  app.post('/mobile-money', { preHandler: requireUser }, async (req, reply) => {
    const idem = await consumeIdempotencyKey(req, reply);
    if (idem.alreadyAnswered) return;
    const body = MobileMoneySchema.parse(req.body);
    const tx = await withdrawals.withdrawMobileMoney({
      userId: req.auth!.userId,
      quoteId: body.quoteId,
      idempotencyKey: idem.key,
      provider: body.provider,
      msisdnE164: body.msisdnE164,
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? undefined,
      deviceFingerprint: deviceFingerprint(req),
    });
    const resp = { transactionId: tx.id, status: tx.status };
    await storeIdempotentResponse(idem.key, 201, resp);
    return reply.code(201).send(resp);
  });

  app.post('/bank', { preHandler: requireUser }, async (req, reply) => {
    const idem = await consumeIdempotencyKey(req, reply);
    if (idem.alreadyAnswered) return;
    const body = BankSchema.parse(req.body);
    const tx = await withdrawals.withdrawBank({
      userId: req.auth!.userId,
      quoteId: body.quoteId,
      idempotencyKey: idem.key,
      partner: body.partner,
      bankCode: body.bankCode,
      accountNumber: body.accountNumber,
      accountName: body.accountName,
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? undefined,
      deviceFingerprint: deviceFingerprint(req),
    });
    const resp = { transactionId: tx.id, status: tx.status };
    await storeIdempotentResponse(idem.key, 201, resp);
    return reply.code(201).send(resp);
  });
}

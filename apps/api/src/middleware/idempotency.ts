/**
 * Idempotency middleware.
 *
 * Every money-moving POST MUST send an `Idempotency-Key` header. The first
 * call with a given key is executed; subsequent calls with the same key
 * receive the cached response. Calls with the same key but a different
 * request body are rejected (409).
 *
 * Cache TTL: 24h. After that the row is GC'd; replay protection assumes the
 * client has long-since received the response.
 */
import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ValidationError, IdempotencyMismatch } from '@afristable/shared';
import { prisma } from '@afristable/database';

const TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyContext {
  key: string;
  /** Returns true if the request was a replay (response already sent). */
  alreadyAnswered: boolean;
}

export async function consumeIdempotencyKey(req: FastifyRequest, reply: FastifyReply): Promise<IdempotencyContext> {
  const key = req.headers['idempotency-key'];
  if (!key || typeof key !== 'string' || key.length < 8 || key.length > 128) {
    throw ValidationError('Idempotency-Key header required (8–128 chars)');
  }
  const requestHash = createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');

  const existing = await prisma.idempotencyKey.findUnique({ where: { key } });
  if (existing) {
    if (existing.requestHash !== requestHash) throw IdempotencyMismatch();
    if (existing.responseStatus && existing.responseBody) {
      reply.code(existing.responseStatus).send(existing.responseBody);
      return { key, alreadyAnswered: true };
    }
    return { key, alreadyAnswered: false };
  }

  await prisma.idempotencyKey.create({
    data: {
      key,
      userId: req.auth?.userId,
      endpoint: req.routeOptions.url ?? req.url,
      requestHash,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });
  return { key, alreadyAnswered: false };
}

export async function storeIdempotentResponse(key: string, status: number, body: unknown) {
  await prisma.idempotencyKey.update({
    where: { key },
    data: { responseStatus: status, responseBody: body as object },
  });
}

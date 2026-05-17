/**
 * Webhook intake.
 *
 * Every provider posts here. We:
 *   1. Read the raw body (signature is over raw bytes).
 *   2. Verify the provider-specific signature.
 *   3. Dedupe via SHA-256(provider + eventId).
 *   4. Store in `webhook_events` with status RECEIVED, then enqueue for
 *      processing. Never run the business logic inline; that's the worker's
 *      job. Fast ACKs prevent provider retries blowing up our DB.
 */
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';

export async function registerWebhooks(app: FastifyInstance) {
  const { prisma, payouts } = app.container;

  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  app.post('/:provider', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const raw = req.body as Buffer;
    const sig =
      (req.headers['x-webhook-signature'] as string) ??
      (req.headers['verif-hash'] as string) ?? // Flutterwave
      (req.headers['x-paystack-signature'] as string) ?? // Paystack
      '';

    let provInstance;
    try {
      provInstance = payouts.get(provider);
    } catch {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Unknown provider' } });
    }

    if (!provInstance.verifyWebhookSignature(raw.toString('utf8'), sig)) {
      return reply.code(401).send({ error: { code: 'AUTH_INVALID', message: 'Bad signature' } });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } });
    }

    const eventId = (parsed as { id?: string; event_id?: string }).id
      ?? (parsed as { event_id?: string }).event_id
      ?? createHash('sha256').update(raw).digest('hex');
    const dedupeKey = createHash('sha256').update(`${provider}:${eventId}`).digest('hex');

    try {
      await prisma.webhookEvent.create({
        data: {
          direction: 'INBOUND',
          provider,
          eventType: (parsed as { type?: string; event?: string }).type
            ?? (parsed as { event?: string }).event
            ?? 'unknown',
          signature: sig,
          payload: parsed as object,
          dedupeKey,
        },
      });
    } catch (err) {
      // Duplicate eventId — already received, just ACK.
      if ((err as { code?: string }).code === 'P2002') {
        return reply.code(200).send({ ok: true, deduped: true });
      }
      throw err;
    }
    // Acknowledge immediately. Worker will pick it up and run the business logic.
    return reply.code(200).send({ ok: true });
  });
}

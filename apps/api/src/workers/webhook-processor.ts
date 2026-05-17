/**
 * Webhook processor.
 *
 * Picks RECEIVED webhook rows and resolves them to terminal transaction
 * states. Each provider has its own mapping function. We MUST tolerate
 * out-of-order / duplicate events from rails — the ledger posting itself
 * is idempotent (transferId), and we only credit funds once.
 */
import type { Worker, ConnectionOptions } from 'bullmq';
import type { Container } from '../container.js';

const POLL_MS = 1500;

export async function runWebhookProcessor(container: Container, _connection: ConnectionOptions) {
  void _connection;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await container.prisma.webhookEvent.findMany({
      where: { status: 'RECEIVED' },
      orderBy: { receivedAt: 'asc' },
      take: 50,
    });
    for (const evt of batch) {
      try {
        await handle(container, evt);
        await container.prisma.webhookEvent.update({
          where: { id: evt.id },
          data: { status: 'PROCESSED', processedAt: new Date() },
        });
      } catch (err) {
        await container.prisma.webhookEvent.update({
          where: { id: evt.id },
          data: { status: 'FAILED', error: (err as Error).message },
        });
      }
    }
    if (batch.length === 0) await sleep(POLL_MS);
  }
}

async function handle(container: Container, evt: { id: string; provider: string; payload: unknown }) {
  // Each provider has its own event shape. Below is the pattern; flesh out
  // per-provider mapping when wiring real adapters.
  const p = container.payouts.get(evt.provider);
  void p;
  const ref = (evt.payload as { reference?: string }).reference;
  if (!ref) return;
  const txn = await container.prisma.transaction.findUnique({ where: { id: ref } });
  if (!txn) return;
  const status = (evt.payload as { status?: string }).status?.toUpperCase();
  if (status === 'COMPLETED' || status === 'SUCCESS' || status === 'CONFIRMED') {
    await container.prisma.transaction.update({ where: { id: txn.id }, data: { status: 'COMPLETED' } });
  } else if (status === 'FAILED' || status === 'REJECTED') {
    await container.prisma.transaction.update({
      where: { id: txn.id }, data: { status: 'FAILED', failureReason: (evt.payload as { reason?: string }).reason ?? 'provider failure' },
    });
    // TODO: ledger reversal posting (debit EXT_RAIL, credit user wallet) — owns its own outbox topic.
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

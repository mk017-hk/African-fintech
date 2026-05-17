/**
 * Outbox → BullMQ dispatcher.
 *
 * Reads unpublished rows from `outbox_messages`, enqueues them onto the
 * topic-specific queue, and marks them published. Uses SELECT … FOR UPDATE
 * SKIP LOCKED so multiple worker instances can run safely.
 */
import { Queue, type ConnectionOptions } from 'bullmq';
import type { Container } from '../container.js';

const BATCH = 100;
const POLL_MS = 1000;

export async function runOutboxDispatcher(container: Container, connection: ConnectionOptions) {
  const queues = new Map<string, Queue>();
  const getQueue = (topic: string) => {
    let q = queues.get(topic);
    if (!q) {
      q = new Queue(topic, { connection });
      queues.set(topic, q);
    }
    return q;
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await container.prisma.$queryRawUnsafe<Array<{
      id: string; topic: string; payload: unknown;
    }>>(
      `SELECT id, topic, payload
         FROM "OutboxMessage"
        WHERE "publishedAt" IS NULL
        ORDER BY "createdAt"
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED`,
    );
    if (rows.length === 0) {
      await sleep(POLL_MS);
      continue;
    }
    for (const row of rows) {
      try {
        await getQueue(row.topic).add('msg', row.payload, {
          jobId: row.id, // de-dupe
          removeOnComplete: 1000,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
        });
        await container.prisma.outboxMessage.update({
          where: { id: row.id },
          data: { publishedAt: new Date() },
        });
      } catch (err) {
        await container.prisma.outboxMessage.update({
          where: { id: row.id },
          data: { attempts: { increment: 1 }, lastError: (err as Error).message },
        });
      }
    }
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

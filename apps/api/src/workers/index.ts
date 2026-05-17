/**
 * Worker entrypoint.
 *
 * Workers consume BullMQ queues fed by the outbox processor. Each worker is
 * single-purpose and idempotent. In production, run them as separate
 * containers so noisy neighbours can't starve money-critical workers.
 */
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '@afristable/config';
import { buildContainer } from '../container.js';
import { runOutboxDispatcher } from './outbox-dispatcher.js';
import { runChainIndexer }     from './chain-indexer.js';
import { runWebhookProcessor } from './webhook-processor.js';
import { runPayoutDispatcher } from './payout-dispatcher.js';

async function main() {
  const e = env();
  const connection: ConnectionOptions = new IORedis(e.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  const container = buildContainer();

  const log = (msg: string) => console.log(`[worker] ${msg}`);

  // The outbox dispatcher is the single producer that turns DB outbox rows
  // into BullMQ jobs. All other workers consume queues.
  void runOutboxDispatcher(container, connection).catch((err) => console.error('outbox', err));
  void runWebhookProcessor(container, connection).catch((err) => console.error('webhook', err));
  void runChainIndexer(container).catch((err) => console.error('chain', err));
  void runPayoutDispatcher(container, connection).catch((err) => console.error('payout', err));

  log('workers up');

  // Demo: confirm we can connect.
  const q = new Queue('demo', { connection });
  await q.add('ping', { at: new Date().toISOString() }, { removeOnComplete: true });
  new Worker('demo', async (job) => log(`demo job ${job.id} ok`), { connection });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

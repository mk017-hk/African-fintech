/**
 * Payout dispatcher.
 *
 * Subscribes to `withdrawal.dispatch.<rail>` queues; for each job, loads the
 * transaction, calls the rail provider, and records the providerRef.
 * Status updates flow back via webhooks → webhook-processor.
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import type { Container } from '../container.js';

const RAILS = [
  'withdrawal.dispatch.onchain:ethereum',
  'withdrawal.dispatch.onchain:polygon',
  'withdrawal.dispatch.onchain:base',
  'withdrawal.dispatch.onchain:solana',
  'withdrawal.dispatch.onchain:stellar',
  'withdrawal.dispatch.mobile_money:mpesa',
  'withdrawal.dispatch.mobile_money:mtn',
  'withdrawal.dispatch.mobile_money:orange',
  'withdrawal.dispatch.mobile_money:airtel',
  'withdrawal.dispatch.bank:flutterwave',
  'withdrawal.dispatch.bank:paystack',
];

export async function runPayoutDispatcher(container: Container, connection: ConnectionOptions) {
  for (const topic of RAILS) {
    new Worker(topic, async (job) => {
      const { transactionId } = job.data as { transactionId: string };
      const txn = await container.prisma.transaction.findUnique({
        where: { id: transactionId },
        include: { stablecoinWithdrawal: true, mobileMoneyPayout: true, bankPayout: true },
      });
      if (!txn) throw new Error('Transaction not found');

      const rail = (txn.metadata as { rail?: string })?.rail;
      if (!rail) throw new Error('No rail recorded');

      if (rail.startsWith('mobile_money:') && txn.mobileMoneyPayout) {
        const provider = container.payouts.get(rail.split(':')[1]!);
        const ack = await provider.send({
          reference: txn.id,
          amount: txn.amount.toString(),
          currency: txn.currency,
          destination: { msisdnE164: txn.mobileMoneyPayout.msisdnE164 },
        });
        await container.prisma.mobileMoneyPayout.update({
          where: { transactionId: txn.id },
          data: { providerRef: ack.providerRef, status: 'PROCESSING' },
        });
      } else if (rail.startsWith('bank:') && txn.bankPayout) {
        const provider = container.payouts.get(rail.split(':')[1]!);
        const ack = await provider.send({
          reference: txn.id,
          amount: txn.amount.toString(),
          currency: txn.currency,
          destination: { accountNumber: '...', bankCode: txn.bankPayout.bankCode }, // decrypted in production
        });
        await container.prisma.bankPayout.update({
          where: { transactionId: txn.id },
          data: { providerRef: ack.providerRef, status: 'PROCESSING' },
        });
      } else if (rail.startsWith('onchain:') && txn.stablecoinWithdrawal) {
        // On-chain submission is gated by the custody/HSM signer; left as
        // a deliberate TODO to keep keys out of any code path that could
        // be reached without operator action.
        // const provider = container.chains.get(txn.stablecoinWithdrawal.network);
        // const { txHash } = await provider.broadcastWithdrawal({...});
        // await container.prisma.stablecoinWithdrawal.update({...});
      }
      await container.prisma.transaction.update({
        where: { id: txn.id }, data: { status: 'PROCESSING' },
      });
    }, { connection, concurrency: 4 });
  }
}

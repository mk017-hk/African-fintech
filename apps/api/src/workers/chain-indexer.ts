/**
 * Chain indexer.
 *
 * Polls each registered blockchain provider for inbound transfers to our
 * custodial deposit addresses. New deposits are written to
 * `stablecoin_deposits` with status DETECTED and confirmation counts
 * incremented on subsequent passes. Once confirmed, the ledger credits the
 * user wallet (CREDIT user_wallet[USDC] / DEBIT EXT_RAIL_USDC).
 *
 * In production this is augmented by webhook-style providers (Alchemy
 * Webhooks, Helius, etc.) for low-latency detection.
 */
import type { Container } from '../container.js';
import { randomToken } from '@afristable/shared';
import { credit, debit } from '@afristable/ledger';
import { Money } from '@afristable/shared';

const POLL_MS = 15_000;

export async function runChainIndexer(container: Container) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick(container);
    } catch (err) {
      console.error('[chain-indexer]', err);
    }
    await sleep(POLL_MS);
  }
}

async function tick(container: Container) {
  // Walk pending deposits and bump confirmations / finalise.
  const pending = await container.prisma.stablecoinDeposit.findMany({
    where: { status: { in: ['DETECTED', 'CONFIRMING'] } },
    take: 100,
  });
  for (const dep of pending) {
    const provider = container.chains.get(dep.network);
    const confirmations = await provider.getConfirmations(dep.txHash).catch(() => dep.confirmations);
    if (confirmations < dep.requiredConfirmations) {
      await container.prisma.stablecoinDeposit.update({
        where: { id: dep.id },
        data: { confirmations, status: confirmations > 0 ? 'CONFIRMING' : 'DETECTED' },
      });
      continue;
    }
    // Confirmed — credit the user.
    await container.prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.findUnique({ where: { id: dep.transactionId } });
      if (!txn || txn.receiverId == null) return;
      const wallet = await tx.wallet.findUnique({
        where: { userId_currency_type: { userId: txn.receiverId, currency: dep.asset, type: 'STABLECOIN' } },
      });
      if (!wallet) return;
      const ext = await tx.ledgerAccount.findFirst({ where: { kind: 'EXTERNAL_RAIL', currency: dep.asset } });
      if (!ext) return;
      const amount = Money.of(dep.amount.toString(), dep.asset);
      await container.ledger.post({
        transferId: randomToken(16),
        transactionId: txn.id,
        memo: 'onchain:deposit',
        legs: [
          credit(wallet.ledgerAccountId, amount, 'deposit'),
          debit (ext.id,                 amount, 'deposit'),
        ],
      }, tx);
      await tx.stablecoinDeposit.update({
        where: { id: dep.id },
        data: { status: 'CREDITED', confirmations, creditedAt: new Date() },
      });
      await tx.transaction.update({ where: { id: txn.id }, data: { status: 'COMPLETED' } });
    });
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

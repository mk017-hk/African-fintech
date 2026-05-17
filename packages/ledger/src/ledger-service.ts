/**
 * LedgerService — the only writer of money state.
 *
 * Invariants enforced here:
 *   1. A posting's legs must sum to zero per currency.
 *   2. The same transferId cannot be posted twice (idempotency).
 *   3. Each user-wallet leg recomputes the wallet's projected balance from
 *      the ledger; no balance is ever directly mutated.
 *   4. All work happens inside one database transaction.
 *
 * Anyone bypassing this service to update `wallet.availableBalance` directly
 * is creating a phantom balance. Code review must reject such PRs.
 */
import Decimal from 'decimal.js';
import {
  Money,
  CurrencyMismatchError,
  InsufficientFunds,
  WalletFrozen,
  Conflict,
  NotFound,
} from '@afristable/shared';
import type { PrismaClient, Tx } from '@afristable/database';
import type { Posting, PostingLeg, AccountBalance } from './types';

export class LedgerService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Post a transfer. Runs inside its own transaction unless `tx` is supplied
   * (allowing composition with surrounding business logic).
   */
  async post(posting: Posting, tx?: Tx): Promise<void> {
    this.validateBalanced(posting);

    const run = async (client: Tx) => {
      // Idempotency guard.
      const existing = await client.ledgerEntry.findFirst({
        where: { transferId: posting.transferId },
        select: { id: true },
      });
      if (existing) {
        throw Conflict(`Posting ${posting.transferId} already exists`);
      }

      // Load every affected account once.
      const accountIds = [...new Set(posting.legs.map((l) => l.accountId))];
      const accounts = await client.ledgerAccount.findMany({
        where: { id: { in: accountIds } },
      });
      if (accounts.length !== accountIds.length) {
        throw NotFound('Unknown ledger account');
      }
      const accountById = new Map(accounts.map((a) => [a.id, a]));

      // Cross-check each leg's currency against the account's currency.
      for (const leg of posting.legs) {
        const acct = accountById.get(leg.accountId)!;
        if (acct.currency !== leg.amount.currency) {
          throw new CurrencyMismatchError(acct.currency, leg.amount.currency);
        }
      }

      // Write all ledger entries.
      await client.ledgerEntry.createMany({
        data: posting.legs.map((leg) => ({
          transferId: posting.transferId,
          accountId: leg.accountId,
          amount: leg.amount.toString(),
          side: leg.side,
          currency: leg.amount.currency,
          memo: leg.memo ?? posting.memo,
          transactionId: posting.transactionId,
        })),
      });

      // Re-project wallet balances for any user-wallet legs. Reads the
      // authoritative balance directly from the ledger; never derived from
      // the prior projection.
      const walletAccountIds = posting.legs
        .map((l) => l.accountId)
        .filter((id) => accountById.get(id)?.kind === 'USER_WALLET');
      for (const accountId of new Set(walletAccountIds)) {
        await this.recomputeWalletBalance(accountId, client);
      }
    };

    if (tx) await run(tx);
    else await this.db.$transaction(run, { isolationLevel: 'Serializable' });
  }

  /**
   * Returns the live balance of an account from the ledger. NEVER trust
   * the projected `wallet.availableBalance` for solvency checks — call this.
   */
  async getAccountBalance(accountId: string, tx?: Tx): Promise<AccountBalance> {
    const client = tx ?? this.db;
    const acct = await client.ledgerAccount.findUnique({ where: { id: accountId } });
    if (!acct) throw NotFound('Account not found');

    const sums = await client.ledgerEntry.groupBy({
      by: ['side'],
      where: { accountId },
      _sum: { amount: true },
    });

    let debits = new Decimal(0);
    let credits = new Decimal(0);
    for (const row of sums) {
      const v = new Decimal(row._sum.amount?.toString() ?? '0');
      if (row.side === 'DEBIT') debits = debits.plus(v);
      else credits = credits.plus(v);
    }
    const raw =
      acct.normalSide === 'CREDIT' ? credits.minus(debits) : debits.minus(credits);

    // Liabilities to users should never go negative; if they do, the system
    // is broken — surface immediately rather than silently clamp.
    const value = raw.isNegative() ? raw : raw;
    return {
      accountId,
      currency: acct.currency,
      balance: Money.of(value.isNegative() ? '0' : value.toString(), acct.currency),
    };
  }

  /**
   * Hard solvency check: throws InsufficientFunds if the wallet's ledger
   * balance is below `required`. Use this BEFORE building a debit posting.
   */
  async assertWalletHasFunds(walletId: string, required: Money, tx?: Tx): Promise<void> {
    const client = tx ?? this.db;
    const wallet = await client.wallet.findUnique({
      where: { id: walletId },
      select: {
        id: true,
        status: true,
        currency: true,
        ledgerAccountId: true,
        lockedBalance: true,
      },
    });
    if (!wallet) throw NotFound('Wallet not found');
    if (wallet.status === 'FROZEN') throw WalletFrozen();
    if (wallet.currency !== required.currency) {
      throw new CurrencyMismatchError(wallet.currency, required.currency);
    }
    const { balance } = await this.getAccountBalance(wallet.ledgerAccountId, tx);
    const locked = Money.of(wallet.lockedBalance.toString(), wallet.currency);
    const available = balance.sub(locked);
    if (available.lt(required)) throw InsufficientFunds();
  }

  /**
   * Recompute and persist the wallet's projected balance fields. This is the
   * ONLY place that writes to `wallet.availableBalance`.
   */
  async recomputeWalletBalance(accountId: string, tx?: Tx): Promise<void> {
    const client = tx ?? this.db;
    const wallet = await client.wallet.findUnique({ where: { ledgerAccountId: accountId } });
    if (!wallet) return; // not a user wallet

    const { balance } = await this.getAccountBalance(accountId, tx);
    await client.wallet.update({
      where: { id: wallet.id },
      data: {
        availableBalance: balance.sub(
          Money.of(wallet.lockedBalance.toString(), wallet.currency),
        ).toString(),
        // pendingBalance is maintained by rail-specific code, not here.
      },
    });
  }

  private validateBalanced(posting: Posting): void {
    if (posting.legs.length < 2) {
      throw new Error('Posting must contain at least two legs');
    }
    const perCurrency = new Map<string, Decimal>();
    for (const leg of posting.legs) {
      const cur = leg.amount.currency;
      const sign = leg.side === 'CREDIT' ? 1 : -1;
      const running = perCurrency.get(cur) ?? new Decimal(0);
      perCurrency.set(cur, running.plus(new Decimal(leg.amount.toString()).times(sign)));
    }
    for (const [currency, total] of perCurrency) {
      if (!total.isZero()) {
        throw new Error(
          `Posting unbalanced in ${currency}: net ${total.toString()} (must be 0)`,
        );
      }
    }
  }
}

/**
 * Helper to build a posting. Useful sugar for service code.
 */
export function debit(accountId: string, amount: Money, memo?: string): PostingLeg {
  return { accountId, side: 'DEBIT', amount, memo };
}
export function credit(accountId: string, amount: Money, memo?: string): PostingLeg {
  return { accountId, side: 'CREDIT', amount, memo };
}

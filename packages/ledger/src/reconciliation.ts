/**
 * Reconciliation helpers.
 *
 *   - `assertBooksBalance` recomputes ΣCREDIT − ΣDEBIT per currency over the
 *     entire ledger. The system is solvent iff this is zero for every
 *     currency, given that user wallets (liabilities) net against
 *     SYSTEM_LIQUIDITY / EXTERNAL_RAIL assets.
 *   - `walletProjectionDrift` lists wallets whose cached balance disagrees
 *     with the ledger. Run nightly as a heal-and-alert job.
 */
import Decimal from 'decimal.js';
import type { PrismaClient } from '@afristable/database';

export interface BalanceCheck {
  currency: string;
  totalCredits: string;
  totalDebits: string;
  net: string; // should be "0" in healthy state
}

export async function ledgerTotalsByCurrency(db: PrismaClient): Promise<BalanceCheck[]> {
  const rows = await db.ledgerEntry.groupBy({
    by: ['currency', 'side'],
    _sum: { amount: true },
  });
  const map = new Map<string, { credit: Decimal; debit: Decimal }>();
  for (const row of rows) {
    const entry = map.get(row.currency) ?? { credit: new Decimal(0), debit: new Decimal(0) };
    const v = new Decimal(row._sum.amount?.toString() ?? '0');
    if (row.side === 'CREDIT') entry.credit = entry.credit.plus(v);
    else                       entry.debit  = entry.debit.plus(v);
    map.set(row.currency, entry);
  }
  return [...map.entries()].map(([currency, { credit, debit }]) => ({
    currency,
    totalCredits: credit.toString(),
    totalDebits: debit.toString(),
    net: credit.minus(debit).toString(),
  }));
}

export async function assertBooksBalance(db: PrismaClient): Promise<void> {
  const totals = await ledgerTotalsByCurrency(db);
  const broken = totals.filter((t) => !new Decimal(t.net).isZero());
  if (broken.length) {
    throw new Error(
      'LEDGER OUT OF BALANCE — halt money movements immediately:\n' +
        broken.map((b) => `  ${b.currency}: net=${b.net}`).join('\n'),
    );
  }
}

export interface WalletDrift {
  walletId: string;
  userId: string;
  currency: string;
  cachedAvailable: string;
  ledgerAvailable: string;
  delta: string;
}

export async function walletProjectionDrift(db: PrismaClient): Promise<WalletDrift[]> {
  const wallets = await db.wallet.findMany({
    select: {
      id: true,
      userId: true,
      currency: true,
      availableBalance: true,
      lockedBalance: true,
      ledgerAccount: {
        select: { id: true, normalSide: true },
      },
    },
  });

  const drift: WalletDrift[] = [];
  for (const w of wallets) {
    const sums = await db.ledgerEntry.groupBy({
      by: ['side'],
      where: { accountId: w.ledgerAccount.id },
      _sum: { amount: true },
    });
    let credits = new Decimal(0), debits = new Decimal(0);
    for (const r of sums) {
      const v = new Decimal(r._sum.amount?.toString() ?? '0');
      if (r.side === 'CREDIT') credits = credits.plus(v); else debits = debits.plus(v);
    }
    const raw = w.ledgerAccount.normalSide === 'CREDIT'
      ? credits.minus(debits)
      : debits.minus(credits);
    const ledgerAvail = raw.minus(new Decimal(w.lockedBalance.toString()));
    const cached = new Decimal(w.availableBalance.toString());
    const delta = cached.minus(ledgerAvail);
    if (!delta.isZero()) {
      drift.push({
        walletId: w.id,
        userId: w.userId,
        currency: w.currency,
        cachedAvailable: cached.toString(),
        ledgerAvailable: ledgerAvail.toString(),
        delta: delta.toString(),
      });
    }
  }
  return drift;
}

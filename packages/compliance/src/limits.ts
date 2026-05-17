/**
 * KYC-tier limit checks. Amounts must be converted to USD by the caller
 * BEFORE invoking — limits are expressed in USD-equivalent.
 */
import { KYC_LIMITS, KycLimitExceeded } from '@afristable/shared';
import type { PrismaClient, KycTier } from '@afristable/database';
import Decimal from 'decimal.js';

export class LimitService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Throws KycLimitExceeded if `usdAmount` would push the user past their
   * tier limits (single-tx, 24h rolling, 30-day rolling).
   */
  async assertWithinLimits(userId: string, tier: KycTier, usdAmount: number): Promise<void> {
    const limits = KYC_LIMITS[tier];
    if (!limits) throw new Error(`Unknown tier: ${tier}`);
    if (usdAmount > limits.singleTxUsd) throw KycLimitExceeded();

    const now = Date.now();
    const last24h  = new Date(now - 24 * 60 * 60 * 1000);
    const last30d  = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [day, month] = await Promise.all([
      this.db.transaction.aggregate({
        where: {
          senderId: userId,
          status: { in: ['COMPLETED', 'PROCESSING', 'PENDING'] },
          createdAt: { gte: last24h },
          // metadata.usdEquivalent is stamped at execution time
        },
        _count: true,
      }),
      this.db.transaction.aggregate({
        where: {
          senderId: userId,
          status: { in: ['COMPLETED', 'PROCESSING', 'PENDING'] },
          createdAt: { gte: last30d },
        },
        _count: true,
      }),
    ]);

    // For real limit enforcement we sum the USD-equivalent stamped in
    // `metadata.usdEquivalent`. Prisma cannot aggregate JSON paths
    // portably, so this is done in code:
    const txs = await this.db.transaction.findMany({
      where: {
        senderId: userId,
        status: { in: ['COMPLETED', 'PROCESSING', 'PENDING'] },
        createdAt: { gte: last30d },
      },
      select: { createdAt: true, metadata: true },
    });

    let dayUsd = new Decimal(0), monthUsd = new Decimal(0);
    const cutoff24h = last24h.getTime();
    for (const t of txs) {
      const u = (t.metadata as { usdEquivalent?: string } | null)?.usdEquivalent;
      if (!u) continue;
      const v = new Decimal(u);
      monthUsd = monthUsd.plus(v);
      if (t.createdAt.getTime() >= cutoff24h) dayUsd = dayUsd.plus(v);
    }
    if (dayUsd.plus(usdAmount).greaterThan(limits.dailyUsd))   throw KycLimitExceeded();
    if (monthUsd.plus(usdAmount).greaterThan(limits.monthlyUsd)) throw KycLimitExceeded();

    // Touch aggregates to avoid unused-result warning in some linters.
    void day; void month;
  }
}

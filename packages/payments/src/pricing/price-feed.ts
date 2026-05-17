/**
 * PriceFeed — base→quote spot rate. Cache for QUOTE_TTL_SECONDS at most.
 * Production: subscribe to a real feed (Coingecko Pro, Chainlink, Pyth).
 * Dev: returns the last seeded ExchangeRate row.
 */
import Decimal from 'decimal.js';
import type { PrismaClient } from '@afristable/database';

export interface PriceFeed {
  /** Returns the current spot rate (1 base = N quote). */
  getRate(base: string, quote: string): Promise<Decimal>;
}

export class DatabasePriceFeed implements PriceFeed {
  constructor(private readonly db: PrismaClient) {}

  async getRate(base: string, quote: string): Promise<Decimal> {
    const B = base.toUpperCase();
    const Q = quote.toUpperCase();
    if (B === Q) return new Decimal(1);

    const direct = await this.directOrInverse(B, Q);
    if (direct) return direct;

    // Cross via USD.
    if (B !== 'USD' && Q !== 'USD') {
      const baseUsd = await this.directOrInverse(B, 'USD');
      const usdQuote = await this.directOrInverse('USD', Q);
      if (baseUsd && usdQuote) return baseUsd.times(usdQuote);
    }
    throw new Error(`No price for ${B}/${Q}`);
  }

  private async directOrInverse(base: string, quote: string): Promise<Decimal | null> {
    const direct = await this.fetchLatest(base, quote);
    if (direct) return direct;
    const inverse = await this.fetchLatest(quote, base);
    if (inverse) return new Decimal(1).dividedBy(inverse);
    return null;
  }

  private async fetchLatest(base: string, quote: string): Promise<Decimal | null> {
    const row = await this.db.exchangeRate.findFirst({
      where: { base, quote },
      orderBy: { fetchedAt: 'desc' },
    });
    return row ? new Decimal(row.rate.toString()) : null;
  }
}

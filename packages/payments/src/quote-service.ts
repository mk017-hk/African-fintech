/**
 * QuoteService.
 *
 *   - Server is the single source of truth for amounts, rates, and fees.
 *   - Quotes are signed (HMAC-SHA256 over a canonical payload) and time-boxed.
 *   - Quotes are single-use: transitioning to CONSUMED is part of the same
 *     DB transaction as the transfer that uses them.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import Decimal from 'decimal.js';
import {
  Money,
  type CreateQuoteDTO,
  type QuoteResponse,
  type QuoteRail,
  QuoteExpired,
  QuoteAlreadyConsumed,
  QuoteInvalidSignature,
  NotFound,
} from '@afristable/shared';
import { env } from '@afristable/config';
import type { PrismaClient, Tx } from '@afristable/database';
import { computePricing } from './pricing/fee-policy';
import type { PriceFeed } from './pricing/price-feed';

export class QuoteService {
  constructor(
    private readonly db: PrismaClient,
    private readonly prices: PriceFeed,
  ) {}

  async create(userId: string, input: CreateQuoteDTO): Promise<QuoteResponse> {
    const { fromCurrency, toCurrency, rail } = input;
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { countryCode: true },
    });
    if (!user) throw NotFound('User not found');

    const spot = await this.prices.getRate(fromCurrency, toCurrency);
    const usdFromRate = await this.prices.getRate('USD', fromCurrency); // for fee math

    // Resolve fromAmount given either input side.
    let fromAmount: Decimal;
    if (input.fromAmount) fromAmount = new Decimal(input.fromAmount);
    else                  fromAmount = new Decimal(input.toAmount!).dividedBy(spot);

    const pricing = computePricing({
      fromCurrency, toCurrency, rail,
      countryCode: user.countryCode,
      fromAmount: fromAmount.toString(),
    }, usdFromRate);

    // Apply spread to the rate. Spread is taken on the user's worse side, so
    // they receive slightly less in `toCurrency`.
    const effectiveRate = spot.times(new Decimal(10_000).minus(pricing.spreadBps)).dividedBy(10_000);
    const fromAfterFee = fromAmount.minus(new Decimal(pricing.feeAmount));
    if (fromAfterFee.isNegative()) {
      throw new Error('Amount is smaller than the fee — increase the amount');
    }
    const toAmount = fromAfterFee.times(effectiveRate);

    const expiresAt = new Date(Date.now() + env().QUOTE_TTL_SECONDS * 1000);
    const quote = await this.db.paymentQuote.create({
      data: {
        userId,
        fromCurrency, toCurrency,
        fromAmount: fromAmount.toString(),
        toAmount: toAmount.toString(),
        rate: effectiveRate.toString(),
        spreadBps: pricing.spreadBps,
        feeAmount: pricing.feeAmount,
        feeCurrency: fromCurrency,
        slippageBps: 50,
        rail,
        signature: '', // filled below after id is known
        expiresAt,
      },
    });

    const signature = this.sign(quote.id, {
      userId, fromCurrency, toCurrency,
      fromAmount: fromAmount.toString(),
      toAmount: toAmount.toString(),
      rate: effectiveRate.toString(),
      spreadBps: pricing.spreadBps,
      feeAmount: pricing.feeAmount,
      feeCurrency: fromCurrency,
      rail,
      expiresAt: expiresAt.toISOString(),
    });
    await this.db.paymentQuote.update({ where: { id: quote.id }, data: { signature } });

    return {
      id: quote.id,
      fromCurrency, toCurrency,
      fromAmount: fromAmount.toString(),
      toAmount: toAmount.toString(),
      rate: effectiveRate.toString(),
      spreadBps: pricing.spreadBps,
      feeAmount: pricing.feeAmount,
      feeCurrency: fromCurrency,
      slippageBps: 50,
      rail,
      signature,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Loads and validates a quote: signature OK, not expired, not consumed.
   * Caller must run inside the same DB transaction as the money movement
   * and pass `tx` so the row lock + status update are atomic.
   */
  async consume(quoteId: string, userId: string, tx: Tx) {
    const quote = await tx.paymentQuote.findUnique({ where: { id: quoteId } });
    if (!quote || quote.userId !== userId) throw NotFound('Quote not found');
    if (quote.status === 'CONSUMED' || quote.status === 'CANCELLED') throw QuoteAlreadyConsumed();
    if (quote.expiresAt.getTime() < Date.now()) {
      if (quote.status === 'ACTIVE') {
        await tx.paymentQuote.update({ where: { id: quote.id }, data: { status: 'EXPIRED' } });
      }
      throw QuoteExpired();
    }
    const expectedSig = this.sign(quote.id, {
      userId: quote.userId,
      fromCurrency: quote.fromCurrency, toCurrency: quote.toCurrency,
      fromAmount: quote.fromAmount.toString(),
      toAmount:   quote.toAmount.toString(),
      rate:       quote.rate.toString(),
      spreadBps:  quote.spreadBps,
      feeAmount:  quote.feeAmount.toString(),
      feeCurrency: quote.feeCurrency,
      rail: quote.rail as QuoteRail,
      expiresAt: quote.expiresAt.toISOString(),
    });
    const a = Buffer.from(expectedSig, 'hex');
    const b = Buffer.from(quote.signature, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw QuoteInvalidSignature();

    await tx.paymentQuote.update({
      where: { id: quote.id },
      data:  { status: 'CONSUMED', consumedAt: new Date() },
    });

    return {
      ...quote,
      fromAmountMoney: Money.of(quote.fromAmount.toString(), quote.fromCurrency),
      toAmountMoney:   Money.of(quote.toAmount.toString(),   quote.toCurrency),
      feeAmountMoney:  Money.of(quote.feeAmount.toString(),  quote.feeCurrency),
    };
  }

  private sign(quoteId: string, payload: Record<string, unknown>): string {
    const canonical =
      `${quoteId}|` +
      Object.keys(payload).sort().map((k) => `${k}=${payload[k]}`).join('|');
    return createHmac('sha256', env().QUOTE_SIGNING_KEY).update(canonical).digest('hex');
  }
}

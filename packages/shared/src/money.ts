/**
 * Money math.
 *
 * RULES:
 *   1. Never use the IEEE-754 `number` type for amounts. Use `Money`.
 *   2. Construct via `Money.of(value, currency)` — the constructor validates.
 *   3. Operations are immutable and currency-checked.
 *   4. Serialise as `{ amount: string, currency: string }` over the wire.
 */
import Decimal from 'decimal.js';

Decimal.set({ precision: 50, rounding: Decimal.ROUND_HALF_EVEN });

export type CurrencyCode = string; // ISO-4217 or stablecoin symbol

export interface MoneyJSON {
  amount: string;
  currency: CurrencyCode;
}

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Currency mismatch: ${a} vs ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

export class NegativeAmountError extends Error {
  constructor(amount: string) {
    super(`Amount cannot be negative: ${amount}`);
    this.name = 'NegativeAmountError';
  }
}

export class Money {
  readonly value: Decimal;
  readonly currency: CurrencyCode;

  private constructor(value: Decimal, currency: CurrencyCode) {
    this.value = value;
    this.currency = currency;
  }

  /** Construct from a numeric-ish input. Rejects negatives. */
  static of(amount: string | number | Decimal, currency: CurrencyCode): Money {
    const v = new Decimal(amount);
    if (v.isNegative()) throw new NegativeAmountError(v.toString());
    if (!currency || typeof currency !== 'string') {
      throw new Error('Currency required');
    }
    return new Money(v, currency.toUpperCase());
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(new Decimal(0), currency.toUpperCase());
  }

  private assertSame(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  add(other: Money): Money {
    this.assertSame(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  sub(other: Money): Money {
    this.assertSame(other);
    const r = this.value.minus(other.value);
    if (r.isNegative()) throw new NegativeAmountError(r.toString());
    return new Money(r, this.currency);
  }

  /** Multiply by a unitless scalar (e.g. an FX rate, a fee bps). */
  mul(scalar: string | number | Decimal): Money {
    const r = this.value.times(new Decimal(scalar));
    if (r.isNegative()) throw new NegativeAmountError(r.toString());
    return new Money(r, this.currency);
  }

  /** Apply a basis-points fee and return [net, fee]. */
  splitFeeBps(bps: number): { net: Money; fee: Money } {
    if (bps < 0 || bps > 10_000) throw new Error('bps out of range');
    const fee = new Money(this.value.times(bps).dividedBy(10_000), this.currency);
    const net = new Money(this.value.minus(fee.value), this.currency);
    return { net, fee };
  }

  /** Convert to another currency at `rate` (target per source unit). */
  convert(rate: string | number | Decimal, toCurrency: CurrencyCode): Money {
    const r = this.value.times(new Decimal(rate));
    return new Money(r, toCurrency.toUpperCase());
  }

  gt(other: Money): boolean {
    this.assertSame(other);
    return this.value.greaterThan(other.value);
  }

  gte(other: Money): boolean {
    this.assertSame(other);
    return this.value.greaterThanOrEqualTo(other.value);
  }

  lt(other: Money): boolean {
    this.assertSame(other);
    return this.value.lessThan(other.value);
  }

  eq(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  /** Decimal-aware string serialisation. Always use this for persistence. */
  toString(decimals = 18): string {
    return this.value.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
  }

  toJSON(): MoneyJSON {
    return { amount: this.toString(), currency: this.currency };
  }

  static fromJSON(json: MoneyJSON): Money {
    return Money.of(json.amount, json.currency);
  }
}

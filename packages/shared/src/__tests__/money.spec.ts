import { describe, expect, it } from 'vitest';
import { Money, CurrencyMismatchError, NegativeAmountError } from '../money';

describe('Money', () => {
  it('rejects negative amounts at construction', () => {
    expect(() => Money.of('-1', 'USDC')).toThrow(NegativeAmountError);
  });

  it('adds same-currency amounts', () => {
    const a = Money.of('1.5', 'USDC');
    const b = Money.of('2.25', 'USDC');
    expect(a.add(b).toString()).toBe('3.75');
  });

  it('throws on cross-currency math', () => {
    const a = Money.of('1', 'USDC');
    const b = Money.of('1', 'USD');
    expect(() => a.add(b)).toThrow(CurrencyMismatchError);
  });

  it('splits a basis-points fee correctly', () => {
    const { net, fee } = Money.of('1000', 'NGN').splitFeeBps(50); // 0.5%
    expect(fee.toString()).toBe('5');
    expect(net.toString()).toBe('995');
  });

  it('round-trips through JSON', () => {
    const m = Money.of('42.42', 'USDC');
    const parsed = Money.fromJSON(JSON.parse(JSON.stringify(m)));
    expect(parsed.eq(m)).toBe(true);
  });
});

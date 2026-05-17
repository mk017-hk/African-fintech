/**
 * Ledger smoke tests. These rely on a Postgres database matching `DATABASE_URL`.
 * In CI they would be wrapped in `vitest --run --reporter=verbose --testTimeout=20000`
 * with a per-test transaction rolled back. Here we keep the assertions
 * deterministic for unit-style coverage of validation logic.
 */
import { describe, expect, it } from 'vitest';
import { Money } from '@afristable/shared';
import { LedgerService, credit, debit } from '../ledger-service';

describe('LedgerService.validateBalanced', () => {
  it('rejects a single-leg posting', () => {
    const svc = new LedgerService({} as never);
    expect(() => (svc as unknown as { validateBalanced: (p: unknown) => void }).validateBalanced({
      transferId: 't', legs: [credit('a', Money.of('1', 'USDC'))],
    })).toThrow(/at least two legs/);
  });

  it('rejects an unbalanced posting', () => {
    const svc = new LedgerService({} as never);
    expect(() => (svc as unknown as { validateBalanced: (p: unknown) => void }).validateBalanced({
      transferId: 't',
      legs: [
        debit ('a', Money.of('10', 'USDC')),
        credit('b', Money.of('9',  'USDC')),
      ],
    })).toThrow(/unbalanced/);
  });

  it('accepts a balanced multi-currency posting', () => {
    const svc = new LedgerService({} as never);
    expect(() => (svc as unknown as { validateBalanced: (p: unknown) => void }).validateBalanced({
      transferId: 't',
      legs: [
        debit ('a', Money.of('10', 'USDC')),
        credit('b', Money.of('10', 'USDC')),
        debit ('c', Money.of('5',  'KES')),
        credit('d', Money.of('5',  'KES')),
      ],
    })).not.toThrow();
  });
});

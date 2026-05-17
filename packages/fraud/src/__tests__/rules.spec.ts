import { describe, expect, it } from 'vitest';
import { RuleBlacklistedAddress } from '../rules';

describe('RuleBlacklistedAddress', () => {
  it('flags known blacklisted EVM addresses', async () => {
    const result = await RuleBlacklistedAddress.evaluate(
      { kind: 'withdrawal.initiate', amountUsd: 100, rail: 'onchain:ethereum',
        destinationRef: '0x0000000000000000000000000000000000000bad' },
      { db: {} as never, userId: 'u' },
    );
    expect(result?.severity).toBe('CRITICAL');
  });

  it('does nothing for non-onchain rails', async () => {
    const result = await RuleBlacklistedAddress.evaluate(
      { kind: 'withdrawal.initiate', amountUsd: 100, rail: 'bank:flutterwave', destinationRef: '0000' },
      { db: {} as never, userId: 'u' },
    );
    expect(result).toBeNull();
  });
});

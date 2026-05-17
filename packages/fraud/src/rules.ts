/**
 * Rule library. Rules are pure-ish: they read from `db` and the event, and
 * return either a reason (matched) or null (no match). Composition is the
 * engine's job; never short-circuit inside a rule.
 *
 * Add a new rule by exporting it here and registering it in the engine.
 * Bake a unit test for every rule.
 */
import type { FraudRule } from './types';

// ---------- Auth -------------------------------------------------------------

export const RuleTooManyFailedOtp: FraudRule = {
  name: 'too_many_failed_otp',
  async evaluate(event, ctx) {
    if (event.kind !== 'auth.otp_attempt' || event.success) return null;
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const count = await ctx.db.otpChallenge.count({
      where: { userId: ctx.userId, attempts: { gt: 0 }, createdAt: { gte: since } },
    });
    if (count < 5) return null;
    return {
      rule: 'too_many_failed_otp',
      severity: 'HIGH',
      score: 40,
      details: { count, window: '15m' },
    };
  },
};

export const RuleUnusualCountryLogin: FraudRule = {
  name: 'unusual_country_login',
  async evaluate(event, ctx) {
    if (event.kind !== 'auth.login' || !event.success) return null;
    if (!ctx.countryCode) return null;
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.userId }, select: { countryCode: true },
    });
    if (!user || user.countryCode === ctx.countryCode) return null;
    return {
      rule: 'unusual_country_login',
      severity: 'MEDIUM',
      score: 20,
      details: { homeCountry: user.countryCode, loginCountry: ctx.countryCode },
    };
  },
};

export const RuleNewDeviceHighValue: FraudRule = {
  name: 'new_device_high_value_transfer',
  async evaluate(event, ctx) {
    if (event.kind !== 'transfer.initiate' && event.kind !== 'withdrawal.initiate') return null;
    if (event.amountUsd < 500) return null;
    if (!ctx.deviceFingerprint) return { rule: 'new_device_high_value_transfer', severity: 'MEDIUM', score: 15, details: { amountUsd: event.amountUsd, reason: 'no device fingerprint' } };
    const device = await ctx.db.device.findFirst({
      where: { userId: ctx.userId, fingerprintHash: ctx.deviceFingerprint },
      select: { trustedAt: true, createdAt: true },
    });
    const newDevice = !device || !device.trustedAt;
    if (!newDevice) return null;
    return {
      rule: 'new_device_high_value_transfer',
      severity: 'HIGH',
      score: 35,
      details: { amountUsd: event.amountUsd, deviceKnown: !!device },
    };
  },
};

// ---------- Velocity ---------------------------------------------------------

export const RuleHighVelocityWithdrawals: FraudRule = {
  name: 'high_velocity_withdrawals',
  async evaluate(event, ctx) {
    if (event.kind !== 'withdrawal.initiate') return null;
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const count = await ctx.db.transaction.count({
      where: {
        senderId: ctx.userId,
        type: { in: ['WITHDRAWAL_ONCHAIN', 'WITHDRAWAL_BANK', 'WITHDRAWAL_MOBILE_MONEY'] },
        createdAt: { gte: since },
      },
    });
    if (count < 5) return null;
    return {
      rule: 'high_velocity_withdrawals',
      severity: 'HIGH',
      score: 30,
      details: { count, window: '1h' },
    };
  },
};

export const RuleTooManyTransfers: FraudRule = {
  name: 'too_many_transfers',
  async evaluate(event, ctx) {
    if (event.kind !== 'transfer.initiate') return null;
    const since = new Date(Date.now() - 10 * 60 * 1000);
    const count = await ctx.db.transaction.count({
      where: { senderId: ctx.userId, type: 'P2P_TRANSFER', createdAt: { gte: since } },
    });
    if (count < 10) return null;
    return {
      rule: 'too_many_transfers',
      severity: 'MEDIUM',
      score: 20,
      details: { count, window: '10m' },
    };
  },
};

// ---------- Account history --------------------------------------------------

export const RuleLargeFirstTransaction: FraudRule = {
  name: 'large_first_transaction',
  async evaluate(event, ctx) {
    if (event.kind !== 'transfer.initiate' && event.kind !== 'withdrawal.initiate') return null;
    if (event.amountUsd < 1000) return null;
    const prior = await ctx.db.transaction.count({
      where: { senderId: ctx.userId, status: 'COMPLETED' },
    });
    if (prior > 0) return null;
    return {
      rule: 'large_first_transaction',
      severity: 'HIGH',
      score: 35,
      details: { amountUsd: event.amountUsd },
    };
  },
};

export const RuleSharedDevice: FraudRule = {
  name: 'many_accounts_same_device',
  async evaluate(event, ctx) {
    if (!ctx.deviceFingerprint) return null;
    if (event.kind !== 'transfer.initiate' && event.kind !== 'withdrawal.initiate' && event.kind !== 'auth.login') {
      return null;
    }
    const userCount = await ctx.db.device.findMany({
      where: { fingerprintHash: ctx.deviceFingerprint },
      select: { userId: true },
      distinct: ['userId'],
    });
    if (userCount.length < 3) return null;
    return {
      rule: 'many_accounts_same_device',
      severity: 'HIGH',
      score: 30,
      details: { distinctUsers: userCount.length },
    };
  },
};

// ---------- Address screening ------------------------------------------------

/** Replace with a sanctions-list lookup in production. Hard-coded to demonstrate the wiring. */
const KNOWN_BLACKLIST = new Set<string>([
  // Demo only. In production: pull from OFAC SDN, EU consolidated, etc.
  '0x0000000000000000000000000000000000000bad',
]);

export const RuleBlacklistedAddress: FraudRule = {
  name: 'blacklisted_wallet_address',
  async evaluate(event) {
    if (event.kind !== 'withdrawal.initiate') return null;
    if (!event.rail.startsWith('onchain:')) return null;
    if (!KNOWN_BLACKLIST.has(event.destinationRef.toLowerCase())) return null;
    return {
      rule: 'blacklisted_wallet_address',
      severity: 'CRITICAL',
      score: 100,
      details: { address: event.destinationRef, list: 'internal' },
    };
  },
};

export const ALL_RULES: FraudRule[] = [
  RuleTooManyFailedOtp,
  RuleUnusualCountryLogin,
  RuleNewDeviceHighValue,
  RuleHighVelocityWithdrawals,
  RuleTooManyTransfers,
  RuleLargeFirstTransaction,
  RuleSharedDevice,
  RuleBlacklistedAddress,
];

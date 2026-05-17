/**
 * FeePolicy — pure functions that return spread (bps) and fee (Money) for a
 * given rail/currency pair. Editable without touching the quote engine.
 *
 * Conventions:
 *   - Spread is applied to the FX rate (worse-for-the-user side).
 *   - Fee is charged in the source currency unless the rail dictates otherwise.
 *   - Country-based pricing layers add bps on top of the rail default.
 */
import Decimal from 'decimal.js';
import type { QuoteRail } from '@afristable/shared';

export interface PricingInput {
  fromCurrency: string;
  toCurrency:   string;
  rail:         QuoteRail;
  /** ISO-2 country of the user (for region-based pricing). */
  countryCode?: string;
  /** Amount in `fromCurrency` (Decimal string). */
  fromAmount:   string;
}

export interface PricingOutput {
  spreadBps:  number;
  feeAmount:  string;   // in fromCurrency
}

const RAIL_DEFAULT_BPS: Record<string, number> = {
  internal: 0,
  'onchain:ethereum': 25,
  'onchain:polygon':  15,
  'onchain:base':     15,
  'onchain:solana':   15,
  'onchain:stellar':  10,
  'mobile_money:mpesa':  60,
  'mobile_money:mtn':    60,
  'mobile_money:orange': 70,
  'mobile_money:airtel': 70,
  'bank:flutterwave': 50,
  'bank:paystack':    50,
  'bank:generic':     80,
  'card':             190,
};

const RAIL_FIXED_FEE_USD: Record<string, string> = {
  internal: '0',
  'onchain:ethereum': '1.50',
  'onchain:polygon':  '0.10',
  'onchain:base':     '0.15',
  'onchain:solana':   '0.05',
  'onchain:stellar':  '0.01',
  'mobile_money:mpesa':  '0.30',
  'mobile_money:mtn':    '0.30',
  'mobile_money:orange': '0.30',
  'mobile_money:airtel': '0.30',
  'bank:flutterwave': '0.50',
  'bank:paystack':    '0.50',
  'bank:generic':     '1.00',
  'card':             '0.30',
};

// Region overlays (illustrative). Drives "transparent" rate disclosure to
// users in expensive corridors.
const REGION_OVERLAY_BPS: Record<string, number> = {
  NG: 10, KE: 5, GH: 10, ZA: 5,
};

/**
 * Compute spread + fee. Fee is returned in the SOURCE currency. The caller
 * is responsible for converting it to the user's preferred fee currency.
 */
export function computePricing(input: PricingInput, usdRate: Decimal): PricingOutput {
  const railBps = RAIL_DEFAULT_BPS[input.rail] ?? 100;
  const regionBps = input.countryCode ? (REGION_OVERLAY_BPS[input.countryCode] ?? 0) : 0;
  const spreadBps = railBps + regionBps;

  // Convert fixed USD fee into source currency.
  const fixedUsd = new Decimal(RAIL_FIXED_FEE_USD[input.rail] ?? '0.50');
  const feeInSource = fixedUsd.dividedBy(usdRate); // 1 USD = usdRate source units
  // Add a tiny percentage fee on top to stay solvent on long tails (10 bps).
  const variable = new Decimal(input.fromAmount).times(10).dividedBy(10_000);
  const feeAmount = feeInSource.plus(variable);

  return {
    spreadBps,
    feeAmount: feeAmount.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''),
  };
}

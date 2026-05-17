/**
 * Currency metadata. The minor-unit count drives input validation and UI
 * formatting. Stablecoins use 6 (USDC/USDT spec) for display, but the ledger
 * stores them at 18 decimals to absorb on-chain precision.
 */
export type CurrencyType = 'stablecoin' | 'fiat';

export interface CurrencyMeta {
  code: string;
  type: CurrencyType;
  decimals: number; // display decimals
  ledgerDecimals: number; // storage precision
  symbol?: string;
  name: string;
  regions?: string[]; // ISO country codes where it is local tender
}

export const CURRENCIES: Record<string, CurrencyMeta> = {
  // Stablecoins
  USDC: { code: 'USDC', type: 'stablecoin', decimals: 2, ledgerDecimals: 18, name: 'USD Coin' },
  USDT: { code: 'USDT', type: 'stablecoin', decimals: 2, ledgerDecimals: 18, name: 'Tether USD' },
  // Major fiats
  USD: { code: 'USD', type: 'fiat', decimals: 2, ledgerDecimals: 6, symbol: '$',  name: 'US Dollar' },
  EUR: { code: 'EUR', type: 'fiat', decimals: 2, ledgerDecimals: 6, symbol: '€',  name: 'Euro' },
  GBP: { code: 'GBP', type: 'fiat', decimals: 2, ledgerDecimals: 6, symbol: '£',  name: 'British Pound' },
  // African fiats
  NGN: { code: 'NGN', type: 'fiat', decimals: 2, ledgerDecimals: 4, symbol: '₦',  name: 'Nigerian Naira', regions: ['NG'] },
  KES: { code: 'KES', type: 'fiat', decimals: 2, ledgerDecimals: 4, symbol: 'KSh', name: 'Kenyan Shilling', regions: ['KE'] },
  GHS: { code: 'GHS', type: 'fiat', decimals: 2, ledgerDecimals: 4, symbol: '₵',  name: 'Ghanaian Cedi', regions: ['GH'] },
  ZAR: { code: 'ZAR', type: 'fiat', decimals: 2, ledgerDecimals: 4, symbol: 'R',  name: 'South African Rand', regions: ['ZA'] },
  UGX: { code: 'UGX', type: 'fiat', decimals: 0, ledgerDecimals: 2, symbol: 'USh', name: 'Ugandan Shilling', regions: ['UG'] },
  TZS: { code: 'TZS', type: 'fiat', decimals: 0, ledgerDecimals: 2, symbol: 'TSh', name: 'Tanzanian Shilling', regions: ['TZ'] },
  XOF: { code: 'XOF', type: 'fiat', decimals: 0, ledgerDecimals: 2, symbol: 'CFA', name: 'West African CFA franc', regions: ['SN', 'CI', 'ML', 'BF', 'BJ', 'TG', 'NE', 'GW'] },
};

export function isSupportedCurrency(code: string): boolean {
  return !!CURRENCIES[code.toUpperCase()];
}

export function getCurrency(code: string): CurrencyMeta {
  const meta = CURRENCIES[code.toUpperCase()];
  if (!meta) throw new Error(`Unsupported currency: ${code}`);
  return meta;
}

export function isStablecoin(code: string): boolean {
  return getCurrency(code).type === 'stablecoin';
}

export function isFiat(code: string): boolean {
  return getCurrency(code).type === 'fiat';
}

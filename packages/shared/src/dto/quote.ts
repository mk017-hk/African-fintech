import { z } from 'zod';
import { AmountStringSchema, CurrencySchema } from './wallet';

export const QuoteRailSchema = z.enum([
  'internal',
  'onchain:ethereum',
  'onchain:polygon',
  'onchain:base',
  'onchain:solana',
  'onchain:stellar',
  'mobile_money:mpesa',
  'mobile_money:mtn',
  'mobile_money:orange',
  'mobile_money:airtel',
  'bank:flutterwave',
  'bank:paystack',
  'bank:generic',
  'card',
]);
export type QuoteRail = z.infer<typeof QuoteRailSchema>;

export const CreateQuoteSchema = z.object({
  fromCurrency: CurrencySchema,
  toCurrency: CurrencySchema,
  // Exactly one of fromAmount / toAmount must be provided.
  fromAmount: AmountStringSchema.optional(),
  toAmount: AmountStringSchema.optional(),
  rail: QuoteRailSchema,
}).refine(
  (q) => (q.fromAmount !== undefined) !== (q.toAmount !== undefined),
  'Provide exactly one of fromAmount or toAmount',
);
export type CreateQuoteDTO = z.infer<typeof CreateQuoteSchema>;

export interface QuoteResponse {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  fromAmount: string;
  toAmount: string;
  rate: string;
  spreadBps: number;
  feeAmount: string;
  feeCurrency: string;
  slippageBps: number;
  rail: QuoteRail;
  signature: string;
  expiresAt: string; // ISO 8601
}

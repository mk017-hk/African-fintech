import { z } from 'zod';
import { PhoneE164Schema } from './auth';

/**
 * IMPORTANT: clients never send raw amounts to money-moving endpoints.
 * They send `quoteId`; the server enforces the amount/rate/fee bound in
 * the signed quote.
 */

export const TransferDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'),            userId: z.string() }),
  z.object({ kind: z.literal('phone'),           phoneE164: PhoneE164Schema }),
  z.object({
    kind: z.literal('wallet_address'),
    network: z.enum(['ETHEREUM', 'POLYGON', 'BASE', 'SOLANA', 'STELLAR']),
    address: z.string().min(8).max(128),
    memo: z.string().max(64).optional(),
  }),
  z.object({
    kind: z.literal('bank_account'),
    partner: z.enum(['flutterwave', 'paystack', 'generic']),
    bankCode: z.string().min(2).max(16),
    accountNumber: z.string().min(4).max(34),
    accountName: z.string().min(1).max(140),
  }),
  z.object({
    kind: z.literal('mobile_money'),
    provider: z.enum(['MPESA', 'MTN', 'ORANGE', 'AIRTEL']),
    msisdnE164: PhoneE164Schema,
  }),
]);
export type TransferDestination = z.infer<typeof TransferDestinationSchema>;

export const CreateTransferSchema = z.object({
  quoteId: z.string().min(1),
  destination: TransferDestinationSchema,
  note: z.string().max(280).optional(),
});
export type CreateTransferDTO = z.infer<typeof CreateTransferSchema>;

export const CreatePaymentRequestSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  currency: z.string().regex(/^[A-Z]+$/),
  note: z.string().max(280).optional(),
  expiresInSeconds: z.number().int().min(60).max(7 * 24 * 3600).default(3600),
});
export type CreatePaymentRequestDTO = z.infer<typeof CreatePaymentRequestSchema>;

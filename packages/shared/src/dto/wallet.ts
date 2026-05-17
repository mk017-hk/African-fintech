import { z } from 'zod';

export const CurrencySchema = z.string().min(3).max(8).regex(/^[A-Z]+$/);
export const AmountStringSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Amount must be a non-negative decimal')
  .max(40);

export const CreateWalletSchema = z.object({
  currency: CurrencySchema,
});
export type CreateWalletDTO = z.infer<typeof CreateWalletSchema>;

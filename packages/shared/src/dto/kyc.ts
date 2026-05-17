import { z } from 'zod';

export const KycDocumentTypeSchema = z.enum([
  'PASSPORT',
  'NATIONAL_ID',
  'DRIVERS_LICENSE',
  'UTILITY_BILL',
  'SELFIE',
]);

export const KycSubmissionSchema = z.object({
  targetTier: z.enum(['TIER_1', 'TIER_2', 'TIER_3']),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  occupation: z.string().max(120).optional(),
  addressLine1: z.string().max(180).optional(),
  city: z.string().max(80).optional(),
  region: z.string().max(80).optional(),
  postalCode: z.string().max(20).optional(),
  nationalId: z.string().max(64).optional(),
  documents: z.array(
    z.object({
      type: KycDocumentTypeSchema,
      storageKey: z.string().min(1),
      documentNumber: z.string().max(64).optional(),
    }),
  ).min(1).max(5),
});
export type KycSubmissionDTO = z.infer<typeof KycSubmissionSchema>;

export const KycReviewSchema = z.object({
  kycRecordId: z.string().min(1),
  decision: z.enum(['APPROVED', 'REJECTED']),
  rejectionReason: z.string().max(500).optional(),
}).refine(
  (v) => v.decision === 'APPROVED' || !!v.rejectionReason,
  'Rejection reason required when rejecting',
);
export type KycReviewDTO = z.infer<typeof KycReviewSchema>;

/** KYC tier → transaction limits (USD-equivalent). */
export const KYC_LIMITS: Record<string, { dailyUsd: number; monthlyUsd: number; singleTxUsd: number }> = {
  TIER_0: { dailyUsd: 50,     monthlyUsd: 200,     singleTxUsd: 50     },
  TIER_1: { dailyUsd: 1000,   monthlyUsd: 5000,    singleTxUsd: 1000   },
  TIER_2: { dailyUsd: 10000,  monthlyUsd: 50000,   singleTxUsd: 10000  },
  TIER_3: { dailyUsd: 100000, monthlyUsd: 1000000, singleTxUsd: 100000 },
};

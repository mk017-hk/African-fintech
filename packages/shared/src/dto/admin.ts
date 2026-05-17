import { z } from 'zod';

export const AdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().regex(/^\d{6}$/).optional(),
});
export type AdminLoginDTO = z.infer<typeof AdminLoginSchema>;

export const ApprovalDecisionSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(500).optional(),
});
export type ApprovalDecisionDTO = z.infer<typeof ApprovalDecisionSchema>;

export const SuspendUserSchema = z.object({
  userId: z.string().min(1),
  reason: z.string().min(1).max(500),
});
export type SuspendUserDTO = z.infer<typeof SuspendUserSchema>;

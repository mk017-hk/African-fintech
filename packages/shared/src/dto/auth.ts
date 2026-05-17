import { z } from 'zod';

export const EmailSchema = z.string().trim().toLowerCase().email().max(254);
export const PhoneE164Schema = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Invalid E.164 phone');
export const CountryCodeSchema = z.string().length(2).regex(/^[A-Z]{2}$/);
export const PasswordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(256)
  .refine((p) => /[A-Z]/.test(p), 'Must contain an uppercase letter')
  .refine((p) => /[a-z]/.test(p), 'Must contain a lowercase letter')
  .refine((p) => /[0-9]/.test(p), 'Must contain a number')
  .refine((p) => /[^A-Za-z0-9]/.test(p), 'Must contain a symbol');

export const SignupSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  phoneE164: PhoneE164Schema.optional(),
  countryCode: CountryCodeSchema,
  acceptedTerms: z.literal(true),
});
export type SignupDTO = z.infer<typeof SignupSchema>;

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(256),
});
export type LoginDTO = z.infer<typeof LoginSchema>;

export const OtpVerifySchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});
export type OtpVerifyDTO = z.infer<typeof OtpVerifySchema>;

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshTokenDTO = z.infer<typeof RefreshTokenSchema>;

export const PasskeyRegisterStartSchema = z.object({
  deviceName: z.string().min(1).max(64).optional(),
});
export type PasskeyRegisterStartDTO = z.infer<typeof PasskeyRegisterStartSchema>;

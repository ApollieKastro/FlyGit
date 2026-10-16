import { z } from 'zod';
import { LIMITS, USERNAME_PATTERN } from '../constants';

/** Generic email schema. */
export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** Password strength: min length, at least one letter and one digit. */
export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMin, { message: 'validation:passwordTooShort' })
  .max(LIMITS.passwordMax, { message: 'validation:passwordTooLong' })
  .refine((v) => /[a-zA-Zа-яА-Я]/.test(v), {
    message: 'validation:passwordNeedsLetter',
  })
  .refine((v) => /\d/.test(v), { message: 'validation:passwordNeedsDigit' });

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(LIMITS.usernameMin, { message: 'validation:usernameTooShort' })
  .max(LIMITS.usernameMax, { message: 'validation:usernameTooLong' })
  .regex(USERNAME_PATTERN, { message: 'validation:usernameInvalid' });

export const registerSchema = z
  .object({
    email: emailSchema,
    username: usernameSchema,
    password: passwordSchema,
    displayName: z.string().trim().max(LIMITS.displayNameMax).optional(),
    /** Preferred language for transactional emails and the UI. */
    locale: z.enum(['ru', 'en', 'zh-CN']).optional(),
    /** Terms acceptance is required by the UI. */
    acceptTerms: z.literal(true, { message: 'validation:termsRequired' }),
  })
  .strict();
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    /** Email or username. */
    identifier: z.string().trim().min(1, { message: 'validation:identifierRequired' }),
    password: z.string().min(1, { message: 'validation:passwordRequired' }),
    /** 6-digit TOTP code when 2FA is enabled. */
    totpCode: z
      .string()
      .regex(/^\d{6}$/, { message: 'validation:totpInvalid' })
      .optional(),
  })
  .strict();
export type LoginInputDto = z.infer<typeof loginSchema>;

export const confirmEmailSchema = z
  .object({ token: z.string().min(16).max(128) })
  .strict();
export type ConfirmEmailInput = z.infer<typeof confirmEmailSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(16).max(128),
    password: passwordSchema,
  })
  .strict();
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
  })
  .strict();
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const verifyTotpSchema = z
  .object({ code: z.string().regex(/^\d{6}$/), secret: z.string().min(16).max(128) })
  .strict();
export type VerifyTotpInput = z.infer<typeof verifyTotpSchema>;

import { z } from 'zod';
import { LIMITS, USERNAME_PATTERN } from '../constants';
import { usernameSchema } from './auth';

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().max(LIMITS.displayNameMax).optional(),
    username: usernameSchema.optional(),
    bio: z.string().trim().max(LIMITS.bioMax).nullable().optional(),
    website: z
      .string()
      .trim()
      .max(LIMITS.websiteMax)
      .url({ message: 'validation:websiteInvalid' })
      .nullable()
      .optional(),
    avatarUrl: z.string().trim().url().max(500).nullable().optional(),
    locale: z.enum(['ru', 'en', 'zh-CN']).optional(),
    theme: z.enum(['dark', 'light', 'system']).optional(),
  })
  .strict();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const sshKeySchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    /** OpenSSH public key line. */
    key: z.string().trim().min(32).max(16_384),
  })
  .strict();
export type SshKeyInput = z.infer<typeof sshKeySchema>;

export const createTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    scopes: z.array(z.enum(['repo:read', 'repo:write', 'user:write'])).min(1),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict();
export type CreateTokenInput = z.infer<typeof createTokenSchema>;

export const userSearchSchema = z.object({
  q: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

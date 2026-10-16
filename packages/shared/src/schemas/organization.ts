import { z } from 'zod';
import { LIMITS, ORG_ROLES, SLUG_PATTERN } from '../constants';

export const createOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(LIMITS.orgNameMax),
    slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN),
    description: z.string().trim().max(LIMITS.descriptionMax).nullable().optional(),
    website: z.string().trim().url().max(LIMITS.websiteMax).nullable().optional(),
  })
  .strict();
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(LIMITS.orgNameMax).optional(),
    description: z.string().trim().max(LIMITS.descriptionMax).nullable().optional(),
    website: z.string().trim().url().max(LIMITS.websiteMax).nullable().optional(),
    avatarUrl: z.string().trim().url().max(500).nullable().optional(),
  })
  .strict();
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const createTeamSchema = z
  .object({
    name: z.string().trim().min(1).max(LIMITS.teamNameMax),
    slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const inviteMemberSchema = z
  .object({
    /** Email or username of the invitee. */
    identifier: z.string().trim().min(1).max(254),
    role: z.enum(ORG_ROLES).default('member'),
  })
  .strict();
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateMemberRoleSchema = z
  .object({ role: z.enum(ORG_ROLES) })
  .strict();

export const addTeamMemberSchema = z
  .object({
    userId: z.string().uuid(),
    role: z.enum(ORG_ROLES).default('member'),
  })
  .strict();

export const auditQuerySchema = z.object({
  actor: z.string().max(64).optional(),
  action: z.string().max(64).optional(),
  entityType: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

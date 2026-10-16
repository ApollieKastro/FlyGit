import { z } from 'zod';
import { LIMITS, REPO_VISIBILITIES, SLUG_PATTERN } from '../constants';

export const repoNameSchema = z
  .string()
  .trim()
  .min(LIMITS.repoNameMin, { message: 'validation:repoNameRequired' })
  .max(LIMITS.repoNameMax, { message: 'validation:repoNameTooLong' })
  .regex(/^[^/\\]+$/, { message: 'validation:repoNameInvalid' });

export const createRepositorySchema = z
  .object({
    /** `user` for personal repos, otherwise organization slug. */
    ownerType: z.enum(['user', 'organization']).default('user'),
    ownerSlug: z.string().trim().max(LIMITS.usernameMax).optional(),
    name: repoNameSchema,
    description: z.string().trim().max(LIMITS.descriptionMax).nullable().optional(),
    visibility: z.enum(REPO_VISIBILITIES).default('private'),
    /** Initialize with a README. */
    initialize: z.boolean().default(true),
    defaultBranch: z
      .string()
      .regex(/^[a-zA-Z0-9._/-]+$/)
      .max(255)
      .default('main'),
    template: z.string().trim().max(100).nullable().optional(),
    topics: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  })
  .strict();
export type CreateRepositoryInput = z.infer<typeof createRepositorySchema>;

export const updateRepositorySchema = z
  .object({
    description: z.string().trim().max(LIMITS.descriptionMax).nullable().optional(),
    visibility: z.enum(REPO_VISIBILITIES).optional(),
    defaultBranch: z
      .string()
      .regex(/^[a-zA-Z0-9._/-]+$/)
      .max(255)
      .optional(),
    topics: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
    /** Rename generates a new slug. */
    name: repoNameSchema.optional(),
  })
  .strict();
export type UpdateRepositoryInput = z.infer<typeof updateRepositorySchema>;

export const repositoryListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  ownerType: z.enum(['user', 'organization']).optional(),
  ownerSlug: z.string().trim().max(64).optional(),
  visibility: z.enum(REPO_VISIBILITIES).optional(),
  sort: z.enum(['updated', 'created', 'name', 'stars']).default('updated'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type RepositoryListQuery = z.infer<typeof repositoryListQuerySchema>;

export const fileQuerySchema = z.object({
  ref: z.string().trim().max(255).optional(),
  path: z.string().max(1024).optional(),
});
export type FileQuery = z.infer<typeof fileQuerySchema>;

export const commitListQuerySchema = z.object({
  ref: z.string().trim().max(255).optional(),
  path: z.string().max(1024).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export const compareQuerySchema = z.object({
  from: z.string().min(1).max(255),
  to: z.string().min(1).max(255),
});

export const updateFileSchema = z
  .object({
    branch: z.string().min(1).max(255),
    message: z.string().trim().min(1).max(500),
    content: z.string().max(5_000_000),
    /** Original blob sha — optimistic concurrency. */
    sha: z.string().length(40).optional(),
    /** `create` for new files, `delete` to remove. */
    action: z.enum(['update', 'create', 'delete']).default('update'),
  })
  .strict();
export type UpdateFileInput = z.infer<typeof updateFileSchema>;

export const addTeamSchema = z
  .object({ teamId: z.string().uuid(), role: z.enum(['admin', 'maintainer', 'developer', 'reporter', 'guest']) })
  .strict();

export const addMemberSchema = z
  .object({
    username: z.string().trim().toLowerCase().min(1).max(64),
    role: z.enum(['admin', 'maintainer', 'developer', 'reporter', 'guest']),
  })
  .strict();

export const createWebhookSchema = z
  .object({
    url: z.string().url(),
    secret: z.string().max(256).optional(),
    events: z
      .array(z.enum(['push', 'issue', 'merge_request', 'release', 'member']))
      .min(1),
    active: z.boolean().default(true),
  })
  .strict();
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const slugSchema = z.string().regex(SLUG_PATTERN, { message: 'validation:slugInvalid' });

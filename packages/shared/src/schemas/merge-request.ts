import { z } from 'zod';
import { LIMITS, MR_MERGE_STRATEGIES, MR_STATUSES } from '../constants';

export const createMergeRequestSchema = z
  .object({
    sourceBranch: z.string().min(1).max(255),
    targetBranch: z.string().min(1).max(255),
    title: z.string().trim().min(1).max(LIMITS.mrTitleMax),
    description: z.string().max(LIMITS.commentMax).nullable().optional(),
    draft: z.boolean().default(false),
    reviewerIds: z.array(z.string().uuid()).max(10).optional(),
    /** Closes linked issues: "Closes #12" in description. */
    autoCloseIssues: z.boolean().default(true),
  })
  .strict();
export type CreateMergeRequestInput = z.infer<typeof createMergeRequestSchema>;

export const updateMergeRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(LIMITS.mrTitleMax).optional(),
    description: z.string().max(LIMITS.commentMax).nullable().optional(),
    targetBranch: z.string().min(1).max(255).optional(),
    draft: z.boolean().optional(),
    reviewerIds: z.array(z.string().uuid()).max(10).optional(),
  })
  .strict();
export type UpdateMergeRequestInput = z.infer<typeof updateMergeRequestSchema>;

export const reviewSchema = z
  .object({
    state: z.enum(['approved', 'changes_requested', 'commented']),
    body: z.string().max(LIMITS.commentMax).optional(),
  })
  .strict();
export type ReviewInput = z.infer<typeof reviewSchema>;

export const mergeSchema = z
  .object({
    strategy: z.enum(MR_MERGE_STRATEGIES).default('merge'),
    /** Commit message override (squash). */
    message: z.string().trim().max(500).optional(),
    /** Remove source branch after merge. */
    deleteSourceBranch: z.boolean().default(true),
    /** Must match target branch head when required by protected branches. */
    sha: z.string().length(40).optional(),
  })
  .strict();
export type MergeInput = z.infer<typeof mergeSchema>;

export const reviewCommentSchema = z
  .object({
    body: z.string().trim().min(1).max(LIMITS.commentMax),
    filePath: z.string().max(1024).nullable().optional(),
    line: z.number().int().min(1).nullable().optional(),
    side: z.enum(['old', 'new']).default('new'),
    /** Reply to an existing review thread. */
    parentId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type ReviewCommentInput = z.infer<typeof reviewCommentSchema>;

export const mergeRequestListQuerySchema = z.object({
  status: z.enum(MR_STATUSES).or(z.literal('all')).default('open'),
  q: z.string().trim().max(100).optional(),
  author: z.string().max(64).optional(),
  reviewer: z.string().max(64).optional(),
  sort: z.enum(['created', 'updated']).default('created'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type MergeRequestListQuery = z.infer<typeof mergeRequestListQuerySchema>;

import { z } from 'zod';
import { ISSUE_STATUSES, LIMITS } from '../constants';

export const createIssueSchema = z
  .object({
    title: z.string().trim().min(1, { message: 'validation:titleRequired' }).max(LIMITS.issueTitleMax),
    body: z.string().max(LIMITS.commentMax).nullable().optional(),
    labels: z.array(z.string().uuid()).max(20).optional(),
    assignees: z.array(z.string().uuid()).max(10).optional(),
    milestoneId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type CreateIssueInput = z.infer<typeof createIssueSchema>;

export const updateIssueSchema = createIssueSchema
  .partial()
  .extend({ status: z.enum(ISSUE_STATUSES).optional() })
  .strict();
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;

export const issueCommentSchema = z
  .object({ body: z.string().trim().min(1).max(LIMITS.commentMax) })
  .strict();
export type IssueCommentInput = z.infer<typeof issueCommentSchema>;

export const issueListQuerySchema = z.object({
  status: z.enum(ISSUE_STATUSES).or(z.literal('all')).default('all'),
  q: z.string().trim().max(100).optional(),
  label: z.array(z.string()).max(10).optional(),
  assignee: z.string().max(64).optional(),
  milestone: z.string().max(64).optional(),
  sort: z.enum(['created', 'updated', 'comments']).default('created'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type IssueListQuery = z.infer<typeof issueListQuerySchema>;

export const createLabelSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    description: z.string().trim().max(200).nullable().optional(),
  })
  .strict();
export type CreateLabelInput = z.infer<typeof createLabelSchema>;

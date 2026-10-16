/** Platform-level user roles. */
export const PLATFORM_ROLES = ['admin', 'user'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** Organization-level member roles. */
export const ORG_ROLES = ['owner', 'maintainer', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Repository-level member roles. */
export const REPO_ROLES = ['admin', 'maintainer', 'developer', 'reporter', 'guest'] as const;
export type RepoRole = (typeof REPO_ROLES)[number];

/**
 * Ordered role weights — higher number grants more power.
 * Used for comparisons when resolving effective access.
 */
export const ROLE_WEIGHT: Record<string, number> = {
  guest: 10,
  reporter: 20,
  developer: 30,
  member: 30,
  maintainer: 40,
  admin: 50,
  owner: 60,
  user: 0,
};

export function roleAtLeast(role: string | null | undefined, required: string): boolean {
  if (!role) return false;
  return (ROLE_WEIGHT[role] ?? 0) >= (ROLE_WEIGHT[required] ?? 0);
}

/** Repository visibility. */
export const REPO_VISIBILITIES = ['public', 'private', 'internal'] as const;
export type RepoVisibility = (typeof REPO_VISIBILITIES)[number];

/** Issue states. */
export const ISSUE_STATUSES = ['open', 'closed'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** Merge request states. */
export const MR_STATUSES = ['draft', 'open', 'merged', 'closed'] as const;
export type MrStatus = (typeof MR_STATUSES)[number];

/** Merge request review states (per reviewer). */
export const MR_REVIEW_STATES = [
  'pending',
  'approved',
  'changes_requested',
  'commented',
] as const;
export type MrReviewState = (typeof MR_REVIEW_STATES)[number];

/** Merge strategies supported by FlyGit. */
export const MR_MERGE_STRATEGIES = ['merge', 'squash', 'rebase'] as const;
export type MrMergeStrategy = (typeof MR_MERGE_STRATEGIES)[number];

/** Entity owner types (user or organization). */
export const OWNER_TYPES = ['user', 'organization'] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

/** In-app notification types. */
export const NOTIFICATION_TYPES = [
  'mention',
  'issue_opened',
  'issue_closed',
  'issue_comment',
  'issue_assigned',
  'mr_opened',
  'mr_review_requested',
  'mr_comment',
  'mr_approved',
  'mr_merged',
  'mr_closed',
  'repository_member_added',
  'organization_invite',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Limits shared between client and server validation. */
export const LIMITS = {
  usernameMin: 3,
  usernameMax: 32,
  passwordMin: 8,
  passwordMax: 128,
  displayNameMax: 64,
  bioMax: 280,
  websiteMax: 200,
  repoNameMin: 1,
  repoNameMax: 100,
  issueTitleMax: 200,
  mrTitleMax: 200,
  orgNameMax: 64,
  teamNameMax: 64,
  commentMax: 65_536,
  descriptionMax: 4_000,
} as const;

/** Username/organization slug pattern (lowercase, digits, hyphens). */
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;
/** Repository/organization slug pattern. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/;

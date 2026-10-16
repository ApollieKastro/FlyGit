import type { MrMergeStrategy, MrReviewState, MrStatus } from '../constants';
import type { UserPublic } from './auth';
import type { FileDiff } from './repository';

export interface MergeRequest {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: MrStatus;
  sourceBranch: string;
  targetBranch: string;
  author: UserPublic;
  reviewers: Array<{ user: UserPublic; state: MrReviewState }>;
  draft: boolean;
  mergeable: boolean;
  mergeStrategy: MrMergeStrategy;
  commitsCount: number;
  filesChangedCount: number;
  additions: number;
  deletions: number;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
}

export interface MergeRequestDetail extends MergeRequest {
  mergeSha: string | null;
  requiredApprovals: number;
  approvalsCount: number;
  headSha: string;
  baseSha: string;
}

export interface MergeRequestDiff {
  files: FileDiff[];
  truncated: boolean;
}

export interface ReviewComment {
  id: string;
  body: string;
  author: UserPublic;
  /** Path + optional line anchor inside the diff. */
  filePath: string | null;
  line: number | null;
  side: 'old' | 'new';
  resolved: boolean;
  createdAt: string;
  replies: ReviewComment[];
}

export interface MergeRequestCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: UserPublic | { name: string; email: string; username: null };
  authoredAt: string;
}

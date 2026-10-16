import type { OwnerType, RepoRole, RepoVisibility } from '../constants';
import type { UserPublic } from './auth';

/** Repository summary as returned in lists. */
export interface RepositorySummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: RepoVisibility;
  ownerType: OwnerType;
  ownerId: string;
  owner: { username: string; displayName: string | null; avatarUrl: string | null };
  defaultBranch: string;
  starsCount: number;
  watchersCount: number;
  forksCount: number;
  openIssuesCount: number;
  openMergeRequestsCount: number;
  language: string | null;
  updatedAt: string;
  createdAt: string;
}

/** Full repository details incl. caller's effective role. */
export interface RepositoryDetail extends RepositorySummary {
  sshUrl: string;
  httpUrl: string;
  yourRole: RepoRole | null;
  starred: boolean;
  watched: boolean;
  sizeBytes: number;
  topics: string[];
}

/** Git commit summary. */
export interface CommitSummary {
  sha: string;
  shortSha: string;
  message: string;
  author: { name: string; email: string; username: string | null };
  authoredAt: string;
  committedAt: string;
  parents: string[];
}

/** Git ref (branch or tag). */
export interface GitRef {
  name: string;
  fullName: string;
  sha: string;
  message?: string;
  author?: { name: string; email: string };
  committedAt?: string;
  protected?: boolean;
  isDefault?: boolean;
}

/** File tree entry. */
export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  size: number;
  sha: string;
}

/** Blob content returned by the code viewer. */
export interface FileContent {
  path: string;
  name: string;
  size: number;
  encoding: 'utf8' | 'base64';
  content: string;
  language: string | null;
  isBinary: boolean;
  /** Truncated for huge files. */
  truncated: boolean;
  lastCommit: CommitSummary | null;
}

/** Diff hunk line. */
export interface DiffLine {
  type: 'context' | 'add' | 'del' | 'meta';
  oldNumber: number | null;
  newNumber: number | null;
  content: string;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  binary: boolean;
}

/** Release published for a repository. */
export interface Release {
  id: string;
  tagName: string;
  name: string;
  description: string | null;
  draft: boolean;
  prerelease: boolean;
  author: UserPublic;
  assets: Array<{ id: string; name: string; size: number; downloadUrl: string }>;
  createdAt: string;
  publishedAt: string | null;
}

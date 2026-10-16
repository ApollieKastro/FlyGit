import type { IssueStatus } from '../constants';
import type { UserPublic } from './auth';

export interface Label {
  id: string;
  name: string;
  color: string;
  description: string | null;
}

export interface Milestone {
  id: string;
  title: string;
  description: string | null;
  dueOn: string | null;
  state: 'open' | 'closed';
  openIssues: number;
  closedIssues: number;
}

export interface IssueComment {
  id: string;
  body: string;
  author: UserPublic;
  createdAt: string;
  updatedAt: string;
  reactions: Record<string, string[]>;
}

export interface Issue {
  id: string;
  number: number;
  title: string;
  body: string | null;
  status: IssueStatus;
  author: UserPublic;
  assignees: UserPublic[];
  labels: Label[];
  milestone: Milestone | null;
  commentsCount: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  linkedMergeRequests: Array<{ id: string; number: number; title: string; status: string }>;
}

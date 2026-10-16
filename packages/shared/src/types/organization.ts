import type { OrgRole, OwnerType, RepoRole } from '../constants';
import type { UserPublic } from './auth';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatarUrl: string | null;
  website: string | null;
  membersCount: number;
  repositoriesCount: number;
  createdAt: string;
}

export interface OrganizationDetail extends Organization {
  yourRole: OrgRole | null;
  ownerId: string;
}

export interface Team {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  membersCount: number;
}

export interface TeamMember {
  user: UserPublic;
  role: OrgRole;
  joinedAt: string;
}

export interface OrgMember {
  user: UserPublic;
  role: OrgRole;
  teams: Array<{ id: string; name: string }>;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  email: string | null;
  user: UserPublic | null;
  role: OrgRole;
  invitedBy: UserPublic;
  expiresAt: string;
  createdAt: string;
}

/** Effective access of a user to a repository (resolved by guards). */
export interface RepositoryAccess {
  repositoryId: string;
  role: RepoRole;
  source: 'direct' | 'team' | 'org' | 'owner' | 'platform-admin';
  ownerType: OwnerType;
  ownerId: string;
}

/** Audit log entry for the admin/org panels. */
export interface AuditLogEntry {
  id: string;
  actor: UserPublic | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

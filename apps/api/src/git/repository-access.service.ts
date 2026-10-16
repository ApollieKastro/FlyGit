import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import type { OrgRole, RepoRole, RepositoryAccess } from '@flygit/shared';
import { roleAtLeast, REPO_ROLES } from '@flygit/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import type { OwnerType, Repository } from '@prisma/client';

/** Result of resolving a user's effective role on a repository. */
export interface ResolvedAccess extends RepositoryAccess {
  repository: Repository;
}

@Injectable()
export class RepositoryAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Loads `owner/repo` (case-insensitive slugs) including deleted check. */
  async findRepository(ownerSlug: string, repoSlug: string): Promise<Repository> {
    const owner = ownerSlug.toLowerCase();
    const slug = repoSlug.toLowerCase();

    const ownerUser = await this.prisma.user.findUnique({ where: { username: owner } });
    const org = ownerUser
      ? null
      : await this.prisma.organization.findUnique({ where: { slug: owner } });

    const ownerId = ownerUser?.id ?? org?.id;
    const ownerType: OwnerType | null = ownerUser ? 'user' : org ? 'organization' : null;

    if (!ownerId || !ownerType) {
      throw this.notFound();
    }

    const repo = await this.prisma.repository.findFirst({
      where: { ownerType, ownerId, slug, deletedAt: null },
    });
    if (!repo) throw this.notFound();
    return repo;
  }

  /**
   * Resolves the caller's effective role on a repository.
   * Highest wins: platform-admin > org owner > direct member > team > org > public.
   */
  async resolve(user: AuthUser | null | undefined, repository: Repository): Promise<ResolvedAccess | null> {
    if (repository.deletedAt) return null;

    const base = {
      repositoryId: repository.id,
      ownerType: repository.ownerType,
      ownerId: repository.ownerId,
    };

    // Platform administrators can do anything.
    if (user?.isAdmin) {
      return { ...base, role: 'admin', source: 'platform-admin', repository };
    }

    // Public repositories grant read-only guest access.
    const publicAccess: ResolvedAccess | null =
      repository.visibility === 'public'
        ? { ...base, role: 'guest', source: 'owner', repository }
        : null;

    if (!user) return publicAccess;

    // Personal repository owner.
    if (repository.ownerType === 'user' && repository.ownerId === user.id) {
      return { ...base, role: 'admin', source: 'owner', repository };
    }

    const candidates: Array<{ role: RepoRole; source: ResolvedAccess['source'] }> = [];

    // Organization membership.
    if (repository.ownerType === 'organization') {
      const orgMember = await this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId: repository.ownerId, userId: user.id } },
      });
      if (orgMember) {
        if (orgMember.role === 'owner') {
          candidates.push({ role: 'admin', source: 'org' });
        } else if (orgMember.role === 'maintainer') {
          // Maintainers get write access on every org repository by default.
          candidates.push({ role: 'developer', source: 'org' });
          // Internal repos stay readable for any org member:
        }
        if (repository.visibility === 'internal') {
          candidates.push({ role: 'guest', source: 'org' });
        }
      }
    }

    // Direct membership.
    const direct = await this.prisma.repositoryMember.findUnique({
      where: { repositoryId_userId: { repositoryId: repository.id, userId: user.id } },
    });
    if (direct) candidates.push({ role: direct.role, source: 'direct' });

    // Team-based membership (highest team role wins).
    const teamRoles = await this.prisma.$queryRaw<Array<{ role: RepoRole }>>`
      SELECT DISTINCT rt.role
      FROM repository_teams rt
      INNER JOIN team_members tm ON tm.team_id = rt.team_id
      WHERE rt.repository_id = ${repository.id} AND tm.user_id = ${user.id}
    `;
    if (teamRoles.length) {
      const best = teamRoles
        .map((t) => t.role)
        .sort((a, b) => (REPO_ROLES.indexOf(a) - REPO_ROLES.indexOf(b)) * -1)[0];
      if (best) candidates.push({ role: best, source: 'team' });
    }

    if (!candidates.length) return publicAccess;

    const winner = candidates.reduce((best, current) =>
      roleAtLeast(current.role, best.role) ? current : best,
    );
    return { ...base, role: winner.role, source: winner.source, repository };
  }

  /** Resolves access or throws 404/403 with a stable error payload. */
  async require(
    user: AuthUser | null | undefined,
    ownerSlug: string,
    repoSlug: string,
    minRole: RepoRole = 'guest',
  ): Promise<ResolvedAccess> {
    const repository = await this.findRepository(ownerSlug, repoSlug);
    const access = await this.resolve(user, repository);

    // Hidden (private/internal) repositories must not leak their existence:
    // resolve() returns null for callers without any access → uniform 404.
    if (!access) throw this.notFound(ownerSlug, repoSlug);

    if (!roleAtLeast(access.role, minRole)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: `Requires ${minRole} access`,
        code: 'INSUFFICIENT_ACCESS',
        details: { required: [minRole], actual: [access.role] },
      });
    }
    return access;
  }

  /** Returns max org role of a user in an organization (or null). */
  async orgRole(orgId: string, userId: string): Promise<OrgRole | null> {
    const member = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    return member?.role ?? null;
  }

  private notFound(owner?: string, repo?: string): NotFoundException {
    return new NotFoundException({
      statusCode: 404,
      error: 'Not Found',
      message: owner && repo ? `Repository ${owner}/${repo} not found` : 'Repository not found',
      code: 'REPOSITORY_NOT_FOUND',
    });
  }
}

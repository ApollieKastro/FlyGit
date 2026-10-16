import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateRepositoryInput,
  RepositoryDetail,
  RepositorySummary,
  UpdateRepositoryInput,
} from '@flygit/shared';
import type { OwnerType, Repository, Visibility } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.module';
import type { GitStorageService } from '../git/git-storage.service';
import type { RepositoryAccessService} from '../git/repository-access.service';
import { type ResolvedAccess } from '../git/repository-access.service';
import { toSlug } from '../common/utils/crypto.util';
import type { AuthUser } from '../common/decorators/current-user.decorator';

interface OwnerInfo {
  type: OwnerType;
  id: string;
  slug: string;
  displayName: string;
  avatarUrl: string | null;
}

const DEFAULT_README = (name: string): string =>
  `# ${name}\n\n> Created with **[FlyGit](https://github.com/ApollieKastro/FlyGit)** — self-hosted Git platform.\n\n## Getting started\n\n\`\`\`bash\ngit clone <clone-url>\ncd ${name}\n\`\`\`\n`;

@Injectable()
export class RepositoriesService {
  private readonly logger = new Logger(RepositoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: GitStorageService,
    private readonly access: RepositoryAccessService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── Creation / resolution ─────────────────────────

  async create(user: AuthUser, input: CreateRepositoryInput): Promise<RepositoryDetail> {
    const owner = await this.resolveOwner(user, input.ownerType, input.ownerSlug);
    const slug = toSlug(input.name);
    if (!slug) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid repository name',
        code: 'INVALID_REPO_NAME',
      });
    }

    const conflict = await this.prisma.repository.findFirst({
      where: { ownerType: owner.type, ownerId: owner.id, slug, deletedAt: null },
    });
    if (conflict) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: `Repository ${owner.slug}/${slug} already exists`,
        code: 'REPOSITORY_EXISTS',
      });
    }

    // Storage first — the directory is removed if the DB write fails.
    await this.storage.initRepository({
      ownerSlug: owner.slug,
      repoSlug: slug,
      defaultBranch: input.defaultBranch,
      readme: input.initialize ? DEFAULT_README(input.name) : null,
      author: { name: user.username, email: user.email },
    });

    try {
      const repository = await this.prisma.repository.create({
        data: {
          ownerType: owner.type,
          ownerId: owner.id,
          name: input.name,
          slug,
          description: input.description ?? null,
          visibility: input.visibility,
          defaultBranch: input.defaultBranch,
          topics: input.topics ?? [],
          isEmpty: !input.initialize,
        },
      });
      await this.audit.record({
        actorId: user.id,
        action: 'repository.created',
        entityType: 'repository',
        entityId: repository.id,
        metadata: { fullName: `${owner.slug}/${slug}` },
      });
      await this.prisma.activity.create({
        data: {
          repositoryId: repository.id,
          actorId: user.id,
          type: 'repository',
          payload: { action: 'create', name: repository.name } as object,
        },
      });
      return this.toDetail(repository, { role: 'admin', source: 'owner' } as ResolvedAccess, owner);
    } catch (error) {
      await this.storage.deleteRepository(owner.slug, slug).catch(() => undefined);
      throw error;
    }
  }

  async update(user: AuthUser, ownerSlug: string, repoSlug: string, input: UpdateRepositoryInput): Promise<RepositoryDetail> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'admin');
    const repository = access.repository;

    let slug = repository.slug;
    if (input.name && toSlug(input.name) !== repository.slug) {
      slug = toSlug(input.name);
      const conflict = await this.prisma.repository.findFirst({
        where: { ownerType: repository.ownerType, ownerId: repository.ownerId, slug, deletedAt: null, NOT: { id: repository.id } },
      });
      if (conflict) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: 'Repository name already exists',
          code: 'REPOSITORY_EXISTS',
        });
      }
      // Renaming on disk: move the bare directory.
      const oldDir = this.storage.repoDir(ownerSlug, repository.slug);
      const newDir = this.storage.repoDir(ownerSlug, slug);
      const { rename } = await import('node:fs/promises');
      await rename(oldDir, newDir).catch((error: unknown) => {
        this.logger.error(`rename failed: ${(error as Error).message}`);
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Failed to rename repository storage',
          code: 'RENAME_FAILED',
        });
      });
    }

    const updated = await this.prisma.repository.update({
      where: { id: repository.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(slug !== repository.slug ? { slug } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility as Visibility } : {}),
        ...(input.defaultBranch !== undefined ? { defaultBranch: input.defaultBranch } : {}),
        ...(input.topics !== undefined ? { topics: input.topics } : {}),
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'repository.updated',
      entityType: 'repository',
      entityId: repository.id,
      metadata: { slug },
    });
    const owner = await this.ownerInfo(updated.ownerType, updated.ownerId);
    return this.toDetail(updated, access, owner);
  }

  async remove(user: AuthUser, ownerSlug: string, repoSlug: string): Promise<void> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'admin');
    const repository = access.repository;
    await this.prisma.repository.update({
      where: { id: repository.id },
      data: { deletedAt: new Date() },
    });
    // Remove the bare directory — irreversible action recorded in audit log.
    await this.storage.deleteRepository(ownerSlug, repository.slug).catch((error: unknown) => {
      this.logger.error(`storage cleanup failed: ${(error as Error).message}`);
    });
    await this.audit.record({
      actorId: user.id,
      action: 'repository.deleted',
      entityType: 'repository',
      entityId: repository.id,
      metadata: { fullName: `${ownerSlug}/${repository.slug}` },
    });
  }

  // ───────────────────────── Listing ─────────────────────────

  async list(
    user: AuthUser | undefined,
    query: {
      q?: string;
      ownerType?: 'user' | 'organization';
      ownerSlug?: string;
      visibility?: 'public' | 'private' | 'internal';
      sort?: 'updated' | 'created' | 'name' | 'stars';
      page: number;
      pageSize: number;
    },
  ) {
    const sortMap = {
      updated: { updatedAt: 'desc' as const },
      created: { createdAt: 'desc' as const },
      name: { name: 'asc' as const },
      stars: { starsCount: 'desc' as const },
    };

    const ownerIdFilter = query.ownerSlug
      ? await this.findOwnerId(query.ownerSlug, query.ownerType)
      : undefined;

    const baseWhere = {
      deletedAt: null,
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { description: { contains: query.q, mode: 'insensitive' as const } },
              { slug: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(query.ownerType ? { ownerType: query.ownerType } : {}),
      ...(ownerIdFilter ? { ownerId: ownerIdFilter } : {}),
      ...(query.visibility ? { visibility: query.visibility as Visibility } : {}),
    };

    // Visibility scope: what the caller is allowed to see at all.
    let visibilityWhere: object = { visibility: 'public' as const };
    if (user) {
      if (!user.isAdmin) {
        const [orgIds, directIds, teamRepoIds] = await Promise.all([
          this.prisma.orgMember
            .findMany({ where: { userId: user.id }, select: { orgId: true } })
            .then((rows) => rows.map((r) => r.orgId)),
          this.prisma.repositoryMember
            .findMany({ where: { userId: user.id }, select: { repositoryId: true } })
            .then((rows) => rows.map((r) => r.repositoryId)),
          this.prisma.$queryRaw<Array<{ repository_id: string }>>`
            SELECT DISTINCT rt.repository_id
            FROM repository_teams rt
            INNER JOIN team_members tm ON tm.team_id = rt.team_id
            WHERE tm.user_id = ${user.id}
          `.then((rows) => rows.map((r) => r.repository_id)),
        ]);
        const memberIds = [...new Set([...directIds, ...teamRepoIds])];
        visibilityWhere = {
          OR: [
            { visibility: 'public' as const },
            { ownerType: 'user' as const, ownerId: user.id },
            { ownerType: 'organization' as const, ownerId: { in: orgIds } },
            ...(memberIds.length ? [{ id: { in: memberIds } }] : []),
          ],
        };
      } else {
        visibilityWhere = {};
      }
    }

    const where = { ...baseWhere, ...(visibilityWhere as object) };

    const [rows, total] = await Promise.all([
      this.prisma.repository.findMany({
        where,
        orderBy: sortMap[query.sort ?? 'updated'],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.repository.count({ where }),
    ]);

    const items = await Promise.all(
      rows.map(async (repo) => {
        const owner = await this.ownerInfo(repo.ownerType, repo.ownerId);
        const access = await this.access.resolve(user, repo);
        return this.toSummary(repo, owner, access);
      }),
    );
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getDetail(user: AuthUser | undefined, ownerSlug: string, repoSlug: string): Promise<RepositoryDetail> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    const owner = await this.ownerInfo(access.repository.ownerType, access.repository.ownerId);
    return this.toDetail(access.repository, access, owner, user);
  }

  // ───────────────────────── Stars / watches / forks ─────────────────────────

  async toggleStar(user: AuthUser, ownerSlug: string, repoSlug: string): Promise<{ starred: boolean; count: number }> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    const existing = await this.prisma.repositoryStar.findUnique({
      where: { repositoryId_userId: { repositoryId: access.repository.id, userId: user.id } },
    });
    if (existing) {
      await this.prisma.$transaction([
        this.prisma.repositoryStar.delete({ where: { id: existing.id } }),
        this.prisma.repository.update({
          where: { id: access.repository.id },
          data: { starsCount: { decrement: 1 } },
        }),
      ]);
      return { starred: false, count: Math.max(0, access.repository.starsCount - 1) };
    }
    await this.prisma.$transaction([
      this.prisma.repositoryStar.create({ data: { repositoryId: access.repository.id, userId: user.id } }),
      this.prisma.repository.update({
        where: { id: access.repository.id },
        data: { starsCount: { increment: 1 } },
      }),
    ]);
    return { starred: true, count: access.repository.starsCount + 1 };
  }

  async toggleWatch(user: AuthUser, ownerSlug: string, repoSlug: string): Promise<{ watching: boolean; count: number }> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    const existing = await this.prisma.repositoryWatcher.findUnique({
      where: { repositoryId_userId: { repositoryId: access.repository.id, userId: user.id } },
    });
    if (existing) {
      await this.prisma.$transaction([
        this.prisma.repositoryWatcher.delete({ where: { id: existing.id } }),
        this.prisma.repository.update({
          where: { id: access.repository.id },
          data: { watchersCount: { decrement: 1 } },
        }),
      ]);
      return { watching: false, count: Math.max(0, access.repository.watchersCount - 1) };
    }
    await this.prisma.$transaction([
      this.prisma.repositoryWatcher.create({ data: { repositoryId: access.repository.id, userId: user.id } }),
      this.prisma.repository.update({
        where: { id: access.repository.id },
        data: { watchersCount: { increment: 1 } },
      }),
    ]);
    return { watching: true, count: access.repository.watchersCount + 1 };
  }

  /** Creates a personal fork of an existing repository. */
  async fork(user: AuthUser, ownerSlug: string, repoSlug: string, targetOrgSlug?: string): Promise<RepositoryDetail> {
    const source = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    if (!source.repository.allowForks) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Forking is disabled for this repository',
        code: 'FORK_DISABLED',
      });
    }

    const owner = targetOrgSlug
      ? await this.resolveOwner(user, 'organization', targetOrgSlug)
      : await this.resolveOwner(user, 'user', undefined);

    const slug = toSlug(source.repository.slug);
    const conflict = await this.prisma.repository.findFirst({
      where: { ownerType: owner.type, ownerId: owner.id, slug, deletedAt: null },
    });
    if (conflict) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: `You already have a fork ${owner.slug}/${slug}`,
        code: 'FORK_EXISTS',
      });
    }

    await this.storage.forkRepository(
      { ownerSlug, repoSlug: source.repository.slug },
      { ownerSlug: owner.slug, repoSlug: slug, defaultBranch: source.repository.defaultBranch },
    );

    try {
      const fork = await this.prisma.repository.create({
        data: {
          ownerType: owner.type,
          ownerId: owner.id,
          name: source.repository.name,
          slug,
          description: source.repository.description,
          visibility: source.repository.visibility === 'internal' ? 'private' : source.repository.visibility,
          defaultBranch: source.repository.defaultBranch,
          topics: source.repository.topics,
          forkParentId: source.repository.id,
          isEmpty: false,
        },
      });
      await this.prisma.repository.update({
        where: { id: source.repository.id },
        data: { forksCount: { increment: 1 } },
      });
      await this.audit.record({
        actorId: user.id,
        action: 'repository.forked',
        entityType: 'repository',
        entityId: fork.id,
        metadata: { from: `${ownerSlug}/${source.repository.slug}` },
      });
      const updated = await this.prisma.repository.findUniqueOrThrow({ where: { id: fork.id } });
      return this.toDetail(updated, { role: 'admin', source: 'owner' } as ResolvedAccess, owner);
    } catch (error) {
      await this.storage.deleteRepository(owner.slug, slug).catch(() => undefined);
      throw error;
    }
  }

  // ───────────────────────── Direct members ─────────────────────────

  async listMembers(user: AuthUser, ownerSlug: string, repoSlug: string) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    const members = await this.prisma.repositoryMember.findMany({
      where: { repositoryId: access.repository.id },
      include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true, createdAt: true } } },
    });
    return members.map((m) => ({ ...m.user, role: m.role, addedAt: m.createdAt.toISOString() }));
  }

  async addMember(user: AuthUser, ownerSlug: string, repoSlug: string, username: string, role: string) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'admin');
    const target = await this.prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (!target) {
      throw new NotFoundException({
        statusCode: 404, error: 'Not Found', message: 'User not found', code: 'USER_NOT_FOUND',
      });
    }
    await this.prisma.repositoryMember.upsert({
      where: { repositoryId_userId: { repositoryId: access.repository.id, userId: target.id } },
      create: { repositoryId: access.repository.id, userId: target.id, role: role as never },
      update: { role: role as never },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'repository.member_added',
      entityType: 'repository',
      entityId: access.repository.id,
      metadata: { username: target.username, role },
    });
    return { username: target.username, role };
  }

  async removeMember(user: AuthUser, ownerSlug: string, repoSlug: string, username: string): Promise<void> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'admin');
    const target = await this.prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (!target) throw new NotFoundException({ statusCode: 404, error: 'Not Found', message: 'User not found', code: 'USER_NOT_FOUND' });
    await this.prisma.repositoryMember.deleteMany({
      where: { repositoryId: access.repository.id, userId: target.id },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'repository.member_removed',
      entityType: 'repository',
      entityId: access.repository.id,
      metadata: { username: target.username },
    });
  }

  // ───────────────────────── Teams ─────────────────────────

  async listTeams(user: AuthUser, ownerSlug: string, repoSlug: string) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'admin');
    const teams = await this.prisma.repositoryTeam.findMany({
      where: { repositoryId: access.repository.id },
      include: { team: true },
    });
    return teams.map((t) => ({
      id: t.team.id,
      name: t.team.name,
      slug: t.team.slug,
      role: t.role,
      organizationId: t.team.organizationId,
    }));
  }

  async addTeam(user: AuthUser, ownerSlug: string, repoSlug: string, teamId: string, role: string) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'admin');
    if (access.repository.ownerType !== 'organization') {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Teams apply to organization repositories only',
        code: 'NOT_ORGANIZATION_REPO',
      });
    }
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId: access.repository.ownerId },
    });
    if (!team) throw new NotFoundException({ statusCode: 404, error: 'Not Found', message: 'Team not found', code: 'TEAM_NOT_FOUND' });
    await this.prisma.repositoryTeam.upsert({
      where: { repositoryId_teamId: { repositoryId: access.repository.id, teamId } },
      create: { repositoryId: access.repository.id, teamId, role: role as never },
      update: { role: role as never },
    });
    return { teamId, role };
  }

  async removeTeam(user: AuthUser, ownerSlug: string, repoSlug: string, teamId: string): Promise<void> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'admin');
    await this.prisma.repositoryTeam.deleteMany({ where: { repositoryId: access.repository.id, teamId } });
  }

  // ───────────────────────── Helpers ─────────────────────────

  private async resolveOwner(user: AuthUser, ownerType: 'user' | 'organization', ownerSlug?: string): Promise<OwnerInfo> {
    if (ownerType === 'organization') {
      const slug = (ownerSlug ?? '').toLowerCase();
      const org = await this.prisma.organization.findUnique({ where: { slug } });
      if (!org) {
        throw new NotFoundException({ statusCode: 404, error: 'Not Found', message: 'Organization not found', code: 'ORG_NOT_FOUND' });
      }
      const member = await this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId: org.id, userId: user.id } },
      });
      if (!member || (member.role !== 'owner' && member.role !== 'maintainer')) {
        throw new ForbiddenException({
          statusCode: 403, error: 'Forbidden',
          message: 'Organization owner or maintainer access required',
          code: 'INSUFFICIENT_ORG_ACCESS',
        });
      }
      return { type: 'organization', id: org.id, slug: org.slug, displayName: org.name, avatarUrl: org.avatarUrl };
    }
    const account = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return {
      type: 'user',
      id: account.id,
      slug: account.username,
      displayName: account.displayName ?? account.username,
      avatarUrl: account.avatarUrl,
    };
  }

  private async findOwnerId(slug: string, ownerType?: 'user' | 'organization'): Promise<string | undefined> {
    const lower = slug.toLowerCase();
    if (ownerType !== 'organization') {
      const user = await this.prisma.user.findUnique({ where: { username: lower } });
      if (user) return user.id;
    }
    if (ownerType !== 'user') {
      const org = await this.prisma.organization.findUnique({ where: { slug: lower } });
      if (org) return org.id;
    }
    return undefined;
  }

  async ownerInfo(ownerType: OwnerType, ownerId: string): Promise<OwnerInfo> {
    if (ownerType === 'user') {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
      return {
        type: 'user',
        id: user.id,
        slug: user.username,
        displayName: user.displayName ?? user.username,
        avatarUrl: user.avatarUrl,
      };
    }
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: ownerId } });
    return {
      type: 'organization',
      id: org.id,
      slug: org.slug,
      displayName: org.name,
      avatarUrl: org.avatarUrl,
    };
  }

  toSummary(repo: Repository, owner: OwnerInfo, access: ResolvedAccess | null): RepositorySummary {
    return {
      id: repo.id,
      slug: repo.slug,
      name: repo.name,
      description: repo.description,
      visibility: repo.visibility,
      ownerType: repo.ownerType,
      ownerId: repo.ownerId,
      owner: { username: owner.slug, displayName: owner.displayName, avatarUrl: owner.avatarUrl },
      defaultBranch: repo.defaultBranch,
      starsCount: repo.starsCount,
      watchersCount: repo.watchersCount,
      forksCount: repo.forksCount,
      openIssuesCount: repo.openIssuesCount,
      openMergeRequestsCount: repo.openMergeRequestsCount,
      language: repo.language,
      updatedAt: repo.updatedAt.toISOString(),
      createdAt: repo.createdAt.toISOString(),
      // extra: caller role attached on detail only
      ...(access ? {} : {}),
    } satisfies RepositorySummary;
  }

  async toDetail(
    repo: Repository,
    access: ResolvedAccess | { role: 'admin'; source: 'owner' },
    owner: OwnerInfo,
    viewer?: AuthUser,
  ): Promise<RepositoryDetail> {
    const base = this.toSummary(repo, owner, access as ResolvedAccess);
    const host = process.env.APP_URL ?? 'http://localhost:3000';
    const hostname = new URL(host).hostname;
    const sshUser = owner.type === 'organization' ? 'git' : owner.slug;

    let starred = false;
    let watched = false;
    if (viewer) {
      const [star, watch] = await Promise.all([
        this.prisma.repositoryStar.findUnique({
          where: { repositoryId_userId: { repositoryId: repo.id, userId: viewer.id } },
        }),
        this.prisma.repositoryWatcher.findUnique({
          where: { repositoryId_userId: { repositoryId: repo.id, userId: viewer.id } },
        }),
      ]);
      starred = Boolean(star);
      watched = Boolean(watch);
    }

    return {
      ...base,
      sshUrl: `ssh://${sshUser}@${hostname}:${process.env.SSH_PORT ?? 2222}/${owner.slug}/${repo.slug}.git`,
      httpUrl: `${host}/git/${owner.slug}/${repo.slug}.git`,
      yourRole: access.role,
      starred,
      watched,
      sizeBytes: Number(repo.sizeBytes),
      topics: repo.topics,
    };
  }
}

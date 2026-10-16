import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateWebhookInput, Release } from '@flygit/shared';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RepositoryAccessService } from '../git/repository-access.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { toSlug } from '../common/utils/crypto.util';

/** Repository-level settings: webhooks, protected branches, releases, wiki. */
@Injectable()
export class RepositorySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: RepositoryAccessService,
    private readonly webhooks: WebhookDispatcherService,
  ) {}

  // ───────────────────────── Webhooks ─────────────────────────

  async listWebhooks(user: AuthUser, ownerSlug: string, repoSlug: string) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'admin');
    const hooks = await this.prisma.webhook.findMany({
      where: { repositoryId: access.repository.id },
      orderBy: { createdAt: 'asc' },
    });
    return hooks.map((h) => ({
      id: h.id,
      url: h.url,
      // Never return the secret — only whether one is set.
      hasSecret: Boolean(h.secret),
      events: h.events,
      active: h.active,
      createdAt: h.createdAt.toISOString(),
    }));
  }

  async createWebhook(user: AuthUser, ownerSlug: string, repoSlug: string, input: CreateWebhookInput) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'admin');
    const hook = await this.prisma.webhook.create({
      data: {
        repositoryId: access.repository.id,
        url: input.url,
        secret: input.secret ?? null,
        events: input.events,
        active: input.active,
      },
    });
    return {
      id: hook.id,
      url: hook.url,
      hasSecret: Boolean(hook.secret),
      events: hook.events,
      active: hook.active,
      createdAt: hook.createdAt.toISOString(),
    };
  }

  async updateWebhook(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    id: string,
    body: { url?: string; secret?: string | null; events?: string[]; active?: boolean },
  ) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'admin');
    const hook = await this.prisma.webhook.findFirst({
      where: { id, repositoryId: access.repository.id },
    });
    if (!hook) throw this.webhookNotFound();
    const updated = await this.prisma.webhook.update({
      where: { id },
      data: {
        ...(body.url !== undefined ? { url: body.url } : {}),
        ...(body.secret !== undefined ? { secret: body.secret || null } : {}),
        ...(body.events !== undefined ? { events: body.events } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });
    return {
      id: updated.id,
      url: updated.url,
      hasSecret: Boolean(updated.secret),
      events: updated.events,
      active: updated.active,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async deleteWebhook(user: AuthUser, ownerSlug: string, repoSlug: string, id: string): Promise<void> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'admin');
    const { count } = await this.prisma.webhook.deleteMany({
      where: { id, repositoryId: access.repository.id },
    });
    if (!count) throw this.webhookNotFound();
  }

  /** Test delivery of a ping event (used by the settings UI). */
  async pingWebhook(user: AuthUser, ownerSlug: string, repoSlug: string, id: string): Promise<void> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'admin');
    const hook = await this.prisma.webhook.findFirst({
      where: { id, repositoryId: access.repository.id },
    });
    if (!hook) throw this.webhookNotFound();
    await this.webhooks.dispatch(access.repository.id, 'push', { ping: true, webhookId: id });
  }

  // ───────────────────────── Protected branches ─────────────────────────

  async listProtectedBranches(user: AuthUser, ownerSlug: string, repoSlug: string) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'admin');
    const rules = await this.prisma.protectedBranch.findMany({
      where: { repositoryId: access.repository.id },
      orderBy: { pattern: 'asc' },
    });
    return rules.map((r) => ({
      id: r.id,
      pattern: r.pattern,
      requireApprovals: r.requireApprovals,
      requireStatusChecks: r.requireStatusChecks,
      allowForcePush: r.allowForcePush,
      allowDeletions: r.allowDeletions,
      allowMerges: r.allowMerges,
      dismissStaleReviews: r.dismissStaleReviews,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async addProtectedBranch(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    body: {
      pattern: string;
      requireApprovals?: number;
      requireStatusChecks?: boolean;
      allowForcePush?: boolean;
      allowDeletions?: boolean;
      allowMerges?: boolean;
      dismissStaleReviews?: boolean;
    },
  ) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'admin');
    const pattern = body.pattern?.trim();
    if (!pattern || pattern.length > 255) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Invalid pattern', code: 'INVALID_PATTERN',
      });
    }
    if (body.requireApprovals !== undefined && (body.requireApprovals < 0 || body.requireApprovals > 10)) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'requireApprovals must be between 0 and 10',
        code: 'INVALID_APPROVALS',
      });
    }
    const existing = await this.prisma.protectedBranch.findUnique({
      where: { repositoryId_pattern: { repositoryId: access.repository.id, pattern } },
    });
    if (existing) {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', message: 'Rule already exists', code: 'PROTECTED_BRANCH_EXISTS',
      });
    }
    const rule = await this.prisma.protectedBranch.create({
      data: {
        repositoryId: access.repository.id,
        pattern,
        requireApprovals: body.requireApprovals ?? 0,
        requireStatusChecks: body.requireStatusChecks ?? false,
        allowForcePush: body.allowForcePush ?? false,
        allowDeletions: body.allowDeletions ?? false,
        allowMerges: body.allowMerges ?? true,
        dismissStaleReviews: body.dismissStaleReviews ?? true,
      },
    });
    return { id: rule.id, pattern: rule.pattern };
  }

  async removeProtectedBranch(user: AuthUser, ownerSlug: string, repoSlug: string, id: string): Promise<void> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'admin');
    const { count } = await this.prisma.protectedBranch.deleteMany({
      where: { id, repositoryId: access.repository.id },
    });
    if (!count) {
      throw new NotFoundException({
        statusCode: 404, error: 'Not Found', message: 'Rule not found', code: 'PROTECTED_BRANCH_NOT_FOUND',
      });
    }
  }

  // ───────────────────────── Releases ─────────────────────────

  async listReleases(user: AuthUser | undefined, ownerSlug: string, repoSlug: string) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    const releases = await this.prisma.release.findMany({
      where: { repositoryId: access.repository.id },
      include: {
        author: { select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true, website: true, createdAt: true } },
        assets: true,
      },
      orderBy: { publishedAt: 'desc', createdAt: 'desc' },
    });
    return releases.map((r) => this.toRelease(r));
  }

  async createRelease(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    body: { tagName: string; name: string; description?: string | null; draft?: boolean; prerelease?: boolean },
  ) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const tagName = body.tagName?.trim();
    if (!tagName) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'tagName is required', code: 'INVALID_TAG',
      });
    }
    const existing = await this.prisma.release.findUnique({
      where: { repositoryId_tagName: { repositoryId: access.repository.id, tagName } },
    });
    if (existing) {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', message: 'Release for this tag already exists',
        code: 'RELEASE_EXISTS',
      });
    }
    const release = await this.prisma.release.create({
      data: {
        repositoryId: access.repository.id,
        tagName,
        name: body.name?.trim() || tagName,
        description: body.description ?? null,
        draft: body.draft ?? false,
        prerelease: body.prerelease ?? false,
        authorId: user.id,
        publishedAt: body.draft ? null : new Date(),
      },
      include: {
        author: { select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true, website: true, createdAt: true } },
        assets: true,
      },
    });
    if (!release.draft) {
      await this.webhooks.dispatch(access.repository.id, 'release', {
        action: 'published',
        release: { tagName: release.tagName, name: release.name },
      });
    }
    return this.toRelease(release);
  }

  async deleteRelease(user: AuthUser, ownerSlug: string, repoSlug: string, id: string): Promise<void> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const { count } = await this.prisma.release.deleteMany({
      where: { id, repositoryId: access.repository.id },
    });
    if (!count) {
      throw new NotFoundException({
        statusCode: 404, error: 'Not Found', message: 'Release not found', code: 'RELEASE_NOT_FOUND',
      });
    }
  }

  // ───────────────────────── Wiki ─────────────────────────

  async listWikiPages(user: AuthUser | undefined, ownerSlug: string, repoSlug: string) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    const pages = await this.prisma.wikiPage.findMany({
      where: { repositoryId: access.repository.id },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, slug: true, title: true, updatedAt: true },
    });
    return pages.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() }));
  }

  async getWikiPage(user: AuthUser | undefined, ownerSlug: string, repoSlug: string, slug: string) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    const page = await this.prisma.wikiPage.findUnique({
      where: { repositoryId_slug: { repositoryId: access.repository.id, slug } },
    });
    if (!page) throw this.wikiNotFound();
    return { ...page, createdAt: page.createdAt.toISOString(), updatedAt: page.updatedAt.toISOString() };
  }

  async upsertWikiPage(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    slug: string,
    body: { title?: string; content: string },
  ) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const safeSlug = toSlug(slug);
    if (!safeSlug) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Invalid page slug', code: 'INVALID_SLUG',
      });
    }
    if (typeof body.content !== 'string' || body.content.length > 1_000_000) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Invalid content', code: 'INVALID_CONTENT',
      });
    }
    const page = await this.prisma.wikiPage.upsert({
      where: { repositoryId_slug: { repositoryId: access.repository.id, slug: safeSlug } },
      create: {
        repositoryId: access.repository.id,
        slug: safeSlug,
        title: body.title?.trim() || safeSlug,
        content: body.content,
        authorId: user.id,
      },
      update: {
        title: body.title?.trim() || undefined,
        content: body.content,
      },
    });
    return { ...page, createdAt: page.createdAt.toISOString(), updatedAt: page.updatedAt.toISOString() };
  }

  async deleteWikiPage(user: AuthUser, ownerSlug: string, repoSlug: string, slug: string): Promise<void> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const { count } = await this.prisma.wikiPage.deleteMany({
      where: { repositoryId: access.repository.id, slug },
    });
    if (!count) throw this.wikiNotFound();
  }

  // ───────────────────────── Helpers ─────────────────────────

  private toRelease(r: {
    id: string;
    tagName: string;
    name: string;
    description: string | null;
    draft: boolean;
    prerelease: boolean;
    createdAt: Date;
    publishedAt: Date | null;
    author: { id: string; username: string; displayName: string | null; avatarUrl: string | null; bio: string | null; website: string | null; createdAt: Date };
    assets: Array<{ id: string; name: string; size: bigint; storageKey: string }>;
  }): Release {
    return {
      id: r.id,
      tagName: r.tagName,
      name: r.name,
      description: r.description,
      draft: r.draft,
      prerelease: r.prerelease,
      author: {
        id: r.author.id,
        username: r.author.username,
        displayName: r.author.displayName,
        avatarUrl: r.author.avatarUrl,
        bio: r.author.bio,
        website: r.author.website,
        createdAt: r.author.createdAt.toISOString(),
      },
      assets: r.assets.map((a) => ({
        id: a.id,
        name: a.name,
        size: Number(a.size),
        downloadUrl: `/api/v1/releases/assets/${a.id}/download`,
      })),
      createdAt: r.createdAt.toISOString(),
      publishedAt: r.publishedAt?.toISOString() ?? null,
    };
  }

  private webhookNotFound(): NotFoundException {
    return new NotFoundException({
      statusCode: 404, error: 'Not Found', message: 'Webhook not found', code: 'WEBHOOK_NOT_FOUND',
    });
  }

  private wikiNotFound(): NotFoundException {
    return new NotFoundException({
      statusCode: 404, error: 'Not Found', message: 'Wiki page not found', code: 'WIKI_PAGE_NOT_FOUND',
    });
  }
}

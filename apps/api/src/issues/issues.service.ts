import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateIssueInput,
  Issue,
  IssueComment,
  IssueListQuery,
  IssueStatus,
  Label,
  UpdateIssueInput,
} from '@flygit/shared';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { NotificationService, extractMentions } from '../notifications/notification.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { RepositoryAccessService } from '../git/repository-access.service';

const USER_PUBLIC_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  website: true,
  createdAt: true,
} as const;

/** Issues: CRUD, labels, milestones, comments and reactions. */
@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: RepositoryAccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly webhooks: WebhookDispatcherService,
  ) {}

  // ───────────────────────── Issues ─────────────────────────

  async list(user: AuthUser | undefined, ownerSlug: string, repoSlug: string, query: IssueListQuery) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    if (!access.repository.allowIssues) return this.emptyPage(query);

    const sortMap: Record<string, object> = {
      created: { createdAt: 'desc' },
      updated: { updatedAt: 'desc' },
      comments: { _count: { comments: 'desc' } },
    };

    // assignee=username or "none"/"*"
    let assigneeUserId: string | undefined;
    if (query.assignee && query.assignee !== '*' && query.assignee !== 'none') {
      const u = await this.prisma.user.findUnique({ where: { username: query.assignee.toLowerCase() } });
      assigneeUserId = u?.id;
      if (!u) return this.emptyPage(query);
    }

    const where = {
      repositoryId: access.repository.id,
      ...(query.status !== 'all' ? { status: query.status as IssueStatus } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' as const } },
              { body: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(query.label?.length
        ? { labels: { some: { labelId: { in: query.label } } } }
        : {}),
      ...(query.assignee === 'none'
        ? { assignees: { none: {} } }
        : assigneeUserId
          ? { assignees: { some: { userId: assigneeUserId } } }
          : {}),
      ...(query.milestone
        ? {
            OR: [
              { milestone: { slug: query.milestone } },
              { milestone: { id: query.milestone } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.issue.findMany({
        where,
        include: this.issueInclude(),
        orderBy: [
          sortMap[query.sort] ?? { createdAt: 'desc' },
          { number: query.direction === 'asc' ? ('asc' as const) : ('desc' as const) },
        ] as never,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.issue.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.toIssue(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(user: AuthUser | undefined, ownerSlug: string, repoSlug: string, number: number): Promise<Issue> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    const issue = await this.prisma.issue.findUnique({
      where: { repositoryId_number: { repositoryId: access.repository.id, number } },
      include: this.issueInclude(),
    });
    if (!issue) throw this.notFound('ISSUE_NOT_FOUND');
    return this.toIssue(issue);
  }

  async create(user: AuthUser, ownerSlug: string, repoSlug: string, input: CreateIssueInput): Promise<Issue> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    if (!access.repository.allowIssues) {
      throw new ForbiddenException({
        statusCode: 403, error: 'Forbidden', message: 'Issues are disabled for this repository',
        code: 'ISSUES_DISABLED',
      });
    }
    const nextNumber = (access.repository.lastIssueNumber ?? 0) + 1;
    const issue = await this.prisma.$transaction(async (tx) => {
      const created = await tx.issue.create({
        data: {
          repositoryId: access.repository.id,
          number: nextNumber,
          authorId: user.id,
          title: input.title,
          body: input.body ?? null,
          milestoneId: input.milestoneId ?? null,
          labels: input.labels?.length
            ? { create: input.labels.map((labelId) => ({ labelId })) }
            : undefined,
          assignees: input.assignees?.length
            ? { create: input.assignees.map((userId) => ({ userId })) }
            : undefined,
        },
        include: this.issueInclude(),
      });
      await tx.repository.update({
        where: { id: access.repository.id },
        data: {
          lastIssueNumber: nextNumber,
          openIssuesCount: { increment: 1 },
        },
      });
      return created;
    });

    await this.afterIssueEvent(issue, 'opened', user, access.repository);
    return this.toIssue(issue);
  }

  async update(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    number: number,
    input: UpdateIssueInput,
  ): Promise<Issue> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const existing = await this.prisma.issue.findUnique({
      where: { repositoryId_number: { repositoryId: access.repository.id, number } },
    });
    if (!existing) throw this.notFound('ISSUE_NOT_FOUND');

    const statusChanged = input.status !== undefined && input.status !== existing.status;
    const status: IssueStatus = input.status ?? existing.status;

    const issue = await this.prisma.$transaction(async (tx) => {
      if (statusChanged) {
        await tx.repository.update({
          where: { id: access.repository.id },
          data: {
            openIssuesCount: {
              increment: status === 'open' ? 1 : -1,
            },
          },
        });
      }
      // Replace labels/assignees when provided (full sync semantics).
      if (input.labels) {
        await tx.issueLabel.deleteMany({ where: { issueId: existing.id } });
        if (input.labels.length) {
          await tx.issueLabel.createMany({
            data: input.labels.map((labelId) => ({ issueId: existing.id, labelId })),
          });
        }
      }
      if (input.assignees) {
        await tx.issueAssignee.deleteMany({ where: { issueId: existing.id } });
        if (input.assignees.length) {
          await tx.issueAssignee.createMany({
            data: input.assignees.map((userId) => ({ issueId: existing.id, userId })),
          });
        }
      }
      return tx.issue.update({
        where: { id: existing.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.milestoneId !== undefined ? { milestoneId: input.milestoneId } : {}),
          ...(statusChanged
            ? { status, closedAt: status === 'closed' ? new Date() : null }
            : {}),
        },
        include: this.issueInclude(),
      });
    });

    if (statusChanged) {
      await this.afterIssueEvent(issue, status === 'closed' ? 'closed' : 'reopened', user, access.repository);
      // Notify assignees of close/reopen.
      await this.notifications.notifyMany(
        issue.assignees.map((a) => a.userId),
        {
          type: 'issue_opened',
          title: status === 'closed' ? `Issue #${number} closed` : `Issue #${number} reopened`,
          body: issue.title,
          url: this.issueUrl(access.repository, number),
          actorId: user.id,
        },
      );
    }
    return this.toIssue(issue);
  }

  async remove(user: AuthUser, ownerSlug: string, repoSlug: string, number: number): Promise<void> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'maintainer');
    const issue = await this.prisma.issue.findUnique({
      where: { repositoryId_number: { repositoryId: access.repository.id, number } },
    });
    if (!issue) throw this.notFound('ISSUE_NOT_FOUND');
    await this.prisma.$transaction([
      this.prisma.issue.delete({ where: { id: issue.id } }),
      this.prisma.repository.update({
        where: { id: access.repository.id },
        data: { openIssuesCount: { decrement: issue.status === 'open' ? 1 : 0 } },
      }),
    ]);
    await this.audit.record({
      actorId: user.id,
      action: 'issue.deleted',
      entityType: 'issue',
      entityId: issue.id,
      metadata: { number, title: issue.title },
    });
  }

  // ───────────────────────── Comments ─────────────────────────

  async listComments(
    user: AuthUser | undefined,
    ownerSlug: string,
    repoSlug: string,
    number: number,
  ): Promise<IssueComment[]> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    const issue = await this.prisma.issue.findUnique({
      where: { repositoryId_number: { repositoryId: access.repository.id, number } },
      select: { id: true },
    });
    if (!issue) throw this.notFound('ISSUE_NOT_FOUND');
    const comments = await this.prisma.comment.findMany({
      where: { issueId: issue.id, target: 'issue' },
      include: { author: { select: USER_PUBLIC_SELECT }, reactions: true, replies: true },
      orderBy: { createdAt: 'asc' },
    });
    return comments.map((c) => this.toComment(c));
  }

  async addComment(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    number: number,
    body: string,
  ): Promise<IssueComment> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const issue = await this.prisma.issue.findUnique({
      where: { repositoryId_number: { repositoryId: access.repository.id, number } },
      include: { assignees: true },
    });
    if (!issue) throw this.notFound('ISSUE_NOT_FOUND');

    const comment = await this.prisma.comment.create({
      data: {
        repositoryId: access.repository.id,
        target: 'issue',
        issueId: issue.id,
        authorId: user.id,
        body,
      },
      include: { author: { select: USER_PUBLIC_SELECT }, reactions: true, replies: true },
    });

    // Notify the issue author, assignees and @mentioned users.
    const mentioned = await this.resolveMentions(body);
    const recipients = new Set<string>([issue.authorId, ...issue.assignees.map((a) => a.userId)]);
    for (const id of mentioned) recipients.add(id);
    await this.notifications.notifyMany([...recipients], {
      type: 'issue_comment',
      title: `New comment on issue #${number}`,
      body: issue.title,
      url: this.issueUrl(access.repository, number),
      actorId: user.id,
    });
    await this.webhooks.dispatch(access.repository.id, 'issue_comment', {
      action: 'created',
      issue: { number, title: issue.title },
      comment: { id: comment.id, body: body.slice(0, 500) },
    });
    return this.toComment(comment);
  }

  async updateComment(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    commentId: string,
    body: string,
  ): Promise<IssueComment> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, target: 'issue', repositoryId: access.repository.id },
    });
    if (!comment) throw this.notFound('COMMENT_NOT_FOUND');
    if (comment.authorId !== user.id && !user.isAdmin) {
      throw new ForbiddenException({
        statusCode: 403, error: 'Forbidden', message: 'Not your comment', code: 'NOT_COMMENT_AUTHOR',
      });
    }
    const updated = await this.prisma.comment.update({
      where: { id: comment.id },
      data: { body, editedAt: new Date() },
      include: { author: { select: USER_PUBLIC_SELECT }, reactions: true, replies: true },
    });
    return this.toComment(updated);
  }

  async deleteComment(user: AuthUser, ownerSlug: string, repoSlug: string, commentId: string): Promise<void> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, target: 'issue', repositoryId: access.repository.id },
    });
    if (!comment) throw this.notFound('COMMENT_NOT_FOUND');
    if (comment.authorId !== user.id && !user.isAdmin && access.role !== 'admin' && access.role !== 'maintainer') {
      throw new ForbiddenException({
        statusCode: 403, error: 'Forbidden', message: 'Cannot delete this comment', code: 'NOT_COMMENT_AUTHOR',
      });
    }
    await this.prisma.comment.delete({ where: { id: comment.id } });
  }

  async toggleReaction(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    commentId: string,
    emoji: string,
  ): Promise<{ reactions: Record<string, string[]>; added: boolean }> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, repositoryId: access.repository.id },
      select: { id: true },
    });
    if (!comment) throw this.notFound('COMMENT_NOT_FOUND');
    if (!emoji || emoji.length > 16) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Invalid emoji', code: 'INVALID_EMOJI',
      });
    }
    const existing = await this.prisma.reaction.findUnique({
      where: { commentId_userId_emoji: { commentId, userId: user.id, emoji } },
    });
    if (existing) {
      await this.prisma.reaction.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.reaction.create({ data: { commentId, userId: user.id, emoji } });
    }
    const reactions = await this.prisma.reaction.findMany({ where: { commentId } });
    return { reactions: this.groupReactions(reactions), added: !existing };
  }

  // ───────────────────────── Labels ─────────────────────────

  async listLabels(user: AuthUser | undefined, ownerSlug: string, repoSlug: string): Promise<Label[]> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    const labels = await this.prisma.label.findMany({
      where: { repositoryId: access.repository.id },
      orderBy: { name: 'asc' },
    });
    return labels;
  }

  async createLabel(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    input: { name: string; color: string; description?: string | null },
  ): Promise<Label> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'maintainer');
    return this.prisma.label.create({
      data: {
        repositoryId: access.repository.id,
        name: input.name,
        color: input.color,
        description: input.description ?? null,
      },
    });
  }

  async updateLabel(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    labelId: string,
    input: { name?: string; color?: string; description?: string | null },
  ): Promise<Label> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'maintainer');
    const label = await this.prisma.label.findFirst({
      where: { id: labelId, repositoryId: access.repository.id },
    });
    if (!label) throw this.notFound('LABEL_NOT_FOUND');
    return this.prisma.label.update({
      where: { id: label.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
    });
  }

  async deleteLabel(user: AuthUser, ownerSlug: string, repoSlug: string, labelId: string): Promise<void> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'maintainer');
    const { count } = await this.prisma.label.deleteMany({
      where: { id: labelId, repositoryId: access.repository.id },
    });
    if (!count) throw this.notFound('LABEL_NOT_FOUND');
  }

  // ───────────────────────── Milestones ─────────────────────────

  async listMilestones(user: AuthUser | undefined, ownerSlug: string, repoSlug: string) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    const milestones = await this.prisma.milestone.findMany({
      where: { repositoryId: access.repository.id },
      include: { _count: { select: { issues: true } } },
      orderBy: { dueOn: 'asc' },
    });
    return milestones.map((m) => ({
      id: m.id,
      slug: m.slug,
      title: m.title,
      description: m.description,
      dueOn: m.dueOn?.toISOString() ?? null,
      state: m.state,
      openIssues: m._count.issues,
    }));
  }

  async createMilestone(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    input: { title: string; description?: string | null; dueOn?: string | null },
  ) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'maintainer');
    const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
    return this.prisma.milestone.create({
      data: {
        repositoryId: access.repository.id,
        title: input.title,
        slug: slug || `m-${Date.now()}`,
        description: input.description ?? null,
        dueOn: input.dueOn ? new Date(input.dueOn) : null,
      },
    });
  }

  async updateMilestone(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    milestoneId: string,
    input: { title?: string; description?: string | null; dueOn?: string | null; state?: 'open' | 'closed' },
  ) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'maintainer');
    const milestone = await this.prisma.milestone.findFirst({
      where: { id: milestoneId, repositoryId: access.repository.id },
    });
    if (!milestone) throw this.notFound('MILESTONE_NOT_FOUND');
    return this.prisma.milestone.update({
      where: { id: milestone.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.dueOn !== undefined ? { dueOn: input.dueOn ? new Date(input.dueOn) : null } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
      },
    });
  }

  async deleteMilestone(user: AuthUser, ownerSlug: string, repoSlug: string, milestoneId: string): Promise<void> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'maintainer');
    const { count } = await this.prisma.milestone.deleteMany({
      where: { id: milestoneId, repositoryId: access.repository.id },
    });
    if (!count) throw this.notFound('MILESTONE_NOT_FOUND');
  }

  // ───────────────────────── Helpers ─────────────────────────

  private issueInclude() {
    return {
      author: { select: USER_PUBLIC_SELECT },
      assignees: { include: { user: { select: USER_PUBLIC_SELECT } } },
      labels: { include: { label: true } },
      milestone: true,
      _count: { select: { comments: true } },
    } as const;
  }

  private toIssue(row: {
    id: string;
    number: number;
    title: string;
    body: string | null;
    status: IssueStatus;
    createdAt: Date;
    updatedAt: Date;
    closedAt: Date | null;
    author: { id: string; username: string; displayName: string | null; avatarUrl: string | null; bio: string | null; website: string | null; createdAt: Date };
    assignees: Array<{ user: { id: string; username: string; displayName: string | null; avatarUrl: string | null; bio: string | null; website: string | null; createdAt: Date } }>;
    labels: Array<{ label: { id: string; name: string; color: string; description: string | null } }>;
    milestone: { id: string; slug: string; title: string; description: string | null; dueOn: Date | null; state: 'open' | 'closed' } | null;
    _count: { comments: number };
  }): Issue {
    return {
      id: row.id,
      number: row.number,
      title: row.title,
      body: row.body,
      status: row.status,
      author: this.toUser(row.author),
      assignees: row.assignees.map((a) => this.toUser(a.user)),
      labels: row.labels.map((l) => l.label),
      milestone: row.milestone
        ? {
            id: row.milestone.id,
            title: row.milestone.title,
            description: row.milestone.description,
            dueOn: row.milestone.dueOn?.toISOString() ?? null,
            state: row.milestone.state,
            openIssues: 0,
            closedIssues: 0,
          }
        : null,
      commentsCount: row._count.comments,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      linkedMergeRequests: [],
    };
  }

  private toComment(row: {
    id: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
    editedAt: Date | null;
    author: { id: string; username: string; displayName: string | null; avatarUrl: string | null; bio: string | null; website: string | null; createdAt: Date };
    reactions?: Array<{ emoji: string; userId: string }>;
  }): IssueComment {
    return {
      id: row.id,
      body: row.body,
      author: this.toUser(row.author),
      createdAt: row.createdAt.toISOString(),
      updatedAt: (row.editedAt ?? row.updatedAt).toISOString(),
      reactions: this.groupReactions(row.reactions ?? []),
    };
  }

  private toUser(u: {
    id: string; username: string; displayName: string | null; avatarUrl: string | null;
    bio: string | null; website: string | null; createdAt: Date;
  }) {
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      bio: u.bio,
      website: u.website,
      createdAt: u.createdAt.toISOString(),
    };
  }

  private groupReactions(reactions: Array<{ emoji: string; userId: string }>): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    for (const r of reactions) (map[r.emoji] ??= []).push(r.userId);
    return map;
  }

  private async afterIssueEvent(
    issue: { id: string; number: number; title: string; authorId: string; assignees: Array<{ userId: string }> },
    action: 'opened' | 'closed' | 'reopened',
    actor: AuthUser,
    repo: { id: string; slug: string; ownerType: string; ownerId: string },
  ): Promise<void> {
    await this.audit.record({
      actorId: actor.id,
      action: `issue.${action}`,
      entityType: 'issue',
      entityId: issue.id,
      metadata: { number: issue.number, title: issue.title, repositoryId: repo.id },
    });
    if (action === 'opened') {
      // Notify repo watchers + assignees.
      const watchers = await this.prisma.repositoryWatcher.findMany({
        where: { repositoryId: repo.id },
        select: { userId: true },
      });
      const recipients = new Set<string>([...watchers.map((w) => w.userId), ...issue.assignees.map((a) => a.userId)]);
      recipients.delete(issue.authorId);
      await this.notifications.notifyMany([...recipients], {
        type: 'issue_opened',
        title: `New issue #${issue.number}: ${issue.title}`,
        url: this.issueUrl(repo, issue.number),
        actorId: actor.id,
      });
      await this.webhooks.dispatch(repo.id, 'issue', {
        action: 'opened',
        issue: { number: issue.number, title: issue.title },
      });
    } else {
      await this.webhooks.dispatch(repo.id, 'issue', {
        action,
        issue: { number: issue.number, title: issue.title },
      });
    }
  }

  private async resolveMentions(body: string): Promise<string[]> {
    const usernames = extractMentions(body);
    if (!usernames.length) return [];
    const users = await this.prisma.user.findMany({
      where: { username: { in: usernames.map((u) => u.toLowerCase()) } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  private issueUrl(repo: { id: string; slug: string }, number: number): string {
    return `/r/${repo.slug}/issues/${number}`;
  }

  private emptyPage(query: { page: number; pageSize: number }) {
    return { items: [] as Issue[], total: 0, page: query.page, pageSize: query.pageSize };
  }

  private notFound(code: string): NotFoundException {
    return new NotFoundException({
      statusCode: 404,
      error: 'Not Found',
      message: code.replaceAll('_', ' ').toLowerCase(),
      code,
    });
  }
}

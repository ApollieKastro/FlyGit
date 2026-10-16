import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateMergeRequestInput,
  FileDiff,
  MergeInput,
  MergeRequest,
  MergeRequestDetail,
  MergeRequestListQuery,
  MrStatus,
  ReviewComment,
  ReviewCommentInput,
  ReviewInput,
  UpdateMergeRequestInput,
} from '@flygit/shared';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.module';
import type { NotificationService } from '../notifications/notification.service';
import type { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import type { RepositoryAccessService } from '../git/repository-access.service';
import type { GitCliService } from '../git/git-cli.service';
import type { GitStorageService } from '../git/git-storage.service';

const USER_PUBLIC_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  website: true,
  createdAt: true,
} as const;

/** Merge requests: creation, review workflow, diffs and merging. */
@Injectable()
export class MergeRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: RepositoryAccessService,
    private readonly git: GitCliService,
    private readonly storage: GitStorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly webhooks: WebhookDispatcherService,
  ) {}

  // ───────────────────────── List / get ─────────────────────────

  async list(user: AuthUser | undefined, ownerSlug: string, repoSlug: string, query: MergeRequestListQuery) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    if (!access.repository.allowMergeRequests) return this.emptyPage(query);

    const sortMap: Record<string, object> = {
      created: { createdAt: 'desc' },
      updated: { updatedAt: 'desc' },
    };

    let authorId: string | undefined;
    if (query.author) {
      const u = await this.prisma.user.findUnique({ where: { username: query.author.toLowerCase() } });
      if (!u) return this.emptyPage(query);
      authorId = u.id;
    }
    let reviewerId: string | undefined;
    if (query.reviewer) {
      const u = await this.prisma.user.findUnique({ where: { username: query.reviewer.toLowerCase() } });
      if (!u) return this.emptyPage(query);
      reviewerId = u.id;
    }

    const where = {
      repositoryId: access.repository.id,
      ...(query.status !== 'all' ? { status: query.status as MrStatus } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' as const } },
              { description: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(authorId ? { authorId } : {}),
      ...(reviewerId ? { reviewers: { some: { userId: reviewerId } } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.mergeRequest.findMany({
        where,
        include: this.mrInclude(),
        orderBy: [sortMap[query.sort] ?? { createdAt: 'desc' }, { number: 'desc' }] as never,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.mergeRequest.count({ where }),
    ]);

    return {
      items: await Promise.all(rows.map((r) => this.toMr(r))),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(user: AuthUser | undefined, ownerSlug: string, repoSlug: string, number: number): Promise<MergeRequestDetail> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    const mr = await this.prisma.mergeRequest.findUnique({
      where: { repositoryId_number: { repositoryId: access.repository.id, number } },
      include: this.mrInclude(),
    });
    if (!mr) throw this.notFound('MR_NOT_FOUND');
    const repoDir = this.repoDir(ownerSlug, access.repository.slug);
    const [commits, files, base] = await Promise.all([
      this.git.listCommitsRange(repoDir, `${mr.baseSha}..${mr.headSha}`),
      this.git.compare(repoDir, mr.baseSha, mr.headSha).catch(() => [] as FileDiff[]),
      this.prisma.protectedBranch.findFirst({
        where: { repositoryId: access.repository.id, pattern: mr.targetBranch },
      }),
    ]);
    const approvals = mr.reviewers.filter((r) => r.state === 'approved').length;
    const base2 = await this.toMr(mr);
    return {
      ...base2,
      mergeSha: mr.mergeSha,
      requiredApprovals: base?.requireApprovals ?? 0,
      approvalsCount: approvals,
      headSha: mr.headSha,
      baseSha: mr.baseSha,
      commitsCount: commits.length,
      filesChangedCount: files.length,
      additions: files.reduce((s, f) => s + f.additions, 0),
      deletions: files.reduce((s, f) => s + f.deletions, 0),
    };
  }

  async diff(
    user: AuthUser | undefined,
    ownerSlug: string,
    repoSlug: string,
    number: number,
    opts: { page?: number; pageSize?: number } = {},
  ): Promise<{ files: FileDiff[]; truncated: boolean }> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    const mr = await this.prisma.mergeRequest.findUnique({
      where: { repositoryId_number: { repositoryId: access.repository.id, number } },
    });
    if (!mr) throw this.notFound('MR_NOT_FOUND');
    const repoDir = this.repoDir(ownerSlug, access.repository.slug);
    const files = await this.git.compare(repoDir, mr.baseSha, mr.headSha).catch(() => [] as FileDiff[]);
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const slice = files.slice((page - 1) * pageSize, page * pageSize);
    return { files: slice, truncated: slice.length < files.length };
  }

  async commits(user: AuthUser | undefined, ownerSlug: string, repoSlug: string, number: number) {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    const mr = await this.prisma.mergeRequest.findUnique({
      where: { repositoryId_number: { repositoryId: access.repository.id, number } },
    });
    if (!mr) throw this.notFound('MR_NOT_FOUND');
    const repoDir = this.repoDir(ownerSlug, access.repository.slug);
    return this.git.listCommitsRange(repoDir, `${mr.baseSha}..${mr.headSha}`);
  }

  // ───────────────────────── Create / update ─────────────────────────

  async create(user: AuthUser, ownerSlug: string, repoSlug: string, input: CreateMergeRequestInput): Promise<MergeRequestDetail> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    if (!access.repository.allowMergeRequests) {
      throw new ForbiddenException({
        statusCode: 403, error: 'Forbidden', message: 'Merge requests are disabled',
        code: 'MR_DISABLED',
      });
    }
    if (input.sourceBranch === input.targetBranch) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Source and target branches must differ',
        code: 'SAME_BRANCHES',
      });
    }
    const repoDir = this.repoDir(ownerSlug, access.repository.slug);
    const headSha = await this.git.revParse(repoDir, input.sourceBranch);
    const baseSha = await this.git.revParse(repoDir, input.targetBranch);
    if (!headSha) {
      throw new NotFoundException({
        statusCode: 404, error: 'Not Found', message: 'Source branch not found', code: 'BRANCH_NOT_FOUND',
      });
    }
    if (!baseSha) {
      throw new NotFoundException({
        statusCode: 404, error: 'Not Found', message: 'Target branch not found', code: 'BRANCH_NOT_FOUND',
      });
    }

    const existing = await this.prisma.mergeRequest.findFirst({
      where: {
        repositoryId: access.repository.id,
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        status: 'open',
      },
    });
    if (existing) {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict',
        message: `Open merge request #${existing.number} already exists for these branches`,
        code: 'MR_EXISTS',
      });
    }

    const nextNumber = (access.repository.lastMergeRequestNumber ?? 0) + 1;
    const mr = await this.prisma.$transaction(async (tx) => {
      const created = await tx.mergeRequest.create({
        data: {
          repositoryId: access.repository.id,
          number: nextNumber,
          authorId: user.id,
          sourceBranch: input.sourceBranch,
          targetBranch: input.targetBranch,
          title: input.title,
          description: input.description ?? null,
          draft: input.draft,
          autoCloseIssues: input.autoCloseIssues,
          headSha,
          baseSha,
          reviewers: input.reviewerIds?.length
            ? { create: input.reviewerIds.map((userId) => ({ userId })) }
            : undefined,
        },
        include: this.mrInclude(),
      });
      await tx.repository.update({
        where: { id: access.repository.id },
        data: {
          lastMergeRequestNumber: nextNumber,
          openMergeRequestsCount: { increment: 1 },
        },
      });
      return created;
    });

    await this.audit.record({
      actorId: user.id,
      action: 'merge_request.opened',
      entityType: 'merge_request',
      entityId: mr.id,
      metadata: { number: nextNumber, title: input.title },
    });
    // Notify reviewers and watchers.
    const watchers = await this.prisma.repositoryWatcher.findMany({
      where: { repositoryId: access.repository.id },
      select: { userId: true },
    });
    const recipients = new Set<string>([
      ...mr.reviewers.map((r) => r.userId),
      ...watchers.map((w) => w.userId),
    ]);
    recipients.delete(user.id);
    await this.notifications.notifyMany([...recipients], {
      type: 'mr_opened',
      title: `New merge request #${nextNumber}: ${input.title}`,
      url: this.mrUrl(access.repository.slug, nextNumber),
      actorId: user.id,
    });
    await this.webhooks.dispatch(access.repository.id, 'merge_request', {
      action: 'opened',
      mergeRequest: { number: nextNumber, title: input.title, sourceBranch: input.sourceBranch, targetBranch: input.targetBranch },
    });
    return this.get(user, ownerSlug, repoSlug, nextNumber);
  }

  async update(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    number: number,
    input: UpdateMergeRequestInput,
  ): Promise<MergeRequest> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const mr = await this.prisma.mergeRequest.findUnique({
      where: { repositoryId_number: { repositoryId: access.repository.id, number } },
      include: this.mrInclude(),
    });
    if (!mr) throw this.notFound('MR_NOT_FOUND');
    if (mr.status !== 'open') {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', message: 'Merge request is not open', code: 'MR_NOT_OPEN',
      });
    }
    if (mr.authorId !== user.id && access.role !== 'admin' && access.role !== 'maintainer') {
      throw new ForbiddenException({
        statusCode: 403, error: 'Forbidden', message: 'Not your merge request', code: 'NOT_MR_AUTHOR',
      });
    }

    let baseSha = mr.baseSha;
    if (input.targetBranch && input.targetBranch !== mr.targetBranch) {
      const sha = await this.git.revParse(this.repoDir(ownerSlug, access.repository.slug), input.targetBranch);
      if (!sha) {
        throw new NotFoundException({
          statusCode: 404, error: 'Not Found', message: 'Target branch not found', code: 'BRANCH_NOT_FOUND',
        });
      }
      baseSha = sha;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.reviewerIds) {
        await tx.mergeRequestReviewer.deleteMany({ where: { mrId: mr.id } });
        if (input.reviewerIds.length) {
          await tx.mergeRequestReviewer.createMany({
            data: input.reviewerIds.map((userId) => ({ mrId: mr.id, userId })),
          });
        }
      }
      return tx.mergeRequest.update({
        where: { id: mr.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.draft !== undefined ? { draft: input.draft } : {}),
          ...(input.targetBranch !== undefined ? { targetBranch: input.targetBranch, baseSha } : {}),
        },
        include: this.mrInclude(),
      });
    });

    // Notify newly added reviewers.
    if (input.reviewerIds?.length) {
      const newReviewers = updated.reviewers.filter((r) => !mr.reviewers.some((old) => old.userId === r.userId));
      await this.notifications.notifyMany(
        newReviewers.map((r) => r.userId),
        {
          type: 'mr_review_requested',
          title: `Review requested on #${number}: ${updated.title}`,
          url: this.mrUrl(access.repository.slug, number),
          actorId: user.id,
        },
      );
    }
    return this.toMr(updated);
  }

  async close(user: AuthUser, ownerSlug: string, repoSlug: string, number: number): Promise<MergeRequest> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const mr = await this.prisma.mergeRequest.findUnique({
      where: { repositoryId_number: { repositoryId: access.repository.id, number } },
      include: this.mrInclude(),
    });
    if (!mr) throw this.notFound('MR_NOT_FOUND');
    if (mr.status !== 'open') {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', message: 'Merge request is not open', code: 'MR_NOT_OPEN',
      });
    }
    if (mr.authorId !== user.id && access.role !== 'admin' && access.role !== 'maintainer') {
      throw new ForbiddenException({
        statusCode: 403, error: 'Forbidden', message: 'Not your merge request', code: 'NOT_MR_AUTHOR',
      });
    }
    const updated = await this.prisma.mergeRequest.update({
      where: { id: mr.id },
      data: { status: 'closed', closedAt: new Date() },
      include: this.mrInclude(),
    });
    await this.prisma.repository.update({
      where: { id: access.repository.id },
      data: { openMergeRequestsCount: { decrement: 1 } },
    });
    await this.webhooks.dispatch(access.repository.id, 'merge_request', {
      action: 'closed',
      mergeRequest: { number, title: mr.title },
    });
    return this.toMr(updated);
  }

  async reopen(user: AuthUser, ownerSlug: string, repoSlug: string, number: number): Promise<MergeRequest> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const mr = await this.prisma.mergeRequest.findUnique({
      where: { repositoryId_number: { repositoryId: access.repository.id, number } },
      include: this.mrInclude(),
    });
    if (!mr) throw this.notFound('MR_NOT_FOUND');
    if (mr.status !== 'closed') {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', message: 'Merge request is not closed', code: 'MR_NOT_CLOSED',
      });
    }
    // Refresh shas — the branches may have moved while closed.
    const repoDir = this.repoDir(ownerSlug, access.repository.slug);
    const headSha = (await this.git.revParse(repoDir, mr.sourceBranch)) ?? mr.headSha;
    const baseSha = (await this.git.revParse(repoDir, mr.targetBranch)) ?? mr.baseSha;
    const updated = await this.prisma.mergeRequest.update({
      where: { id: mr.id },
      data: { status: 'open', closedAt: null, headSha, baseSha },
      include: this.mrInclude(),
    });
    await this.prisma.repository.update({
      where: { id: access.repository.id },
      data: { openMergeRequestsCount: { increment: 1 } },
    });
    return this.toMr(updated);
  }

  /** Syncs headSha after a push to the source branch (called from post-receive). */
  async syncHeadSha(repositoryId: string, branch: string, newSha: string): Promise<void> {
    await this.prisma.mergeRequest.updateMany({
      where: { repositoryId, sourceBranch: branch, status: 'open' },
      data: { headSha: newSha },
    });
  }

  // ───────────────────────── Reviews ─────────────────────────

  async review(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    number: number,
    input: ReviewInput,
  ): Promise<void> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const mr = await this.prisma.mergeRequest.findUnique({
      where: { repositoryId_number: { repositoryId: access.repository.id, number } },
      include: this.mrInclude(),
    });
    if (!mr) throw this.notFound('MR_NOT_FOUND');
    if (mr.status !== 'open') {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', message: 'Merge request is not open', code: 'MR_NOT_OPEN',
      });
    }
    if (mr.authorId === user.id) {
      throw new ForbiddenException({
        statusCode: 403, error: 'Forbidden', message: 'Authors cannot review their own merge request',
        code: 'SELF_REVIEW',
      });
    }

    await this.prisma.mergeRequestReviewer.upsert({
      where: { mrId_userId: { mrId: mr.id, userId: user.id } },
      create: { mrId: mr.id, userId: user.id, state: input.state as never },
      update: { state: input.state as never },
    });

    if (input.body) {
      await this.prisma.comment.create({
        data: {
          repositoryId: access.repository.id,
          target: 'merge_request',
          mergeRequestId: mr.id,
          authorId: user.id,
          body: input.body,
        },
      });
    }

    if (input.state === 'approved') {
      await this.notifications.notify({
        userId: mr.authorId,
        type: 'mr_approved',
        title: `Merge request #${number} approved`,
        body: mr.title,
        url: this.mrUrl(access.repository.slug, number),
        actorId: user.id,
      });
    } else if (input.state === 'changes_requested') {
      await this.notifications.notify({
        userId: mr.authorId,
        type: 'mr_comment',
        title: `Changes requested on #${number}`,
        body: mr.title,
        url: this.mrUrl(access.repository.slug, number),
        actorId: user.id,
      });
    }
  }

  // ───────────────────────── Comments ─────────────────────────

  async listComments(user: AuthUser | undefined, ownerSlug: string, repoSlug: string, number: number): Promise<ReviewComment[]> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'guest');
    const mr = await this.prisma.mergeRequest.findUnique({
      where: { repositoryId_number: { repositoryId: access.repository.id, number } },
      select: { id: true },
    });
    if (!mr) throw this.notFound('MR_NOT_FOUND');
    const comments = await this.prisma.comment.findMany({
      where: { mergeRequestId: mr.id, target: 'merge_request' },
      include: { author: { select: USER_PUBLIC_SELECT }, replies: { include: { author: { select: USER_PUBLIC_SELECT } } } },
      orderBy: { createdAt: 'asc' },
    });
    // Only top-level comments; replies nested.
    return comments.filter((c) => !c.parentId).map((c) => this.toReviewComment(c as never));
  }

  async addComment(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    number: number,
    input: ReviewCommentInput,
  ): Promise<ReviewComment> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const mr = await this.prisma.mergeRequest.findUnique({
      where: { repositoryId_number: { repositoryId: access.repository.id, number } },
    });
    if (!mr) throw this.notFound('MR_NOT_FOUND');

    if (input.parentId) {
      const parent = await this.prisma.comment.findFirst({
        where: { id: input.parentId, mergeRequestId: mr.id },
      });
      if (!parent) throw this.notFound('COMMENT_NOT_FOUND');
    }

    const comment = await this.prisma.comment.create({
      data: {
        repositoryId: access.repository.id,
        target: 'merge_request',
        mergeRequestId: mr.id,
        authorId: user.id,
        body: input.body,
        filePath: input.filePath ?? null,
        line: input.line ?? null,
        side: input.side,
        parentId: input.parentId ?? null,
      },
      include: { author: { select: USER_PUBLIC_SELECT }, replies: true },
    });

    // Notify MR author + reviewers.
    const reviewers = await this.prisma.mergeRequestReviewer.findMany({
      where: { mrId: mr.id },
      select: { userId: true },
    });
    const recipients = new Set<string>([mr.authorId, ...reviewers.map((r) => r.userId)]);
    recipients.delete(user.id);
    await this.notifications.notifyMany([...recipients], {
      type: 'mr_comment',
      title: `New comment on merge request #${number}`,
      body: mr.title,
      url: this.mrUrl(access.repository.slug, number),
      actorId: user.id,
    });
    await this.webhooks.dispatch(access.repository.id, 'merge_request_comment', {
      action: 'created',
      mergeRequest: { number, title: mr.title },
      comment: { id: comment.id, body: input.body.slice(0, 500), filePath: input.filePath ?? undefined },
    });
    return this.toReviewComment(comment as never);
  }

  async resolveThread(user: AuthUser, ownerSlug: string, repoSlug: string, commentId: string): Promise<void> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, target: 'merge_request', repositoryId: access.repository.id },
    });
    if (!comment) throw this.notFound('COMMENT_NOT_FOUND');
    await this.prisma.comment.update({
      where: { id: comment.id },
      data: { resolvedAt: comment.resolvedAt ? null : new Date() },
    });
  }

  // ───────────────────────── Merge ─────────────────────────

  async merge(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    number: number,
    input: MergeInput,
  ): Promise<MergeRequestDetail> {
    const access = await this.access.require(user, ownerSlug, repoSlug, 'developer');
    const mr = await this.prisma.mergeRequest.findUnique({
      where: { repositoryId_number: { repositoryId: access.repository.id, number } },
      include: this.mrInclude(),
    });
    if (!mr) throw this.notFound('MR_NOT_FOUND');
    if (mr.status !== 'open') {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', message: 'Merge request is not open', code: 'MR_NOT_OPEN',
      });
    }
    if (mr.draft) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Draft merge requests cannot be merged',
        code: 'MR_DRAFT',
      });
    }

    const repoDir = this.repoDir(ownerSlug, access.repository.slug);

    // Optimistic concurrency: target branch must not have moved.
    const currentBase = await this.git.revParse(repoDir, mr.targetBranch);
    if (!currentBase) {
      throw new NotFoundException({
        statusCode: 404, error: 'Not Found', message: 'Target branch no longer exists', code: 'BRANCH_NOT_FOUND',
      });
    }
    if (input.sha && input.sha !== currentBase) {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', message: 'Target branch has changed',
        code: 'TARGET_BRANCH_MOVED',
      });
    }
    const currentHead = await this.git.revParse(repoDir, mr.sourceBranch);
    if (!currentHead) {
      throw new NotFoundException({
        statusCode: 404, error: 'Not Found', message: 'Source branch no longer exists', code: 'BRANCH_NOT_FOUND',
      });
    }

    // Protected-branch rules for the target.
    const protectedRule = await this.prisma.protectedBranch.findFirst({
      where: { repositoryId: access.repository.id, pattern: mr.targetBranch },
    });
    if (protectedRule) {
      if (!protectedRule.allowMerges) {
        throw new ForbiddenException({
          statusCode: 403, error: 'Forbidden', message: 'Merges are disabled on this branch',
          code: 'MERGE_NOT_ALLOWED',
        });
      }
      const approvals = mr.reviewers.filter((r) => r.state === 'approved').length;
      if (approvals < protectedRule.requireApprovals) {
        throw new ForbiddenException({
          statusCode: 403, error: 'Forbidden',
          message: `Requires ${protectedRule.requireApprovals} approvals (have ${approvals})`,
          code: 'INSUFFICIENT_APPROVALS',
          details: { required: protectedRule.requireApprovals, actual: approvals },
        });
      }
      const changesRequested = mr.reviewers.some((r) => r.state === 'changes_requested');
      if (changesRequested) {
        throw new ForbiddenException({
          statusCode: 403, error: 'Forbidden', message: 'Changes were requested',
          code: 'CHANGES_REQUESTED',
        });
      }
    }

    // Perform the merge.
    const mergeSha = await this.performMerge(repoDir, mr, input, currentBase, user);

    await this.prisma.$transaction(async (tx) => {
      await tx.mergeRequest.update({
        where: { id: mr.id },
        data: {
          status: 'merged',
          mergedAt: new Date(),
          mergedById: user.id,
          mergeSha,
          headSha: currentHead,
          baseSha: currentBase,
          strategy: input.strategy,
        },
        include: this.mrInclude(),
      });
      await tx.repository.update({
        where: { id: access.repository.id },
        data: { openMergeRequestsCount: { decrement: 1 } },
      });
    });

    // Auto-close linked issues ("Closes #12").
    if (mr.autoCloseIssues && mr.description) {
      const numbers = [...mr.description.matchAll(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)].map((m) => Number(m[1]));
      if (numbers.length) {
        await this.prisma.issue.updateMany({
          where: { repositoryId: access.repository.id, number: { in: numbers }, status: 'open' },
          data: { status: 'closed', closedAt: new Date() },
        });
        const closed = await this.prisma.issue.count({
          where: { repositoryId: access.repository.id, number: { in: numbers }, status: 'closed' },
        });
        if (closed) {
          await this.prisma.repository.update({
            where: { id: access.repository.id },
            data: { openIssuesCount: { decrement: closed } },
          });
        }
      }
    }

    // Delete source branch if requested.
    if (input.deleteSourceBranch && mr.sourceBranch !== access.repository.defaultBranch) {
      await this.git.deleteRef(repoDir, `refs/heads/${mr.sourceBranch}`).catch(() => undefined);
    }

    await this.audit.record({
      actorId: user.id,
      action: 'merge_request.merged',
      entityType: 'merge_request',
      entityId: mr.id,
      metadata: { number, strategy: input.strategy, mergeSha },
    });
    await this.notifications.notify({
      userId: mr.authorId,
      type: 'mr_merged',
      title: `Merge request #${number} merged`,
      body: mr.title,
      url: this.mrUrl(access.repository.slug, number),
      actorId: user.id,
    });
    await this.webhooks.dispatch(access.repository.id, 'merge_request', {
      action: 'merged',
      mergeRequest: { number, title: mr.title, mergeSha },
    });
    return this.get(user, ownerSlug, repoSlug, number);
  }

  // ───────────────────────── Git merge execution ─────────────────────────

  private async performMerge(
    repoDir: string,
    mr: { sourceBranch: string; targetBranch: string; title: string; description: string | null },
    input: MergeInput,
    currentBase: string,
    user: AuthUser,
  ): Promise<string> {
    const identity = [
      '-c', `user.name=${user.username}`,
      '-c', `user.email=${user.email}`,
    ];


    // Create a temporary worktree at the target branch tip and merge there.
    const { mkdir, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { randomBytes } = await import('node:crypto');
    const tmp = join(tmpdir(), `flygit-merge-${randomBytes(6).toString('hex')}`);
    try {
      await mkdir(tmp, { recursive: true });
      await this.git.runOrThrow(['worktree', 'add', '--detach', tmp, currentBase], repoDir);

      if (input.strategy === 'squash') {
        const message = input.message?.trim() || mr.title;
        const squash = await this.git.run(
          [...identity, 'merge', '--squash', mr.sourceBranch],
          tmp,
        );
        if (squash.code !== 0) {
          throw new ConflictException({
            statusCode: 409, error: 'Conflict', message: `Squash failed: ${squash.stderr.trim()}`,
            code: 'MERGE_CONFLICT',
          });
        }
        await this.git.runOrThrow([...identity, 'commit', '-m', message], tmp);
      } else if (input.strategy === 'rebase') {
        const rebase = await this.git.run(
          [...identity, 'rebase', mr.sourceBranch],
          tmp,
        );
        if (rebase.code !== 0) {
          await this.git.run(['rebase', '--abort'], tmp).catch(() => undefined);
          throw new ConflictException({
            statusCode: 409, error: 'Conflict', message: `Rebase failed: ${rebase.stderr.trim()}`,
            code: 'MERGE_CONFLICT',
          });
        }
      } else {
        const message = input.message?.trim() || `Merge branch '${mr.sourceBranch}' into ${mr.targetBranch}\n\n${mr.title}`;
        const merge = await this.git.run(
          [...identity, 'merge', '--no-ff', '-m', message, mr.sourceBranch],
          tmp,
        );
        if (merge.code !== 0) {
          throw new ConflictException({
            statusCode: 409, error: 'Conflict', message: `Merge failed: ${merge.stderr.trim()}`,
            code: 'MERGE_CONFLICT',
          });
        }
      }

      const newSha = (await this.git.run(['rev-parse', 'HEAD'], tmp)).stdout.trim();
      if (!newSha) {
        throw new BadRequestException({
          statusCode: 400, error: 'Bad Request', message: 'Merge produced no commit', code: 'MERGE_FAILED',
        });
      }
      // Move the target branch ref in the bare repository.
      await this.git.runOrThrow(
        ['update-ref', `refs/heads/${mr.targetBranch}`, newSha, currentBase],
        repoDir,
      );
      return newSha;
    } finally {
      await this.git.run(['worktree', 'remove', '--force', tmp], repoDir).catch(() => undefined);
      await this.git.run(['worktree', 'prune'], repoDir).catch(() => undefined);
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ───────────────────────── Helpers ─────────────────────────

  private mrInclude() {
    return {
      author: { select: USER_PUBLIC_SELECT },
      reviewers: { include: { user: { select: USER_PUBLIC_SELECT } } },
    } as const;
  }

  private async toMr(row: {
    id: string;
    number: number;
    title: string;
    description: string | null;
    status: MrStatus;
    sourceBranch: string;
    targetBranch: string;
    draft: boolean;
    strategy: string;
    createdAt: Date;
    updatedAt: Date;
    mergedAt: Date | null;
    closedAt: Date | null;
    author: { id: string; username: string; displayName: string | null; avatarUrl: string | null; bio: string | null; website: string | null; createdAt: Date };
    reviewers: Array<{ userId: string; state: string; user: { id: string; username: string; displayName: string | null; avatarUrl: string | null; bio: string | null; website: string | null; createdAt: Date } }>;
  }): Promise<MergeRequest> {
    return {
      id: row.id,
      number: row.number,
      title: row.title,
      description: row.description,
      status: row.status,
      sourceBranch: row.sourceBranch,
      targetBranch: row.targetBranch,
      author: this.toUser(row.author),
      reviewers: row.reviewers.map((r) => ({ user: this.toUser(r.user), state: r.state as never })),
      draft: row.draft,
      mergeable: row.status === 'open' && !row.draft,
      mergeStrategy: row.strategy as never,
      commitsCount: 0,
      filesChangedCount: 0,
      additions: 0,
      deletions: 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      mergedAt: row.mergedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
    };
  }

  private toReviewComment(row: {
    id: string;
    body: string;
    filePath: string | null;
    line: number | null;
    side: string;
    resolvedAt: Date | null;
    createdAt: Date;
    author: { id: string; username: string; displayName: string | null; avatarUrl: string | null; bio: string | null; website: string | null; createdAt: Date };
    replies?: Array<{ id: string; body: string; filePath: string | null; line: number | null; side: string; resolvedAt: Date | null; createdAt: Date; author: { id: string; username: string; displayName: string | null; avatarUrl: string | null; bio: string | null; website: string | null; createdAt: Date } }>;
  }): ReviewComment {
    return {
      id: row.id,
      body: row.body,
      author: this.toUser(row.author),
      filePath: row.filePath,
      line: row.line,
      side: row.side as 'old' | 'new',
      resolved: Boolean(row.resolvedAt),
      createdAt: row.createdAt.toISOString(),
      replies: (row.replies ?? []).map((r) =>
        this.toReviewComment(r as Parameters<typeof this.toReviewComment>[0]),
      ),
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

  private repoDir(ownerSlug: string, repoSlug: string): string {
    return this.storage.repoDir(ownerSlug, repoSlug);
  }

  private mrUrl(repoSlug: string, number: number): string {
    return `/r/${repoSlug}/merge-requests/${number}`;
  }

  private emptyPage(query: { page: number; pageSize: number }) {
    return { items: [] as MergeRequest[], total: 0, page: query.page, pageSize: query.pageSize };
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

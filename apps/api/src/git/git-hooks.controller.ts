import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import type { RepoRole } from '@flygit/shared';
import { roleAtLeast } from '@flygit/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import type { GitCliService } from './git-cli.service';
import type { GitStorageService } from './git-storage.service';
import type { RepositoryAccessService } from './repository-access.service';
import type { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { randomToken } from '../common/utils/crypto.util';

const hookBodySchema = z.object({
  repoPath: z.string().min(3).max(300),
  pusher: z.string().max(64).nullable().optional(),
  updates: z
    .array(
      z.object({
        oldSha: z.string().regex(/^[0-9a-f]{4,40}$/i),
        newSha: z.string().regex(/^[0-9a-f]{4,40}$/i),
        ref: z.string().min(1).max(255),
      }),
    )
    .min(1)
    .max(500),
});

type HookBody = z.infer<typeof hookBodySchema>;

const ZERO_SHA_RE = /^0+$/;

/**
 * Endpoints consumed by the generated pre-receive / post-receive git hooks.
 * Guarded by a shared secret (FLYGIT_HOOK_SECRET) — see docs/SECURITY.md.
 */
@Public()
@Controller('internal/git')
export class GitHooksController {
  private readonly logger = new Logger(GitHooksController.name);
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly git: GitCliService,
    private readonly storage: GitStorageService,
    private readonly access: RepositoryAccessService,
    private readonly webhooks: WebhookDispatcherService,
  ) {
    this.secret = process.env.FLYGIT_HOOK_SECRET ?? '';
  }

  /** Validates branch protection and push permissions — runs before refs update. */
  @Post('pre-receive')
  @HttpCode(200)
  async preReceive(
    @Headers('x-flygit-secret') secret: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<{ allowed: boolean; reason?: string }> {
    this.assertSecret(secret);
    const body = this.parseBody(rawBody);

    const { owner, repo } = this.splitPath(body.repoPath);
    const repository = await this.access.findRepository(owner, repo);

    // Identify the pusher (username injected by HTTP REMOTE_USER / SSH FLYGIT_USER).
    const pusherName = body.pusher?.toLowerCase() ?? null;
    const pusher = pusherName
      ? await this.prisma.user.findFirst({
          where: { OR: [{ username: pusherName }, { email: pusherName }] },
        })
      : null;

    const authUser = pusher
      ? { id: pusher.id, username: pusher.username, email: pusher.email, isAdmin: pusher.isAdmin, role: pusher.role }
      : null;

    // Without a resolved identity only public read-only operations could pass,
    // but receive-pack already requires authentication → reject.
    if (!authUser) return { allowed: false, reason: 'pusher identity not resolved' };

    const access = await this.access.resolve(authUser, repository);
    if (!access || !roleAtLeast(access.role, 'developer')) {
      return { allowed: false, reason: 'you need developer access to push' };
    }

    const protectedBranches = await this.prisma.protectedBranch.findMany({
      where: { repositoryId: repository.id },
    });

    for (const update of body.updates) {
      const verdict = await this.checkUpdate(repository.id, repository.defaultBranch, access.role, protectedBranches, update);
      if (!verdict.ok) return { allowed: false, reason: verdict.reason };
    }
    return { allowed: true };
  }

  /** Refreshes repository statistics and fires side effects — after refs update. */
  @Post('post-receive')
  @HttpCode(202)
  async postReceive(
    @Headers('x-flygit-secret') secret: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<{ accepted: true }> {
    this.assertSecret(secret);
    const body = this.parseBody(rawBody);
    // Process asynchronously — the hook does not wait for side effects.
    void this.processPostReceive(body).catch((error: unknown) => {
      this.logger.error(`post-receive failed: ${(error as Error).message}`);
    });
    return { accepted: true };
  }

  // ───────────────────────── Internals ─────────────────────────

  private async checkUpdate(
    repositoryId: string,
    defaultBranch: string,
    role: RepoRole,
    protectedBranches: Array<{ pattern: string; allowForcePush: boolean; allowDeletions: boolean; requireApprovals: number }>,
    update: { oldSha: string; newSha: string; ref: string },
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const isDelete = ZERO_SHA_RE.test(update.newSha);
    const isNew = ZERO_SHA_RE.test(update.oldSha);

    if (update.ref.startsWith('refs/heads/')) {
      const branch = update.ref.slice('refs/heads/'.length);
      const protection = protectedBranches.find((p) => matchPattern(p.pattern, branch));

      if (isDelete) {
        if (branch === defaultBranch) return { ok: false, reason: 'cannot delete the default branch' };
        if (protection && !protection.allowDeletions) {
          return { ok: false, reason: `branch "${branch}" is protected and cannot be deleted` };
        }
        // Deleting any branch requires maintainer rights.
        if (!roleAtLeast(role, 'maintainer')) {
          return { ok: false, reason: 'you need maintainer access to delete branches' };
        }
        return { ok: true };
      }

      if (protection) {
        if (!roleAtLeast(role, 'maintainer')) {
          return {
            ok: false,
            reason: `branch "${branch}" is protected — maintainer access required`,
          };
        }
        // Non-fast-forward checks (force push).
        if (!isNew && !protection.allowForcePush) {
          const [o, r] = await this.ownerAndSlug(repositoryId);
          const repoDir = this.storage.repoDir(o, r);
          const fastForward = await this.git.isAncestor(repoDir, update.oldSha, update.newSha);
          if (!fastForward) {
            return { ok: false, reason: `force push rejected: "${branch}" is protected` };
          }
        }
      }
      return { ok: true };
    }

    if (update.ref.startsWith('refs/tags/')) {
      if (isDelete && !roleAtLeast(role, 'maintainer')) {
        return { ok: false, reason: 'you need maintainer access to delete tags' };
      }
      return { ok: true };
    }

    // Any other ref namespace is not allowed.
    return { ok: false, reason: `ref "${update.ref}" is not allowed` };
  }

  private async processPostReceive(body: HookBody): Promise<void> {
    const { owner, repo } = this.splitPath(body.repoPath);
    const repository = await this.access.findRepository(owner, repo);
    const repoDir = this.storage.repoDir(owner, repo);

    const branchUpdates = body.updates.filter((u) => u.ref.startsWith('refs/heads/') && !ZERO_SHA_RE.test(u.newSha));
    const deleted = body.updates.filter((u) => ZERO_SHA_RE.test(u.newSha));

    const pusherName = body.pusher?.toLowerCase() ?? null;
    const pusher = pusherName
      ? await this.prisma.user.findFirst({ where: { username: pusherName } })
      : null;

    // Statistics.
    const [empty, language, sizeBytes] = await Promise.all([
      this.git.isRepoEmpty(repoDir),
      branchUpdates.length ? this.git.detectLanguage(repoDir) : Promise.resolve(null),
      this.git.repoSizeBytes(repoDir),
    ]);
    await this.prisma.repository.update({
      where: { id: repository.id },
      data: {
        isEmpty: empty,
        language: language ?? repository.language,
        sizeBytes: BigInt(Math.max(0, sizeBytes)),
      },
    });

    // Keep open merge requests in sync with their source branch heads.
    if (branchUpdates.length) {
      const branchNames = branchUpdates.map((u) => u.ref.slice('refs/heads/'.length));
      const openMrs = await this.prisma.mergeRequest.findMany({
        where: {
          repositoryId: repository.id,
          status: { in: ['open', 'draft'] },
          sourceBranch: { in: branchNames },
        },
      });
      for (const mr of openMrs) {
        const update = branchUpdates.find((u) => u.ref.slice('refs/heads/'.length) === mr.sourceBranch);
        if (update) {
          await this.prisma.mergeRequest.update({
            where: { id: mr.id },
            data: { headSha: update.newSha },
          });
        }
      }
    }

    // Activity feed entries.
    if (pusher && (branchUpdates.length || deleted.length)) {
      const refs = [...branchUpdates, ...deleted]
        .slice(0, 20)
        .map((u) => ({
          ref: u.ref,
          kind: ZERO_SHA_RE.test(u.newSha) ? 'delete' : ZERO_SHA_RE.test(u.oldSha) ? 'create' : 'update',
          sha: u.newSha,
        }));
      await this.prisma.activity.create({
        data: {
          repositoryId: repository.id,
          actorId: pusher.id,
          type: 'push',
          payload: { refs, pusher: pusher.username } as object,
        },
      });
    }

    // External webhooks.
    if (branchUpdates.length) {
      await this.webhooks.dispatch(repository.id, 'push', {
        refUpdates: body.updates,
        pusher: pusher ? { username: pusher.username } : null,
      });
    }
  }

  private async ownerAndSlug(repositoryId: string): Promise<[string, string]> {
    const repo = await this.prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } });
    if (repo.ownerType === 'user') {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: repo.ownerId } });
      return [user.username, repo.slug];
    }
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: repo.ownerId } });
    return [org.slug, repo.slug];
  }

  private splitPath(repoPath: string): { owner: string; repo: string } {
    const [owner, repo] = repoPath.split('/');
    if (!owner || !repo) throw new BadRequestException('invalid repoPath');
    return { owner: owner.toLowerCase(), repo: repo.toLowerCase() };
  }

  private parseBody(rawBody: unknown): HookBody {
    const parsed = hookBodySchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('invalid hook payload');
    return parsed.data;
  }

  private assertSecret(provided: string | undefined): void {
    if (!this.secret) {
      // Secret not configured — refuse to enforce anything (hooks fail closed
      // on the git side only if the endpoint rejects; we reject loudly here
      // so operators notice the misconfiguration).
      throw new BadRequestException('FLYGIT_HOOK_SECRET is not configured');
    }
    if (provided !== this.secret) {
      throw new BadRequestException('invalid hook secret');
    }
  }
}

/** Simple glob matching for branch protection patterns (`*` and `**`). */
export function matchPattern(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    // eslint-disable-next-line no-control-regex -- sentinel for `**` glob
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(value);
}

/** Generates the instance hook secret during bootstrap when unset. */
export function ensureHookSecret(): void {
  if (!process.env.FLYGIT_HOOK_SECRET) {
    process.env.FLYGIT_HOOK_SECRET = randomToken(32);
  }
}

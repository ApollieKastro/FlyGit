import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  CommitSummary,
  FileContent,
  FileDiff,
  FileEntry,
  GitRef,
  UpdateFileInput,
} from '@flygit/shared';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';
import type { GitCliService } from '../git/git-cli.service';
import type { GitStorageService } from '../git/git-storage.service';
import type { RepositoryAccessService} from '../git/repository-access.service';
import { type ResolvedAccess } from '../git/repository-access.service';

export interface CompareResult {
  from: string;
  to: string;
  baseCommit: string | null;
  commits: CommitSummary[];
  files: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
}

/** Repository content backed by git: trees, files, commits, branches, blame. */
@Injectable()
export class RepositoryContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly git: GitCliService,
    private readonly storage: GitStorageService,
    private readonly access: RepositoryAccessService,
  ) {}

  /** Resolves access + absolute repo dir in one step. */
  private async ctx(
    user: AuthUser | null | undefined,
    ownerSlug: string,
    repoSlug: string,
    minRole: Parameters<RepositoryAccessService['require']>[3] = 'guest',
  ): Promise<{ access: ResolvedAccess; repoDir: string }> {
    const access = await this.access.require(user, ownerSlug, repoSlug, minRole);
    const repoDir = this.storage.repoDir(ownerSlug, access.repository.slug);
    return { access, repoDir };
  }

  // ───────────────────────── Refs ─────────────────────────

  async listBranches(user: AuthUser | null | undefined, ownerSlug: string, repoSlug: string): Promise<GitRef[]> {
    const { access, repoDir } = await this.ctx(user, ownerSlug, repoSlug);
    if (access.repository.isEmpty) return [];
    const branches = await this.git.listBranches(repoDir, access.repository.defaultBranch);
    const protectedPatterns = await this.prisma.protectedBranch.findMany({
      where: { repositoryId: access.repository.id },
      select: { pattern: true },
    });
    return branches.map((b) => ({
      ...b,
      protected: protectedPatterns.some((p) => matchPattern(p.pattern, b.name)),
    }));
  }

  async createBranch(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    name: string,
    from?: string,
  ): Promise<GitRef> {
    const { access, repoDir } = await this.ctx(user, ownerSlug, repoSlug, 'developer');
    if (!/^[a-zA-Z0-9._/-]+$/.test(name) || name.startsWith('-') || name.includes('..')) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Invalid branch name', code: 'INVALID_BRANCH',
      });
    }
    if (await this.git.branchExists(repoDir, name)) {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', message: 'Branch already exists', code: 'BRANCH_EXISTS',
      });
    }
    const startRef = from ?? access.repository.defaultBranch;
    const sha = await this.git.revParse(repoDir, startRef);
    if (!sha) {
      throw new NotFoundException({
        statusCode: 404, error: 'Not Found', message: `Ref ${startRef} not found`, code: 'REF_NOT_FOUND',
      });
    }
    await this.git.updateRef(repoDir, `refs/heads/${name}`, sha);
    const branches = await this.git.listBranches(repoDir, access.repository.defaultBranch);
    return branches.find((b) => b.name === name)!;
  }

  async deleteBranch(user: AuthUser, ownerSlug: string, repoSlug: string, name: string): Promise<void> {
    const { access, repoDir } = await this.ctx(user, ownerSlug, repoSlug, 'developer');
    if (name === access.repository.defaultBranch) {
      throw new ForbiddenException({
        statusCode: 403, error: 'Forbidden', message: 'Cannot delete the default branch',
        code: 'DEFAULT_BRANCH_PROTECTED',
      });
    }
    if (!(await this.git.branchExists(repoDir, name))) {
      throw new NotFoundException({
        statusCode: 404, error: 'Not Found', message: 'Branch not found', code: 'BRANCH_NOT_FOUND',
      });
    }
    const protectedPatterns = await this.prisma.protectedBranch.findMany({
      where: { repositoryId: access.repository.id },
      select: { pattern: true, allowDeletions: true },
    });
    const rule = protectedPatterns.find((p) => matchPattern(p.pattern, name));
    if (rule && !rule.allowDeletions) {
      throw new ForbiddenException({
        statusCode: 403, error: 'Forbidden', message: 'Branch is protected',
        code: 'PROTECTED_BRANCH',
      });
    }
    await this.git.deleteRef(repoDir, `refs/heads/${name}`);
  }

  async listTags(user: AuthUser | null | undefined, ownerSlug: string, repoSlug: string): Promise<GitRef[]> {
    const { access, repoDir } = await this.ctx(user, ownerSlug, repoSlug);
    if (access.repository.isEmpty) return [];
    return this.git.listTags(repoDir);
  }

  // ───────────────────────── Commits ─────────────────────────

  async listCommits(
    user: AuthUser | null | undefined,
    ownerSlug: string,
    repoSlug: string,
    query: { ref?: string; path?: string; page: number; pageSize: number },
  ) {
    const { access, repoDir } = await this.ctx(user, ownerSlug, repoSlug);
    if (access.repository.isEmpty) return { commits: [], total: 0, page: query.page, pageSize: query.pageSize };
    const ref = query.ref ?? access.repository.defaultBranch;
    const path = query.path ? this.git.sanitizePath(query.path) : '';
    if (query.path && path === null) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Invalid path', code: 'INVALID_PATH',
      });
    }
    const { commits, total } = await this.git.listCommits(repoDir, {
      ref,
      path: path || undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { commits, total, page: query.page, pageSize: query.pageSize };
  }

  async getCommit(
    user: AuthUser | null | undefined,
    ownerSlug: string,
    repoSlug: string,
    sha: string,
  ) {
    const { access, repoDir } = await this.ctx(user, ownerSlug, repoSlug);
    if (access.repository.isEmpty) {
      throw new NotFoundException({ statusCode: 404, error: 'Not Found', message: 'Commit not found', code: 'COMMIT_NOT_FOUND' });
    }
    const commit = await this.git.getCommit(repoDir, sha);
    if (!commit) {
      throw new NotFoundException({ statusCode: 404, error: 'Not Found', message: 'Commit not found', code: 'COMMIT_NOT_FOUND' });
    }
    const files = await this.git.getCommitFiles(repoDir, sha);
    return { ...commit, files };
  }

  async compare(
    user: AuthUser | null | undefined,
    ownerSlug: string,
    repoSlug: string,
    from: string,
    to: string,
  ): Promise<CompareResult> {
    const { access, repoDir } = await this.ctx(user, ownerSlug, repoSlug);
    if (access.repository.isEmpty) {
      throw new NotFoundException({ statusCode: 404, error: 'Not Found', message: 'Repository is empty', code: 'EMPTY_REPOSITORY' });
    }
    const fromSha = await this.git.revParse(repoDir, from);
    const toSha = await this.git.revParse(repoDir, to);
    if (!fromSha || !toSha) {
      throw new NotFoundException({
        statusCode: 404, error: 'Not Found', message: 'One of the refs was not found', code: 'REF_NOT_FOUND',
      });
    }
    const baseCommit = await this.git.mergeBase(repoDir, fromSha, toSha);
    const commits = baseCommit
      ? (await this.git.listCommitsRange(repoDir, `${baseCommit}..${toSha}`))
      : [];
    const files = await this.git.compare(repoDir, from, to);
    return {
      from: fromSha,
      to: toSha,
      baseCommit,
      commits,
      files,
      totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
      totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
    };
  }

  // ───────────────────────── Tree / files ─────────────────────────

  async listTree(
    user: AuthUser | null | undefined,
    ownerSlug: string,
    repoSlug: string,
    query: { ref?: string; path?: string },
  ): Promise<{ ref: string; path: string; entries: FileEntry[] }> {
    const { access, repoDir } = await this.ctx(user, ownerSlug, repoSlug);
    if (access.repository.isEmpty) {
      return { ref: access.repository.defaultBranch, path: query.path ?? '', entries: [] };
    }
    const ref = query.ref ?? access.repository.defaultBranch;
    const path = query.path ? this.git.sanitizePath(query.path) : '';
    if (query.path && path === null) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Invalid path', code: 'INVALID_PATH',
      });
    }
    const sha = await this.git.revParse(repoDir, ref);
    if (!sha) {
      throw new NotFoundException({ statusCode: 404, error: 'Not Found', message: 'Ref not found', code: 'REF_NOT_FOUND' });
    }
    const entries = await this.git.listTree(repoDir, ref, path || '');
    if (!entries.length && path) {
      // Distinguish "empty directory" from "not found": check whether the path exists.
      const file = await this.git.readFile(repoDir, ref, path);
      if (!file) {
        throw new NotFoundException({
          statusCode: 404, error: 'Not Found', message: 'Path not found', code: 'PATH_NOT_FOUND',
        });
      }
    }
    return { ref, path: path || '', entries };
  }

  async readFile(
    user: AuthUser | null | undefined,
    ownerSlug: string,
    repoSlug: string,
    query: { ref?: string; path: string },
  ): Promise<FileContent> {
    const { access, repoDir } = await this.ctx(user, ownerSlug, repoSlug);
    if (access.repository.isEmpty) {
      throw new NotFoundException({ statusCode: 404, error: 'Not Found', message: 'File not found', code: 'FILE_NOT_FOUND' });
    }
    const ref = query.ref ?? access.repository.defaultBranch;
    const path = this.git.sanitizePath(query.path);
    if (path === null || !path) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Invalid path', code: 'INVALID_PATH',
      });
    }
    const file = await this.git.readFile(repoDir, ref, path);
    if (!file) {
      throw new NotFoundException({ statusCode: 404, error: 'Not Found', message: 'File not found', code: 'FILE_NOT_FOUND' });
    }
    return file;
  }

  async readReadme(
    user: AuthUser | null | undefined,
    ownerSlug: string,
    repoSlug: string,
    ref?: string,
  ): Promise<{ ref: string; content: string | null }> {
    const { access, repoDir } = await this.ctx(user, ownerSlug, repoSlug);
    if (access.repository.isEmpty) return { ref: access.repository.defaultBranch, content: null };
    const resolvedRef = ref ?? access.repository.defaultBranch;
    const content = await this.git.readReadme(repoDir, resolvedRef);
    return { ref: resolvedRef, content };
  }

  async blame(
    user: AuthUser | null | undefined,
    ownerSlug: string,
    repoSlug: string,
    query: { ref?: string; path: string },
  ) {
    const { access, repoDir } = await this.ctx(user, ownerSlug, repoSlug);
    if (access.repository.isEmpty) return [];
    const ref = query.ref ?? access.repository.defaultBranch;
    const path = this.git.sanitizePath(query.path);
    if (path === null || !path) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Invalid path', code: 'INVALID_PATH',
      });
    }
    return this.git.blame(repoDir, ref, path);
  }

  /**
   * Creates (or deletes) a file via a temporary worktree and commits the change.
   * Uses a detached worktree so the bare repository stays untouched until
   * `update-ref` moves the branch.
   */
  async updateFile(
    user: AuthUser,
    ownerSlug: string,
    repoSlug: string,
    filePath: string,
    input: UpdateFileInput,
  ): Promise<{ commitSha: string; branch: string }> {
    const { access, repoDir } = await this.ctx(user, ownerSlug, repoSlug, 'developer');
    if (access.repository.isEmpty) {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', message: 'Repository is empty',
        code: 'EMPTY_REPOSITORY',
      });
    }
    const path = this.git.sanitizePath(filePath);
    if (path === null || !path) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Invalid path', code: 'INVALID_PATH',
      });
    }

    // Protected-branch rule: browser edits may be blocked for non-admins.
    const protectedPatterns = await this.prisma.protectedBranch.findMany({
      where: { repositoryId: access.repository.id },
      select: { pattern: true },
    });
    if (protectedPatterns.some((p) => matchPattern(p.pattern, input.branch))) {
      const source = access.source;
      if (source !== 'owner' && source !== 'platform-admin' && access.role !== 'admin') {
        throw new ForbiddenException({
          statusCode: 403, error: 'Forbidden', message: 'Direct edits to protected branches are not allowed',
          code: 'PROTECTED_BRANCH',
        });
      }
    }

    const branchSha = await this.git.revParse(repoDir, input.branch);
    if (!branchSha) {
      throw new NotFoundException({
        statusCode: 404, error: 'Not Found', message: 'Branch not found', code: 'BRANCH_NOT_FOUND',
      });
    }

    // Optimistic concurrency: verify the file was not changed in the meantime.
    if (input.sha && input.action === 'update') {
      const current = await this.git.run(['rev-parse', `${branchSha}:${path}`], repoDir);
      const currentSha = current.code === 0 ? current.stdout.trim() : null;
      if (currentSha !== input.sha) {
        throw new ConflictException({
          statusCode: 409, error: 'Conflict', message: 'File was modified since you loaded it',
          code: 'FILE_CHANGED',
        });
      }
    }

    const tmp = join(tmpdir(), `flygit-edit-${randomBytes(6).toString('hex')}`);
    try {
      await mkdir(tmp, { recursive: true });
      // Detached worktree at the branch tip — the bare repo stays untouched
      // until update-ref moves the branch at the end.
      await this.git.runOrThrow(['worktree', 'add', '--detach', tmp, branchSha], repoDir);
      const target = join(tmp, path);
      await mkdir(join(target, '..'), { recursive: true });

      if (input.action === 'delete') {
        await unlink(target).catch(() => undefined);
      } else {
        await writeFile(target, input.content, 'utf8');
      }

      await this.git.runOrThrow(['add', '--', path], tmp);
      const status = await this.git.run(['status', '--porcelain'], tmp);
      if (status.stdout.trim()) {
        await this.git.runOrThrow(
          [
            '-c', `user.name=${user.username}`,
            '-c', `user.email=${user.email}`,
            'commit',
            '-m', input.message,
            '--',
            path,
          ],
          tmp,
        );
      }
      const newSha = (await this.git.run(['rev-parse', 'HEAD'], tmp)).stdout.trim();
      if (!newSha || newSha === branchSha) {
        throw new ConflictException({
          statusCode: 409, error: 'Conflict', message: 'No changes to commit', code: 'NO_CHANGES',
        });
      }
      await this.git.updateRef(repoDir, `refs/heads/${input.branch}`, newSha);
      await this.prisma.repository.update({
        where: { id: access.repository.id },
        data: { isEmpty: false, updatedAt: new Date() },
      }).catch(() => undefined);
      return { commitSha: newSha, branch: input.branch };
    } finally {
      await this.git.run(['worktree', 'remove', '--force', tmp], repoDir).catch(() => undefined);
      await this.git.run(['worktree', 'prune'], repoDir).catch(() => undefined);
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Glob-style branch protection matching: `*` matches any run of characters,
 * everything else is literal. `main` matches only `main`, `release/*` matches
 * `release/1.0` but not `release`.
 */
export function matchPattern(pattern: string, name: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(name);
}

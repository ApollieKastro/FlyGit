import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { chmod, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { GitCliService } from './git-cli.service';

export interface InitRepositoryOptions {
  ownerSlug: string;
  repoSlug: string;
  defaultBranch: string;
  /** Initial README.md content; null skips file initialization. */
  readme?: string | null;
  /** Initial author for the seed commit. */
  author?: { name: string; email: string };
}

const HOOK_SECRET_PLACEHOLDER = '__FLYGIT_HOOK_SECRET__';

/**
 * Manages the bare-repository storage on disk.
 *
 * Layout:  <GIT_STORAGE_DIR>/<ownerSlug>/<repoSlug>.git
 *
 * Every repository receives two Node.js hooks:
 *  - pre-receive  → validates permissions and protected-branch rules via API
 *  - post-receive → refreshes stats, notifies watchers, fires webhooks
 */
@Injectable()
export class GitStorageService implements OnModuleInit {
  private readonly logger = new Logger(GitStorageService.name);
  private readonly root: string;

  constructor(private readonly git: GitCliService) {
    this.root = resolve(process.env.GIT_STORAGE_DIR ?? './storage/git');
  }

  async onModuleInit() {
    await mkdir(this.root, { recursive: true });
  }

  get storageRoot(): string {
    return this.root;
  }

  /** Absolute path of a bare repository directory. */
  repoDir(ownerSlug: string, repoSlug: string): string {
    const dir = resolve(join(this.root, ownerSlug, `${repoSlug}.git`));
    // Defence in depth: never escape the storage root.
    if (!dir.startsWith(this.root + sep) && dir !== this.root) {
      throw new Error('Repository path escapes storage root');
    }
    return dir;
  }

  async exists(ownerSlug: string, repoSlug: string): Promise<boolean> {
    try {
      await access(join(this.repoDir(ownerSlug, repoSlug), 'HEAD'), constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /** Creates a bare repository, installs hooks and optionally seeds a README. */
  async initRepository(opts: InitRepositoryOptions): Promise<void> {
    const dir = this.repoDir(opts.ownerSlug, opts.repoSlug);
    await mkdir(dirname(dir), { recursive: true });

    const init = await this.git.run(['init', '--bare', `--initial-branch=${opts.defaultBranch}`, dir], this.root);
    if (init.code !== 0) {
      // Older git versions do not know --initial-branch.
      await this.git.runOrThrow(['init', '--bare', dir], this.root);
      await this.git.runOrThrow(['symbolic-ref', 'HEAD', `refs/heads/${opts.defaultBranch}`], dir);
    }

    // Receive non-fast-forward only via explicit force (protected-branch logic
    // lives in the pre-receive hook).
    await this.git.run(['config', 'receive.denyDeletes', 'false'], dir).catch(() => undefined);
    await this.git.run(['config', 'receive.denyCurrentBranch', 'ignore'], dir).catch(() => undefined);

    await this.installHooks(dir, opts.ownerSlug, opts.repoSlug);

    if (opts.readme) {
      await this.seedReadme(dir, opts, opts.readme);
    }
  }

  /** Clones a bare repository (fork). */
  async forkRepository(
    source: { ownerSlug: string; repoSlug: string },
    target: { ownerSlug: string; repoSlug: string; defaultBranch: string },
  ): Promise<void> {
    const srcDir = this.repoDir(source.ownerSlug, source.repoSlug);
    const dstDir = this.repoDir(target.ownerSlug, target.repoSlug);
    await mkdir(dirname(dstDir), { recursive: true });
    await this.git.runOrThrow(
      ['clone', '--bare', '--no-hardlinks', srcDir, dstDir],
      this.root,
      { timeoutMs: 120_000 },
    );
    await this.git
      .run(['symbolic-ref', 'HEAD', `refs/heads/${target.defaultBranch}`], dstDir)
      .catch(() => undefined);
    await this.installHooks(dstDir, target.ownerSlug, target.repoSlug);
  }

  /** Deletes the repository directory from disk. */
  async deleteRepository(ownerSlug: string, repoSlug: string): Promise<void> {
    const dir = this.repoDir(ownerSlug, repoSlug);
    await rm(dir, { recursive: true, force: true });
  }

  /** Ensures hooks exist (repairs after storage restores). */
  async ensureHooks(ownerSlug: string, repoSlug: string): Promise<void> {
    const dir = this.repoDir(ownerSlug, repoSlug);
    await this.installHooks(dir, ownerSlug, repoSlug);
  }

  // ───────────────────────── Internals ─────────────────────────

  private async installHooks(dir: string, ownerSlug: string, repoSlug: string): Promise<void> {
    const hooksDir = join(dir, 'hooks');
    await mkdir(hooksDir, { recursive: true });
    const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
    const secret = process.env.FLYGIT_HOOK_SECRET ?? HOOK_SECRET_PLACEHOLDER;

    const preReceive = this.renderHook('pre-receive', ownerSlug, repoSlug, apiUrl, secret);
    const postReceive = this.renderHook('post-receive', ownerSlug, repoSlug, apiUrl, secret);

    for (const [name, body] of [
      ['pre-receive', preReceive],
      ['post-receive', postReceive],
    ] as const) {
      const path = join(hooksDir, name);
      await writeFile(path, body, 'utf8');
      await chmod(path, 0o755);
    }
  }

  /**
   * Renders a Node.js hook. Node is guaranteed to be on PATH because hooks
   * are spawned by the API process (HTTP push) or SSH server (SSH push).
   * When FLYGIT_API_URL / FLYGIT_HOOK_SECRET env vars are present they win
   * over the baked-in defaults, so secrets can be rotated via environment.
   */
  private renderHook(
    hookName: 'pre-receive' | 'post-receive',
    ownerSlug: string,
    repoSlug: string,
    apiUrl: string,
    secret: string,
  ): string {
    const endpoint = hookName === 'pre-receive' ? 'pre-receive' : 'post-receive';
    return `#!/usr/bin/env node
/* FlyGit ${hookName} hook — generated, do not edit. */
const api = process.env.FLYGIT_API_URL || ${JSON.stringify(apiUrl)};
const secret = process.env.FLYGIT_HOOK_SECRET || ${JSON.stringify(secret)};
const repoPath = ${JSON.stringify(`${ownerSlug}/${repoSlug}`)};

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

(async () => {
  const raw = await readStdin();
  const updates = raw
    .split('\\n')
    .filter(Boolean)
    .map((line) => {
      const [oldSha, newSha, ref] = line.trim().split(/\\s+/);
      return { oldSha, newSha, ref };
    });
  const pusher = process.env.REMOTE_USER || process.env.FLYGIT_USER || null;
  const body = JSON.stringify({ repoPath, updates, pusher });
  try {
    const res = await fetch(api + '/api/v1/internal/git/${endpoint}', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-flygit-secret': secret },
      body,
    });
    if (!res.ok) {
      ${hookName === 'pre-receive' ? "process.stderr.write('FlyGit: hook endpoint returned ' + res.status + '\\n');" : ''}
      process.exit(${hookName === 'pre-receive' ? '1' : '0'});
    }
    const data = await res.json();
    ${hookName === 'pre-receive'
      ? `if (data && data.allowed === false) {
      process.stderr.write('FlyGit: ' + (data.reason || 'push rejected') + '\\n');
      process.exit(1);
    }`
      : ''}
    process.exit(0);
  } catch (err) {
    // Fail open: an API outage must not block pushes (see docs/SECURITY.md).
    process.stderr.write('FlyGit: hook call failed (' + (err && err.message) + ')\\n');
    ${hookName === 'pre-receive' ? '' : ''}
    process.exit(0);
  }
})();
`;
  }

  /** Creates the initial commit with README.md inside the bare repo (fast-import). */
  private async seedReadme(
    dir: string,
    opts: InitRepositoryOptions,
    content: string,
  ): Promise<void> {
    const author = opts.author ?? { name: 'FlyGit', email: 'noreply@flygit.local' };
    const data = Buffer.from(content, 'utf8');
    const now = Math.floor(Date.now() / 1000);
    const commitMessage = 'Initial commit';
    const importScript = [
      'blob',
      `mark :1`,
      `data ${data.length}`,
      data.toString('utf8'),
      `commit refs/heads/${opts.defaultBranch}`,
      `mark :2`,
      `author ${author.name} <${author.email}> ${now} +0000`,
      `committer ${author.name} <${author.email}> ${now} +0000`,
      `data ${commitMessage.length}`,
      commitMessage,
      `M 100644 :1 README.md`,
      '',
    ].join('\n');
    const result = await this.git.run(['fast-import', '--force'], dir, { input: importScript });
    if (result.code !== 0) {
      this.logger.warn(`fast-import failed for ${dir}: ${result.stderr.trim()}`);
      throw new Error('Failed to seed initial commit');
    }
    await this.git.run(['reset', '--hard'], dir).catch(() => undefined);
    const head = await this.git.run(['rev-parse', `refs/heads/${opts.defaultBranch}`], dir);
    if (head.code === 0 && head.stdout.trim()) {
      await this.git.run(['symbolic-ref', 'HEAD', `refs/heads/${opts.defaultBranch}`], dir).catch(() => undefined);
    }
  }
}

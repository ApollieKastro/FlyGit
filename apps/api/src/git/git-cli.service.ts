import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import type { CommitSummary, DiffHunk, FileContent, FileDiff, FileEntry, GitRef } from '@flygit/shared';

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

const FS = '\x1f'; // unit separator
const RS = '\x1e'; // record separator

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript',
  py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', swift: 'Swift',
  rb: 'Ruby', php: 'PHP', cs: 'C#', cpp: 'C++', cc: 'C++', c: 'C', h: 'C', hh: 'C++',
  html: 'HTML', css: 'CSS', scss: 'SCSS', vue: 'Vue', svelte: 'Svelte',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell',
  sql: 'SQL', json: 'JSON', yml: 'YAML', yaml: 'YAML', md: 'Markdown', xml: 'XML',
  dockerfile: 'Dockerfile', tf: 'Terraform', proto: 'Protocol Buffers', graphql: 'GraphQL',
};

@Injectable()
export class GitCliService {
  private readonly logger = new Logger(GitCliService.name);

  /** Executes a git command inside `cwd` with a timeout. */
  run(args: string[], cwd: string, opts: { timeoutMs?: number; input?: Buffer | string } = {}): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', ['-c', 'core.quotepath=false', ...args], {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`git ${args[0]} timed out after ${opts.timeoutMs ?? 30_000}ms`));
      }, opts.timeoutMs ?? 30_000);

      child.stdout.on('data', (d: Buffer) => stdout.push(d));
      child.stderr.on('data', (d: Buffer) => stderr.push(d));
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve({
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          code: code ?? 1,
        });
      });

      if (opts.input !== undefined) child.stdin.end(opts.input);
      else child.stdin.end();
    });
  }

  /** Like `run` but throws when the command fails. */
  async runOrThrow(args: string[], cwd: string, opts: { timeoutMs?: number; input?: Buffer | string } = {}): Promise<string> {
    const result = await this.run(args, cwd, opts);
    if (result.code !== 0) {
      this.logger.warn(`git ${args.join(' ')} failed (${result.code}): ${result.stderr.trim()}`);
      throw new GitCommandError(result.stderr.trim() || `git ${args[0]} failed`, result.code);
    }
    return result.stdout;
  }

  // ───────────────────────── Repository metadata ─────────────────────────

  async listBranches(repoDir: string, defaultBranch: string): Promise<GitRef[]> {
    const out = await this.runOrThrow(
      [
        'for-each-ref',
        '--format=%(refname:short)%1f%(objectname)%1f%(contents:subject)%1f%(committerdate:iso-strict)%1f%(committername)%1f%(committeremail)%1f%(refname)',
        'refs/heads',
      ],
      repoDir,
    );
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, sha, message, committedAt, authorName, authorEmail, fullName] = line.split(FS);
        return {
          name: name!,
          fullName: fullName ?? `refs/heads/${name}`,
          sha: sha!,
          message: message ?? '',
          committedAt: committedAt ?? undefined,
          author: { name: authorName ?? '', email: authorEmail ?? '' },
          isDefault: name === defaultBranch,
        } satisfies GitRef;
      })
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  }

  async listTags(repoDir: string): Promise<GitRef[]> {
    const out = await this.runOrThrow(
      [
        'for-each-ref',
        '--sort=-creatordate',
        '--format=%(refname:short)%1f%(objectname)%1f%(contents:subject)%1f%(creatordate:iso-strict)%1f%(committername)%1f%(committeremail)',
        'refs/tags',
      ],
      repoDir,
    );
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, sha, message, committedAt, authorName, authorEmail] = line.split(FS);
        return {
          name: name!,
          fullName: `refs/tags/${name}`,
          sha: sha!,
          message: message ?? '',
          committedAt: committedAt ?? undefined,
          author: { name: authorName ?? '', email: authorEmail ?? '' },
        } satisfies GitRef;
      });
  }

  async resolveRef(repoDir: string, ref: string): Promise<string | null> {
    const safe = this.sanitizeRef(ref);
    if (!safe) return null;
    const result = await this.run(['rev-parse', '--verify', '--quiet', `${safe}^{commit}`], repoDir);
    return result.code === 0 ? result.stdout.trim() || null : null;
  }

  async branchExists(repoDir: string, branch: string): Promise<boolean> {
    const result = await this.run(
      ['show-ref', '--verify', '--quiet', `refs/heads/${this.sanitizeRef(branch)}`],
      repoDir,
    );
    return result.code === 0;
  }

  async isAncestor(repoDir: string, ancestor: string, descendant: string): Promise<boolean> {
    const result = await this.run(['merge-base', '--is-ancestor', ancestor, descendant], repoDir);
    return result.code === 0;
  }

  async mergeBase(repoDir: string, a: string, b: string): Promise<string | null> {
    const result = await this.run(['merge-base', a, b], repoDir);
    return result.code === 0 ? result.stdout.trim() || null : null;
  }

  // ───────────────────────── Commits ─────────────────────────

  async listCommits(
    repoDir: string,
    opts: { ref?: string; path?: string; page: number; pageSize: number },
  ): Promise<{ commits: CommitSummary[]; total: number }> {
    const ref = opts.ref ? this.sanitizeRef(opts.ref) : 'HEAD';
    const countArgs = ['rev-list', '--count', ref ?? 'HEAD', ...(opts.path ? ['--', opts.path] : [])];
    const countResult = await this.run(countArgs, repoDir);
    const total = countResult.code === 0 ? Number(countResult.stdout.trim()) || 0 : 0;

    const format = ['%H', '%h', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%P', '%s'].join(FS);
    const args = [
      'log',
      `--format=${format}${RS}`,
      `--skip=${(opts.page - 1) * opts.pageSize}`,
      `--max-count=${opts.pageSize}`,
      ref ?? 'HEAD',
      ...(opts.path ? ['--', opts.path] : []),
    ];
    const result = await this.run(args, repoDir);
    if (result.code !== 0) return { commits: [], total: 0 };

    const commits = result.stdout
      .split(RS)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const [sha, shortSha, an, ae, at, _cn, _ce, ct, parents, subject] = chunk.split(FS);
        return {
          sha: sha!,
          shortSha: shortSha!,
          message: subject ?? '',
          author: { name: an ?? '', email: ae ?? '', username: null },
          authoredAt: new Date(Number(at) * 1000).toISOString(),
          committedAt: new Date(Number(ct) * 1000).toISOString(),
          parents: (parents ?? '').split(' ').filter(Boolean),
        } satisfies CommitSummary;
      });
    return { commits, total };
  }

  /** Commit list for an explicit range (used by compare/MR views). */
  async listCommitsRange(repoDir: string, range: string): Promise<CommitSummary[]> {
    const format = ['%H', '%h', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%P', '%s'].join(FS);
    const result = await this.run(['log', `--format=${format}${RS}`, range], repoDir);
    if (result.code !== 0) return [];
    return result.stdout
      .split(RS)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const [sha, shortSha, an, ae, at, _cn, _ce, ct, parents, subject] = chunk.split(FS);
        return {
          sha: sha!,
          shortSha: shortSha!,
          message: subject ?? '',
          author: { name: an ?? '', email: ae ?? '', username: null },
          authoredAt: new Date(Number(at) * 1000).toISOString(),
          committedAt: new Date(Number(ct) * 1000).toISOString(),
          parents: (parents ?? '').split(' ').filter(Boolean),
        } satisfies CommitSummary;
      });
  }

  async getCommit(repoDir: string, sha: string): Promise<(CommitSummary & { body: string }) | null> {
    const format = ['%H', '%h', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%P', '%s', '%b'].join(FS);
    const result = await this.run(['show', '-s', `--format=${format}`, sha], repoDir);
    if (result.code !== 0) return null;
    const [H, h, an, ae, at, _cn, _ce, ct, parents, subject, body] = result.stdout.split(FS);
    return {
      sha: H!,
      shortSha: h!,
      message: subject ?? '',
      body: (body ?? '').trim(),
      author: { name: an ?? '', email: ae ?? '', username: null },
      authoredAt: new Date(Number(at) * 1000).toISOString(),
      committedAt: new Date(Number(ct) * 1000).toISOString(),
      parents: (parents ?? '').split(' ').filter(Boolean),
    };
  }

  /** Commit detail with per-file stats. */
  async getCommitFiles(repoDir: string, sha: string): Promise<FileDiff[]> {
    const patch = await this.run(['show', '--no-color', '--numstat', '--format=', '--find-renames', sha], repoDir);
    if (patch.code !== 0) return [];
    const stats = patch.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [add, del, path] = line.split('\t');
        return { path: path ?? '', additions: Number(add) || 0, deletions: Number(del) || 0 };
      });
    const diffs = await this.getPatch(repoDir, ['show', '--no-color', '--find-renames', '--format=', sha]);
    return diffs.map((d) => ({
      ...d,
      additions: stats.find((s) => s.path === d.path)?.additions ?? d.additions,
      deletions: stats.find((s) => s.path === d.path)?.deletions ?? d.deletions,
    }));
  }

  // ───────────────────────── Tree / files ─────────────────────────

  async listTree(repoDir: string, ref: string, path: string): Promise<FileEntry[]> {
    const safeRef = this.sanitizeRef(ref) ?? 'HEAD';
    const target = path ? `${safeRef}:${path.replace(/^\/+/, '')}` : `${safeRef}`;
    const result = await this.run(['ls-tree', '-l', target], repoDir);
    if (result.code !== 0) return [];
    const entries: FileEntry[] = [];
    for (const line of result.stdout.split('\n')) {
      if (!line) continue;
      // <mode> <type> <sha> <size>\t<name>
      const match = /^(\d{6})\s+(\w+)\s+([0-9a-f]{40})\s*(-|\d+)\t(.+)$/.exec(line);
      if (!match) continue;
      const type = match[2]!;
      const isDir = type === 'tree';
      const name = match[5]!;
      entries.push({
        name,
        path: path ? `${path.replace(/\/+$/, '')}/${name}` : name,
        type: isDir ? 'dir' : type === 'commit' ? 'submodule' : 'file',
        size: isDir ? 0 : Number(match[4]) === -1 ? 0 : Number(match[4]),
        sha: match[3]!,
      });
    }
    return entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  }

  async readFile(repoDir: string, ref: string, path: string): Promise<FileContent | null> {
    const safeRef = this.sanitizeRef(ref) ?? 'HEAD';
    const safePath = path.replace(/^\/+/, '');
    const sizeResult = await this.run(['cat-file', '-s', `${safeRef}:${safePath}`], repoDir);
    if (sizeResult.code !== 0) return null;
    const size = Number(sizeResult.stdout.trim()) || 0;
    const truncated = size > 1_000_000;

    const buffer = await this.captureBuffer(
      ['show', `${safeRef}:${safePath}`],
      repoDir,
      truncated ? 1_000_000 : undefined,
    );
    if (!buffer) return null;

    const isBinary = buffer.subarray(0, 8000).includes(0);
    const ext = safePath.split('.').pop()?.toLowerCase() ?? '';
    const base = safePath.split('/').pop()?.toLowerCase() ?? '';
    const language =
      LANGUAGE_BY_EXT[ext] ??
      (base === 'dockerfile' ? 'Dockerfile' : base.startsWith('dockerfile.') ? 'DockerFile' : null);

    const lastCommit = (await this.listCommits(repoDir, { ref: safeRef, path: safePath, page: 1, pageSize: 1 }))
      .commits[0];

    return {
      path: safePath,
      name: safePath.split('/').pop() ?? safePath,
      size,
      encoding: isBinary ? 'base64' : 'utf8',
      content: isBinary ? buffer.toString('base64') : buffer.toString('utf8'),
      language,
      isBinary,
      truncated,
      lastCommit: lastCommit ?? null,
    };
  }

  /** Counts files and total size for a ref (used for empty-repo checks). */
  async isRepoEmpty(repoDir: string): Promise<boolean> {
    const result = await this.run(['rev-parse', '--verify', 'HEAD'], repoDir);
    return result.code !== 0;
  }

  /** Dominant language by blob bytes — called after each push. */
  async detectLanguage(repoDir: string): Promise<string | null> {
    const result = await this.run(['ls-tree', '-r', '-l', 'HEAD'], repoDir);
    if (result.code !== 0) return null;
    const extBytes = new Map<string, number>();
    for (const line of result.stdout.split('\n')) {
      const match = /^\d{6}\s+\w+\s+[0-9a-f]{40}\s+(\d+)\t(.+)$/.exec(line);
      if (!match) continue;
      const size = Number(match[1]);
      const path = match[2]!;
      const ext = (path.split('.').pop() ?? '').toLowerCase();
      if (!ext) continue;
      extBytes.set(ext, (extBytes.get(ext) ?? 0) + size);
    }
    let best: { lang: string; bytes: number } | null = null;
    for (const [ext, bytes] of extBytes) {
      const lang = LANGUAGE_BY_EXT[ext];
      if (!lang) continue;
      if (!best || bytes > best.bytes) best = { lang, bytes };
    }
    return best?.lang ?? null;
  }

  async repoSizeBytes(repoDir: string): Promise<number> {
    try {
      const s = await stat(repoDir);
      if (!s.isDirectory()) return 0;
      const du = await this.run(['count-objects', '-v'], repoDir);
      const sizeMatch = /^size:\s*(\d+)/m.exec(du.stdout);
      const idxMatch = /^size-garbage:\s*(\d+)/m.exec(du.stdout);
      const packMatch = await this.run(['count-objects', '-vH'], repoDir);
      void packMatch;
      return Number(sizeMatch?.[1] ?? 0) + Number(idxMatch?.[1] ?? 0);
    } catch {
      return 0;
    }
  }

  // ───────────────────────── Diff ─────────────────────────

  /** Three-dot diff (changes on `to` since merge-base with `from`). */
  async compare(repoDir: string, from: string, to: string): Promise<FileDiff[]> {
    const a = this.sanitizeRef(from);
    const b = this.sanitizeRef(to);
    if (!a || !b) return [];
    const numstat = await this.run(['diff', '--numstat', '--find-renames', `${a}...${b}`], repoDir);
    const stats = new Map<string, { additions: number; deletions: number }>();
    if (numstat.code === 0) {
      for (const line of numstat.stdout.split('\n')) {
        const [add, del, path] = line.split('\t');
        if (path) stats.set(path, { additions: Number(add) || 0, deletions: Number(del) || 0 });
      }
    }
    const diffs = await this.getPatch(repoDir, ['diff', '--no-color', '--find-renames', `${a}...${b}`]);
    return diffs.map((d) => ({
      ...d,
      additions: stats.get(d.path)?.additions ?? d.additions,
      deletions: stats.get(d.path)?.deletions ?? d.deletions,
    }));
  }

  /** Parses `git diff` output into structured hunks. */
  async getPatch(repoDir: string, args: string[]): Promise<FileDiff[]> {
    const result = await this.run(args, repoDir);
    if (result.code !== 0 || !result.stdout) return [];
    return parseUnifiedDiff(result.stdout);
  }

  /** Line-level blame. */
  async blame(repoDir: string, ref: string, path: string): Promise<Array<{ line: number; sha: string; author: string; email: string; date: string; summary: string }>> {
    const safeRef = this.sanitizeRef(ref) ?? 'HEAD';
    const result = await this.run(['blame', '--porcelain', safeRef, '--', path], repoDir);
    if (result.code !== 0) return [];
    const commits = new Map<string, { author: string; email: string; date: string; summary: string }>();
    const lines: Array<{ line: number; sha: string; author: string; email: string; date: string; summary: string }> = [];
    let current: { sha: string; author?: string; email?: string; date?: string; summary?: string } | null = null;
    let lineNo = 0;
    for (const raw of result.stdout.split('\n')) {
      const header = /^([0-9a-f]{40})\s+(\d+)(?:\s+(\d+))?$/.exec(raw);
      if (header) {
        const sha = header[1]!;
        lineNo = Number(header[2]);
        if (header[3] === undefined) {
          current = { sha };
          const cached = commits.get(sha);
          if (cached) {
            lines.push({ line: lineNo, sha, ...cached });
            current = null;
          }
        } else {
          current = null;
          const cached = commits.get(sha);
          if (cached) lines.push({ line: lineNo, sha, ...cached });
        }
        continue;
      }
      if (!current) continue;
      if (raw.startsWith('author ')) current.author = raw.slice(7);
      else if (raw.startsWith('author-mail ')) current.email = raw.slice(12).replace(/[<>]/g, '');
      else if (raw.startsWith('author-time ')) current.date = new Date(Number(raw.slice(12)) * 1000).toISOString();
      else if (raw.startsWith('summary ')) current.summary = raw.slice(8);
      else if (raw === '') {
        if (current.author) {
          const info = {
            author: current.author,
            email: current.email ?? '',
            date: current.date ?? '',
            summary: current.summary ?? '',
          };
          commits.set(current.sha, info);
          lines.push({ line: lineNo, sha: current.sha, ...info });
          current = null;
        }
      } else if (!raw.startsWith('\t')) {
        continue;
      }
    }
    return lines;
  }

  // ───────────────────────── Mutations (used by MR merge) ─────────────────────────

  /** Resolves a full 40-char sha or ref name to a commit sha. */
  async revParse(repoDir: string, ref: string): Promise<string | null> {
    const safe = this.sanitizeRef(ref) ?? ref;
    if (!/^[0-9a-f]{7,40}$/i.test(safe) && !/^[a-zA-Z0-9._/-]+$/.test(safe)) return null;
    const result = await this.run(['rev-parse', '--verify', `${safe}^{commit}`], repoDir);
    return result.code === 0 ? result.stdout.trim() || null : null;
  }

  async deleteRef(repoDir: string, refName: string): Promise<void> {
    await this.run(['update-ref', '-d', refName], repoDir);
  }

  async updateRef(repoDir: string, refName: string, sha: string): Promise<void> {
    await this.runOrThrow(['update-ref', refName, sha], repoDir);
  }

  /** Reads README.md content for the repository landing page. */
  async readReadme(repoDir: string, ref: string): Promise<string | null> {
    for (const name of ['README.md', 'readme.md', 'README', 'README.rst', 'README.txt']) {
      const content = await this.readFile(repoDir, ref, name).catch(() => null);
      if (content && !content.isBinary) return content.content;
    }
    return null;
  }

  // ───────────────────────── Helpers ─────────────────────────

  /**
   * Rejects anything that could escape the repository (path traversal,
   * option injection). Only conservative ref/path characters pass.
   */
  sanitizeRef(ref: string): string | null {
    if (!ref) return null;
    if (ref.startsWith('-')) return null;
    if (!/^[a-zA-Z0-9._/@{}^~:-]+$/.test(ref)) return null;
    if (ref.includes('..')) return null;
    return ref;
  }

  sanitizePath(path: string): string | null {
    if (!path) return '';
    const normalized = path.replace(/^\/+/, '');
    if (normalized.includes('..') || normalized.startsWith('-')) return null;
    if (!/^[a-zA-Z0-9 ._\-/@+()[\],#~]+$/.test(normalized)) return null;
    return normalized;
  }

  private captureBuffer(args: string[], cwd: string, maxBytes?: number): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', ['-c', 'core.quotepath=false', ...args], { cwd, env: process.env });
      const chunks: Buffer[] = [];
      let total = 0;
      let settled = false;
      const done = (value: Buffer | null) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      child.stdout.on('data', (d: Buffer) => {
        total += d.length;
        if (maxBytes && total > maxBytes) {
          chunks.push(d.subarray(0, Math.max(0, d.length - (total - maxBytes))));
          child.kill('SIGKILL');
          done(Buffer.concat(chunks));
          return;
        }
        chunks.push(d);
      });
      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      child.on('close', (code) => done(code === 0 ? Buffer.concat(chunks) : null));
    });
  }
}

export class GitCommandError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = 'GitCommandError';
  }
}

// ───────────────────────── Unified diff parser ─────────────────────────

export function parseUnifiedDiff(patch: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = patch.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.startsWith('diff --git ')) {
      i++;
      continue;
    }
    i++;
    let path: string | null = null;
    let oldPath: string | null = null;
    let status: FileDiff['status'] = 'modified';
    let binary = false;
    const hunks: DiffHunk[] = [];
    let additions = 0;
    let deletions = 0;

    while (i < lines.length && !lines[i]!.startsWith('diff --git ')) {
      const current = lines[i]!;
      if (current.startsWith('--- ')) {
        const p = current.slice(4).trim();
        if (p.startsWith('/dev/null')) status = 'added';
        else oldPath = p.replace(/^a\//, '');
      } else if (current.startsWith('+++ ')) {
        const p = current.slice(4).trim();
        if (p.startsWith('/dev/null')) status = 'deleted';
        else path = p.replace(/^b\//, '');
      } else if (current.startsWith('rename from ')) {
        status = 'renamed';
        oldPath = current.slice(12);
      } else if (current.startsWith('rename to ')) {
        path = current.slice(10);
      } else if (current.startsWith('new file mode')) {
        status = 'added';
      } else if (current.startsWith('deleted file mode')) {
        status = 'deleted';
      } else if (current.startsWith('Binary files ') || current === 'GIT binary patch') {
        binary = true;
      } else if (current.startsWith('@@ ')) {
        const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(current);
        if (match) {
          const hunk: DiffHunk = {
            header: current,
            oldStart: Number(match[1]),
            oldLines: Number(match[2] ?? 1),
            newStart: Number(match[3]),
            newLines: Number(match[4] ?? 1),
            lines: [],
          };
          i++;
          let oldNo = hunk.oldStart;
          let newNo = hunk.newStart;
          while (i < lines.length && !lines[i]!.startsWith('@@ ') && !lines[i]!.startsWith('diff --git ')) {
            const l = lines[i]!;
            if (l.startsWith('+')) {
              hunk.lines.push({ type: 'add', oldNumber: null, newNumber: newNo++, content: l.slice(1) });
              additions++;
            } else if (l.startsWith('-')) {
              hunk.lines.push({ type: 'del', oldNumber: oldNo++, newNumber: null, content: l.slice(1) });
              deletions++;
            } else if (l.startsWith('\\')) {
              hunk.lines.push({ type: 'meta', oldNumber: null, newNumber: null, content: l });
            } else if (l === '' && i + 1 >= lines.length) {
              break;
            } else {
              hunk.lines.push({ type: 'context', oldNumber: oldNo++, newNumber: newNo++, content: l.startsWith(' ') ? l.slice(1) : l });
            }
            i++;
          }
          hunks.push(hunk);
          continue;
        }
      }
      i++;
    }

    if (path) {
      files.push({ path, oldPath, status, additions, deletions, hunks, binary });
    }
  }
  return files;
}

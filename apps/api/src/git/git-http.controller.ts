import { Controller, All, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { spawn } from 'node:child_process';
import { roleAtLeast } from '@flygit/shared';
import { GitStorageService } from './git-storage.service';
import { RepositoryAccessService } from './repository-access.service';
import { GitAuthService, gitForbidden, gitNotFound, gitUnauthorized } from './git-auth.service';

const GIT_PATH_RE = /^\/git\/([^/]+)\/([^/]+)\.git\/(.+)$/;

/**
 * Git smart-HTTP transport.
 *
 * Clone/push URLs:  <APP_URL>/git/<owner>/<repo>.git
 * Implemented by proxying to the standard `git http-backend` CGI,
 * which is the reference implementation of the smart protocol.
 */
@Controller('git')
export class GitHttpController {
  private readonly logger = new Logger(GitHttpController.name);

  constructor(
    private readonly storage: GitStorageService,
    private readonly access: RepositoryAccessService,
    private readonly gitAuth: GitAuthService,
  ) {}

  @All(':owner/:repo.git/info/refs')
  infoRefs(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.handle(req, res);
  }

  @All(':owner/:repo.git/git-upload-pack')
  uploadPack(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.handle(req, res);
  }

  @All(':owner/:repo.git/git-receive-pack')
  receivePack(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.handle(req, res);
  }

  private async handle(req: Request, res: Response): Promise<void> {
    const match = GIT_PATH_RE.exec(req.path);
    if (!match) {
      gitNotFound(res);
      return;
    }
    const owner = match[1]!.toLowerCase();
    const repo = match[2]!.toLowerCase();
    const rest = match[3]!;

    if (!/^[a-z0-9._-]+$/.test(owner) || !/^[a-z0-9._-]+$/.test(repo)) {
      gitNotFound(res);
      return;
    }

    // Parse the requested git service from the sub-path.
    let service: 'git-upload-pack' | 'git-receive-pack' | null = null;
    let pathInfo = `/${owner}/${repo}.git`;
    if (rest === 'info/refs') {
      const requested = (req.query.service as string) ?? '';
      if (requested !== 'git-upload-pack' && requested !== 'git-receive-pack') {
        gitNotFound(res);
        return;
      }
      service = requested;
      pathInfo += '/info/refs';
    } else if (rest === 'git-upload-pack') {
      service = 'git-upload-pack';
      pathInfo += '/git-upload-pack';
    } else if (rest === 'git-receive-pack') {
      service = 'git-receive-pack';
      pathInfo += '/git-receive-pack';
    } else {
      gitNotFound(res);
      return;
    }

    // ── Authorization ────────────────────────────────────────────
    const user = await this.gitAuth.authenticate(req);

    let repository;
    try {
      repository = await this.access.findRepository(owner, repo);
    } catch {
      // Do not leak repo existence: unauthenticated clients get a 401
      // challenge (so the git credential prompt appears), authenticated
      // clients get a plain 404.
      if (!user && service === 'git-upload-pack') {
        gitUnauthorized(res, 'Authentication required');
        return;
      }
      gitNotFound(res);
      return;
    }

    const access = await this.access.resolve(user, repository);
    const required = service === 'git-receive-pack' ? 'developer' : 'guest';
    if (!access || !roleAtLeast(access.role, required)) {
      if (!user) {
        gitUnauthorized(res, 'Authentication required');
        return;
      }
      gitForbidden(res, `You need ${required} access to this repository`);
      return;
    }

    // ── Dispatch to git http-backend ─────────────────────────────
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_PROJECT_ROOT: this.storage.storageRoot,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: pathInfo,
      QUERY_STRING: req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '',
      REQUEST_METHOD: req.method,
      CONTENT_TYPE: String(req.headers['content-type'] ?? ''),
      CONTENT_LENGTH: String(req.headers['content-length'] ?? ''),
      REMOTE_ADDR: req.ip ?? '',
      GATEWAY_INTERFACE: 'CGI/1.1',
      SERVER_PROTOCOL: 'HTTP/1.1',
      SERVER_SOFTWARE: 'FlyGit',
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    };
    if (user) env.REMOTE_USER = user.username;
    const protocol = req.headers['git-protocol'];
    if (protocol) env.HTTP_GIT_PROTOCOL = String(protocol);

    const child = spawn('git', ['http-backend'], { env, stdio: ['pipe', 'pipe', 'pipe'] });

    let headerSent = false;
    let headerBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr = '';

    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });

    child.stdout.on('data', (chunk: Buffer) => {
      if (headerSent) {
        res.write(chunk);
        return;
      }
      const combined = headerBuffer.length ? Buffer.concat([headerBuffer, chunk]) : chunk;
      const separatorAt = findHeaderEnd(combined);
      if (separatorAt < 0) {
        headerBuffer = combined; // headers not complete yet — keep buffering
        return;
      }
      writeCgiHeaders(res, combined.subarray(0, separatorAt));
      headerSent = true;
      headerBuffer = Buffer.alloc(0);
      const body = combined.subarray(separatorAt + (combined[separatorAt] === 13 ? 4 : 2));
      if (body.length) res.write(body);
    });

    child.on('close', () => {
      if (!headerSent) {
        this.logger.error(`git http-backend produced no output for ${pathInfo}: ${stderr.trim()}`);
        if (!res.headersSent) {
          res.status(500).setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('fatal: internal git error\n');
        } else {
          res.end();
        }
        return;
      }
      res.end();
    });

    child.on('error', (err) => {
      this.logger.error(`git http-backend spawn failed: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('fatal: internal git error\n');
      }
    });

    // Stream the request body into the CGI process.
    if (req.method === 'POST') {
      req.pipe(child.stdin);
      child.stdin.on('error', () => undefined);
    } else {
      child.stdin.end();
    }
  }
}

/** Finds the end of CGI headers (`\r\n\r\n` or `\n\n`); returns separator start index or -1. */
function findHeaderEnd(buf: Buffer): number {
  const crlf = buf.indexOf('\r\n\r\n');
  const lf = buf.indexOf('\n\n');
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) return crlf;
  if (lf >= 0) return lf;
  return -1;
}

function writeCgiHeaders(res: Response, headerBlock: Buffer): void {
  let status = 200;
  for (const line of headerBlock.toString('utf8').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (name.toLowerCase() === 'status') {
      status = Number.parseInt(value, 10) || 200;
    } else if (name) {
      try {
        res.setHeader(name, value);
      } catch {
        // ignore invalid header values produced by the CGI
      }
    }
  }
  res.status(status);
}

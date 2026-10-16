import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * Credential verification for Git over HTTPS.
 *
 * Accepts `Basic` auth where the password is either:
 *  - a personal access token (`fgt_…`) — recommended for CI, or
 *  - the account password (interactive users).
 */
@Injectable()
export class GitAuthService {
  private readonly logger = new Logger(GitAuthService.name);
  private readonly passwordCache = new Map<string, { ok: boolean; expires: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async authenticate(req: Request): Promise<AuthUser | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Basic ')) return null;

    let decoded: string;
    try {
      decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    } catch {
      return null;
    }
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    const username = decoded.slice(0, separator).toLowerCase();
    const secret = decoded.slice(separator + 1);
    if (!username || !secret) return null;

    // API tokens are recognised by their prefix and are cheap to verify.
    if (secret.startsWith('fgt_')) {
      const user = await this.users.verifyApiToken(secret);
      if (user && (user.username.toLowerCase() === username || username === user.email)) return user;
      return null;
    }

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username }, { email: username }], isActive: true },
    });
    if (!user) return null;

    // Mitigate argon2 cost on repeated auth attempts from the same client.
    const cacheKey = `${user.id}:${secret.length}`;
    const cached = this.passwordCache.get(cacheKey);
    if (cached && cached.expires > Date.now() && cached.ok) {
      return this.toAuthUser(user);
    }

    try {
      const ok = await argon2.verify(user.passwordHash, secret);
      this.passwordCache.set(cacheKey, { ok, expires: Date.now() + 30_000 });
      if (this.passwordCache.size > 500) {
        const oldest = this.passwordCache.keys().next().value;
        if (oldest) this.passwordCache.delete(oldest);
      }
      return ok ? this.toAuthUser(user) : null;
    } catch (error) {
      this.logger.debug(`password verify failed: ${(error as Error).message}`);
      return null;
    }
  }

  private toAuthUser(user: { id: string; username: string; email: string; isAdmin: boolean; role: 'admin' | 'user' }): AuthUser {
    return { id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin, role: user.role };
  }
}

/** Minimal helper shared by HTTP/SSH transports. */
export function gitUnauthorized(res: Response, message = 'Authentication required'): void {
  res.status(401);
  res.setHeader('WWW-Authenticate', 'Basic realm="FlyGit", charset="UTF-8"');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(`fatal: ${message}\n`);
}

export function gitNotFound(res: Response): void {
  res.status(404);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('fatal: repository not found\n');
}

export function gitForbidden(res: Response, message: string): void {
  res.status(403);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(`fatal: ${message}\n`);
}

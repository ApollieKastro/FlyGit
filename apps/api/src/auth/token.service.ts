import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { JwtPayload, PlatformRole } from '@flygit/shared';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';
import { randomToken, sha256 } from '../common/utils/crypto.util';

export interface SessionRecord {
  id: string;
  token: string;
  expiresAt: Date;
}

/**
 * Access tokens are short-lived JWTs; refresh tokens are opaque secrets
 * persisted as SHA-256 hashes in the `sessions` table (rotated on every use).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async signAccessToken(user: {
    id: string;
    username: string;
    email: string;
    isAdmin: boolean;
    role: PlatformRole;
  }): Promise<{ token: string; expiresIn: number }> {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin,
      type: 'access',
    };
    const secret = process.env.JWT_ACCESS_SECRET!;
    const ttl = process.env.JWT_ACCESS_TTL ?? '15m';
    const expiresIn = this.ttlToSeconds(ttl);
    const token = await this.jwt.signAsync(payload, {
      secret,
      expiresIn,
      jwtid: randomUUID(),
    });
    return { token, expiresIn };
  }

  /** Creates a new refresh session; returns the raw token exactly once. */
  async createSession(
    userId: string,
    meta: { userAgent: string | null; ip: string | null },
  ): Promise<SessionRecord> {
    const raw = randomToken(32);
    const days = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(raw),
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt,
      },
    });
    return { id: '', token: raw, expiresAt };
  }

  /**
   * Validates and rotates a refresh token.
   * Returns the owning user or throws when the session is invalid.
   */
  async rotateSession(
    rawToken: string,
    meta: { userAgent: string | null; ip: string | null },
  ): Promise<{ userId: string; token: string; expiresAt: Date; sessionId: string }> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(rawToken) },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or expired session',
        code: 'INVALID_REFRESH_TOKEN',
      });
    }

    // Rotate: revoke the old token, issue a fresh one in the same session row.
    const next = randomToken(32);
    const days = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await this.prisma.session.update({
      where: { id: session.id },
      data: { tokenHash: sha256(next), lastUsedAt: new Date(), expiresAt, ip: meta.ip, userAgent: meta.userAgent },
    });
    return { userId: session.userId, token: next, expiresAt, sessionId: session.id };
  }

  async revokeSessionByToken(rawToken: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessions(userId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  verifyAccessToken(token: string): AuthUser {
    try {
      const payload = this.jwt.verify<JwtPayload>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      if (payload.type !== 'access') throw new Error('wrong token type');
      return {
        id: payload.sub,
        username: payload.username,
        email: payload.email,
        isAdmin: payload.isAdmin,
        role: payload.isAdmin ? 'admin' : 'user',
      };
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid access token',
        code: 'INVALID_ACCESS_TOKEN',
      });
    }
  }

  /** Signs a short-lived challenge token used between login and 2FA check. */
  async signTwoFactorChallenge(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, type: '2fa' },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: 5 * 60 },
    );
  }

  async verifyTwoFactorChallenge(token: string): Promise<string> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; type: string }>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      if (payload.type !== '2fa') throw new Error('wrong type');
      return payload.sub;
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Two-factor challenge expired, sign in again',
        code: 'TWO_FACTOR_CHALLENGE_EXPIRED',
      });
    }
  }

  private ttlToSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 900;
    const value = Number(match[1]);
    const unit = match[2];
    const factor = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86_400;
    return value * factor;
  }
}

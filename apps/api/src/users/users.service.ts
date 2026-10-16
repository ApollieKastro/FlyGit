import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CreateTokenInput, SshKeyInput, UpdateProfileInput, UserPrivate } from '@flygit/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.module';
import { randomToken, sha256 } from '../common/utils/crypto.util';
import type { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getMe(userId: string): Promise<UserPrivate> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      website: user.website,
      role: user.role,
      isActive: user.isActive,
      emailConfirmedAt: user.emailConfirmedAt?.toISOString() ?? null,
      twoFactorEnabled: user.totpEnabled,
      locale: user.locale,
      theme: user.theme as 'dark' | 'light' | 'system',
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  async updateMe(userId: string, input: UpdateProfileInput): Promise<UserPrivate> {
    if (input.username && input.username !== undefined) {
      const existing = await this.prisma.user.findUnique({
        where: { username: input.username },
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: 'Username already taken',
          code: 'USERNAME_TAKEN',
          details: { username: ['validation:usernameTaken'] },
        });
      }
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.username !== undefined ? { username: input.username } : {}),
        ...(input.bio !== undefined ? { bio: input.bio } : {}),
        ...(input.website !== undefined ? { website: input.website } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.theme !== undefined ? { theme: input.theme } : {}),
      },
    });
    await this.audit.record({ actorId: userId, action: 'user.profile_updated', entityType: 'user', entityId: userId });
    return this.getMe(user.id);
  }

  /** Public profile with public repositories. */
  async getProfile(username: string, viewer: AuthUser | undefined) {
    const user = await this.prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (!user || !user.isActive) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }
    const [repos, starsCount, followers] = await Promise.all([
      this.prisma.repository.findMany({
        where: {
          ownerType: 'user',
          ownerId: user.id,
          deletedAt: null,
          visibility: viewer && (viewer.isAdmin || viewer.id === user.id) ? undefined : 'public',
        },
        orderBy: { updatedAt: 'desc' },
        take: 30,
        select: {
          id: true, slug: true, name: true, description: true, visibility: true,
          language: true, starsCount: true, updatedAt: true, defaultBranch: true,
          openIssuesCount: true, forkParentId: true,
        },
      }),
      this.prisma.repositoryStar.count({ where: { userId: user.id } }),
      this.prisma.activity.count({ where: { actorId: user.id } }),
    ]);

    return {
      profile: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        website: user.website,
        createdAt: user.createdAt.toISOString(),
      },
      repositories: repos.map((r) => ({
        ...r,
        updatedAt: r.updatedAt.toISOString(),
        owner: { username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl },
        ownerType: 'user' as const,
        ownerId: user.id,
        starsCount: r.starsCount,
        watchersCount: 0,
        forksCount: 0,
        openMergeRequestsCount: 0,
        createdAt: user.createdAt.toISOString(),
      })),
      starsCount,
      activityCount: followers,
    };
  }

  async search(q: string, page: number, pageSize: number) {
    const where = q ? { OR: [{ username: { contains: q, mode: 'insensitive' as const } }, { displayName: { contains: q, mode: 'insensitive' as const } }], isActive: true } : { isActive: true };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { username: 'asc' },
        select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true, createdAt: true },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  // ───────────────────────── SSH keys ─────────────────────────

  async listSshKeys(userId: string) {
    const keys = await this.prisma.sshKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, publicKey: true, fingerprint: true, createdAt: true, lastUsedAt: true },
    });
    return keys.map((k) => ({ ...k, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null }));
  }

  async addSshKey(userId: string, input: SshKeyInput) {
    const fingerprint = SshKeyService.fingerprint(input.key);
    if (!fingerprint) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid SSH public key',
        code: 'INVALID_SSH_KEY',
      });
    }
    const existing = await this.prisma.sshKey.findUnique({ where: { fingerprint } });
    if (existing) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'This key is already registered',
        code: 'SSH_KEY_TAKEN',
      });
    }
    const key = await this.prisma.sshKey.create({
      data: { userId, title: input.title, publicKey: input.key.trim(), fingerprint },
    });
    await this.audit.record({ actorId: userId, action: 'user.ssh_key_added', entityType: 'ssh_key', entityId: key.id });
    return { id: key.id, title: key.title, fingerprint: key.fingerprint, createdAt: key.createdAt.toISOString() };
  }

  async removeSshKey(userId: string, keyId: string): Promise<void> {
    const { count } = await this.prisma.sshKey.deleteMany({ where: { id: keyId, userId } });
    if (!count) {
      throw new NotFoundException({ statusCode: 404, error: 'Not Found', message: 'SSH key not found', code: 'SSH_KEY_NOT_FOUND' });
    }
    await this.audit.record({ actorId: userId, action: 'user.ssh_key_removed', entityType: 'ssh_key', entityId: keyId });
  }

  // ───────────────────────── API tokens ─────────────────────────

  async listTokens(userId: string) {
    const tokens = await this.prisma.apiToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, prefix: true, scopes: true, expiresAt: true, lastUsedAt: true, createdAt: true },
    });
    return tokens.map((t) => ({
      ...t,
      expiresAt: t.expiresAt?.toISOString() ?? null,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  /** Returns the plaintext token exactly once — only its hash is stored. */
  async createToken(userId: string, input: CreateTokenInput) {
    const raw = `fgt_${randomToken(24)}`;
    const token = await this.prisma.apiToken.create({
      data: {
        userId,
        name: input.name,
        tokenHash: sha256(raw),
        prefix: raw.slice(0, 12),
        scopes: input.scopes,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
    await this.audit.record({ actorId: userId, action: 'user.token_created', entityType: 'api_token', entityId: token.id, metadata: { name: token.name } });
    return {
      id: token.id,
      name: token.name,
      token: raw,
      scopes: token.scopes,
      prefix: token.prefix,
      expiresAt: token.expiresAt?.toISOString() ?? null,
      createdAt: token.createdAt.toISOString(),
    };
  }

  async revokeToken(userId: string, tokenId: string): Promise<void> {
    const { count } = await this.prisma.apiToken.updateMany({
      where: { id: tokenId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!count) {
      throw new NotFoundException({ statusCode: 404, error: 'Not Found', message: 'Token not found', code: 'TOKEN_NOT_FOUND' });
    }
    await this.audit.record({ actorId: userId, action: 'user.token_revoked', entityType: 'api_token', entityId: tokenId });
  }

  /** Verifies an API token (used by git over HTTPS and CI). */
  async verifyApiToken(raw: string): Promise<AuthUser | null> {
    const token = await this.prisma.apiToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!token || token.revokedAt || (token.expiresAt && token.expiresAt < new Date())) return null;
    const user = await this.prisma.user.findUnique({ where: { id: token.userId } });
    if (!user || !user.isActive) return null;
    void this.prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return { id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin, role: user.role };
  }

  async updateNotificationPreferences(userId: string, prefs: Record<string, { inApp: boolean; email: boolean }>) {
    const entries = Object.entries(prefs);
    await this.prisma.$transaction(
      entries.map(([type, value]) =>
        this.prisma.notificationPreference.upsert({
          where: { userId_type: { userId, type } },
          create: { userId, type, inApp: value.inApp, email: value.email },
          update: { inApp: value.inApp, email: value.email },
        }),
      ),
    );
    return { updated: entries.length };
  }

  async getNotificationPreferences(userId: string) {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId } });
    return rows.map((r) => ({ type: r.type, inApp: r.inApp, email: r.email }));
  }
}

/** Pure helpers for OpenSSH public key handling. */
export class SshKeyService {
  private static readonly SUPPORTED = new Set([
    'ssh-ed25519',
    'ssh-rsa',
    'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521',
    'sk-ssh-ed25519@openssh.com',
    'sk-ecdsa-sha2-nistp256@openssh.com',
  ]);

  /**
   * Computes the OpenSSH-style SHA256 fingerprint of a public key line.
   * Returns null when the line is not a supported key.
   */
  static fingerprint(publicKeyLine: string): string | null {
    const parts = publicKeyLine.trim().split(/\s+/);
    const type = parts[0];
    if (!type || !this.SUPPORTED.has(type)) return null;
    try {
      const blob = Buffer.from(parts[1] ?? '', 'base64');
      if (blob.length < 32) return null;
      // Round-trip check: type inside the blob must match the declared type.
      const typeLen = blob.readUInt32BE(0);
      const blobType = blob.subarray(4, 4 + typeLen).toString('utf8');
      if (blobType !== type) return null;
      const hash = createHash('sha256').update(blob).digest('base64');
      return `SHA256:${hash.replace(/=+$/, '')}`;
    } catch {
      return null;
    }
  }
}

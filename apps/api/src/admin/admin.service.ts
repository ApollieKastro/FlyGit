import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuditLogEntry } from '@flygit/shared';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';

/** Platform administration: users, stats, global audit trail. */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async stats() {
    const [users, organizations, repositories, issues, mergeRequests, activeSessions] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.organization.count(),
      this.prisma.repository.count({ where: { deletedAt: null } }),
      this.prisma.issue.count(),
      this.prisma.mergeRequest.count(),
      this.prisma.session.count({ where: { expiresAt: { gt: new Date() }, revokedAt: null } }),
    ]);
    return { users, organizations, repositories, issues, mergeRequests, activeSessions };
  }

  async listUsers(query: {
    q?: string;
    role?: 'admin' | 'user';
    active?: boolean;
    page: number;
    pageSize: number;
  }) {
    const where = {
      ...(query.q
        ? {
            OR: [
              { username: { contains: query.q, mode: 'insensitive' as const } },
              { email: { contains: query.q, mode: 'insensitive' as const } },
              { displayName: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.active !== undefined ? { isActive: query.active } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          email: true,
          displayName: true,
          avatarUrl: true,
          role: true,
          isActive: true,
          emailConfirmedAt: true,
          totpEnabled: true,
          createdAt: true,
          lastLoginAt: true,
          _count: { select: { sessions: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: rows.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        role: u.role,
        isActive: u.isActive,
        emailConfirmed: Boolean(u.emailConfirmedAt),
        totpEnabled: u.totpEnabled,
        sessionsCount: u._count.sessions,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        website: true,
        role: true,
        isActive: true,
        locale: true,
        theme: true,
        emailConfirmedAt: true,
        totpEnabled: true,
        createdAt: true,
        lastLoginAt: true,
        _count: { select: { sessions: true } },
      },
    });
    if (!user) throw this.userNotFound();
    return {
      ...user,
      emailConfirmed: Boolean(user.emailConfirmedAt),
      emailConfirmedAt: user.emailConfirmedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
  }

  async setUserActive(actor: AuthUser, id: string, isActive: boolean): Promise<void> {
    if (id === actor.id) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Cannot deactivate yourself',
        code: 'SELF_DEACTIVATE',
      });
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw this.userNotFound();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { isActive } }),
      // Deactivating revokes all sessions immediately.
      ...(isActive ? [] : [this.prisma.session.deleteMany({ where: { userId: id } })]),
    ]);
    await this.audit.record({
      actorId: actor.id,
      action: isActive ? 'admin.user_activated' : 'admin.user_deactivated',
      entityType: 'user',
      entityId: id,
      metadata: { username: user.username },
    });
  }

  async setUserRole(actor: AuthUser, id: string, role: 'admin' | 'user'): Promise<void> {
    if (id === actor.id && role === 'user') {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Cannot demote yourself',
        code: 'SELF_DEMOTE',
      });
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw this.userNotFound();
    await this.prisma.user.update({ where: { id }, data: { role } });
    await this.audit.record({
      actorId: actor.id,
      action: 'admin.user_role_changed',
      entityType: 'user',
      entityId: id,
      metadata: { username: user.username, role },
    });
  }

  async deleteUser(actor: AuthUser, id: string): Promise<void> {
    if (id === actor.id) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Cannot delete yourself',
        code: 'SELF_DELETE',
      });
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw this.userNotFound();
    // Refuse to delete users who still own repositories.
    const repos = await this.prisma.repository.count({
      where: { ownerType: 'user', ownerId: id, deletedAt: null },
    });
    if (repos > 0) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request',
        message: `User still owns ${repos} repositories`,
        code: 'USER_HAS_REPOSITORIES',
      });
    }
    await this.prisma.user.delete({ where: { id } });
    await this.audit.record({
      actorId: actor.id,
      action: 'admin.user_deleted',
      entityType: 'user',
      entityId: id,
      metadata: { username: user.username },
    });
  }

  async listSessions(actor: AuthUser, userId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    }));
  }

  async revokeSession(actor: AuthUser, userId: string, sessionId: string): Promise<void> {
    const { count } = await this.prisma.session.deleteMany({
      where: { id: sessionId, userId },
    });
    if (!count) {
      throw new NotFoundException({
        statusCode: 404, error: 'Not Found', message: 'Session not found', code: 'SESSION_NOT_FOUND',
      });
    }
    await this.audit.record({
      actorId: actor.id,
      action: 'admin.session_revoked',
      entityType: 'session',
      entityId: sessionId,
      metadata: { userId },
    });
  }

  async auditLog(query: {
    actor?: string;
    action?: string;
    entityType?: string;
    entityId?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: AuditLogEntry[]; total: number; page: number; pageSize: number }> {
    const actorUser = query.actor
      ? await this.prisma.user.findUnique({ where: { username: query.actor.toLowerCase() }, select: { id: true } })
      : null;
    const where = {
      ...(actorUser ? { actorId: actorUser.id } : query.actor ? { actorId: 'nonexistent' } : {}),
      ...(query.action ? { action: { contains: query.action } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          actor: { select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true, website: true, createdAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        actor: r.actor
          ? {
              id: r.actor.id,
              username: r.actor.username,
              displayName: r.actor.displayName,
              avatarUrl: r.actor.avatarUrl,
              bio: r.actor.bio,
              website: r.actor.website,
              createdAt: r.actor.createdAt.toISOString(),
            }
          : null,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        metadata: (r.metadata as Record<string, unknown> | null) ?? null,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private userNotFound(): NotFoundException {
    return new NotFoundException({
      statusCode: 404, error: 'Not Found', message: 'User not found', code: 'USER_NOT_FOUND',
    });
  }
}

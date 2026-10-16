import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Append-only audit trail. Writes are fire-and-forget: an audit failure must
 * never break the business operation that triggered it.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          metadata: entry.metadata ? (entry.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
          ip: entry.ip ?? null,
        },
      });
    } catch {
      // intentionally ignored — see class doc
    }
  }

  /** Convenience for express request context. */
  fromRequest(req: Request, entry: Omit<AuditEntry, 'ip'>): Promise<void> {
    const user = (req as Request & { user?: { id: string } }).user;
    return this.record({ ...entry, actorId: entry.actorId ?? user?.id ?? null, ip: req.ip ?? null });
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}

import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { NotificationType } from '@flygit/shared';
import { NOTIFICATION_TYPES } from '@flygit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MailService, type MailLocale } from '../mail/mail.service';
import { NotificationsController } from './notifications.controller';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  url: string;
  actorId?: string | null;
}

/**
 * In-app notifications with optional email delivery.
 * Delivery honours per-user preferences (notification_preferences).
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async notify(input: CreateNotificationInput): Promise<void> {
    if (input.userId === input.actorId) return; // never notify yourself
    try {
      const pref = await this.prisma.notificationPreference.findUnique({
        where: { userId_type: { userId: input.userId, type: input.type } },
      });
      const inAppEnabled = pref ? pref.inApp : true;
      const emailEnabled = pref ? pref.email : false;

      if (inAppEnabled) {
        await this.prisma.notification.create({
          data: {
            userId: input.userId,
            type: input.type,
            title: input.title.slice(0, 200),
            body: input.body ?? null,
            url: input.url.slice(0, 1024),
            actorId: input.actorId ?? null,
          },
        });
      }

      if (emailEnabled) {
        await this.sendEmail(input);
      }
    } catch (error) {
      this.logger.warn(`notification failed for user ${input.userId}: ${(error as Error).message}`);
    }
  }

  /** Fan-out helper. */
  async notifyMany(userIds: string[], input: Omit<CreateNotificationInput, 'userId'>): Promise<void> {
    await Promise.all(userIds.map((userId) => this.notify({ ...input, userId })));
  }

  async list(userId: string, opts: { unreadOnly?: boolean; page: number; pageSize: number }) {
    const where = opts.unreadOnly ? { userId, isRead: false } : { userId };
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: { actor: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);
    return {
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        url: n.url,
        isRead: n.isRead,
        actor: n.actor
          ? { id: n.actor.id, username: n.actor.username, displayName: n.actor.displayName, avatarUrl: n.actor.avatarUrl }
          : null,
        createdAt: n.createdAt.toISOString(),
      })),
      total,
      unread,
      page: opts.page,
      pageSize: opts.pageSize,
    };
  }

  async markRead(userId: string, ids: string[] | 'all'): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, ...(ids === 'all' ? {} : { id: { in: ids } }) },
      data: { isRead: true },
    });
    return { updated: result.count };
  }

  async markUnread(userId: string, ids: string[]): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, id: { in: ids } },
      data: { isRead: false },
    });
    return { updated: result.count };
  }

  async remove(userId: string, ids: string[]): Promise<{ deleted: number }> {
    const result = await this.prisma.notification.deleteMany({ where: { userId, id: { in: ids } } });
    return { deleted: result.count };
  }

  private async sendEmail(input: CreateNotificationInput): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!user?.emailConfirmedAt) return;
    const locale = (user.locale as MailLocale) ?? 'en';
    const url = `${process.env.APP_URL}${input.url}`;
    const html = `<!doctype html><body style="margin:0;background:#0B0D12;font-family:Inter,Arial,sans-serif;padding:32px 16px;">
      <div style="max-width:520px;margin:0 auto;background:#11141B;border:1px solid #232833;border-radius:16px;padding:32px;">
        <div style="font-size:14px;font-weight:700;color:#5B7CFA;letter-spacing:.08em;text-transform:uppercase;">FlyGit</div>
        <h1 style="color:#F5F7FA;font-size:18px;margin:16px 0 8px;">${escapeHtml(input.title)}</h1>
        ${input.body ? `<div style="color:#9AA4B2;font-size:14px;line-height:1.6;">${escapeHtml(input.body).slice(0, 500)}</div>` : ''}
        <a href="${url}" style="display:inline-block;margin-top:20px;background:#5B7CFA;color:#fff;text-decoration:none;padding:10px 20px;border-radius:12px;font-size:14px;font-weight:600;">${locale === 'ru' ? 'Открыть' : locale === 'zh-CN' ? '打开' : 'View'}</a>
      </div></body>`;
    await this.mail.send(user.email, {
      subject: `[FlyGit] ${input.title}`.slice(0, 200),
      text: `${input.title}\n\n${input.body ?? ''}\n\n${url}`,
      html,
    });
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Extracts @usernames mentioned in text. */
export function extractMentions(text: string): string[] {
  const matches = text.match(/@([a-zA-Z0-9](?:[a-zA-Z0-9-]{1,30}[a-zA-Z0-9])?)/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
}

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}

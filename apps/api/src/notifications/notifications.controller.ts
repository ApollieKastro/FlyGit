import { Body, Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import type { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('unread') unread?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.notifications.list(user.id, {
      unreadOnly: unread === 'true' || unread === '1',
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Math.min(Number(pageSize) || 20, 100) : 20,
    });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthUser) {
    const result = await this.notifications.list(user.id, { unreadOnly: true, page: 1, pageSize: 1 });
    return { count: result.total };
  }

  @Post('read')
  @HttpCode(200)
  markRead(@CurrentUser() user: AuthUser, @Body() body: { ids: string[] | 'all' }) {
    return this.notifications.markRead(user.id, body?.ids ?? 'all');
  }

  @Post('unread')
  @HttpCode(200)
  markUnread(@CurrentUser() user: AuthUser, @Body() body: { ids: string[] }) {
    return this.notifications.markUnread(user.id, body?.ids ?? []);
  }

  @Delete()
  @HttpCode(200)
  remove(@CurrentUser() user: AuthUser, @Query('ids') idsQuery?: string) {
    const ids = idsQuery ? idsQuery.split(',').filter(Boolean) : [];
    return this.notifications.remove(user.id, ids);
  }
}

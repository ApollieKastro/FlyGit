import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { auditQuerySchema } from '@flygit/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { PlatformAdmin } from '../common/decorators/roles.decorator';
import { AdminService } from './admin.service';

@PlatformAdmin()
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  // ───────────────────────── Users ─────────────────────────

  @Get('users')
  listUsers(
    @Query('q') q?: string,
    @Query('role') role?: string,
    @Query('active') active?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.admin.listUsers({
      q: q || undefined,
      role: role === 'admin' || role === 'user' ? role : undefined,
      active: active === undefined ? undefined : active === 'true',
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Math.min(Number(pageSize) || 20, 100) : 20,
    });
  }

  @Get('users/:id')
  getUser(@Param('id') id: string) {
    return this.admin.getUser(id);
  }

  @Patch('users/:id/active')
  setUserActive(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
  ) {
    return this.admin.setUserActive(actor, id, Boolean(body?.isActive));
  }

  @Patch('users/:id/role')
  setUserRole(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: { role: 'admin' | 'user' },
  ) {
    return this.admin.setUserRole(actor, id, body?.role === 'admin' ? 'admin' : 'user');
  }

  @Delete('users/:id')
  @HttpCode(204)
  deleteUser(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.admin.deleteUser(actor, id);
  }

  // ───────────────────────── Sessions ─────────────────────────

  @Get('users/:id/sessions')
  listSessions(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.admin.listSessions(actor, id);
  }

  @Delete('users/:id/sessions/:sessionId')
  @HttpCode(204)
  revokeSession(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.admin.revokeSession(actor, id, sessionId);
  }

  // ───────────────────────── Audit ─────────────────────────

  @Get('audit')
  auditLog(
    @Query(new ZodValidationPipe(auditQuerySchema))
    query: { actor?: string; action?: string; entityType?: string; page: number; pageSize: number },
    @Query('entityId') entityId?: string,
  ) {
    return this.admin.auditLog({ ...query, entityId: entityId || undefined });
  }
}

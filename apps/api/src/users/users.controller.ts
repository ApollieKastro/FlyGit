import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { createTokenSchema, sshKeySchema, updateProfileSchema, userSearchSchema } from '@flygit/shared';
import type { CreateTokenInput, SshKeyInput, UpdateProfileInput } from '@flygit/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthUser) {
    return this.users.getMe(user.id);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) input: UpdateProfileInput,
  ) {
    return this.users.updateMe(user.id, input);
  }

  @Get('me/notifications/preferences')
  getPreferences(@CurrentUser() user: AuthUser) {
    return this.users.getNotificationPreferences(user.id);
  }

  @Put('me/notifications/preferences')
  async setPreferences(@CurrentUser() user: AuthUser, @Body() body: Record<string, { inApp?: boolean; email?: boolean }>) {
    const normalized: Record<string, { inApp: boolean; email: boolean }> = {};
    for (const [type, value] of Object.entries(body ?? {})) {
      normalized[type] = { inApp: Boolean(value?.inApp), email: Boolean(value?.email) };
    }
    return this.users.updateNotificationPreferences(user.id, normalized);
  }

  // ───────────────────────── SSH keys ─────────────────────────

  @Get('me/ssh-keys')
  listSshKeys(@CurrentUser() user: AuthUser) {
    return this.users.listSshKeys(user.id);
  }

  @Post('me/ssh-keys')
  @HttpCode(201)
  addSshKey(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(sshKeySchema)) input: SshKeyInput) {
    return this.users.addSshKey(user.id, input);
  }

  @Delete('me/ssh-keys/:id')
  @HttpCode(204)
  removeSshKey(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.removeSshKey(user.id, id);
  }

  // ───────────────────────── API tokens ─────────────────────────

  @Get('me/tokens')
  listTokens(@CurrentUser() user: AuthUser) {
    return this.users.listTokens(user.id);
  }

  @Post('me/tokens')
  @HttpCode(201)
  createToken(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createTokenSchema)) input: CreateTokenInput) {
    return this.users.createToken(user.id, input);
  }

  @Delete('me/tokens/:id')
  @HttpCode(204)
  revokeToken(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.revokeToken(user.id, id);
  }

  // ───────────────────────── Profiles & search ─────────────────────────

  @Public()
  @Get('search')
  search(@Query(new ZodValidationPipe(userSearchSchema)) query: { q?: string; page: number; pageSize: number }) {
    return this.users.search(query.q ?? '', query.page, query.pageSize);
  }

  @Public()
  @Get(':username')
  getProfile(@Param('username') username: string, @CurrentUser() user: AuthUser | undefined) {
    return this.users.getProfile(username, user);
  }
}

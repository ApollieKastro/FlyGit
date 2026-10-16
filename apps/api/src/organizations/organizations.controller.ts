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
import {
  addTeamMemberSchema,
  auditQuerySchema,
  createOrganizationSchema,
  createTeamSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
  updateOrganizationSchema,
} from '@flygit/shared';
import type {
  CreateOrganizationInput,
  CreateTeamInput,
  InviteMemberInput,
  UpdateOrganizationInput,
} from '@flygit/shared';
import type { OrgRole } from '@flygit/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import type { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get('mine')
  listMine(@CurrentUser() user: AuthUser) {
    return this.orgs.listForUser(user);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createOrganizationSchema)) input: CreateOrganizationInput) {
    return this.orgs.create(user, input);
  }

  @Get('invitations/:token/preview')
  previewInvite(@Param('token') token: string) {
    // Public preview so the invite landing page can show the org name
    // before the invitee logs in. Actual acceptance requires auth.
    return this.orgs.previewInvite(token);
  }

  @Get(':slug')
  get(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.orgs.getDetail(user, slug);
  }

  @Patch(':slug')
  update(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(updateOrganizationSchema)) input: UpdateOrganizationInput,
  ) {
    return this.orgs.update(user, slug, input);
  }

  @Delete(':slug')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.orgs.remove(user, slug);
  }

  // ───────────────────────── Members ─────────────────────────

  @Get(':slug/members')
  listMembers(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.orgs.listMembers(user, slug);
  }

  @Patch(':slug/members/:username')
  updateMemberRole(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('username') username: string,
    @Body(new ZodValidationPipe(updateMemberRoleSchema)) body: { role: OrgRole },
  ) {
    return this.orgs.updateMemberRole(user, slug, username, body.role);
  }

  @Delete(':slug/members/:username')
  @HttpCode(204)
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('username') username: string,
  ) {
    return this.orgs.removeMember(user, slug, username);
  }

  // ───────────────────────── Invitations ─────────────────────────

  @Get(':slug/invitations')
  listInvitations(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.orgs.listInvitations(user, slug);
  }

  @Post(':slug/invitations')
  @HttpCode(201)
  invite(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(inviteMemberSchema)) input: InviteMemberInput,
  ) {
    return this.orgs.invite(user, slug, input);
  }

  @Delete(':slug/invitations/:id')
  @HttpCode(204)
  revokeInvitation(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('id') id: string,
  ) {
    return this.orgs.revokeInvitation(user, slug, id);
  }

  @Post('invitations/:token/accept')
  acceptInvite(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.orgs.acceptInvite(user, token);
  }

  @Post('invitations/:token/decline')
  @HttpCode(204)
  declineInvite(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.orgs.declineInvite(user, token);
  }

  // ───────────────────────── Teams ─────────────────────────

  @Get(':slug/teams')
  listTeams(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.orgs.listTeams(user, slug);
  }

  @Post(':slug/teams')
  @HttpCode(201)
  createTeam(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(createTeamSchema)) input: CreateTeamInput,
  ) {
    return this.orgs.createTeam(user, slug, input);
  }

  @Delete(':slug/teams/:teamId')
  @HttpCode(204)
  removeTeam(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('teamId') teamId: string) {
    return this.orgs.removeTeam(user, slug, teamId);
  }

  @Get(':slug/teams/:teamId/members')
  listTeamMembers(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('teamId') teamId: string,
  ) {
    return this.orgs.listTeamMembers(user, slug, teamId);
  }

  @Post(':slug/teams/:teamId/members')
  @HttpCode(201)
  addTeamMember(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('teamId') teamId: string,
    @Body(new ZodValidationPipe(addTeamMemberSchema)) body: { userId: string; role: OrgRole },
  ) {
    return this.orgs.addTeamMember(user, slug, teamId, body.userId, body.role);
  }

  @Delete(':slug/teams/:teamId/members/:userId')
  @HttpCode(204)
  removeTeamMember(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
  ) {
    return this.orgs.removeTeamMember(user, slug, teamId, userId);
  }

  // ───────────────────────── Audit ─────────────────────────

  @Get(':slug/audit')
  auditLog(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: { actor?: string; action?: string; entityType?: string; page: number; pageSize: number },
  ) {
    return this.orgs.auditLog(user, slug, query);
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateOrganizationInput, UpdateOrganizationInput } from '@flygit/shared';
import type { OrgRole, OrganizationDetail } from '@flygit/shared';
import type { Organization } from '@prisma/client';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { MailService, MailTemplates, type MailLocale } from '../mail/mail.service';
import { randomToken, sha256, toSlug } from '../common/utils/crypto.util';

const INVITE_TTL_DAYS = 14;

/** Organization management: CRUD, members, invitations, teams, audit log. */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  // ───────────────────────── Organization CRUD ─────────────────────────

  async create(user: AuthUser, input: CreateOrganizationInput): Promise<OrganizationDetail> {
    const slug = toSlug(input.slug);
    const [slugTaken, nameTaken] = await Promise.all([
      this.prisma.organization.findUnique({ where: { slug } }),
      this.prisma.organization.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' } } }),
    ]);
    if (slugTaken || nameTaken) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: slugTaken ? `Slug "${slug}" is already taken` : `Name "${input.name}" is already taken`,
        code: 'ORG_TAKEN',
      });
    }

    const org = await this.prisma.organization.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? null,
        website: input.website ?? null,
        ownerId: user.id,
        members: { create: { userId: user.id, role: 'owner' } },
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'organization.created',
      entityType: 'organization',
      entityId: org.id,
      metadata: { slug },
    });
    return this.toDetail(org, 'owner', 1);
  }

  async update(user: AuthUser, slug: string, input: UpdateOrganizationInput): Promise<OrganizationDetail> {
    const { org } = await this.requireRole(user, slug, 'owner');
    const updated = await this.prisma.organization.update({
      where: { id: org.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.website !== undefined ? { website: input.website } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'organization.updated',
      entityType: 'organization',
      entityId: org.id,
      metadata: { fields: Object.keys(input) },
    });
    const count = await this.prisma.orgMember.count({ where: { orgId: org.id } });
    return this.toDetail(updated, 'owner', count);
  }

  async remove(user: AuthUser, slug: string): Promise<void> {
    const { org } = await this.requireRole(user, slug, 'owner');
    // Guard: refuse to delete an org that still owns repositories.
    const repoCount = await this.prisma.repository.count({
      where: { ownerType: 'organization', ownerId: org.id, deletedAt: null },
    });
    if (repoCount > 0) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: `Organization still owns ${repoCount} repositories`,
        code: 'ORG_HAS_REPOSITORIES',
      });
    }
    await this.prisma.organization.delete({ where: { id: org.id } });
    await this.audit.record({
      actorId: user.id,
      action: 'organization.deleted',
      entityType: 'organization',
      entityId: org.id,
      metadata: { slug },
    });
  }

  async listForUser(user: AuthUser) {
    const memberships = await this.prisma.orgMember.findMany({
      where: { userId: user.id },
      include: { organization: true },
      orderBy: { organization: { name: 'asc' } },
    });
    return memberships.map((m) => ({
      id: m.organization.id,
      slug: m.organization.slug,
      name: m.organization.name,
      avatarUrl: m.organization.avatarUrl,
      role: m.role,
    }));
  }

  async getDetail(user: AuthUser, slug: string): Promise<OrganizationDetail> {
    const org = await this.prisma.organization.findUnique({ where: { slug: slug.toLowerCase() } });
    if (!org) throw this.notFound();
    const membership = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: org.id, userId: user.id } },
    });
    const repoCount = await this.prisma.repository.count({
      where: { ownerType: 'organization', ownerId: org.id, deletedAt: null },
    });
    const memberCount = await this.prisma.orgMember.count({ where: { orgId: org.id } });
    const role: OrgRole | null = user.isAdmin ? 'owner' : membership?.role ?? null;
    return this.toDetail(org, role ?? 'member', memberCount, repoCount);
  }

  // ───────────────────────── Members ─────────────────────────

  async listMembers(user: AuthUser, slug: string) {
    const { org } = await this.requireRole(user, slug, 'member');
    const members = await this.prisma.orgMember.findMany({
      where: { orgId: org.id },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true, website: true, createdAt: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });
    return members.map((m) => ({
      ...m.user,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    }));
  }

  async updateMemberRole(user: AuthUser, slug: string, username: string, role: OrgRole): Promise<void> {
    const { org } = await this.requireRole(user, slug, 'owner');
    const target = await this.prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (!target) throw this.memberNotFound();
    const member = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: org.id, userId: target.id } },
    });
    if (!member) throw this.memberNotFound();

    // Never demote the last owner.
    if (member.role === 'owner' && role !== 'owner') {
      const owners = await this.prisma.orgMember.count({ where: { orgId: org.id, role: 'owner' } });
      if (owners <= 1) {
        throw new ConflictException({
          statusCode: 409, error: 'Conflict', message: 'Cannot demote the last owner',
          code: 'LAST_OWNER',
        });
      }
    }
    await this.prisma.orgMember.update({
      where: { id: member.id },
      data: { role },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'organization.member_role_changed',
      entityType: 'organization',
      entityId: org.id,
      metadata: { username, role },
    });
  }

  async removeMember(user: AuthUser, slug: string, username: string): Promise<void> {
    const { org } = await this.requireRole(user, slug, 'owner');
    const target = await this.prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (!target) throw this.memberNotFound();
    const member = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: org.id, userId: target.id } },
    });
    if (!member) throw this.memberNotFound();
    if (member.role === 'owner') {
      const owners = await this.prisma.orgMember.count({ where: { orgId: org.id, role: 'owner' } });
      if (owners <= 1) {
        throw new ConflictException({
          statusCode: 409, error: 'Conflict', message: 'Cannot remove the last owner',
          code: 'LAST_OWNER',
        });
      }
    }
    await this.prisma.orgMember.delete({ where: { id: member.id } });
    await this.audit.record({
      actorId: user.id,
      action: 'organization.member_removed',
      entityType: 'organization',
      entityId: org.id,
      metadata: { username },
    });
  }

  // ───────────────────────── Invitations ─────────────────────────

  async invite(user: AuthUser, slug: string, input: { identifier: string; role: OrgRole }) {
    const { org } = await this.requireRole(user, slug, 'maintainer');
    const identifier = input.identifier.trim().toLowerCase();

    // Already a member?
    const existingUser = await this.prisma.user.findFirst({
      where: { OR: [{ username: identifier }, { email: identifier }] },
    });
    if (existingUser) {
      const existingMember = await this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId: org.id, userId: existingUser.id } },
      });
      if (existingMember) {
        throw new ConflictException({
          statusCode: 409, error: 'Conflict', message: 'User is already a member',
          code: 'ALREADY_MEMBER',
        });
      }
    }

    // Pending invite for the same email/user?
    const pending = await this.prisma.orgInvitation.findFirst({
      where: {
        orgId: org.id,
        acceptedAt: null,
        declinedAt: null,
        expiresAt: { gt: new Date() },
        OR: [{ email: identifier }, ...(existingUser ? [{ userId: existingUser.id }] : [])],
      },
    });
    if (pending) {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', message: 'Invitation already pending',
        code: 'INVITE_PENDING',
      });
    }

    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000);
    const invitation = await this.prisma.orgInvitation.create({
      data: {
        orgId: org.id,
        email: existingUser ? existingUser.email : identifier,
        userId: existingUser?.id ?? null,
        role: input.role,
        tokenHash: sha256(token),
        invitedById: user.id,
        expiresAt,
      },
    });

    const inviteUrl = `${process.env.APP_URL ?? 'http://localhost:3000'}/invite/${token}`;
    const locale = (existingUser?.locale as MailLocale) ?? 'en';
    await this.mail.send(invitation.email!, MailTemplates.invitation(locale, org.name, inviteUrl));
    await this.audit.record({
      actorId: user.id,
      action: 'organization.invited',
      entityType: 'organization',
      entityId: org.id,
      metadata: { email: invitation.email, role: input.role },
    });
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async listInvitations(user: AuthUser, slug: string) {
    const { org } = await this.requireRole(user, slug, 'maintainer');
    const invitations = await this.prisma.orgInvitation.findMany({
      where: { orgId: org.id, acceptedAt: null, declinedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return invitations.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    }));
  }

  async revokeInvitation(user: AuthUser, slug: string, id: string): Promise<void> {
    const { org } = await this.requireRole(user, slug, 'maintainer');
    const { count } = await this.prisma.orgInvitation.deleteMany({
      where: { id, orgId: org.id, acceptedAt: null, declinedAt: null },
    });
    if (!count) throw this.inviteNotFound();
  }

  /** Public preview of an invitation (org name + role, no sensitive data). */
  async previewInvite(token: string): Promise<{ slug: string; name: string; role: OrgRole; expiresAt: string }> {
    const invitation = await this.prisma.orgInvitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { organization: { select: { slug: true, name: true } } },
    });
    if (!invitation || invitation.acceptedAt || invitation.declinedAt || invitation.expiresAt < new Date()) {
      throw this.inviteNotFound();
    }
    return {
      slug: invitation.organization.slug,
      name: invitation.organization.name,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /** Accepts an invitation by raw token (called from the invite landing page). */
  async acceptInvite(user: AuthUser, token: string): Promise<{ slug: string; role: OrgRole }> {
    const invitation = await this.prisma.orgInvitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { organization: true },
    });
    if (!invitation || invitation.acceptedAt || invitation.declinedAt) throw this.inviteNotFound();
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'Invitation expired', code: 'INVITE_EXPIRED',
      });
    }
    if (invitation.email && invitation.email !== user.email.toLowerCase()) {
      throw new ForbiddenException({
        statusCode: 403, error: 'Forbidden', message: 'Invitation was sent to a different email',
        code: 'INVITE_EMAIL_MISMATCH',
      });
    }
    await this.prisma.$transaction([
      this.prisma.orgInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date(), userId: user.id },
      }),
      this.prisma.orgMember.upsert({
        where: { orgId_userId: { orgId: invitation.orgId, userId: user.id } },
        create: { orgId: invitation.orgId, userId: user.id, role: invitation.role },
        update: { role: invitation.role },
      }),
    ]);
    await this.audit.record({
      actorId: user.id,
      action: 'organization.invite_accepted',
      entityType: 'organization',
      entityId: invitation.orgId,
      metadata: { role: invitation.role },
    });
    return { slug: invitation.organization.slug, role: invitation.role };
  }

  async declineInvite(user: AuthUser, token: string): Promise<void> {
    const invitation = await this.prisma.orgInvitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!invitation || invitation.acceptedAt || invitation.declinedAt) throw this.inviteNotFound();
    await this.prisma.orgInvitation.update({
      where: { id: invitation.id },
      data: { declinedAt: new Date(), userId: user.id },
    });
  }

  // ───────────────────────── Teams ─────────────────────────

  async listTeams(user: AuthUser, slug: string) {
    const { org } = await this.requireRole(user, slug, 'member');
    const teams = await this.prisma.team.findMany({
      where: { organizationId: org.id },
      include: { _count: { select: { members: true, repositories: true } } },
      orderBy: { name: 'asc' },
    });
    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      description: t.description,
      membersCount: t._count.members,
      repositoriesCount: t._count.repositories,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async createTeam(user: AuthUser, slug: string, input: { name: string; slug: string; description?: string | null }) {
    const { org } = await this.requireRole(user, slug, 'maintainer');
    const teamSlug = toSlug(input.slug);
    const existing = await this.prisma.team.findUnique({
      where: { organizationId_slug: { organizationId: org.id, slug: teamSlug } },
    });
    if (existing) {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', message: 'Team slug already exists', code: 'TEAM_EXISTS',
      });
    }
    const team = await this.prisma.team.create({
      data: {
        organizationId: org.id,
        name: input.name,
        slug: teamSlug,
        description: input.description ?? null,
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'organization.team_created',
      entityType: 'organization',
      entityId: org.id,
      metadata: { team: team.slug },
    });
    return { id: team.id, name: team.name, slug: team.slug, description: team.description };
  }

  async removeTeam(user: AuthUser, slug: string, teamId: string): Promise<void> {
    const { org } = await this.requireRole(user, slug, 'maintainer');
    const team = await this.prisma.team.findFirst({ where: { id: teamId, organizationId: org.id } });
    if (!team) throw this.teamNotFound();
    await this.prisma.team.delete({ where: { id: team.id } });
    await this.audit.record({
      actorId: user.id,
      action: 'organization.team_deleted',
      entityType: 'organization',
      entityId: org.id,
      metadata: { team: team.slug },
    });
  }

  async addTeamMember(user: AuthUser, slug: string, teamId: string, userId: string, role: OrgRole) {
    const { org } = await this.requireRole(user, slug, 'maintainer');
    const team = await this.prisma.team.findFirst({ where: { id: teamId, organizationId: org.id } });
    if (!team) throw this.teamNotFound();
    const membership = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: org.id, userId } },
    });
    if (!membership) {
      throw new BadRequestException({
        statusCode: 400, error: 'Bad Request', message: 'User is not an organization member',
        code: 'NOT_ORG_MEMBER',
      });
    }
    await this.prisma.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } },
      create: { teamId, userId, role },
      update: { role },
    });
    return { teamId, userId, role };
  }

  async removeTeamMember(user: AuthUser, slug: string, teamId: string, userId: string): Promise<void> {
    const { org } = await this.requireRole(user, slug, 'maintainer');
    const team = await this.prisma.team.findFirst({ where: { id: teamId, organizationId: org.id } });
    if (!team) throw this.teamNotFound();
    await this.prisma.teamMember.deleteMany({ where: { teamId, userId } });
  }

  async listTeamMembers(user: AuthUser, slug: string, teamId: string) {
    const { org } = await this.requireRole(user, slug, 'member');
    const team = await this.prisma.team.findFirst({ where: { id: teamId, organizationId: org.id } });
    if (!team) throw this.teamNotFound();
    const members = await this.prisma.teamMember.findMany({
      where: { teamId },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true, website: true, createdAt: true } },
      },
    });
    return members.map((m) => ({ ...m.user, role: m.role, joinedAt: m.joinedAt.toISOString() }));
  }

  // ───────────────────────── Audit log ─────────────────────────

  async auditLog(
    user: AuthUser,
    slug: string,
    query: { actor?: string; action?: string; entityType?: string; page: number; pageSize: number },
  ) {
    const { org } = await this.requireRole(user, slug, 'owner');
    const where = {
      entityType: 'organization' as const,
      entityId: org.id,
      ...(query.action ? { action: { contains: query.action } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          actor: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        actor: r.actor ? { username: r.actor.username, displayName: r.actor.displayName, avatarUrl: r.actor.avatarUrl } : null,
        entityType: r.entityType,
        entityId: r.entityId,
        ip: r.ip,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // ───────────────────────── Helpers ─────────────────────────

  /** Resolves the org and checks the caller holds at least `minRole`. */
  private async requireRole(
    user: AuthUser,
    slug: string,
    minRole: OrgRole,
  ): Promise<{ org: { id: string; slug: string; name: string } }> {
    const org = await this.prisma.organization.findUnique({ where: { slug: slug.toLowerCase() } });
    if (!org) throw this.notFound();
    if (user.isAdmin) return { org };

    const member = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: org.id, userId: user.id } },
    });
    if (!member) {
      throw new ForbiddenException({
        statusCode: 403, error: 'Forbidden', message: 'Organization membership required',
        code: 'NOT_ORG_MEMBER',
      });
    }
    const weight: Record<OrgRole, number> = { member: 10, maintainer: 20, owner: 30 };
    if (weight[member.role] < weight[minRole]) {
      throw new ForbiddenException({
        statusCode: 403, error: 'Forbidden', message: `Requires ${minRole} access`,
        code: 'INSUFFICIENT_ORG_ACCESS',
        details: { required: [minRole], actual: [member.role] },
      });
    }
    return { org };
  }

  private toDetail(org: Organization, role: OrgRole, memberCount: number, repoCount?: number): OrganizationDetail {
    return {
      id: org.id,
      slug: org.slug,
      name: org.name,
      description: org.description,
      avatarUrl: org.avatarUrl,
      website: org.website,
      membersCount: memberCount,
      repositoriesCount: repoCount ?? 0,
      yourRole: role,
      ownerId: org.ownerId,
      createdAt: org.createdAt.toISOString(),
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      statusCode: 404, error: 'Not Found', message: 'Organization not found', code: 'ORG_NOT_FOUND',
    });
  }

  private memberNotFound(): NotFoundException {
    return new NotFoundException({
      statusCode: 404, error: 'Not Found', message: 'Member not found', code: 'MEMBER_NOT_FOUND',
    });
  }

  private inviteNotFound(): NotFoundException {
    return new NotFoundException({
      statusCode: 404, error: 'Not Found', message: 'Invitation not found', code: 'INVITE_NOT_FOUND',
    });
  }

  private teamNotFound(): NotFoundException {
    return new NotFoundException({
      statusCode: 404, error: 'Not Found', message: 'Team not found', code: 'TEAM_NOT_FOUND',
    });
  }
}

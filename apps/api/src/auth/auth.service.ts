import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type {
  ConfirmEmailInput,
  ForgotPasswordInput,
  LoginInputDto,
  RegisterInput,
  ResetPasswordInput,
  SessionInfo,
  UserPrivate,
} from '@flygit/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.module';
import type { MailService} from '../mail/mail.service';
import { MailTemplates, type MailLocale } from '../mail/mail.service';
import { randomToken, sha256 } from '../common/utils/crypto.util';
import type { TokenService } from './token.service';
import type { TotpService } from './totp.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

const CONFIRM_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface LoginResult {
  user: UserPrivate;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── Registration ─────────────────────────

  async register(input: RegisterInput, meta: { ip: string | null; userAgent: string | null }) {
    if (process.env.ALLOW_REGISTRATION === 'false') {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Registration is disabled on this instance',
        code: 'REGISTRATION_DISABLED',
      });
    }
    if (process.env.REGISTRATION_MODE === 'invite') {
      const invitation = await this.prisma.orgInvitation.findFirst({
        where: { email: input.email, acceptedAt: null, declinedAt: null, expiresAt: { gt: new Date() } },
      });
      if (!invitation) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          message: 'This instance is invite-only',
          code: 'INVITE_ONLY',
        });
      }
    }

    const [emailTaken, usernameTaken] = await Promise.all([
      this.prisma.user.findUnique({ where: { email: input.email } }),
      this.prisma.user.findUnique({ where: { username: input.username } }),
    ]);
    if (emailTaken || usernameTaken) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: emailTaken ? 'Email already registered' : 'Username already taken',
        code: emailTaken ? 'EMAIL_TAKEN' : 'USERNAME_TAKEN',
        details: {
          ...(emailTaken ? { email: ['validation:emailTaken'] } : {}),
          ...(usernameTaken ? { username: ['validation:usernameTaken'] } : {}),
        },
      });
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const confirmToken = process.env.CONFIRM_EMAIL_REQUIRED === 'true' ? randomToken(32) : null;
    const locale = input.locale ?? 'en';

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        username: input.username,
        displayName: input.displayName ?? input.username,
        passwordHash,
        locale,
        emailConfirmToken: confirmToken ? sha256(confirmToken) : null,
        emailConfirmedAt: confirmToken ? null : new Date(),
      },
    });

    if (confirmToken) {
      const url = `${process.env.APP_URL}/confirm-email?token=${confirmToken}`;
      await this.mail.send(user.email, MailTemplates.confirmEmail(locale as MailLocale, url));
    }

    await this.audit.record({
      actorId: user.id,
      action: 'auth.register',
      entityType: 'user',
      entityId: user.id,
      metadata: { username: user.username },
      ip: meta.ip,
    });

    return this.toPrivate(user);
  }

  async confirmEmail(input: ConfirmEmailInput): Promise<{ confirmed: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { emailConfirmToken: sha256(input.token) },
    });
    if (!user || user.emailConfirmedAt) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Confirmation link is invalid or already used',
        code: 'INVALID_CONFIRM_TOKEN',
      });
    }
    if (Date.now() - user.createdAt.getTime() > CONFIRM_TOKEN_TTL_MS) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Confirmation link has expired',
        code: 'CONFIRM_TOKEN_EXPIRED',
      });
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailConfirmedAt: new Date(), emailConfirmToken: null },
    });
    await this.audit.record({ actorId: user.id, action: 'auth.confirm_email', entityType: 'user', entityId: user.id });
    return { confirmed: true };
  }

  /** Re-sends the confirmation email (throttled by the rate limiter). */
  async resendConfirmation(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailConfirmedAt) return;
    const token = randomToken(32);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailConfirmToken: sha256(token) },
    });
    const url = `${process.env.APP_URL}/confirm-email?token=${token}`;
    await this.mail.send(user.email, MailTemplates.confirmEmail((user.locale as MailLocale) ?? 'en', url));
  }

  // ───────────────────────── Login ─────────────────────────

  async login(
    input: LoginInputDto,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<LoginResult | { requiresTwoFactor: true; challengeToken: string }> {
    const user = await this.findForLogin(input.identifier);
    if (!user) {
      await this.audit.record({
        action: 'auth.login_failed',
        entityType: 'user',
        metadata: { identifier: input.identifier },
        ip: meta.ip,
      });
      throw this.invalidCredentials();
    }

    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      await this.audit.record({
        actorId: user.id,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        ip: meta.ip,
      });
      throw this.invalidCredentials();
    }

    if (process.env.CONFIRM_EMAIL_REQUIRED === 'true' && !user.emailConfirmedAt) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Email address is not confirmed',
        code: 'EMAIL_NOT_CONFIRMED',
      });
    }

    if (user.totpEnabled) {
      if (!input.totpCode) {
        const challengeToken = await this.tokens.signTwoFactorChallenge(user.id);
        return { requiresTwoFactor: true, challengeToken };
      }
      if (!this.totp.verifyWithBackup(input.totpCode, user.totpSecret!, user.totpBackupCodes)) {
        throw this.invalidCredentials('Invalid two-factor code');
      }
      if (this.isBackupCode(input.totpCode, user.totpBackupCodes)) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { totpBackupCodes: this.totp.consumeBackupCode(input.totpCode, user.totpBackupCodes) },
        });
      }
    }

    return this.issueSession(user, meta);
  }

  async loginWithTwoFactor(
    challengeToken: string,
    code: string,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<LoginResult> {
    const userId = await this.tokens.verifyTwoFactorChallenge(challengeToken);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || !user.totpEnabled || !user.totpSecret) {
      throw this.invalidCredentials();
    }
    if (!this.totp.verifyWithBackup(code, user.totpSecret, user.totpBackupCodes)) {
      throw this.invalidCredentials('Invalid two-factor code');
    }
    if (this.isBackupCode(code, user.totpBackupCodes)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { totpBackupCodes: this.totp.consumeBackupCode(code, user.totpBackupCodes) },
      });
    }
    return this.issueSession(user, meta);
  }

  private async issueSession(
    user: {
      id: string;
      username: string;
      email: string;
      isAdmin: boolean;
      role: 'admin' | 'user';
      emailConfirmedAt: Date | null;
      locale: string;
      theme: string;
      displayName: string | null;
      avatarUrl: string | null;
      bio: string | null;
      website: string | null;
      isActive: boolean;
      totpEnabled: boolean;
      createdAt: Date;
      updatedAt: Date;
    },
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<LoginResult> {
    const { token: refreshToken, expiresAt } = await this.tokens.createSession(user.id, meta);
    const access = await this.tokens.signAccessToken(user);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      actorId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      ip: meta.ip,
    });
    return {
      user: this.toPrivate(user),
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken,
      refreshExpiresAt: expiresAt,
    };
  }

  // ───────────────────────── Session lifecycle ─────────────────────────

  async refresh(
    rawToken: string | undefined,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<{ accessToken: string; expiresIn: number; refreshToken: string; refreshExpiresAt: Date }> {
    if (!rawToken) throw this.invalidRefresh();
    const rotated = await this.tokens.rotateSession(rawToken, meta);
    const user = await this.prisma.user.findUnique({ where: { id: rotated.userId } });
    if (!user || !user.isActive) throw this.invalidRefresh();
    const access = await this.tokens.signAccessToken(user);
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: rotated.token,
      refreshExpiresAt: rotated.expiresAt,
    };
  }

  async logout(rawToken: string | undefined, userId?: string): Promise<void> {
    if (rawToken) await this.tokens.revokeSessionByToken(rawToken);
    if (userId) {
      await this.audit.record({ actorId: userId, action: 'auth.logout', entityType: 'user', entityId: userId });
    }
  }

  async logoutAll(userId: string): Promise<{ revoked: number }> {
    const revoked = await this.tokens.revokeAllSessions(userId);
    await this.audit.record({ actorId: userId, action: 'auth.logout_all', entityType: 'user', entityId: userId, metadata: { revoked } });
    return { revoked };
  }

  async listSessions(currentUserId: string, currentTokenHash: string | null): Promise<SessionInfo[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId: currentUserId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: currentTokenHash ? s.tokenHash === currentTokenHash : false,
    }));
  }

  async revokeSessionById(userId: string, sessionId: string): Promise<void> {
    await this.tokens.revokeSession(userId, sessionId);
  }

  // ───────────────────────── Password reset ─────────────────────────

  async requestPasswordReset(input: ForgotPasswordInput): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      // Do not reveal whether the address exists.
      this.logger.debug(`Password reset requested for unknown address ${input.email}`);
      return;
    }
    const token = randomToken(32);
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });
    const url = `${process.env.APP_URL}/reset-password?token=${token}`;
    await this.mail.send(user.email, MailTemplates.passwordReset((user.locale as MailLocale) ?? 'en', url));
    await this.audit.record({ actorId: user.id, action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id });
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(input.token) },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Reset link is invalid or has expired',
        code: 'INVALID_RESET_TOKEN',
      });
    }
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // A password change terminates every existing session.
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      actorId: record.userId,
      action: 'auth.password_reset_completed',
      entityType: 'user',
      entityId: record.userId,
    });
  }

  async changePassword(user: AuthUser, currentPassword: string, newPassword: string): Promise<void> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const valid = await argon2.verify(record.passwordHash, currentPassword);
    if (!valid) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Current password is incorrect',
        code: 'INVALID_PASSWORD',
      });
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.audit.record({ actorId: user.id, action: 'auth.password_changed', entityType: 'user', entityId: user.id });
  }

  // ───────────────────────── Two-factor ─────────────────────────

  async setupTwoFactor(user: AuthUser): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string; backupCodes: string[] }> {
    const setup = this.totp.setup({ username: user.username, issuer: 'FlyGit' });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: setup.secret, totpEnabled: false, totpBackupCodes: setup.backupCodes },
    });
    const qrDataUrl = await this.totp.toQrDataUrl(setup.otpauthUrl);
    return { secret: setup.secret, otpauthUrl: setup.otpauthUrl, qrDataUrl, backupCodes: setup.backupCodes };
  }

  async enableTwoFactor(user: AuthUser, code: string): Promise<{ enabled: true; backupCodes: string[] }> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!record.totpSecret) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Two-factor setup was not started',
        code: 'TWO_FACTOR_NOT_SETUP',
      });
    }
    if (!this.totp.verify(code, record.totpSecret)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid two-factor code',
        code: 'TWO_FACTOR_INVALID_CODE',
      });
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true, totpBackupCodes: record.totpBackupCodes },
    });
    await this.audit.record({ actorId: user.id, action: 'auth.2fa_enabled', entityType: 'user', entityId: user.id });
    return { enabled: true, backupCodes: record.totpBackupCodes };
  }

  async disableTwoFactor(user: AuthUser, code: string): Promise<void> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!record.totpEnabled || !record.totpSecret) return;
    if (!this.totp.verifyWithBackup(code, record.totpSecret, record.totpBackupCodes)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid two-factor code',
        code: 'TWO_FACTOR_INVALID_CODE',
      });
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null, totpBackupCodes: [] },
    });
    await this.audit.record({ actorId: user.id, action: 'auth.2fa_disabled', entityType: 'user', entityId: user.id });
  }

  // ───────────────────────── Helpers ─────────────────────────

  private async findForLogin(identifier: string) {
    const normalized = identifier.trim().toLowerCase();
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email: normalized }, { username: normalized }],
        isActive: true,
      },
    });
  }

  private invalidCredentials(message = 'Invalid credentials') {
    return new UnauthorizedException({
      statusCode: 401,
      error: 'Unauthorized',
      message,
      code: 'INVALID_CREDENTIALS',
    });
  }

  private invalidRefresh() {
    return new UnauthorizedException({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid or expired session',
      code: 'INVALID_REFRESH_TOKEN',
    });
  }

  private isBackupCode(code: string, codes: string[]): boolean {
    const normalized = code.replace(/[\s-]/g, '').toUpperCase();
    return codes.includes(normalized);
  }

  toPrivate(user: {
    id: string;
    username: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    bio: string | null;
    website: string | null;
    role: 'admin' | 'user';
    isActive: boolean;
    emailConfirmedAt: Date | null;
    totpEnabled: boolean;
    locale: string;
    theme: string;
    createdAt: Date;
    updatedAt: Date;
  }): UserPrivate {
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
}

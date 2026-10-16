import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  Headers,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  changePasswordSchema,
  confirmEmailSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@flygit/shared';
import type { ConfirmEmailInput, ForgotPasswordInput, LoginInputDto, RegisterInput, ResetPasswordInput } from '@flygit/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { clientIp, userAgent } from '../common/utils/request.util';
import { AuthService } from './auth.service';
import { REFRESH_COOKIE } from './jwt-auth.guard';
import { sha256 } from '../common/utils/crypto.util';

const REFRESH_PATH = '/api/v1/auth';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private meta(req: Request) {
    return {
      ip: clientIp(req, process.env.TRUST_PROXY === 'true'),
      userAgent: userAgent(req),
    };
  }

  private setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: REFRESH_PATH,
      expires: expiresAt,
    });
  }

  // ───────────────────────── Registration ─────────────────────────

  @Public()
  @Post('register')
  @HttpCode(201)
  @RateLimit({ namespace: 'register', windowSeconds: 3600, max: 10 })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) input: RegisterInput,
    @Req() req: Request,
  ) {
    return this.auth.register(input, this.meta(req));
  }

  @Public()
  @Post('confirm-email')
  @HttpCode(200)
  @RateLimit({ namespace: 'confirm', windowSeconds: 3600, max: 30 })
  async confirmEmail(@Body(new ZodValidationPipe(confirmEmailSchema)) input: ConfirmEmailInput) {
    return this.auth.confirmEmail(input);
  }

  @Public()
  @Post('resend-confirmation')
  @HttpCode(202)
  @RateLimit({ namespace: 'resend', windowSeconds: 3600, max: 10 })
  async resendConfirmation(@Body() body: { email?: string }) {
    if (typeof body.email === 'string' && body.email.length <= 254) {
      await this.auth.resendConfirmation(body.email.trim().toLowerCase());
    }
    return { accepted: true };
  }

  // ───────────────────────── Login / logout ─────────────────────────

  @Public()
  @Post('login')
  @HttpCode(200)
  @RateLimit({ namespace: 'login', windowSeconds: 900, max: 15 })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginInputDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(input, this.meta(req));
    if ('requiresTwoFactor' in result) return result;
    this.setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
    return {
      user: result.user,
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    };
  }

  @Public()
  @Post('2fa/login')
  @HttpCode(200)
  @RateLimit({ namespace: '2fa-login', windowSeconds: 900, max: 15 })
  async loginWithTwoFactor(
    @Body() body: { challengeToken?: string; code?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.loginWithTwoFactor(
      String(body.challengeToken ?? ''),
      String(body.code ?? ''),
      this.meta(req),
    );
    this.setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
    return { user: result.user, accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const bodyToken = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
    const result = await this.auth.refresh(cookie ?? bodyToken, this.meta(req));
    this.setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const bodyToken = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
    await this.auth.logout(cookie ?? bodyToken);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.logoutAll(user.id);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
    return result;
  }

  @Get('sessions')
  async sessions(@CurrentUser() user: AuthUser, @Headers('authorization') auth?: string) {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    return this.auth.listSessions(user.id, token ? sha256(token) : null);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.auth.revokeSessionById(user.id, id);
  }

  // ───────────────────────── Password ─────────────────────────

  @Public()
  @Post('password-reset')
  @HttpCode(202)
  @RateLimit({ namespace: 'pw-reset', windowSeconds: 3600, max: 5 })
  async requestPasswordReset(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) input: ForgotPasswordInput,
  ) {
    await this.auth.requestPasswordReset(input);
    return { accepted: true };
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(204)
  @RateLimit({ namespace: 'pw-reset-confirm', windowSeconds: 3600, max: 20 })
  async confirmPasswordReset(
    @Body(new ZodValidationPipe(resetPasswordSchema)) input: ResetPasswordInput,
  ) {
    await this.auth.resetPassword(input);
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) input: { currentPassword: string; newPassword: string },
  ) {
    await this.auth.changePassword(user, input.currentPassword, input.newPassword);
  }

  // ───────────────────────── Two-factor ─────────────────────────

  @Post('2fa/setup')
  @HttpCode(201)
  async setupTwoFactor(@CurrentUser() user: AuthUser) {
    return this.auth.setupTwoFactor(user);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  async enableTwoFactor(@CurrentUser() user: AuthUser, @Body() body: { code?: string }) {
    return this.auth.enableTwoFactor(user, String(body.code ?? ''));
  }

  @Post('2fa/disable')
  @HttpCode(204)
  async disableTwoFactor(@CurrentUser() user: AuthUser, @Body() body: { code?: string }) {
    await this.auth.disableTwoFactor(user, String(body.code ?? ''));
  }
}

import { Injectable, type CanActivate, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { TokenService } from './token.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

export const REFRESH_COOKIE = 'fg_refresh';

/** Reads `Authorization: Bearer`, `Authorization: Basic` or the refresh cookie. */
export function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

/**
 * Global authentication guard. Routes are protected by default;
 * mark them with `@Public()` to allow anonymous access.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = extractToken(request);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    request.user = this.tokens.verifyAccessToken(token);
    return true;
  }
}

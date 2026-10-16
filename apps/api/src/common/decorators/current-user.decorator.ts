import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { PlatformRole } from '@flygit/shared';

/** Shape attached to `req.user` by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  username: string;
  email: string;
  isAdmin: boolean;
  role: PlatformRole;
}

export const CurrentUser = createParamDecorator(
  (_data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return request.user;
  },
);

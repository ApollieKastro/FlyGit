import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './current-user.decorator';

/**
 * Resolves the caller if a valid token was sent, otherwise `undefined`.
 * Routes using this decorator must be marked `@Public()` — the global
 * JwtAuthGuard still verifies a token when one is present.
 */
export const OptionalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return request.user;
  },
);

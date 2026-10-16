import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RATE_LIMIT_KEY, type RateLimitOptions } from '../common/decorators/rate-limit.decorator';
import { RedisService } from '../redis/redis.service';
import { clientIp, rateLimitKey } from '../common/utils/request.util';

/**
 * Redis-backed fixed-window rate limiter for sensitive endpoints
 * (login, password reset, registration). Degrades to "allow" when Redis
 * is down so that an infra outage never locks everyone out.
 *
 * Enable via `@RateLimit({ windowSeconds, max, namespace })`.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const identifier =
      typeof body.identifier === 'string'
        ? body.identifier
        : typeof body.email === 'string'
          ? body.email
          : '';
    const key = rateLimitKey(
      options.namespace,
      clientIp(req, process.env.TRUST_PROXY === 'true'),
      identifier,
    );
    const count = await this.redis.incrWithTtl(key, options.windowSeconds);
    if (count > options.max) {
      throw new HttpException(
        {
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'Too many attempts, please try again later',
          code: 'RATE_LIMITED',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

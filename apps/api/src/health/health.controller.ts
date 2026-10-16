import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { APP_VERSION } from '../config/configuration';
import type { HealthResponse } from '@flygit/shared';

@Controller()
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Load-balancer / Docker healthcheck endpoint. */
  @Public()
  @Get('healthz')
  async healthz(): Promise<HealthResponse> {
    const checks: HealthResponse['checks'] = {};

    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = { status: 'up', latencyMs: Date.now() - dbStart };
    } catch {
      checks.postgres = { status: 'down' };
    }

    checks.redis = { status: this.redis.isAvailable ? 'up' : 'down' };

    const status = checks.postgres.status === 'up' ? 'ok' : 'degraded';
    return {
      status,
      version: APP_VERSION,
      uptime: Math.round((Date.now() - this.startedAt) / 1000),
      checks,
    };
  }

  @Public()
  @Get('healthz/ready')
  async ready(): Promise<{ ready: boolean }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ready: true };
    } catch {
      return { ready: false };
    }
  }
}

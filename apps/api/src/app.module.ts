import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuditModule } from './audit/audit.module';
import { MailModule } from './mail/mail.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { GitModule } from './git/git.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { IssuesModule } from './issues/issues.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RateLimitGuard } from './auth/rate-limit.guard';
import { PlatformAdminGuard } from './common/guards/platform-admin.guard';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        autoLogging: {
          ignore: (req) => req.url === '/healthz' || req.url === '/api/v1/healthz',
        },
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
            : undefined,
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie'],
          censor: '[redacted]',
        },
      },
    }),
    // Baseline protection for every endpoint; sensitive routes add @RateLimit.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    RedisModule,
    AuditModule,
    MailModule,
    AuthModule,
    UsersModule,
    GitModule,
    RepositoriesModule,
    OrganizationsModule,
    IssuesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PlatformAdminGuard },
  ],
})
export class AppModule {}

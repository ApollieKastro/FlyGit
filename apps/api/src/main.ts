import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { validateEnv } from './config/validate-env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ensureHookSecret } from './git/git-hooks.controller';

async function bootstrap(): Promise<void> {
  // Fail fast on invalid configuration before any module is constructed.
  const env = validateEnv(process.env);
  // Shared secret for pre/post-receive hooks (see docs/SECURITY.md).
  ensureHookSecret();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.setGlobalPrefix('api/v1', {
    // Git transport and healthchecks live at well-known root paths.
    exclude: ['healthz', 'healthz/ready', 'git', 'git/(.*)'],
  });
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.enableCors({
    origin: process.env.APP_URL ?? 'http://localhost:3000',
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.use(cookieParser());
  app.getHttpAdapter().getInstance().set('trust proxy', env.TRUST_PROXY);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  await app.listen(env.PORT, env.HOST);
  app.get(Logger).log(`FlyGit API listening on http://${env.HOST}:${env.PORT}/api/v1`, 'Bootstrap');
}

void bootstrap();

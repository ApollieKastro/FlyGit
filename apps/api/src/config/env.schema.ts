import { z } from 'zod';

/**
 * Environment schema — fail fast on misconfiguration.
 * Every variable below must exist in `deploy/.env.example`.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    /** Public base URL used for links in emails and git clone URLs. */
    APP_URL: z.string().url().default('http://localhost:3000'),
    API_URL: z.string().url().default('http://localhost:3001'),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

    /** Directory where bare git repositories are stored. */
    GIT_STORAGE_DIR: z.string().default('./storage/git'),
    /** Directory for object storage when STORAGE_DRIVER=local. */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage/uploads'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: z.coerce.boolean().default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().default('FlyGit <noreply@flygit.local>'),
    /** `log` prints emails to stdout — handy in development. */
    MAIL_DRIVER: z.enum(['smtp', 'log', 'none']).default('log'),

    /** Restrict registration to invitations only. */
    REGISTRATION_MODE: z.enum(['open', 'invite']).default('open'),
    /** Disable public sign-ups entirely (admin bootstraps users). */
    ALLOW_REGISTRATION: z.coerce.boolean().default(true),
    CONFIRM_EMAIL_REQUIRED: z.coerce.boolean().default(true),

    /** Git over SSH listener (0 disables the server). */
    SSH_PORT: z.coerce.number().int().positive().default(2222),
    SSH_ENABLED: z.coerce.boolean().default(true),
    SSH_HOST_KEY_PATH: z.string().default('./storage/ssh/host_ed25519'),

    /** Base url for webhooks fired by the platform. */
    WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    TRUST_PROXY: z.coerce.boolean().default(false),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3') {
      if (!env.S3_BUCKET) {
        ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'Required when STORAGE_DRIVER=s3' });
      }
      if (!env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) {
        ctx.addIssue({ code: 'custom', path: ['S3_ACCESS_KEY'], message: 'Required when STORAGE_DRIVER=s3' });
      }
    }
    if (env.MAIL_DRIVER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'Required when MAIL_DRIVER=smtp' });
    }
  });

export type Env = z.infer<typeof envSchema>;

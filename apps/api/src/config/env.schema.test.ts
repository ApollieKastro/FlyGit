import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema';

/** Minimal valid baseline — most fields have defaults. */
const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/flygit',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('envSchema', () => {
  it('accepts a minimal valid configuration', () => {
    const result = envSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('requires DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(envSchema.safeParse(rest).success).toBe(false);
  });

  it('requires JWT secrets of at least 16 characters', () => {
    expect(envSchema.safeParse({ ...base, JWT_ACCESS_SECRET: 'short' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, JWT_REFRESH_SECRET: 'short' }).success).toBe(false);
  });

  it('applies sensible defaults', () => {
    const parsed = envSchema.parse(base);
    expect(parsed.PORT).toBe(3000);
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.MAIL_DRIVER).toBe('log');
    expect(parsed.REGISTRATION_MODE).toBe('open');
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(envSchema.safeParse({ ...base, NODE_ENV: 'staging' }).success).toBe(false);
  });

  it('requires SMTP_HOST when MAIL_DRIVER=smtp', () => {
    expect(envSchema.safeParse({ ...base, MAIL_DRIVER: 'smtp' }).success).toBe(false);
    expect(
      envSchema.safeParse({ ...base, MAIL_DRIVER: 'smtp', SMTP_HOST: 'mail.example.com' }).success,
    ).toBe(true);
  });

  it('requires S3 credentials when STORAGE_DRIVER=s3', () => {
    expect(envSchema.safeParse({ ...base, STORAGE_DRIVER: 's3' }).success).toBe(false);
    expect(
      envSchema.safeParse({
        ...base,
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'flygit',
        S3_ACCESS_KEY: 'key',
        S3_SECRET_KEY: 'secret',
      }).success,
    ).toBe(true);
  });
});

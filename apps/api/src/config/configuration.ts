import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from './env.schema';

export const APP_VERSION =
  process.env.npm_package_version ??
  (() => {
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
        version: string;
      };
      return pkg.version;
    } catch {
      return '0.0.0';
    }
  })();

/** Typed accessor for validated environment variables. */
export function getEnv(): Env {
  const env = process.env as unknown as Env;
  if (!env.DATABASE_URL || !env.JWT_ACCESS_SECRET) {
    throw new Error('Environment is not initialized — call validateEnv() first');
  }
  return env;
}

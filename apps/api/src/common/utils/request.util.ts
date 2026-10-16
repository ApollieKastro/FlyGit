import { createHash } from 'node:crypto';
import type { Request } from 'express';

/** Extracts client IP honouring X-Forwarded-For when trust proxy is enabled. */
export function clientIp(req: Request, trustProxy = false): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const first = Array.isArray(xff) ? xff[0] : xff;
    if (first) return first.split(',')[0]!.trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** Stable key for per-identifier rate limits (login, password reset). */
export function rateLimitKey(prefix: string, ...parts: string[]): string {
  const raw = parts.join('|');
  return `${prefix}:${createHash('sha256').update(raw).digest('hex').slice(0, 32)}`;
}

/** Minimal user-agent truncation for session storage. */
export function userAgent(req: Request): string | null {
  const ua = req.headers['user-agent'];
  return ua ? ua.slice(0, 300) : null;
}

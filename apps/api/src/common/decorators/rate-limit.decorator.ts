import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  /** Window in seconds. */
  windowSeconds: number;
  /** Max attempts per window. */
  max: number;
  /** Key namespace so different endpoints do not share counters. */
  namespace: string;
}

/** Applies Redis-backed rate limiting to a route. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

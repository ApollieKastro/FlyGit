import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random token (default 32 bytes ≈ 43 chars). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest — used to store opaque tokens without plaintext. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Constant-time string comparison (length-safe). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to keep timing uniform, then fail.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** `main` → `feat/...`-style safe slug for repository names. */
export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+/, '')
    .replace(/[._-]+$/, '')
    .slice(0, 100);
}

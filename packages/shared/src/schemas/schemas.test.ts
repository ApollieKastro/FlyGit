import { describe, expect, it } from 'vitest';
import { loginSchema, passwordSchema, registerSchema, usernameSchema } from './auth';
import { createRepositorySchema } from './repository';
import { roleAtLeast, ROLE_WEIGHT } from './constants';

describe('auth schemas', () => {
  it('accepts a valid registration payload', () => {
    const result = registerSchema.safeParse({
      email: 'dev@flygit.io',
      username: 'dev-user',
      password: 'Sup3rSecret',
      acceptTerms: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects registration without terms acceptance', () => {
    const result = registerSchema.safeParse({
      email: 'dev@flygit.io',
      username: 'devuser',
      password: 'Sup3rSecret',
      acceptTerms: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects weak passwords', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false);
    expect(passwordSchema.safeParse('alllettersonly').success).toBe(false);
    expect(passwordSchema.safeParse('1234567890').success).toBe(false);
  });

  it('normalizes username to lowercase', () => {
    const parsed = usernameSchema.parse('DevUser');
    expect(parsed).toBe('devuser');
  });

  it('requires 6-digit TOTP code when provided', () => {
    expect(loginSchema.safeParse({ identifier: 'a', password: 'b', totpCode: '12' }).success).toBe(
      false,
    );
    expect(
      loginSchema.safeParse({ identifier: 'a', password: 'b', totpCode: '123456' }).success,
    ).toBe(true);
  });
});

describe('repository schemas', () => {
  it('defaults to a private repository with README', () => {
    const parsed = createRepositorySchema.parse({ name: 'flygit' });
    expect(parsed.visibility).toBe('private');
    expect(parsed.initialize).toBe(true);
    expect(parsed.defaultBranch).toBe('main');
  });

  it('rejects invalid repository names', () => {
    expect(createRepositorySchema.safeParse({ name: '' }).success).toBe(false);
    expect(createRepositorySchema.safeParse({ name: 'a/b' }).success).toBe(false);
  });
});

describe('roleAtLeast', () => {
  it('respects role ordering', () => {
    expect(roleAtLeast('admin', 'developer')).toBe(true);
    expect(roleAtLeast('developer', 'maintainer')).toBe(false);
    expect(roleAtLeast(null, 'guest')).toBe(false);
    expect(roleAtLeast('owner', 'admin')).toBe(true);
  });

  it('defines weights for every documented role', () => {
    for (const role of ['guest', 'reporter', 'developer', 'maintainer', 'admin', 'owner']) {
      expect(ROLE_WEIGHT[role]).toBeGreaterThan(0);
    }
  });
});

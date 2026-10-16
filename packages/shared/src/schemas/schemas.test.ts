import { describe, expect, it } from 'vitest';
import { loginSchema, passwordSchema, registerSchema, usernameSchema } from './auth';
import { createRepositorySchema } from './repository';
import { createIssueSchema, updateIssueSchema, issueCommentSchema } from './issue';
import { createMergeRequestSchema, mergeSchema } from './merge-request';
import { roleAtLeast, ROLE_WEIGHT } from '../constants';

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

describe('issue schemas', () => {
  it('accepts a valid issue with a title only', () => {
    expect(createIssueSchema.safeParse({ title: 'Bug report' }).success).toBe(true);
  });

  it('rejects an empty title', () => {
    expect(createIssueSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('accepts status transitions on update', () => {
    expect(updateIssueSchema.safeParse({ status: 'closed' }).success).toBe(true);
    expect(updateIssueSchema.safeParse({ status: 'open' }).success).toBe(true);
    expect(updateIssueSchema.safeParse({ status: 'bogus' }).success).toBe(false);
  });

  it('requires a non-empty comment body', () => {
    expect(issueCommentSchema.safeParse({ body: '' }).success).toBe(false);
    expect(issueCommentSchema.safeParse({ body: 'looks good' }).success).toBe(true);
  });
});

describe('merge request schemas', () => {
  it('accepts a valid merge request', () => {
    const result = createMergeRequestSchema.safeParse({
      sourceBranch: 'feature',
      targetBranch: 'main',
      title: 'Add dark mode',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.draft).toBe(false);
      expect(result.data.autoCloseIssues).toBe(true);
    }
  });

  it('rejects missing branches', () => {
    expect(createMergeRequestSchema.safeParse({ title: 'x' }).success).toBe(false);
  });

  it('defaults merge strategy to merge and deletes the source branch', () => {
    const result = mergeSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.strategy).toBe('merge');
      expect(result.data.deleteSourceBranch).toBe(true);
    }
  });

  it('rejects an unsupported merge strategy', () => {
    expect(mergeSchema.safeParse({ strategy: 'fast-forward-only' }).success).toBe(false);
  });
});

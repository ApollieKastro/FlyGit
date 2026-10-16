import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('resolves Tailwind conflicts (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('ignores falsy values', () => {
    const skip = false;
    expect(cn('a', skip && 'b', undefined, null)).toBe('a');
  });

  it('handles conditional objects', () => {
    expect(cn({ 'font-bold': true, 'italic': false }, 'text-sm')).toBe('font-bold text-sm');
  });
});

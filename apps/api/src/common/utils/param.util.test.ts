import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { parseNumberParam } from './param.util';

describe('parseNumberParam', () => {
  it('parses a valid positive integer', () => {
    expect(parseNumberParam('42')).toBe(42);
    expect(parseNumberParam('1')).toBe(1);
  });

  it('throws NotFoundException for a UUID (not a number)', () => {
    expect(() => parseNumberParam('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Issue')).toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException for zero and negatives', () => {
    expect(() => parseNumberParam('0')).toThrow(NotFoundException);
    expect(() => parseNumberParam('-5')).toThrow(NotFoundException);
  });

  it('throws NotFoundException for non-numeric strings', () => {
    expect(() => parseNumberParam('abc')).toThrow(NotFoundException);
    expect(() => parseNumberParam('')).toThrow(NotFoundException);
    expect(() => parseNumberParam('1.5')).toThrow(NotFoundException);
  });

  it('uses the provided entity name in the error message', () => {
    try {
      parseNumberParam('abc', 'Merge request');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundException);
      const response = (err as NotFoundException).getResponse() as { message: string };
      expect(response.message).toContain('Merge request');
    }
  });
});

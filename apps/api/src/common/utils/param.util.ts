import { NotFoundException } from '@nestjs/common';

/**
 * Parses a `:number` path parameter into a positive integer.
 * Throws 404 when the value is not a valid issue/MR number so that
 * malformed URLs (e.g. a UUID where a number is expected) do not reach
 * Prisma and surface as a 500.
 */
export function parseNumberParam(value: string, entity = 'resource'): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new NotFoundException({
      statusCode: 404,
      error: 'Not Found',
      message: `${entity} not found`,
      code: 'NOT_FOUND',
    });
  }
  return parsed;
}

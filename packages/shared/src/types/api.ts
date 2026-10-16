/** Standard API error payload. */
export interface ApiError {
  statusCode: number;
  error: string;
  message: string | string[];
  /** Machine-readable error code (e.g. `INVALID_CREDENTIALS`). */
  code?: string;
  /** Field-level validation details. */
  details?: Record<string, string[]>;
}

/** Cursor-based pagination envelope. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

/** Health check payload returned by `/healthz`. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptime: number;
  checks: Record<string, { status: 'up' | 'down'; latencyMs?: number }>;
}

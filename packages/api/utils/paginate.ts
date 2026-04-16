export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Parse `page` and `limit` from query string.
 * Defaults: page=1, limit=defaultLimit (capped at 200).
 */
export function parsePagination(
  query: Record<string, any>,
  defaultLimit = 20,
): PaginationParams {
  const page = Math.max(1, parseInt(query.page as string) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit as string) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * Returns true when the request explicitly asks for pagination.
 * Used to decide the response shape (array vs. envelope).
 */
export function hasPaginationParams(query: Record<string, any>): boolean {
  return query.page !== undefined || query.limit !== undefined;
}

/**
 * Wrap an array with pagination metadata.
 */
export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

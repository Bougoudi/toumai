import { env } from '../../config/env.js';

export interface PageParams {
  page: number;
  limit: number;
  skip: number;
}

/** Normalise `page`/`limit` (bornés) pour une pagination côté serveur. */
export function pageParams(query: { page?: unknown; limit?: unknown }): PageParams {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const requested = Number(query.limit ?? env.touma.pageSize) || env.touma.pageSize;
  const limit = Math.min(env.touma.maxPageSize, Math.max(1, requested));
  return { page, limit, skip: (page - 1) * limit };
}

/** Enveloppe standard d'une liste paginée. */
export function paginated<T>(items: T[], total: number, { page, limit }: PageParams) {
  return {
    items,
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    hasNext: page * limit < total,
  };
}

import { z } from "zod";

/** 分页响应（架构 §7.5）：limit 默认 20/上限 100，offset 上限 10000。 */
export const PaginatedResponseSchema = z.object({
  items: z.array(z.unknown()),
  count: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
});

export type PaginatedResponse<T> = {
  items: T[];
  count: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
export const MAX_PAGE_OFFSET = 10000;

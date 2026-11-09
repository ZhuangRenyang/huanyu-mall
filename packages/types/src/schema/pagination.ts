import { z } from "zod";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, MAX_PAGE_OFFSET } from "../pagination.js";

/**
 * 列表分页查询参数（架构 §7.5）。
 * 超过上限直接 400（不静默截断）；order 走白名单防注入。
 */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  offset: z.coerce.number().int().min(0).max(MAX_PAGE_OFFSET).default(0),
  order: z.string().regex(/^[a-z_]+\.(asc|desc)$/).optional(),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

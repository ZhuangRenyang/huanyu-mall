import { z } from "zod";

/** 全链路 SnakeCase DTO 约定：字段名蛇形（variant_id / amount_minor / created_at）。 */

/** 软删 + 时间戳基座（架构 §1.2 不变式 6/坑 4）。时间一律 timestamptz UTC。 */
export type Timestamps = {
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/** ISO 4217 货币代码，长度 3 大写。 */
export const CurrencyCodeSchema = z.string().length(3).regex(/^[A-Z]{3}$/);
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

/** 金额最小单位（架构 §1.2 不变式 5）：bigint，禁浮点。 */
export type AmountMinor = bigint;

/** 模块实体 id 前缀约定（架构 §4.3 / §7.8），id 形如 `<prefix>_<ulid>`。 */
export const ID_PREFIXES = [
  "prod", "var", "ptype", "attr", "attrv",
  "price_set", "price", "plist",
  "region", "chan",
  "cart", "li", "ship_opt", "ship_zone",
  "ord", "oline", "pay", "psess", "ref", "pprov",
  "inv_item", "loc", "inv_lvl", "resv",
  "ful", "ship", "tax",
  "cust", "addr", "auth", "rt", "admin", "role",
  "evt", "file", "theme",
  "lnk", "wf",
] as const;

export type IdPrefix = (typeof ID_PREFIXES)[number];

export function isIdWithPrefix(value: unknown, prefix: IdPrefix): value is string {
  return typeof value === "string" && value.startsWith(`${prefix}_`);
}

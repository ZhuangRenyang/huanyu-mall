import type { LinkableDefinition } from "@mall/core";

/**
 * 声明本模块哪些实体/字段可被 links join（白名单，架构 §4.4）。
 * channel 是 product_channel / price_list_channel / tax_rate_channel 等关联的一端。
 */
export const linkable: LinkableDefinition[] = [
  {
    entity: "channel",
    fields: [
      "id",
      "name",
      "slug",
      "currency_code",
      "region_id",
      "default_locale",
      "market_scope",
      "is_active",
    ],
  },
];

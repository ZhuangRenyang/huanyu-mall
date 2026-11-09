import type { LinkableDefinition } from "@mall/core";

/** 声明本模块可被 links join 的白名单（架构 §4.4）。 */
export const linkable: LinkableDefinition[] = [
  {
    entity: "product",
    fields: ["id", "title", "handle", "status", "thumbnail_file_id", "product_type_id"],
  },
  {
    entity: "variant",
    fields: ["id", "product_id", "sku", "title", "options", "status"],
  },
];

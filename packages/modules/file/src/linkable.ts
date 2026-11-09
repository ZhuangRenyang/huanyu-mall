import type { LinkableDefinition } from "@mall/core";

/** file 经 product_image_file 被 product 关联；声明可 join 白名单。 */
export const linkable: LinkableDefinition[] = [
  { entity: "file", fields: ["id", "key", "content_type", "size_bytes", "storage_provider"] },
];

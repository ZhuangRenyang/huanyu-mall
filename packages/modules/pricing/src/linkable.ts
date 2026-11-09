import type { LinkableDefinition } from "@mall/core";

/** price_set 经 variant_price_set 被 product 关联；声明可 join 白名单。 */
export const linkable: LinkableDefinition[] = [{ entity: "price_set", fields: ["id"] }];
